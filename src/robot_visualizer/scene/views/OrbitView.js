import * as THREE from 'three'
import { BaseView } from './BaseView'

export class OrbitView extends BaseView {
  constructor(camera, controls) {
    super('orbit')
    this._camera = camera
    this._controls = controls
    this._target = null
    this._lastTargetPos = null
    this._offset = new THREE.Vector3(0, 0, 30)
    this._initializedFromTarget = false
  }

  setTarget(target) {
    this._target = target
  }

  setParams(params = {}) {
    super.setParams(params)
    if (params.offset) this._offset.set(params.offset.x ?? this._offset.x, params.offset.y ?? this._offset.y, params.offset.z ?? this._offset.z)
  }

  activate() {
    this._controls.enabled = true
    const restoredRel = this.restoreRelativePose(this._camera, this._controls, this._target, { useTargetOrientation: false })
    const restoredAbs = restoredRel ? true : this.restoreAbsolutePose(this._camera, this._controls)

    if (!restoredRel && !restoredAbs && this._target) {
      const targetPos = new THREE.Vector3()
      this._target.getWorldPosition(targetPos)
      this._controls.target.copy(targetPos)
      this._camera.position.copy(targetPos.clone().add(this._offset))
      this._controls.update()
      this._initializedFromTarget = true
    } else {
      this._initializedFromTarget = restoredRel || restoredAbs
    }

    if (this._target) {
      const p = new THREE.Vector3()
      this._target.getWorldPosition(p)
      this._lastTargetPos = p.clone()
    } else {
      this._lastTargetPos = null
    }
  }

  snapshot() {
    this.saveAbsolutePose(this._camera, this._controls)
    this.saveRelativePose(this._camera, this._controls, this._target, { useTargetOrientation: false })
    this.position.copy(this._camera.position)
    this.focalPoint.copy(this._controls.target)
  }

  update() {
    if (!this._target) return

    const p = new THREE.Vector3()
    this._target.getWorldPosition(p)

    if (!this._initializedFromTarget && !this._hasRelativePose && !this._hasAbsPose) {
      this._controls.target.copy(p)
      this._camera.position.copy(p.clone().add(this._offset))
      this._controls.update()
      this._initializedFromTarget = true
    }

    if (!this._lastTargetPos) {
      this._lastTargetPos = p.clone()
      return
    }

    const delta = p.clone().sub(this._lastTargetPos)
    this._lastTargetPos.copy(p)
    if (delta.lengthSq() < 1e-12) return

    this._controls.target.add(delta)
    this._camera.position.add(delta)
    this._controls.update()

    this.position.copy(this._camera.position)
    this.focalPoint.copy(this._controls.target)
  }
}
