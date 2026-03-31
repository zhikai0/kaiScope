import * as THREE from 'three'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { STLLoader }     from 'three/examples/jsm/loaders/STLLoader.js'

/**
 * MeshLoader — 加载 URDF 引用的网格文件
 *
 * URDF 里的文件路径格式：
 *   file:///absolute/path/to/file.dae   → 本地文件，需通过后端代理
 *   package://pkg_name/path/to/file.dae → ROS package 路径，需后端解析
 *
 * 后端代理接口（需在 vite.config.js 或后端实现）：
 *   GET /api/urdf/file?path=/absolute/path/to/file.dae
 *   → 返回文件二进制内容，Content-Type 对应 mime type
 */
export class MeshLoader {
  constructor(proxyBase = '/api/urdf') {
    this._proxyBase    = proxyBase
    this._colladaLoader = new ColladaLoader()
    this._stlLoader     = new STLLoader()
    this._cache         = new Map()  // url -> Promise<THREE.Object3D>
  }

  /**
   * 加载一个网格文件，返回 THREE.Object3D
   * @param {string} urdfFilename  URDF 中的 filename 属性值
   * @returns {Promise<THREE.Object3D>}
   */
  async load(urdfFilename) {
    const url = this._resolveUrl(urdfFilename)
    console.log(`[MeshLoader] load: ${urdfFilename} → ${url}`)
    if (this._cache.has(url)) {
      console.log(`[MeshLoader] cache hit: ${url}`)
      return this._cache.get(url)
    }
    const promise = this._doLoad(url, urdfFilename)
    this._cache.set(url, promise)
    return promise
  }

  async _doLoad(url, originalFilename) {
    const ext = originalFilename.split('.').pop().toLowerCase()
    console.log(`[MeshLoader] _doLoad ext=${ext} url=${url}`)
    try {
      if (ext === 'dae') {
        const obj = await this._loadCollada(url)
        console.log(`[MeshLoader] collada loaded: ${url}, children=${obj?.children?.length}`)
        return obj
      } else if (ext === 'stl') {
        const obj = await this._loadSTL(url)
        console.log(`[MeshLoader] stl loaded: ${url}`)
        return obj
      } else {
        console.warn(`[MeshLoader] Unsupported format: ${ext}, skipping ${originalFilename}`)
        return new THREE.Group()
      }
    } catch (e) {
      console.error(`[MeshLoader] Failed to load ${url}:`, e)
      return new THREE.Group()
    }
  }

  _loadCollada(url) {
    return new Promise((resolve, reject) => {
      this._colladaLoader.load(
        url,
        (collada) => {
          const obj = collada.scene
          // Collada 场景默认 Y-up，URDF 是 Z-up，保持原样让 URDFModel 处理坐标系
          resolve(obj)
        },
        undefined,
        reject
      )
    })
  }

  _loadSTL(url) {
    return new Promise((resolve, reject) => {
      this._stlLoader.load(
        url,
        (geo) => {
          const mat  = new THREE.MeshStandardMaterial({ color: 0x888888 })
          const mesh = new THREE.Mesh(geo, mat)
          resolve(mesh)
        },
        undefined,
        reject
      )
    })
  }

  /**
   * 将 URDF 文件路径转为可访问的 URL
   * file:///... → /api/urdf/file?path=...
   * package://pkg/... → /api/urdf/package?pkg=pkg&path=...
   */
  _resolveUrl(filename) {
    if (filename.startsWith('file://')) {
      const absPath = filename.replace('file://', '')
      return `${this._proxyBase}/file?path=${encodeURIComponent(absPath)}`
    }
    if (filename.startsWith('package://')) {
      const rest    = filename.replace('package://', '')
      const slashIdx = rest.indexOf('/')
      const pkg     = rest.slice(0, slashIdx)
      const relPath = rest.slice(slashIdx + 1)
      return `${this._proxyBase}/package?pkg=${encodeURIComponent(pkg)}&path=${encodeURIComponent(relPath)}`
    }
    // 相对路径直接返回
    return filename
  }

  dispose() {
    this._cache.clear()
  }
}
