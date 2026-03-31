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
 *
 * 使用方法：
 *   const model = new URDFModel(rosRoot, { proxyBase: '/api/urdf' })
 *   await model.loadFromString(urdfText)
 *   model.setJointAngle('front_left_steering_joint', 0.3)
 *   model.dispose()
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
    this._parsed = URDFParser.parse(urdfText)
    console.log(`[URDFModel] parsed: robot=${this._parsed.name}, links=${this._parsed.links.size}, joints=${this._parsed.joints.size}`)
    await this._build()
    this._parent.add(this._root)
    this._loaded = true
    console.log(`[URDFModel] Loaded robot: ${this._parsed.name}, root children=${this._root.children.length}`)
  }

  /**
   * 从 ROS DataManager 订阅 /robot_description 加载
   * @param {string} topic
   * @param {object} rosDataManager  实现了 subscribe(topic, cb) 的数据管理器
   */
  loadFromTopic(topic = '/robot_description', rosDataManager) {
    rosDataManager.subscribe(topic, (msg) => {
      const text = msg?.data ?? msg
      if (typeof text === 'string' && text.includes('<robot')) {
        this.loadFromString(text).catch(e => console.error('[URDFModel]', e))
      }
    })
  }

  /**
   * 设置关节角度（弧度）
   * @param {string} jointName
   * @param {number} angle  弧度
   */
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

    // 为每个 link 创建 Group
    links.forEach((link, name) => {
      const g = new THREE.Group()
      g.name = `link_${name}`
      this._linkNodes.set(name, g)
    })

    // 找根 link（不是任何 joint 的 child）
    const childLinks = new Set()
    joints.forEach(j => childLinks.add(j.child))
    let rootLinkName = null
    links.forEach((_, name) => { if (!childLinks.has(name)) rootLinkName = name })
    if (!rootLinkName) rootLinkName = links.keys().next().value
    console.log(`[URDFModel] root link: ${rootLinkName}`)

    // 递归构建 link 树
    this._root.add(this._linkNodes.get(rootLinkName))
    this._attachChildren(rootLinkName, joints)

    // 并行加载所有 visual mesh
    const loadPromises = []
    links.forEach((link, name) => {
      const node = this._linkNodes.get(name)
      for (const visual of link.visuals) {
        loadPromises.push(this._addVisual(node, visual))
      }
    })
    console.log(`[URDFModel] loading ${loadPromises.length} visuals...`)
    await Promise.all(loadPromises)
    console.log(`[URDFModel] all visuals loaded`)
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
    if (!geometry) { console.log('[URDFModel] visual has no geometry, skip'); return }
    let obj
    if (geometry.type === 'mesh') {
      console.log(`[URDFModel] loading mesh: ${geometry.filename}`)
      const loaded = await this._meshLoader.load(geometry.filename)
      obj = loaded.clone(true)
      // 应用 mesh scale（如果 URDF 指定了）
      const s = geometry.scale
      if (s && (s.x !== 0 || s.y !== 0 || s.z !== 0)) {
        obj.scale.set(s.x || 1, s.y || 1, s.z || 1)
      }
    } else {
      console.log(`[URDFModel] building primitive: ${geometry.type}`)
      obj = URDFModel._buildPrimitive(geometry)
    }
    if (!obj) { console.warn('[URDFModel] _addVisual: obj is null after load'); return }
    URDFModel._applyOrigin(obj, origin)
    linkNode.add(obj)
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
    let geo, mat
    mat = new THREE.MeshStandardMaterial({ color: 0x888888 })
    if (geometry.type === 'box') {
      const s = geometry.size
      geo = new THREE.BoxGeometry(s.x, s.y, s.z)
    } else if (geometry.type === 'cylinder') {
      geo = new THREE.CylinderGeometry(
        geometry.radius, geometry.radius, geometry.length, 16
      )
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
    // 不 dispose 共享 MeshLoader，缓存保留供下次使用
  }
}
