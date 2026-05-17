import * as THREE from 'three'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { STLLoader }     from 'three/examples/jsm/loaders/STLLoader.js'

/**
 * MeshLoader — 加载 URDF 引用的网格文件
 *
 * 使用 /urdf/... 代理路径访问 install 目录下的文件
 * ColladaLoader 直接从这个 URL 加载，纹理路径会相对于 DAE URL 自动解析
 */
export class MeshLoader {
  constructor(proxyBase = '/urdf') {
    this._proxyBase     = proxyBase
    this._colladaLoader = new ColladaLoader()
    this._stlLoader     = new STLLoader()
    this._cache         = new Map()
  }

  async load(urdfFilename) {
    const url = this._resolveUrl(urdfFilename)
    if (this._cache.has(url)) {
      return this._cache.get(url)
    }
    const promise = this._doLoad(url, urdfFilename)
    this._cache.set(url, promise)
    return promise
  }

  async _doLoad(url, originalFilename) {
    const ext = originalFilename.split('.').pop().toLowerCase()
    try {
      if (ext === 'dae') return await this._loadCollada(url)
      if (ext === 'stl') {
        const geo  = await this._loadSTL(url)
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x888888 }))
        return mesh
      }
      return new THREE.Group()
    } catch (e) {
      console.error(`[MeshLoader] Failed to load ${url}:`, e)
      return new THREE.Group()
    }
  }

  _loadCollada(proxyUrl) {
    return new Promise((resolve, reject) => {
      this._colladaLoader.load(
        proxyUrl,
        (collada) => resolve(collada.scene),
        undefined,
        (err) => reject(err)
      )
    })
  }

  _loadSTL(url) {
    return new Promise((resolve, reject) => {
      this._stlLoader.load(url, resolve, undefined, reject)
    })
  }

  _resolveUrl(filename) {
    if (filename.startsWith('file://')) {
      const absPath = filename.replace('file://', '')
      const installBase = '/home/zzk/workspace/wsl_ws/robot_ws/install/ackbot/share/ackbot/robots/salt_bot/assets'
      const relPath = absPath.replace(installBase, '').replace(/^\//, '')
      return `/urdf/${relPath}`
    }
    if (filename.startsWith('package://')) {
      const rest     = filename.replace('package://', '')
      const slashIdx = rest.indexOf('/')
      const relPath  = rest.slice(slashIdx + 1)
      return `/urdf/${relPath}`
    }
    return filename
  }

  dispose() {
    this._cache.clear()
  }
}
