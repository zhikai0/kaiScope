import * as THREE from 'three'
import { BaseMarker } from './BaseMarker'
import { TextMarker } from './TextMarker'

// 复用四元数对象，避免每帧 GC
const _tmpQuat = new THREE.Quaternion()

/**
 * AxesMarker — RViz 风格坐标轴 Marker
 *
 * 外观：
 *  - 圆柱体轴杆 + 锥形箭头头部（与 RViz 一致）
 *  - X=红  Y=绿  Z=蓝（RGB = XYZ）
 *  - MeshPhongMaterial + flatShading + 30% 自发光，无镜面反射
 *  - Canvas Sprite 文字标签（frame 名称），可单独显隐
 *
 * 支持的 ROS 消息类型：
 *  - geometry_msgs/msg/PoseStamped
 *  - geometry_msgs/msg/Pose
 *  - nav_msgs/msg/Odometry
 *  - tf2_msgs/msg/TFMessage
 *
 * options:
 *  scale      {number}  轴总长，默认 1.0
 *  radius     {number}  轴杆半径，默认 0.05
 *  segments   {number}  圆柱分段，默认 16
 *  showLabel  {boolean} 是否显示 frame 名标签，默认 true
 *  label      {string}  标签文字
 *  labelSize  {number}  标签世界高度（米），默认 0.3
 */
export class AxesMarker extends BaseMarker {
  static get TYPE() { return 'axes' }

  static get ROS_MSG_TYPES() {
    return [
      'geometry_msgs/msg/PoseStamped',
      'geometry_msgs/msg/Pose',
      'nav_msgs/msg/Odometry',
      'tf2_msgs/msg/TFMessage',
    ]
  }

  // RViz 标准轴颜色（纯色，不受光照影响）
  static COLORS = {
    x: 0xff0000,  // 纯红
    y: 0x00ff00,  // 纯绿
    z: 0x0000ff,  // 纯蓝
  }

  _build() {
    const scale     = this.options.scale    ?? 1.0
    const radius    = (this.options.radius  ?? 0.05) * scale
    const segments  = this.options.segments ?? 16
    const label     = this.options.label    ?? ''
    const showLabel = this.options.showLabel !== false

    // 三根轴
    this.root.add(AxesMarker._makeAxis(scale, radius, segments, AxesMarker.COLORS.x, 'x'))
    this.root.add(AxesMarker._makeAxis(scale, radius, segments, AxesMarker.COLORS.y, 'y'))
    this.root.add(AxesMarker._makeAxis(scale, radius, segments, AxesMarker.COLORS.z, 'z'))

    // 原点小球（白色，MeshBasicMaterial）
    const sphereGeo = new THREE.SphereGeometry(radius * 1.6, 12, 8)
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    this.root.add(new THREE.Mesh(sphereGeo, sphereMat))

    // 文字标签 — THREE.Sprite 天然 billboard，始终面向相机
    // 使用 billboard group：onBeforeRender 时抵消父节点旋转，确保文字不随 TF 旋转
    this._labelGroup  = null
    this._labelSprite = null
    if (label) {
      this._labelSprite = TextMarker.makeSprite(label, { worldHeight: this.options.labelSize ?? 0.3 })
      // ROS Z-up 坐标系：Z 是上方，偏移到坐标轴顶端上方
      this._labelSprite.position.set(0, 0, scale * 1.2)
      this._labelSprite.visible = showLabel

      // Billboard group：每帧在渲染前抵消世界旋转，使标签始终水平正向显示
      this._labelGroup = new THREE.Group()
      this._labelGroup.add(this._labelSprite)
      this._labelGroup.onBeforeRender = (renderer, scene, camera) => {
        // 取父节点（root）的世界旋转四元数的逆，抵消旋转
        this._labelGroup.getWorldQuaternion(_tmpQuat)
        _tmpQuat.invert()
        this._labelGroup.quaternion.copy(_tmpQuat)
      }
      this.root.add(this._labelGroup)
    }
  }

