import * as THREE from 'three'
import { BaseMarker } from './BaseMarker'

/**
 * PathMarker — 渲染 nav_msgs/Path（或预计算好的点数组）
 *
 * lineStyle:
 *  'lines'       — TubeGeometry 圆柱管道线（默认）
 *  'pointlines'  — 细管线 + 每路径点圆球（InstancedMesh）
 *
 * options:
 *  color     {string}  颜色，默认 '#19ff00'
 *  alpha     {number}  透明度 0-1，默认 1
 *  lineStyle {'lines'|'pointlines'}  默认 'lines'
 *  lineWidth {number}  lines/pointlines 模式: 管道半径（米），默认 0.05
 *  pointSize {number}  pointlines 模式: 球体半径（米），默认 0.1
 *  pointColor {string} plines 模式: 球体颜色，默认 '#ff0000' (红色)
 */
export class PathMarker extends BaseMarker {
  static get TYPE() { return 'path' }

  static get ROS_MSG_TYPES() {
    return [
      'nav_msgs/msg/Path',
      'nav_msgs/Path',
      'geometry_msgs/msg/PoseArray',
      '__preprocessed__',
    ]
  }

  _build() {
    this._mesh = null
    this._pts  = null
  }

  update(data) {
    if (!data) return
    let pts = []
    if (Array.isArray(data.points)) {
      pts = data.points
    } else if (Array.isArray(data.poses)) {
      pts = data.poses.map(p => p.pose?.position).filter(Boolean)
    } else {
      return
    }
    if (pts.length < 2) { this._clear(); return }
    this._pts = pts
    this._rebuild(pts)
  }

  _rebuild(pts) {
    this._clear()
    const color     = this.options.color     ?? '#19ff00'
    const alpha     = this.options.alpha     ?? 1.0
    const lineStyle = this.options.lineStyle ?? 'lines'
    const col = new THREE.Color(color)
    const mat = new THREE.MeshPhongMaterial({
      color:       col,
      opacity:     alpha,
      transparent: alpha < 1,
      side:        THREE.DoubleSide,
      depthWrite:  alpha >= 1,
      shininess:   60,
    })

    if (lineStyle === 'pointlines') {
      const sphereColor = new THREE.Color(this.options.pointColor ?? '#ff0000')
      const sphereMat = new THREE.MeshPhongMaterial({
        color:       sphereColor,
        opacity:     alpha,
        transparent: alpha < 1,
        depthWrite:  alpha >= 1,
        shininess:   80,
      })
      this._mesh     = this._buildPointLines(pts, sphereMat)
      this._lineMesh = this._buildTube(pts, mat)
      if (this._lineMesh) this.root.add(this._lineMesh)
    } else {
      this._mesh = this._buildTube(pts, mat)
    }

    if (this._mesh) this.root.add(this._mesh)
  }

  /** 圆柱管道线（TubeGeometry） */
  _buildTube(pts, mat) {
    const radius   = this.options.lineWidth ?? 0.025
    const vectors  = pts.map(p => new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0))
    const curve    = new THREE.CatmullRomCurve3(vectors)
    const tubeSeg  = Math.min(pts.length * 3, 1024)
    const geo      = new THREE.TubeGeometry(curve, tubeSeg, radius, 8, false)
    return new THREE.Mesh(geo, mat)
  }

  /** InstancedMesh 渲染圆球，pointlines 模式专用 */
  _buildPointLines(pts, mat) {
    const radius = this.options.pointSize ?? 0.1
    const geo    = new THREE.SphereGeometry(radius, 12, 8)
    const mesh   = new THREE.InstancedMesh(geo, mat, pts.length)
    mesh.frustumCulled = false
    const dummy = new THREE.Object3D()
    for (let i = 0; i < pts.length; i++) {
      dummy.position.set(pts[i].x ?? 0, pts[i].y ?? 0, pts[i].z ?? 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    return mesh
  }

  _clear() {
    if (this._mesh) {
      this._mesh.geometry.dispose()
      this._mesh.material.dispose()
      this.root.remove(this._mesh)
      this._mesh = null
    }
    if (this._lineMesh) {
      this._lineMesh.geometry.dispose()
      this._lineMesh.material.dispose()
      this.root.remove(this._lineMesh)
      this._lineMesh = null
    }
  }

  setStyle({ color, alpha, lineStyle, lineWidth, pointSize, pointColor } = {}) {
    if (color      !== undefined) this.options.color      = color
    if (alpha      !== undefined) this.options.alpha      = alpha
    if (lineStyle  !== undefined) this.options.lineStyle  = lineStyle
    if (lineWidth  !== undefined) this.options.lineWidth  = lineWidth
    if (pointSize  !== undefined) this.options.pointSize  = pointSize
    if (pointColor !== undefined) this.options.pointColor = pointColor
    if (this._pts) this._rebuild(this._pts)
  }

  dispose() {
    this._clear()
    super.dispose()
  }
}
