import * as THREE from 'three'
import { URDFParser } from './URDFParser.js'
import { MeshLoader }  from './MeshLoader.js'

// 跨 URDFModel 实例共享的 MeshLoader 单例（缓存不随 dispose 丢失）
let _sharedMeshLoader = null
function getSharedMeshLoader(proxyBase = '/api/urdf') {
  if (!_sharedMeshLoader) _sharedMeshLoader = new MeshLoader(proxyBase)
  return _sharedMeshLoader
}

/**
 * URDFModel — 在 Three.js 场景中加载并管理 URDF 机器人模型
 */
export class URDFModel {
  constructor(parent, options = {}) {
    this._parent     = parent
    this._meshLoader = getSharedMeshLoader(options.proxyBase ?? '/api/urdf')
    this._root       = new THREE.Group()
    this._root.name  = 'urdf_model'
    this._linkNodes  = new Map()   // linkName -> THREE.Group
    this._jointNodes = new Map()   // jointName -> THREE.Group (joint pivot)
    this._parsed     = null
    this._loaded     = false
  }

  // ── Public API ───────────────────────────────────────────────────────

  async loadFromString(urdfText) {
    console.log(`[URDFModel] loadFromString called, length=${urdfText?.length}, preview=${urdfText?.slice(0,80)}`)
    this._disposeModel()

    await URDFModel._yieldToMainThread()
    this._parsed = await URDFModel._parseWithWorker(urdfText)
    console.log(`[URDFModel] parsed: robot=${this._parsed.name}, links=${this._parsed.links.size}, joints=${this._parsed.joints.size}`)

    await URDFModel._yieldToMainThread()
    await this._build()

    await URDFModel._yieldToMainThread()
    this._parent.add(this._root)
    this._loaded = true
    console.log(`[URDFModel] Loaded robot: ${this._parsed.name}, root children=${this._root.children.length}`)
  }

  /**
   * 从 ROS DataManager 订阅 /robot_description 加载
   */
  loadFromTopic(topic = '/robot_description', rosDataManager) {
    rosDataManager.subscribe(topic, (msg) => {
      const text = msg?.data ?? msg
      if (typeof text === 'string' && text.includes('<robot')) {
        this.loadFromString(text).catch(e => console.error('[URDFModel]', e))
      }
    })
  }

  /** 设置关节角度（弧度） */
  setJointAngle(jointName, angle) {
    const pivot = this._jointNodes.get(jointName)
    const joint = this._parsed?.joints.get(jointName)
    if (!pivot || !joint) return
    const axis = new THREE.Vector3(joint.axis.x, joint.axis.y, joint.axis.z)
    pivot.setRotationFromAxisAngle(axis, angle)
  }

  get isLoaded() { return this._loaded }

  // ── Build ────────────────────────────────────────────────────────────

  async _build() {
    const { links, joints } = this._parsed
    console.log(`[URDFModel] _build: ${links.size} links, ${joints.size} joints`)

    let createdLinks = 0
    for (const [name] of links.entries()) {
      const g = new THREE.Group()
      g.name = `link_${name}`
      this._linkNodes.set(name, g)
      createdLinks += 1
      if (createdLinks % 40 === 0) await URDFModel._yieldToMainThread()
    }

    const childLinks = new Set()
    joints.forEach(j => childLinks.add(j.child))
    let rootLinkName = null
    links.forEach((_, name) => { if (!childLinks.has(name)) rootLinkName = name })
    if (!rootLinkName) rootLinkName = links.keys().next().value
    console.log(`[URDFModel] root link: ${rootLinkName}`)

    this._root.add(this._linkNodes.get(rootLinkName))
    this._attachChildren(rootLinkName, joints)

    const visualTasks = []
    for (const [name, link] of links.entries()) {
      const node = this._linkNodes.get(name)
      for (const visual of link.visuals) {
        visualTasks.push(() => this._addVisual(node, visual))
      }
    }

    console.log(`[URDFModel] loading ${visualTasks.length} visuals...`)
    await this._runWithConcurrency(visualTasks, 4)
    console.log('[URDFModel] all visuals loaded')
  }

