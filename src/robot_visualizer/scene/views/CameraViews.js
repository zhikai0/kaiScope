import { OrbitView } from './OrbitView'
import { ThirdPersonFollowerView } from './ThirdPersonFollowerView'
import { TopDownView } from './TopDownView'

export class CameraViews {
  constructor(camera, controls, scene) {
    this._camera = camera
    this._controls = controls
    this._scene = scene

    this._views = {
      orbit: new OrbitView(camera, controls),
      topdown: new TopDownView(camera, controls),
      thirdpersonfollower: new ThirdPersonFollowerView(camera, controls),
    }

    this._mode = 'orbit'
    this._active = this._views.orbit
    this._active.activate()
  }

  setMode(mode, options = {}) {
    const next = this._views[mode]
    if (!next) return

    this._active?.snapshot?.()
    this._active?.deactivate?.()

    this._mode = mode
    this._active = next
    if (Object.keys(options).length > 0) this._active.setParams(options)
    this._active.activate()
  }

  setFollowTarget(target) {
    this._views.thirdpersonfollower.setTarget(target)
    this._views.orbit.setTarget(target)
    this._views.topdown.setTarget(target)
  }

  setParams(mode, params = {}) {
    this._views[mode]?.setParams(params)
  }

  get mode() { return this._mode }

  /**
   * 当从 localStorage 恢复相机位姿时，通知 CameraViews 将该位姿同步到当前活跃 View。
   * 这样后续 activate() 时就不会覆盖已恢复的位置。
   */
  syncFromExternalCamera(camera, controls) {
    if (!this._active) return
    // 保存为绝对位姿，这样后续 activate/update 时会识别到已有状态
    this._active.saveAbsolutePose(camera, controls)
  }

  update() {
    this._active?.update()
  }
}
