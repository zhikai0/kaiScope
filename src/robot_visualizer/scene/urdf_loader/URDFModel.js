import * as THREE from 'three'
import { URDFParser }   from './URDFParser.js'
import { MeshLoader }    from './MeshLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { STLLoader }     from 'three/examples/jsm/loaders/STLLoader.js'

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
    this._axisCache  = new Map()   // jointName -> THREE.Vector3 (缓存轴向量)
    this._jointBaseQuats = new Map()  // jointName -> THREE.Quaternion (初始 origin 旋转)
    this._tempServerPath = null    // 拖拽模式下服务器临时路径
    this._blobUrls       = []      // 记录创建的 blob: URLs，dispose 时 revoke
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * 从 URDF 字符串加载（需要外部提供 fileMap 以加载 mesh/texture 资产）。
   * @param {string} urdfText  URDF XML 文本
   * @param {Map<string, File>} [fileMap]  可选，拖拽文件夹时的本地文件映射
   */
  async loadFromString(urdfText, fileMap = null) {
    this._disposeModel()
    this._tempServerPath = null

    if (fileMap && fileMap.size > 0) {
      await this._setupLocalMeshLoader(fileMap)
      urdfText = this._rewriteUrdfPaths(urdfText)
    }

    await URDFModel._yieldToMainThread()
    this._parsed = await URDFModel._parseWithWorker(urdfText)

    this._parsed.joints.forEach((joint, name) => {
      this._axisCache.set(name, new THREE.Vector3(joint.axis.x, joint.axis.y, joint.axis.z))
    })

    await URDFModel._yieldToMainThread()
    await this._build()

    this._parent.add(this._root)
    this._loaded = true
  }

  /**
   * 把拖拽的 File 对象转成 blob: URL，配置 BlobMeshLoader 直接从内存加载，
   * 改写 URDF 路径指向 blob URL。完全不需要服务器写入！
   * @param {Map<string, File>} fileMap  relativePath -> File
   */
  async _setupLocalMeshLoader(fileMap) {
    const t0 = Date.now()

    const keys = [...fileMap.keys()]
    const prefix = keys.find(k => k.includes('/'))?.match(/^[^/]+\//)?.[0] || ''
    this._folderPrefix = prefix

    // 并行创建所有 blob URL
    const entries = [...fileMap.entries()]
    const results = await Promise.all(
      entries.map(async ([relPath, file]) => {
        const key = prefix ? relPath.replace(new RegExp('^' + prefix), '') : relPath
        const blob    = new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' })
        const blobUrl = URL.createObjectURL(blob)
        return [key, blobUrl]
      })
    )

    this._blobMap = new Map(results.map(([k, u]) => [k, u]))
    results.forEach(([, u]) => this._blobUrls.push(u))
    console.log(`[URDFModel] created ${this._blobUrls.length} blob URLs in ${Date.now() - t0}ms`)

    this._meshLoader    = new BlobMeshLoader(this._blobMap, _sharedMeshLoader)
    this._serverUrl     = null
    this._tempServerPath = null
  }

  /**
   * 改写 URDF 中的 package:// 和 file:// 路径为 blob URL。
   * blob URL 模式不需要改写（BlobMeshLoader._resolveUrl 直接查 Map），直接返回原文本。
   */
  _rewriteUrdfPaths(urdfText) {
    return urdfText
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
    if (!pivot) return
    const axis = this._axisCache.get(jointName)
    if (!axis) return
    const axisQuat = new THREE.Quaternion().setFromAxisAngle(axis, angle)
    // 正确顺序：先应用 origin 旋转（baseQuat），再应用关节旋转（axisQuat）
    pivot.quaternion.copy(this._jointBaseQuats.get(jointName)).multiply(axisQuat)
  }

  get isLoaded() { return this._loaded }

  /** 获取所有 link 名称 */
  getLinkNames() {
    return Array.from(this._linkNodes.keys())
  }

  // ── Build ────────────────────────────────────────────────────────────

  async _build() {
    const { links, joints } = this._parsed

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
    this._root.add(this._linkNodes.get(rootLinkName))
    this._attachChildren(rootLinkName, joints)

    const visualTasks = []
    for (const [name, link] of links.entries()) {
      const node = this._linkNodes.get(name)
      for (const visual of link.visuals) {
        visualTasks.push(() => this._addVisual(node, visual))
      }
    }

    await this._runWithConcurrency(visualTasks, 8)
  }

  _attachChildren(parentLinkName, joints) {
    joints.forEach((joint, jName) => {
      if (joint.parent !== parentLinkName) return
      const pivot = new THREE.Group()
      pivot.name  = `joint_${jName}`
      URDFModel._applyOrigin(pivot, joint.origin)
      // 保存初始 origin 旋转，供 setJointAngle 叠加使用
      this._jointBaseQuats.set(jName, pivot.quaternion.clone())
      const childNode  = this._linkNodes.get(joint.child)
      const parentNode = this._linkNodes.get(parentLinkName)
      if (childNode)  pivot.add(childNode)
      if (parentNode) parentNode.add(pivot)
      this._jointNodes.set(jName, pivot)
      this._attachChildren(joint.child, joints)
    })
  }

  async _addVisual(linkNode, visual) {
    const { origin, geometry, material } = visual
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

    // Apply material from URDF <material> element.
    // 只有 URDF 明确内联了 texture/color 时才覆盖 DAE 的材质；
    // 如果 URDF 只引用了全局 material name（无内联属性），保留 DAE 原有材质。
    if (material && (material.texture || material.color)) {
      this._applyMaterial(obj, material)
    } else {
      // console.log(`[_addVisual] no inline material, keeping DAE texture`)
    }

    URDFModel._applyOrigin(obj, origin)
    linkNode.add(obj)
  }

  _applyMaterial(obj, mat) {
    if (!mat) return

    const applyToMesh = (mesh) => {
      if (!mesh.isMesh) return
      const tex = mat.texture ? this._loadTexture(mat.texture) : null
      if (tex) {
        mesh.material = new THREE.MeshPhongMaterial({
          map: tex,
          shininess: 30,
        })
      } else if (mat.color) {
        const { r, g, b, a } = mat.color
        mesh.material = new THREE.MeshPhongMaterial({
          color: new THREE.Color(r, g, b),
          transparent: a < 1,
          opacity: a,
          shininess: 30,
        })
      }
    }

    obj.traverse(applyToMesh)
    if (obj.isMesh) applyToMesh(obj)
  }

  _loadTexture(filename) {
    const url = this._meshLoader._resolveUrl(filename)
    if (!url) return null

    const loader = new THREE.TextureLoader()
    try {
      const tex = loader.load(url)
      tex.colorSpace = THREE.SRGBColorSpace
      return tex
    } catch (e) {
      console.warn(`[URDFModel] Failed to load texture ${filename} (url: ${url})`)
      return null
    }
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
      const worker = new Worker(new URL('./URDFParser.js', import.meta.url), { type: 'module' })
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
    // URDF rpy 是 roll-pitch-yaw，对应 ZYX 旋转顺序（先 Z=Yaw，再 Y=Pitch，最后 X=Roll）
    const euler = new THREE.Euler(rpy.r, rpy.p, rpy.y, 'ZYX')
    obj.quaternion.setFromEuler(euler)
  }

  static _buildPrimitive(geometry) {
    let geo
    const mat = new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 30 })
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

  setVisible(visible) {
    if (this._root) this._root.visible = visible
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
    this._jointBaseQuats.clear()
    this._loaded = false

    // 释放 blob: URLs，释放浏览器内存
    for (const url of this._blobUrls) URL.revokeObjectURL(url)
    this._blobUrls = []
  }

  dispose() {
    this._disposeModel()
    this._meshLoader?.dispose?.()
  }
}

