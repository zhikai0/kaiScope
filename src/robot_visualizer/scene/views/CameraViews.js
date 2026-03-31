import * as THREE from 'three'

/**
 * CameraViews — 相机视角管理
 *
 * 支持的视角模式：
 *  'orbit'   — 标准自由视角（默认），类 RViz，可旋转/平移/缩放
 *  'follow'  — 跟车视角，相机跟随目标对象，保持固定偏移
 *
 * 使用方式（在 Viewport3D 里）：
 *   import { CameraViews } from './views/CameraViews'
 *   const views = new CameraViews(camera, controls, scene)
 *   views.setMode('follow', { target: robotMesh, offset: {x:0, y:-8, z:5} })
 *   views.setMode('orbit')
 *   // 在 animate 循环里每帧调用：
 *   views.update()
 */
export class CameraViews {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('three/examples/jsm/controls/OrbitControls').OrbitControls} controls
   * @param {THREE.Scene} scene
   */
  constructor(camera, controls, scene) {
    this._camera   = camera
    this._controls = controls
    this._scene    = scene
    this._mode     = 'orbit'

    // 跟车模式配置
    this._followTarget = null   // THREE.Object3D，跟随的目标
    this._followOffset = new THREE.Vector3(0, -10, 6)  // 相对目标的偏移（Y-up 坐标系）
    this._followLookOffset = new THREE.Vector3(0, 0, 0) // 注视点相对目标的偏移
    this._followSmooth = 0.08   // 插值系数（0=瞬间，1=不跟随）

    // 保存 orbit 模式下的相机状态（切回时恢复）
    this._savedOrbitPos    = camera.position.clone()
    this._savedOrbitTarget = controls.target.clone()
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * 切换视角模式
   * @param {'orbit'|'follow'} mode
   * @param {object} options
   *   orbit:  无额外参数
   *   follow: { target?: THREE.Object3D, offset?: {x,y,z}, lookOffset?: {x,y,z}, smooth?: number }
   */
  setMode(mode, options = {}) {
    if (mode === this._mode && Object.keys(options).length === 0) return

    if (mode === 'orbit') {
      this._mode = 'orbit'
      this._controls.enabled = true
      // 恢复保存的 orbit 状态
      this._camera.position.copy(this._savedOrbitPos)
      this._controls.target.copy(this._savedOrbitTarget)
      this._controls.update()
    } else if (mode === 'follow') {
      // 切换前保存当前 orbit 状态
      if (this._mode === 'orbit') {
        this._savedOrbitPos.copy(this._camera.position)
        this._savedOrbitTarget.copy(this._controls.target)
      }
      this._mode = 'follow'
      this._controls.enabled = false  // 跟车模式禁用手动控制

      if (options.target)      this._followTarget = options.target
      if (options.offset)      this._followOffset.set(options.offset.x ?? 0, options.offset.y ?? -10, options.offset.z ?? 6)
      if (options.lookOffset)  this._followLookOffset.set(options.lookOffset.x ?? 0, options.lookOffset.y ?? 0, options.lookOffset.z ?? 0)
      if (options.smooth !== undefined) this._followSmooth = options.smooth
    }
  }

  /** 更新跟随目标（不切换模式） */
  setFollowTarget(target) {
    this._followTarget = target
  }

  get mode() { return this._mode }

  /**
   * 每帧调用（放在 animate 循环里）
   */
  update() {
    if (this._mode === 'follow') {
      this._updateFollow()
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────

  _updateFollow() {
    if (!this._followTarget) return

    // 获取目标世界坐标
    const targetPos = new THREE.Vector3()
    this._followTarget.getWorldPosition(targetPos)

    // 获取目标朝向（yaw 方向），用于让相机跟随朝向
    const targetQuat = new THREE.Quaternion()
    this._followTarget.getWorldQuaternion(targetQuat)

    // 将偏移量旋转到目标朝向
    const offset = this._followOffset.clone().applyQuaternion(targetQuat)
    const desiredPos = targetPos.clone().add(offset)

    // 平滑插值相机位置
    this._camera.position.lerp(desiredPos, this._followSmooth)

    // 注视点
    const lookAt = targetPos.clone().add(
      this._followLookOffset.clone().applyQuaternion(targetQuat)
    )
    this._camera.lookAt(lookAt)
  }
}
