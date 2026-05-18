import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { BaseMarker } from './BaseMarker'

/**
 * PathMarker — 渲染 nav_msgs/Path（或预计算好的点数组）
 *
 * 使用 Line2 + LineMaterial 实现像素级线宽，相机拉远时视觉宽度保持不变，与 RViz 一致。
 *
 * lineStyle:
 *  'lines'       — 像素宽度线（默认）
 *  'pointlines'  — 像素宽度线 + 每路径点球体（InstancedMesh）
 *
 * options:
 *  color     {string}  颜色，默认 '#19ff00'
 *  alpha     {number}  透明度 0-1，默认 1
 *  lineStyle {'lines'|'pointlines'}  默认 'lines'
 *  lineWidth {number}  屏幕像素宽度（跟随相机缩放），默认 2px
 *  pointSize {number}  pointlines 模式: 球体半径（米），默认 0.15
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
    this._mesh     = null
    this._lineMesh = null
    this._pts      = null
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
    const lineWidth = this.options.lineWidth ?? 2

    const col = new THREE.Color(color)

    if (lineStyle === 'lines') {
      this._mesh = this._buildLine(pts, col, alpha, lineWidth)
      if (this._mesh) this.root.add(this._mesh)
    } else {
      this._mesh = this._buildLine(pts, col, alpha, lineWidth)
      if (this._mesh) this.root.add(this._mesh)

      const sphereColor = new THREE.Color(this.options.pointColor ?? '#ff0000')
      const sphereMat = new THREE.MeshPhongMaterial({
        color:       sphereColor,
        opacity:     alpha,
        transparent: alpha < 1,
        depthWrite:  alpha >= 1,
        shininess:   80,
      })
      this._lineMesh = this._buildPointLines(pts, sphereMat)
      if (this._lineMesh) this.root.add(this._lineMesh)
    }
  }

  /** 像素宽度线（Line2，toneMapped: false 避免二次 gamma） */
  _buildLine(pts, color, alpha, lineWidth) {
    const positions = []
    for (const p of pts) {
      positions.push(p.x ?? 0, p.y ?? 0, p.z ?? 0)
    }

    const geo = new LineGeometry()
    geo.setPositions(positions)

    const mat = new LineMaterial({
      color: color,
      linewidth: lineWidth,
      transparent: alpha < 1,
      opacity: alpha,
      toneMapped: false,
      depthWrite: true,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    })

    const line = new Line2(geo, mat)
    line.computeLineDistances()
    return line
  }

  /** InstancedMesh 渲染圆球，pointlines 模式专用 */
  _buildPointLines(pts, mat) {
    const radius = this.options.pointSize ?? 0.15
    const geo    = new THREE.SphereGeometry(radius, 10, 6)
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
      this._mesh.geometry?.dispose()
      this._mesh.material?.dispose()
      this.root.remove(this._mesh)
      this._mesh = null
    }
    if (this._lineMesh) {
      this._lineMesh.geometry?.dispose()
      this._lineMesh.material?.dispose()
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