/**
 * BlobMeshLoader — 拖拽场景下直接从浏览器内存（blob: URL）加载资产。
 * 不需要服务器写入文件，消除网络上传/下载和磁盘 I/O。
 */
class BlobMeshLoader {
  constructor(blobMap, sharedMeshLoader = null) {
    this._blobMap    = blobMap
    this._shared     = sharedMeshLoader
    this._colladaCache = new Map()
    this._blobUrls   = []
  }

  async load(urdfFilename) {
    const url = this._resolveUrl(urdfFilename)
    return this._doLoad(url, urdfFilename)
  }

  _resolveUrl(filename) {
    // 1. 已经是 blob: 或 http(s):// URL，直接返回
    if (filename.startsWith('blob:') || filename.startsWith('http')) return filename

    // 2. package://pkg/path → 提取 path 部分（去掉 robots/<folder>/ 前缀）查 blobMap
    if (filename.startsWith('package://')) {
      const rest     = filename.replace('package://', '')
      const slashIdx = rest.indexOf('/')
      const relPath  = rest.slice(slashIdx + 1)
      // 去掉 robots/<folder>/ 前缀（如 "robots/salt_bot/assets/meshes/foo.dae" → "assets/meshes/foo.dae"）
      const cleaned = relPath.replace(/^robots\/[^/]+\//, '')
      return this._blobMap.get(cleaned) || this._blobMap.get(relPath) || filename
    }

    // 3. file://$(find pkg)/robots/pkg/... → 提取 assets/... 查 blobMap
    const m = filename.match(/\$\([^)]+\)\/robots\/[^/]+\/(.+)/)
    if (m) return this._blobMap.get(m[1]) || filename

    // 4. 相对路径：直接查 blobMap
    return this._blobMap.get(filename) || filename
  }

