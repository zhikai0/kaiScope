import * as THREE from 'three'
import * as Cesium from 'cesium'

// Cesium Web Mercator 投影和瓦片方案
const PROJECTION    = new Cesium.WebMercatorProjection()
const TILING_SCHEME = new Cesium.WebMercatorTilingScheme()

// Three.js y=0 地面平面（用于射线求交）
const GROUND_PLANE  = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const RAYCASTER     = new THREE.Raycaster()
const _rayOrigin    = new THREE.Vector3()
const _rayDir       = new THREE.Vector3()

/**
 * MapLayer — 动态瓦片卫星地图（跟随相机可见范围）
 *
 * 瓦片来源：ArcGIS World Imagery
 *
 * 核心逻辑：
 *  1. 每帧从相机视锥体四角的射线与 y=0 地面相交，得到可见矩形（米）
 *  2. 可见矩形映射到墨卡托坐标，再用 Cesium API 转为瓦片序号
 *  3. 瓦片以 GNSS 原点为相对原点，Three.js 世界坐标 = 墨卡托 - 原点墨卡托
 *
 * Cesium API 使用:
 *  - Cesium.WebMercatorProjection.project()      经纬度(弧度) → 墨卡托米坐标
 *  - Cesium.WebMercatorTilingScheme.tileXYToNativeRectangle()  瓦片 → 墨卡托边界
 *  - Cesium.WebMercatorTilingScheme.positionToTileXY()        经纬度 → 瓦片序号
 *  - Cesium.Cartographic.fromDegrees()            度 → 弧度坐标
 */
export class MapLayer {
  constructor(scene) {
    this._scene    = scene
    this._lng      = null
    this._lat      = null
    this._zoom     = 18
    this._visible  = false
    this._opacity  = 1.0

    // 当前已加载瓦片: key "tx,ty" -> { mesh, mat, tex, loading, loadReq }
    this._tileMap   = new Map()
    this._pool      = []
    this._poolLimit = 80
    this._geo       = new THREE.PlaneGeometry(1, 1)

    // 相机可见范围（米），用于判断瓦片是否需要重建
    this._lastViewBounds = null
    this._lastRebuildZoom = -1
  }

  // ── Public API ───────────────────────────────────────────────────────

  async loadTexture(lng, lat, zoom) {
    this._lng  = lng
    this._lat  = lat
    this._zoom = zoom
    this._lastViewBounds = null  // 强制重建
    this._rebuildAllTiles()
  }

  applyTexture(tex) {
    this.setVisible(tex !== null)
  }

  setOpacity(opacity) {
    this._opacity = Math.max(0, Math.min(1, opacity))
    this._tileMap.forEach(tile => {
      tile.mat.opacity     = this._opacity
      tile.mat.transparent = this._opacity < 1
      tile.mat.needsUpdate = true
    })
  }

  setVisible(v) {
    this._visible = v
    this._tileMap.forEach(tile => { tile.mesh.visible = v })
  }

  /**
   * 每帧调用：
   *  - zoom 变化 → 重建瓦片
   *  - 相机可见范围变化（超出当前瓦片边界）→ 增量加载
   */
  tick(camera, renderer) {
    if (this._lng === null) return

    // zoom 变化 → 完整重建
    if (this._zoom !== this._lastRebuildZoom) {
      this._rebuildAllTiles()
      this._lastRebuildZoom = this._zoom
      return
    }

    // 相机可见范围 → 增量加载新瓦片
    const bounds = this._computeViewBounds(camera, renderer)
    if (bounds) {
      this._loadTilesInBounds(bounds)
    }
  }

  dispose() {
    this._tileMap.forEach(tile => {
      tile.loadReq?.abort()
      tile.tex?.dispose()
      tile.mesh.geometry.dispose()
      tile.mat.dispose()
      this._scene.remove(tile.mesh)
    })
    this._tileMap.clear()
    this._pool.forEach(m => {
      m.geometry?.dispose()
      m.material?.dispose()
      this._scene.remove(m)
    })
    this._pool = []
    this._geo?.dispose()
  }

  // ── Internal ─────────────────────────────────────────────────────────

