import * as THREE from 'three'

export class BaseView {
  constructor(type) {
    this.type = type
    this.targetFrame = 'base_link'
    this.yaw = 0
    this.pitch = 0
    this.position = new THREE.Vector3(0, 0, 0)
    this.focalPoint = new THREE.Vector3(0, 0, 0)

    this._hasAbsPose = false
    this._absCameraPos = new THREE.Vector3()
    this._absControlTarget = new THREE.Vector3()

    this._hasRelativePose = false
    this._relOffset = new THREE.Vector3()
    this._relLookOffset = new THREE.Vector3()
  }

  setParams(params = {}) {
    if (params.targetFrame !== undefined) this.targetFrame = params.targetFrame
    if (params.yaw !== undefined) this.yaw = params.yaw
    if (params.pitch !== undefined) this.pitch = params.pitch
    if (params.position) this.position.set(params.position.x ?? this.position.x, params.position.y ?? this.position.y, params.position.z ?? this.position.z)
    if (params.focalPoint) this.focalPoint.set(params.focalPoint.x ?? this.focalPoint.x, params.focalPoint.y ?? this.focalPoint.y, params.focalPoint.z ?? this.focalPoint.z)
  }

  saveAbsolutePose(camera, controls) {
    this._absCameraPos.copy(camera.position)
    this._absControlTarget.copy(controls.target)
    this._hasAbsPose = true
  }

  restoreAbsolutePose(camera, controls) {
    if (!this._hasAbsPose) return false
    camera.position.copy(this._absCameraPos)
    controls.target.copy(this._absControlTarget)
    controls.update()
    return true
  }

  saveRelativePose(camera, controls, target, { useTargetOrientation = true } = {}) {
    if (!target) return false

    const targetPos = new THREE.Vector3()
    target.getWorldPosition(targetPos)

    const relOffset = camera.position.clone().sub(targetPos)
    const relLook = controls.target.clone().sub(targetPos)

    if (useTargetOrientation) {
      const q = new THREE.Quaternion()
      target.getWorldQuaternion(q)
      const inv = q.invert()
      relOffset.applyQuaternion(inv)
      relLook.applyQuaternion(inv)
    }

    this._relOffset.copy(relOffset)
    this._relLookOffset.copy(relLook)
    this._hasRelativePose = true
    return true
  }

  restoreRelativePose(camera, controls, target, { useTargetOrientation = true } = {}) {
    if (!target || !this._hasRelativePose) return false

    const targetPos = new THREE.Vector3()
    target.getWorldPosition(targetPos)

    const worldOffset = this._relOffset.clone()
    const worldLookOffset = this._relLookOffset.clone()

    if (useTargetOrientation) {
      const q = new THREE.Quaternion()
      target.getWorldQuaternion(q)
      worldOffset.applyQuaternion(q)
      worldLookOffset.applyQuaternion(q)
    }

    camera.position.copy(targetPos.clone().add(worldOffset))
    controls.target.copy(targetPos.clone().add(worldLookOffset))
    controls.update()
    return true
  }

  activate() {}
  deactivate() {}
  snapshot() {}
  update() {}
}