  async _doLoad(url, originalFilename) {
    const ext = originalFilename.split('.').pop().toLowerCase()

    if (ext === 'dae') {
      if (this._colladaCache.has(url)) return this._colladaCache.get(url).clone(true)
      const { scene, texMap } = await this._loadCollada(url)
      this._colladaCache.set(url, scene)
      return scene.clone(true)
    }

    if (ext === 'stl') {
      const geo  = await this._loadSTL(url)
      return new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 30 }))
    }

    return new THREE.Group()
  }

  /**
   * 加载 DAE，DAE 的 <init_from> 只保留文件名（不填 blob URL），
   * 返回场景和纹理映射（filename -> THREE.Texture）。
   * ColladaLoader 加载完毕后，把材质贴图替换成预加载的 Texture。
   */
  _loadCollada(daeBlobUrl) {
    return new Promise((resolve, reject) => {
      const self = this

      // 找到 DAE 的相对目录（用于 resolve ../.. 路径）
      let daeRelDir = ''
      for (const [relPath, blobUrl] of self._blobMap.entries()) {
        if (blobUrl === daeBlobUrl) {
          const lastSlash = relPath.lastIndexOf('/')
          daeRelDir = lastSlash >= 0 ? relPath.slice(0, lastSlash + 1) : ''
          break
        }
      }

      // 把 <init_from> 替换成完整 blob URL（绝对 URL 不会被 TextureLoader 拼接）
      fetch(daeBlobUrl)
        .then(r => r.text())
        .then(xmlText => {
          const rewritten = xmlText.replace(/<init_from>([^<]*)<\/init_from>/g, (match, raw) => {
            const resolved = self._resolveTexPath(raw.trim(), daeRelDir)
            return `<init_from>${resolved}</init_from>`
          })
          const newBlob    = new Blob([rewritten], { type: 'model/vnd.collada+xml' })
          const newBlobUrl = URL.createObjectURL(newBlob)
          self._blobUrls.push(newBlobUrl)

          const loader = new ColladaLoader()
          loader.setPath('')
          loader.load(newBlobUrl, (collada) => resolve({ scene: collada.scene }), undefined, reject)
        })
        .catch(reject)
    })
  }

  /** 把含 ../.. 的纹理路径 resolve 成 blob URL */
  _resolveTexPath(raw, daeRelDir) {
    if (!raw) return raw
    if (raw.startsWith('blob:') || raw.startsWith('http')) return raw

    const lastSlash = raw.lastIndexOf('/')
    const dir  = lastSlash >= 0 ? raw.slice(0, lastSlash) : ''
    const file = lastSlash >= 0 ? raw.slice(lastSlash + 1) : raw

    let resolvedDir = daeRelDir
    for (const part of dir.split('/').filter(Boolean)) {
      if (part === '..') {
        const idx = resolvedDir.lastIndexOf('/', resolvedDir.length - 2)
        resolvedDir = idx >= 0 ? resolvedDir.slice(0, idx + 1) : ''
      } else if (part !== '.') {
        resolvedDir += part + '/'
      }
    }

    // 在 blobMap 里查找匹配
    for (const [relPath, blobUrl] of this._blobMap.entries()) {
      const relFile = relPath.split('/').pop()
      if (relFile === file && (relPath.startsWith(resolvedDir) || resolvedDir === '')) {
        return blobUrl
      }
    }
    // 兜底：直接文件名
    for (const [relPath, blobUrl] of this._blobMap.entries()) {
      if (relPath.split('/').pop() === file) return blobUrl
    }
    return raw
  }

  _replaceTex(mat, prop, raw, daeRelDir) {
    // 不再需要（纹理已通过 blob URL 正确加载）
  }

  _loadSTL(blobUrl) {
    return new Promise((resolve, reject) => {
      const loader = new STLLoader()
      loader.load(blobUrl, resolve, undefined, reject)
    })
  }

  dispose() {
    this._colladaCache.clear()
    for (const url of this._blobUrls) URL.revokeObjectURL(url)
    this._blobUrls = []
    if (this._shared) this._shared.dispose()
  }
}