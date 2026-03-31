import * as THREE from 'three'

/**
 * MapLayer — 单瓦片卫星地图
 * 瓦片来源：ArcGIS World Imagery（无需 Key，清晰度高）
 */
export class MapLayer {
  constructor(scene) {
    this._scene   = scene
    this._zoom    = 18
    this._lng     = null
    this._lat     = null
    this._visible = false
    this._loading = false
    this._currentTex = null

    // 单块地面 Mesh
    const geo = new THREE.PlaneGeometry(1, 1)
    this._mat = new THREE.MeshBasicMaterial({
      color:      0xffffff,
      transparent: false,
      opacity:    1,
      depthWrite: false,
    })
    this._mesh = new THREE.Mesh(geo, this._mat)
    this._mesh.rotation.x = -Math.PI / 2
    this._mesh.position.y = 0.01
    this._mesh.renderOrder = -1
    this._mesh.visible = false
    scene.add(this._mesh)
  }

  // ── Public API ───────────────────────────────────────────────────────

  async loadTexture(lng, lat, zoom) {
    this._lng  = lng
    this._lat  = lat
    this._zoom = zoom
    const s = this._tileMeters(lat, zoom)
    this._mesh.scale.set(s, s, 1)
    await this._load(lng, lat, zoom)
  }

  applyTexture(tex) {
    if (tex === null) this.setVisible(false)
    else              this.setVisible(true)
  }

  setOpacity(opacity) {
    this._mat.opacity     = Math.max(0, Math.min(1, opacity))
    this._mat.transparent = opacity < 1
    this._mat.needsUpdate = true
  }

  setVisible(v) {
    this._visible      = v
    this._mesh.visible = v
  }

  /** tick — 单瓦片不需要滚动，保留接口兼容 */
  tick(_baseLinkPos) {}

  dispose() {
    this._currentTex?.dispose()
    this._mesh.geometry.dispose()
    this._mat.dispose()
    this._scene.remove(this._mesh)
  }

  // ── Internal ─────────────────────────────────────────────────────────

  async _load(lng, lat, zoom) {
    if (this._loading) return
    this._loading = true
    try {
      const tx  = this._lon2tile(lng, zoom)
      const ty  = this._lat2tile(lat, zoom)
      const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`
      const tex = await this._fetchTile(url)
      if (!tex) return
      const old = this._currentTex
      this._currentTex  = tex
      this._mat.map     = tex
      this._mat.needsUpdate = true
      old?.dispose()
      this._mesh.visible = this._visible
    } catch (e) {
      console.warn('[MapLayer] load failed:', e)
    } finally {
      this._loading = false
    }
  }

  _fetchTile(url) {
    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const tex = new THREE.Texture(img)
        tex.colorSpace  = THREE.SRGBColorSpace
        tex.anisotropy  = 16
        tex.needsUpdate = true
        resolve(tex)
      }
      img.onerror = () => resolve(null)
      img.src = url
    })
  }

  _lon2tile(lon, z) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, z))
  }

  _lat2tile(lat, z) {
    return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z))
  }

  _tileMeters(lat, zoom) {
    return (40075016.686 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, zoom)
  }
}
