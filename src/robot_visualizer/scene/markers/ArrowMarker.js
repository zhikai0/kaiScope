import * as THREE from 'three'
import { BaseMarker } from './BaseMarker'

/**
 * ArrowMarker — TF 父子关系箭头 Marker
 *
 * 绘制一条从子坐标系原点指向父坐标系原点的箭头（圆柱杆 + 锥形头）。
 * 颜色为半透明橙黄色（与 TF axes 颜色协调）。
 *
 * 使用场景：TfDisplayManager 中，showArrows 开启时，
 * 为每对 parent→child 关系创建一个 ArrowMarker。
 *
 * options:
 *  scale      {number}  箭头缩放比例，控制粗细，默认 1.0
 *  color      {number}  颜色（十六进制），默认 0xffaa00
 *  opacity    {number}  透明度，默认 0.75
 */
export class ArrowMarker extends BaseMarker {
  static get TYPE() { return 'arrow' }

  static get ROS_MSG_TYPES() {
    return ['__arrow__']  // 内部专用，不映射到 ROS topic
  }

  _build() {
    this._arrowGroup = null
    this._lastLength = -1
    this._rebuildArrow(1.0)
  }

  /**
   * 重建箭头几何体（长度改变时调用）
   * @param {number} length  箭头总长（米）
   */
  _rebuildArrow(length) {
    // 清理旧几何体
    if (this._arrowGroup) {
      this._arrowGroup.traverse(o => {
        o.geometry?.dispose()
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose())
        else o.material?.dispose()
      })
      this.root.remove(this._arrowGroup)
      this._arrowGroup = null
    }

    const scale   = this.options.scale   ?? 1.0
    const color   = this.options.color   ?? 0xffaa00
    const opacity = this.options.opacity ?? 0.75

    const r        = 0.025 * scale
    const headLen  = Math.min(length * 0.3, 0.25 * scale)
    const shaftLen = Math.max(length - headLen, 0.001)
    const headR    = r * 2.5
    const segs     = 12

    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite:  false,
    })

    // 杆：沿 +Y 方向（CylinderGeometry 默认 Y 轴）
    const shaftGeo = new THREE.CylinderGeometry(r, r, shaftLen, segs)
    const shaft    = new THREE.Mesh(shaftGeo, mat)
    shaft.position.y = shaftLen / 2

    // 锥头：指向 +Y 末端（父节点方向）
    const coneGeo = new THREE.ConeGeometry(headR, headLen, segs)
    const cone    = new THREE.Mesh(coneGeo, mat)
    cone.position.y = shaftLen + headLen / 2

    this._arrowGroup = new THREE.Group()
    this._arrowGroup.add(shaft, cone)
    this.root.add(this._arrowGroup)
  }

  /**
   * 更新箭头两端点（在 fixedFrame / ROS 坐标系中）
   * 箭头从 childPos 出发，指向 parentPos
   *
   * @param {{ childPos: {x,y,z}, parentPos: {x,y,z} }} data
   */
  update(data) {
    if (!data) return
    const { childPos, parentPos } = data
    if (!childPos || !parentPos) return

    const from = new THREE.Vector3(childPos.x,  childPos.y,  childPos.z)
    const to   = new THREE.Vector3(parentPos.x, parentPos.y, parentPos.z)

    // root 放在子节点世界位置
    this.root.position.copy(from)

    const dir    = new THREE.Vector3().subVectors(to, from)
    const length = dir.length()

    if (length < 1e-6) {
      this.root.visible = false
      return
    }
    this.root.visible = true

    // 长度变化时重建几何体
    if (Math.abs(length - this._lastLength) > 0.001) {
      this._lastLength = length
      this._rebuildArrow(length)
    }

    // 旋转 root 使 +Y 轴朝向父节点
    // Three.js CylinderGeometry 默认 Y-up，需旋转到 dir 方向
    const up = new THREE.Vector3(0, 1, 0)
    dir.normalize()
    this.root.quaternion.setFromUnitVectors(up, dir)
  }

  dispose() {
    if (this._arrowGroup) {
      this._arrowGroup.traverse(o => {
        o.geometry?.dispose()
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose())
        else o.material?.dispose()
      })
      this._arrowGroup = null
    }
    super.dispose()
  }
}
