import * as THREE from 'three'
import { BaseMarker } from './BaseMarker'

/**
 * PathMarker — 渲染 nav_msgs/Path（或预计算好的点数组）
 *
 * lineStyle:
 *  'lines'     — TubeGeometry 圆柱管道线（默认）
 *  'billboard' — 始终朝向相机的扁平面片线
 *
 * options:
 *  color     {string}  颜色，默认 '#19ff00'
 *  alpha     {number}  透明度 0-1，默认 1
 *  lineStyle {'lines'|'billboard'}  默认 'lines'
 *  lineWidth {number}  lines 模式: 管道半径（米），默认 0.04
 *             billboard 模式: 面片半宽（米），默认 0.06
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
    const mat = new THREE.MeshBasicMaterial({
      color:       col,
      opacity:     alpha,
      transparent: alpha < 1,
      side:        THREE.DoubleSide,
      depthWrite:  alpha >= 1,
    })

    if (lineStyle === 'billboard') {
      this._mesh = this._buildBillboard(pts, mat)
    } else {
      this._mesh = this._buildTube(pts, mat)
    }

    if (this._mesh) this.root.add(this._mesh)
  }

  /** 圆柱管道线（TubeGeometry） */
  _buildTube(pts, mat) {
    const radius   = this.options.lineWidth ?? 0.04
    const vectors  = pts.map(p => new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0))
    const curve    = new THREE.CatmullRomCurve3(vectors)
    const tubeSeg  = Math.min(pts.length * 3, 1024)
    const geo      = new THREE.TubeGeometry(curve, tubeSeg, radius, 8, false)
    return new THREE.Mesh(geo, mat)
  }

  /**
   * Billboard 线：每相邻两点生成一个四边形面片，面片朝向由渲染时动态更新。
   * 此处预生成 geometry，在 onBeforeRender 里更新顶点使其始终朝相机。
   */
  _buildBillboard(pts, mat) {
    const hw = this.options.lineWidth ?? 0.06  // 半宽（米）
    const n  = pts.length - 1  // 段数
    // 每段 4 顶点，2 三角形
    const positions = new Float32Array(n * 4 * 3)
    const indices   = []

    // 初始化顶点（占位）
    for (let i = 0; i < n; i++) {
      const p0 = pts[i],   p1 = pts[i + 1]
      const base = i * 4 * 3
      // 先填充实际坐标，onBeforeRender 会覆盖
      for (let v = 0; v < 4; v++) {
        positions[base + v*3]   = (v < 2 ? p0.x : p1.x) ?? 0
        positions[base + v*3+1] = (v < 2 ? p0.y : p1.y) ?? 0
        positions[base + v*3+2] = (v < 2 ? p0.z : p1.z) ?? 0
      }
      const vi = i * 4
      indices.push(vi, vi+1, vi+2,  vi+1, vi+3, vi+2)
    }

    const geo = new THREE.BufferGeometry()
    const posAttr = new THREE.BufferAttribute(positions, 3)
    posAttr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('position', posAttr)
    geo.setIndex(indices)

    const mesh = new THREE.Mesh(geo, mat)
    // 每帧更新顶点使面片朝相机
    mesh.onBeforeRender = (renderer, scene, camera) => {
      const pos  = geo.attributes.position
      const camPos = camera.position
      const up  = new THREE.Vector3(0, 1, 0)
      for (let i = 0; i < n; i++) {
        const p0 = new THREE.Vector3(pts[i].x??0,   pts[i].y??0,   pts[i].z??0)
        const p1 = new THREE.Vector3(pts[i+1].x??0, pts[i+1].y??0, pts[i+1].z??0)
        const dir    = p1.clone().sub(p0).normalize()
        const mid    = p0.clone().add(p1).multiplyScalar(0.5)
        const toEye  = camPos.clone().sub(mid).normalize()
        const perp   = dir.clone().cross(toEye).normalize().multiplyScalar(hw)
        const base = i * 4
        pos.setXYZ(base+0, p0.x - perp.x, p0.y - perp.y, p0.z - perp.z)
        pos.setXYZ(base+1, p0.x + perp.x, p0.y + perp.y, p0.z + perp.z)
        pos.setXYZ(base+2, p1.x - perp.x, p1.y - perp.y, p1.z - perp.z)
        pos.setXYZ(base+3, p1.x + perp.x, p1.y + perp.y, p1.z + perp.z)
      }
      pos.needsUpdate = true
      geo.computeVertexNormals()
    }
    return mesh
  }

  _clear() {
    if (this._mesh) {
      this._mesh.geometry.dispose()
      this._mesh.material.dispose()
      this.root.remove(this._mesh)
      this._mesh = null
    }
  }

  setStyle({ color, alpha, lineStyle, lineWidth } = {}) {
    if (color     !== undefined) this.options.color     = color
    if (alpha     !== undefined) this.options.alpha     = alpha
    if (lineStyle !== undefined) this.options.lineStyle = lineStyle
    if (lineWidth !== undefined) this.options.lineWidth = lineWidth
    if (this._pts) this._rebuild(this._pts)
  }

  dispose() {
    this._clear()
    super.dispose()
  }
}