  _attachChildren(parentLinkName, joints) {
    joints.forEach((joint, jName) => {
      if (joint.parent !== parentLinkName) return
      const pivot = new THREE.Group()
      pivot.name  = `joint_${jName}`
      URDFModel._applyOrigin(pivot, joint.origin)
      const childNode  = this._linkNodes.get(joint.child)
      const parentNode = this._linkNodes.get(parentLinkName)
      if (childNode)  pivot.add(childNode)
      if (parentNode) parentNode.add(pivot)
      this._jointNodes.set(jName, pivot)
      this._attachChildren(joint.child, joints)
    })
  }

  async _addVisual(linkNode, visual) {
    const { origin, geometry } = visual
    if (!geometry) return

    let obj
    if (geometry.type === 'mesh') {
      const loaded = await this._meshLoader.load(geometry.filename)
      obj = loaded.clone(true)
      const s = geometry.scale
      if (s && (s.x !== 0 || s.y !== 0 || s.z !== 0)) {
        obj.scale.set(s.x || 1, s.y || 1, s.z || 1)
      }
    } else {
      obj = URDFModel._buildPrimitive(geometry)
    }
    if (!obj) return

    URDFModel._applyOrigin(obj, origin)
    linkNode.add(obj)
  }

  async _runWithConcurrency(tasks, maxConcurrency = 4) {
    if (!tasks.length) return
    const queue = [...tasks]
    const workers = Array.from({ length: Math.min(maxConcurrency, tasks.length) }, async () => {
      while (queue.length) {
        const task = queue.shift()
        if (!task) return
        await task()
        await URDFModel._yieldToMainThread()
      }
    })
    await Promise.all(workers)
  }

  static async _parseWithWorker(urdfText) {
    try {
      const worker = new Worker(new URL('./URDFParseWorker.js', import.meta.url), { type: 'module' })
      const payload = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('URDF parse worker timeout'))
        }, 15000)

        worker.onmessage = (e) => {
          clearTimeout(timer)
          const { ok, data, error } = e.data || {}
          if (!ok) reject(new Error(error || 'URDF parse worker failed'))
          else resolve(data)
        }
        worker.onerror = (e) => {
          clearTimeout(timer)
          reject(e.error || new Error(e.message || 'URDF parse worker error'))
        }

        worker.postMessage({ urdfText })
      })

      worker.terminate()
      return URDFModel._deserializeParsed(payload)
    } catch (e) {
      console.warn('[URDFModel] worker parse failed, fallback to main thread:', e)
      return URDFParser.parse(urdfText)
    }
  }

  static _deserializeParsed(payload) {
    const links = new Map((payload.links || []).map(([name, link]) => [name, link]))
    const joints = new Map((payload.joints || []).map(([name, joint]) => [name, joint]))
    return { name: payload.name || 'robot', links, joints }
  }

  static _yieldToMainThread() {
    return new Promise(resolve => setTimeout(resolve, 0))
  }

  // ── Static helpers ───────────────────────────────────────────────────

  static _applyOrigin(obj, origin) {
    if (!origin) return
    const { xyz, rpy } = origin
    obj.position.set(xyz.x, xyz.y, xyz.z)
    const euler = new THREE.Euler(rpy.r, rpy.p, rpy.y, 'XYZ')
    obj.quaternion.setFromEuler(euler)
  }

  static _buildPrimitive(geometry) {
    let geo
    const mat = new THREE.MeshStandardMaterial({ color: 0x888888 })
    if (geometry.type === 'box') {
      const s = geometry.size
      geo = new THREE.BoxGeometry(s.x, s.y, s.z)
    } else if (geometry.type === 'cylinder') {
      geo = new THREE.CylinderGeometry(geometry.radius, geometry.radius, geometry.length, 16)
    } else if (geometry.type === 'sphere') {
      geo = new THREE.SphereGeometry(geometry.radius, 16, 12)
    } else {
      return null
    }
    return new THREE.Mesh(geo, mat)
  }

  // ── Dispose ──────────────────────────────────────────────────────────

  _disposeModel() {
    if (this._root.parent) this._root.parent.remove(this._root)
    this._root.traverse(obj => {
      obj.geometry?.dispose()
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose())
      else obj.material?.dispose()
    })
    this._linkNodes.clear()
    this._jointNodes.clear()
    this._loaded = false
  }

  dispose() {
    this._disposeModel()
  }
}
