import * as THREE from 'three'
import { BaseMarker } from './BaseMarker'

/**
 * ArrowMarker — TF parent-child relationship arrow
 *
 * Visual design:
 *  - Shaft:     pale yellow  #ffffcc  (thin cylinder)
 *  - Arrowhead: pink         #ff99cc  (cone, ~1/5 of total length)
 *  - Both parts use MeshStandardMaterial for PBR lighting
 *
 * Used by TfDisplayManager when showArrows is enabled.
 *
 * options:
 *  scale      {number}  thickness scale factor, default 1.0
 *  opacity    {number}  opacity, default 0.92
 */
export class ArrowMarker extends BaseMarker {
  static get TYPE() { return 'arrow' }

  static get ROS_MSG_TYPES() {
    return ['__arrow__']  // internal only, not mapped to ROS topic
  }

  // Two-tone colors — shaft warm yellow, head vivid pink
  static SHAFT_COLOR = 0xddcc44   // warm yellow, more saturated
  static HEAD_COLOR  = 0xf04c9e   // vivid pink/magenta

  _build() {
    this._arrowGroup = new THREE.Group()

    const scale   = this.options.scale   ?? 1.0
    const opacity = this.options.opacity ?? 1.0
    const segs    = 14

    this._radius  = 0.022 * scale
    this._headLen = 0.5 * scale         // keep arrowhead size fixed
    this._headR   = this._radius * 3.5

    const isTransp = opacity < 1.0

    // ── Shaft material: warm yellow ──────────────────────────────────
    // Low emissiveIntensity — let lighting do the work, avoid colour washout
    const shaftMat = new THREE.MeshStandardMaterial({
      color:             new THREE.Color(ArrowMarker.SHAFT_COLOR),
      emissive:          new THREE.Color(ArrowMarker.SHAFT_COLOR),
      emissiveIntensity: 0.0,
      metalness:         0.45,
      roughness:         0.4,
      transparent:       isTransp,
      opacity,
      depthWrite:        true,
    })

    // ── Head material: vivid pink ────────────────────────────────────
    const headMat = new THREE.MeshStandardMaterial({
      color:             new THREE.Color(ArrowMarker.HEAD_COLOR),
      emissive:          new THREE.Color(ArrowMarker.HEAD_COLOR),
      emissiveIntensity: 0.0,
      metalness:         0.5,
      roughness:         0.35,
      transparent:       isTransp,
      opacity,
      depthWrite:        true,
    })

    // Shaft geometry length = 1; use scale.y to fit distance
    const shaftGeo = new THREE.CylinderGeometry(this._radius, this._radius, 1, segs)
    this._shaft = new THREE.Mesh(shaftGeo, shaftMat)
    this._shaft.castShadow = true
    this._arrowGroup.add(this._shaft)

    // Cone head geometry keeps constant size
    const coneGeo = new THREE.ConeGeometry(this._headR, this._headLen, segs)
    this._head = new THREE.Mesh(coneGeo, headMat)
    this._head.castShadow = true
    this._arrowGroup.add(this._head)

    this.root.add(this._arrowGroup)
    this._setLength(1.0)
  }

  _setLength(length) {
    const shaftLen = Math.max(length - this._headLen, 0.001)
    this._shaft.scale.set(1, shaftLen, 1)
    this._shaft.position.y = shaftLen / 2
    this._head.position.y  = shaftLen + this._headLen / 2
  }

  /**
   * Update arrow endpoints (in fixedFrame / ROS coordinate space).
   * Arrow originates at childPos and points toward parentPos.
   *
   * @param {{ childPos: {x,y,z}, parentPos: {x,y,z} }} data
   */
  update(data) {
    if (!data) return
    const { childPos, parentPos } = data
    if (!childPos || !parentPos) return

    const from = new THREE.Vector3(childPos.x,  childPos.y,  childPos.z)
    const to   = new THREE.Vector3(parentPos.x, parentPos.y, parentPos.z)

    // root sits at child world position
    this.root.position.copy(from)

    const dir    = new THREE.Vector3().subVectors(to, from)
    const length = dir.length()

    if (length < 1e-6) {
      this.root.visible = false
      return
    }
    this.root.visible = true

    this._setLength(length)

    // Rotate root so +Y axis points toward parent node
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
