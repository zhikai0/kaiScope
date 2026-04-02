import * as THREE from 'three'
import { BaseView } from './BaseView'

export class TopDownView extends BaseView {
  constructor(camera, controls) {
    super('topdown')
    this._camera = camera
    this._controls = controls
    this._target = null
    this._lastTargetPos = null
    this._savedCtrl = null
    this._offset = new THREE.Vector3(0, 0, 50)
  }

  setTarget(target) {
    this._target = target
  }

  setParams(params = {}) {
    super.setParams(params)
    if (params.offset) this._offset.set(params.offset.x ?? this._offset.x, params.offset.y ?? this._offset.y, params.offset.z ?? this._offset.z)
  }

  activate() {
    this._savedCtrl = {
      enableRotate: this._controls.enableRotate,
      minPolarAngle: this._controls.minPolarAngle,
      maxPolarAngle: this._controls.maxPolarAngle,
      rotateSpeed: this._controls.rotateSpeed,
      enableDamping: this._controls.enableDamping,
      dampingFactor: this._controls.dampingFactor,
    }

    this._controls.enabled = true
    this._controls.enableDamping = false
    this._controls.enableRotate = true
    this._controls.minPolarAngle = 0.001
    this._controls.maxPolarAngle = 0.001
    this._controls.rotateSpeed = 0.35

    const restoredRel = this.restoreRelativePose(this._camera, this._controls, this._target, { useTargetOrientation: false })
    const restoredAbs = restoredRel ? true : this.restoreAbsolutePose(this._camera, this._controls)

    if (!restoredRel && !restoredAbs && this._target) {
      const targetPos = new THREE.Vector3()
      this._target.getWorldPosition(targetPos)
      this._controls.target.copy(targetPos)
      this._camera.position.copy(targetPos.clone().add(this._offset))
    }

    if (this._target) {
      const p = new THREE.Vector3()
      this._target.getWorldPosition(p)
      this._lastTargetPos = p.clone()
    } else {
      this._lastTargetPos = null
    }

    this._controls.update()
  }

  snapshot() {
    this.saveAbsolutePose(this._camera, this._controls)
    this.saveRelativePose(this._camera, this._controls, this._target, { useTargetOrientation: false })
    this.position.copy(this._camera.position)
    this.focalPoint.copy(this._controls.target)
  }

  deactivate() {
    if (!this._savedCtrl) return
    this._controls.enableRotate = this._savedCtrl.enableRotate
    this._controls.minPolarAngle = this._savedCtrl.minPolarAngle
    this._controls.maxPolarAngle = this._savedCtrl.maxPolarAngle
    this._controls.rotateSpeed = this._savedCtrl.rotateSpeed
    this._controls.enableDamping = this._savedCtrl.enableDamping
    this._controls.dampingFactor = this._savedCtrl.dampingFactor
  }

  update() {
    if (!this._target) return

    const p = new THREE.Vector3()
    this._target.getWorldPosition(p)

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