  /**
   * 完整重建所有瓦片（由固定半径覆盖）
   */
  _rebuildAllTiles() {
    const { _lng, _lat, _zoom, _tileMap } = this
    if (_lng === null) return

    // 原点的墨卡托坐标
    const originMerc = this._lngLatToMercator(_lng, _lat)
    const tileSizeM  = this._tileMeters(_zoom)

    // 以原点为中心，覆盖 ±200m 范围
    const halfM = 200
    const halfTiles = Math.ceil(halfM / tileSizeM) + 1

    const tx0 = this._lngLatToTileXY(_lng, _lat, _zoom).x
    const ty0 = this._lngLatToTileXY(_lng, _lat, _zoom).y

    const neededKeys = new Set()

    for (let row = -halfTiles; row <= halfTiles; row++) {
      for (let col = -halfTiles; col <= halfTiles; col++) {
        const tx = tx0 + col
        const ty = ty0 + row
        const key = `${tx},${ty}`
        neededKeys.add(key)
        if (!_tileMap.has(key)) {
          this._addTile(tx, ty, _zoom, originMerc)
        }
      }
    }

    // 移除多余瓦片
    for (const [key, tile] of _tileMap) {
      if (!neededKeys.has(key)) this._removeTile(key, tile)
    }
  }

  /**
   * 根据相机可见范围增量加载瓦片
   */
  _loadTilesInBounds(bounds) {
    const { _lng, _lat, _zoom } = this
    const { minX, maxX, minZ, maxZ } = bounds  // Three.js 世界坐标（米）

    // Three.js 世界坐标 → 墨卡托坐标
    const originMerc = this._lngLatToMercator(_lng, _lat)
    const mercMinX = minX + originMerc.x
    const mercMaxX = maxX + originMerc.x
    const mercMinY = originMerc.y - maxZ  // Three.js -Z → 墨卡托 +Y（maxZ 最小 → mercMinY 最大）
    const mercMaxY = originMerc.y - minZ  // Three.js -minZ → 墨卡托 -Y（minZ 最大 → mercMaxY 最小）

    // 墨卡托坐标 → 瓦片序号（Cesium unproject + positionToTileXY）
    const swTile = this._mercatorToTileXY(mercMinX, mercMinY, _zoom)
    const neTile = this._mercatorToTileXY(mercMaxX, mercMaxY, _zoom)

    for (let ty = swTile.y; ty <= neTile.y; ty++) {
      for (let tx = swTile.x; tx <= neTile.x; tx++) {
        const key = `${tx},${ty}`
        if (!this._tileMap.has(key)) {
          this._addTile(tx, ty, _zoom, originMerc)
        }
      }
    }
  }

  _addTile(tx, ty, zoom, originMerc) {
    originMerc = originMerc || this._lngLatToMercator(this._lng, this._lat)

    const key  = `${tx},${ty}`
    const rect = TILING_SCHEME.tileXYToNativeRectangle(tx, ty, zoom, {})

    // 瓦片中心（墨卡托米坐标）
    const tileCenterX = (rect.west + rect.east)  / 2
    const tileCenterY = (rect.north + rect.south) / 2

    // Three.js 世界坐标
    const wx = tileCenterX - originMerc.x
    const wz = -(tileCenterY - originMerc.y)   // Y 轴翻转
    const tileSizeM = rect.east - rect.west

    // 从对象池获取或新建 mesh
    let mesh
    if (this._pool.length > 0) {
      mesh = this._pool.pop()
    } else {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: false, opacity: 1, depthWrite: false,
      })
      mesh = new THREE.Mesh(this._geo, mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y  = 0.01
      mesh.renderOrder = -1
      this._scene.add(mesh)
    }

    mesh.position.x = wx
    mesh.position.z = wz
    mesh.scale.set(tileSizeM, tileSizeM, 1)
    mesh.visible    = this._visible
    mesh.material.opacity     = this._opacity
    mesh.material.transparent = this._opacity < 1