  /**
   * 构建单根轴（圆柱杆 + 锥形箭头）
   * @param {number} len      总长
   * @param {number} r        杆半径
   * @param {number} segs     分段数
   * @param {number} color    十六进制颜色
   * @param {'x'|'y'|'z'} axis
   */
  static _makeAxis(len, r, segs, color, axis) {
    const group    = new THREE.Group()
    const headLen  = len * 0.25
    const shaftLen = len - headLen
    const headR    = r * 2.2

    const col = new THREE.Color(color)
    // RViz 使用 MeshBasicMaterial — 纯色，完全不受光照影响
    const mat = new THREE.MeshBasicMaterial({
      color: col,
      side:  THREE.DoubleSide,
    })

    // 杆（CylinderGeometry 默认沿 Y 轴）
    const shaftGeo = new THREE.CylinderGeometry(r, r, shaftLen, segs)
    const shaft    = new THREE.Mesh(shaftGeo, mat)
    shaft.position.y = shaftLen / 2

    // 锥头
    const coneGeo = new THREE.ConeGeometry(headR, headLen, segs)
    const cone    = new THREE.Mesh(coneGeo, mat)
    cone.position.y = shaftLen + headLen / 2

    group.add(shaft, cone)

    // 旋转到对应轴方向
    if (axis === 'x') group.rotation.z = -Math.PI / 2
    if (axis === 'z') group.rotation.x =  Math.PI / 2
    // Y 轴不旋转

    return group
  }

  /** 显示/隐藏文字标签 */
  setLabelVisible(visible) {
    if (this._labelGroup)  this._labelGroup.visible  = visible
    else if (this._labelSprite) this._labelSprite.visible = visible
  }

  /** 更新标签文字（重建 sprite） */
  setLabel(text, worldHeight) {
    // 清理旧 sprite
    if (this._labelSprite) {
      this._labelSprite.parent?.remove(this._labelSprite)
      this._labelSprite.material?.map?.dispose()
      this._labelSprite.material?.dispose()
      this._labelSprite = null
    }
    // 清理旧 billboard group
    if (this._labelGroup) {
      this.root.remove(this._labelGroup)
      this._labelGroup = null
    }
    if (!text) return
    const h = worldHeight ?? this.options.labelSize ?? 0.3
    const scale = this.options.scale ?? 1.0
    this._labelSprite = TextMarker.makeSprite(text, { worldHeight: h })
    this._labelSprite.position.set(0, 0, scale * 1.2)
    this._labelSprite.visible = this.options.showLabel !== false

    this._labelGroup = new THREE.Group()
    this._labelGroup.add(this._labelSprite)
    this._labelGroup.onBeforeRender = (renderer, scene, camera) => {
      this._labelGroup.getWorldQuaternion(_tmpQuat)
      _tmpQuat.invert()
      this._labelGroup.quaternion.copy(_tmpQuat)
    }
    this.root.add(this._labelGroup)
  }

  /** 重建（scale 变化时调用） */
  rebuild() {
    // 清理 root 子节点
    while (this.root.children.length) {
      const c = this.root.children[0]
      c.traverse(o => {
        o.geometry?.dispose()
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose())
        else o.material?.dispose()
      })
      this.root.remove(c)
    }
    // 清理 labelGroup 子节点
    if (this._labelGroup) {
      while (this._labelGroup.children.length) {
        const c = this._labelGroup.children[0]
        c.traverse(o => {
          o.geometry?.dispose()
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose())
          else o.material?.dispose()
        })
        this._labelGroup.remove(c)
      }
    }
    this._labelSprite = null
    this._build()
  }

  // ── update（接收 ROS 消息，更新位姿） ───────────────────────────────

  update(data) {
    if (!data) return

    let pos = null
    let ori = null

    switch (this.rosMsgType) {
      case 'geometry_msgs/msg/PoseStamped':
        pos = data.pose?.position
        ori = data.pose?.orientation
        break
      case 'geometry_msgs/msg/Pose':
        pos = data.position
        ori = data.orientation
        break
      case 'nav_msgs/msg/Odometry':
        pos = data.pose?.pose?.position
        ori = data.pose?.pose?.orientation
        break
      case 'tf2_msgs/msg/TFMessage': {
        const tf = data.transforms?.[0]?.transform
        pos = tf?.translation
        ori = tf?.rotation
        break
      }
      default:
        console.warn(`[AxesMarker] 未知消息类型：${this.rosMsgType}`)
        return
    }

    // rosRoot 已做 Z-up→Y-up，直接用 ROS 原始坐标
    if (pos) {
      this.root.position.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0)
    }
    if (ori) {
      this.root.quaternion.set(ori.x ?? 0, ori.y ?? 0, ori.z ?? 0, ori.w ?? 1)
    }
  }
}
