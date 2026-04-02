import * as THREE from 'three'
import { BaseView } from './BaseView'

export class ThirdPersonFollowerView extends BaseView {
  constructor(camera, controls) {
    super('thirdpersonfollower')
    this._camera = camera
    this._controls = controls
    this._target = null
    this._offset = new THREE.Vector3(-20, 0, 8)
    this._lookOffset = new THREE.Vector3(0, 0, 1.2)
    this._smooth = 0.2
    this._allowControl = true
    this._useTargetOrientation = true

    this._isUserAdjusting = false
    this._pendingUserChange = false
    this._suppressControlChange = false

    this._onControlStart = () => { this._isUserAdjusting = true }
    this._onControlEnd = () => { this._isUserAdjusting = false }
    this._onControlChange = () => {
      if (this._suppressControlChange) return
      this._pendingUserChange = true
    }
  }

  setTarget(target) {
    this._target = target
  }

  setParams(params = {}) {
    super.setParams(params)
    if (params.offset) this._offset.set(params.offset.x ?? this._offset.x, params.offset.y ?? this._offset.y, params.offset.z ?? this._offset.z)
    if (params.lookOffset) this._lookOffset.set(params.lookOffset.x ?? this._lookOffset.x, params.lookOffset.y ?? this._lookOffset.y, params.lookOffset.z ?? this._lookOffset.z)
    if (params.smooth !== undefined) this._smooth = params.smooth
    if (params.allowControl !== undefined) this._allowControl = params.allowControl
    if (params.useTargetOrientation !== undefined) this._useTargetOrientation = params.useTargetOrientation
  }

  activate() {
    this._controls.enabled = this._allowControl
    this._controls.enableZoom = true
    this._isUserAdjusting = false
    this._pendingUserChange = false

    const restoredRel = this.restoreRelativePose(this._camera, this._controls, this._target, {
      useTargetOrientation: this._useTargetOrientation,
    })
    const restoredAbs = restoredRel ? true : this.restoreAbsolutePose(this._camera, this._controls)

    if (restoredRel && this._target) {
      const targetPos = new THREE.Vector3()
      this._target.getWorldPosition(targetPos)
      const targetQuat = new THREE.Quaternion()
      this._target.getWorldQuaternion(targetQuat)
      const invQuat = targetQuat.clone().invert()
      this._offset.copy(this._camera.position.clone().sub(targetPos).applyQuaternion(invQuat))
      this._lookOffset.copy(this._controls.target.clone().sub(targetPos).applyQuaternion(invQuat))
    }

    if (!restoredRel && !restoredAbs && this._target) {
      const targetPos = new THREE.Vector3()
      this._target.getWorldPosition(targetPos)
      const targetQuat = new THREE.Quaternion()
      this._target.getWorldQuaternion(targetQuat)
      const worldOffset = this._offset.clone().applyQuaternion(targetQuat)
      const worldLookOffset = this._lookOffset.clone().applyQuaternion(targetQuat)
      this._camera.position.copy(targetPos.clone().add(worldOffset))
      this._controls.target.copy(targetPos.clone().add(worldLookOffset))
      this._suppressControlChange = true
      this._controls.update()
      this._suppressControlChange = false
    }

    if (this._allowControl) {
      this._controls.addEventListener('start', this._onControlStart)
      this._controls.addEventListener('end', this._onControlEnd)
      this._controls.addEventListener('change', this._onControlChange)
    }
  }

  deactivate() {
    this._controls.removeEventListener('start', this._onControlStart)
    this._controls.removeEventListener('end', this._onControlEnd)
    this._controls.removeEventListener('change', this._onControlChange)
    this._isUserAdjusting = false
    this._pendingUserChange = false
  }

  snapshot() {
    this.saveAbsolutePose(this._camera, this._controls)
    this.saveRelativePose(this._camera, this._controls, this._target, {
      useTargetOrientation: this._useTargetOrientation,
    })
    this.position.copy(this._camera.position)
    this.focalPoint.copy(this._controls.target)
  }

  update() {
    if (!this._target) return

    const targetPos = new THREE.Vector3()
    this._target.getWorldPosition(targetPos)

    const targetQuat = new THREE.Quaternion()
    this._target.getWorldQuaternion(targetQuat)

    if (this._allowControl && (this._isUserAdjusting || this._pendingUserChange)) {
      const invQuat = targetQuat.clone().invert()
      this._offset.copy(this._camera.position.clone().sub(targetPos).applyQuaternion(invQuat))
      this._lookOffset.copy(this._controls.target.clone().sub(targetPos).applyQuaternion(invQuat))
      this._pendingUserChange = false
    }

    const worldOffset = this._useTargetOrientation
      ? this._offset.clone().applyQuaternion(targetQuat)
      : this._offset.clone()
    const worldLookOffset = this._useTargetOrientation
      ? this._lookOffset.clone().applyQuaternion(targetQuat)
      : this._lookOffset.clone()

    const desiredPos = targetPos.clone().add(worldOffset)
    const desiredLookAt = targetPos.clone().add(worldLookOffset)

    this._controls.target.copy(desiredLookAt)
    this._camera.position.copy(desiredPos)
    this._suppressControlChange = true
    this._controls.update()
    this._suppressControlChange = false

    this.position.copy(this._camera.position)
    this.focalPoint.copy(this._controls.target)
  }
}