    const tile = { mesh, mat: mesh.material, tex: null, loading: false, loadReq: null }
    this._tileMap.set(key, tile)
    this._loadTile(tile, tx, ty, zoom)
  }

  _removeTile(key, tile) {
    tile.loadReq?.abort()
    tile.tex?.dispose()
    tile.tex = null
    tile.mat.map = null
    tile.mat.needsUpdate = true
    tile.mesh.visible = false
    this._tileMap.delete(key)

    if (this._pool.length < this._poolLimit) {
      this._pool.push(tile.mesh)
    } else {
      tile.mesh.geometry?.dispose()
      tile.mat.dispose()
      this._scene.remove(tile.mesh)
    }
  }

  _loadTile(tile, tx, ty, zoom) {
    if (tile.loadReq) { tile.loadReq.abort(); tile.loadReq = null }

    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`
    const controller = new AbortController()
    tile.loadReq = controller
    tile.loading = true

    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      if (tile.loadReq !== controller) return
      tile.loading = false
      tile.loadReq = null
      const oldTex = tile.tex
      const tex = new THREE.Texture(img)
      tex.colorSpace  = THREE.SRGBColorSpace
      tex.anisotropy  = 16
      tex.needsUpdate = true
      tile.tex = tex
      tile.mat.map = tex
      tile.mat.needsUpdate = true
      oldTex?.dispose()
    }

    img.onerror = () => {
      if (tile.loadReq !== controller) return
      tile.loading = false
      tile.loadReq = null
      tile.mat.color.set(0x2a2a2a)
      tile.mat.needsUpdate = true
    }

    controller.signal.addEventListener('abort', () => { img.src = '' })
    img.src = url
  }

  // ── Cesium 坐标转换 ───────────────────────────────────────────────────

  /** 经纬度(度) → 墨卡托米坐标 */
  _lngLatToMercator(lng, lat) {
    const cart = Cesium.Cartographic.fromDegrees(lng, lat, 0)
    return PROJECTION.project(cart)
  }

  /** 墨卡托米坐标 → 瓦片序号 */
  _mercatorToTileXY(mx, my, level) {
    // unproject: 墨卡托 → 弧度经纬度
    const carto = PROJECTION.unproject(new Cesium.Cartesian3(mx, my, 0))
    return TILING_SCHEME.positionToTileXY(carto, level, new Cesium.Cartesian2())
  }

  /** 经纬度(度) → 瓦片序号 */
  _lngLatToTileXY(lng, lat, level) {
    const carto = Cesium.Cartographic.fromDegrees(lng, lat, 0)
    return TILING_SCHEME.positionToTileXY(carto, level, new Cesium.Cartesian2())
  }

  /** 单个瓦片的物理尺寸（米） */
  _tileMeters(zoom) {
    const rect = TILING_SCHEME.tileXYToNativeRectangle(0, 0, zoom, {})
    return rect.east - rect.west
  }

  // ── 相机视锥体 → 地面可见范围 ───────────────────────────────────────

  /**
   * 从相机视锥体四角发射射线，与 y=0 地面相交，返回 Three.js 世界坐标矩形
   * @returns {{ minX, maxX, minZ, maxZ } | null}
   */
  _computeViewBounds(camera, renderer) {
    if (!camera || !renderer) return null

    const w = renderer.domElement.clientWidth
    const h = renderer.domElement.clientHeight
    if (w === 0 || h === 0) return null

    // 相机视锥体四角的 NDC 坐标
    const corners = [
      new THREE.Vector3(-1, -1, 0.5),  // 左下
      new THREE.Vector3( 1, -1, 0.5),  // 右下
      new THREE.Vector3( 1,  1, 0.5),  // 右上
      new THREE.Vector3(-1,  1, 0.5),  // 左上
    ]

    const camPos  = camera.position
    let minX =  Infinity, maxX = -Infinity
    let minZ =  Infinity, maxZ = -Infinity
    let hitCount = 0

    for (const nc of corners) {
      // NDC → 世界空间角点
      nc.unproject(camera)
      // 从相机出发指向角点的方向
      _rayDir.subVectors(nc, camPos).normalize()
      // 以相机位置为射线起点
      RAYCASTER.set(camPos, _rayDir)

      const hit = new THREE.Vector3()
      const ok = RAYCASTER.ray.intersectPlane(GROUND_PLANE, hit)
      if (ok && isFinite(hit.x)) {
        minX = Math.min(minX, hit.x)
        maxX = Math.max(maxX, hit.x)
        minZ = Math.min(minZ, hit.z)
        maxZ = Math.max(maxZ, hit.z)
        hitCount++
      }
    }

    if (hitCount < 3) return null  // 至少 3 个角命中地面

    // 加一圈缓冲（避免边缘刚好卡住）
    const pad = 5
    return {
      minX: minX - pad, maxX: maxX + pad,
      minZ: minZ - pad, maxZ: maxZ + pad,
    }
  }
}
