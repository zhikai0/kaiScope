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
  static HEAD_COLOR  = 0xee4499   // vivid pink/magenta

  _build() {
    this._arrowGroup = null
    this._lastLength = -1
    this._rebuildArrow(1.0)
  }

  /**
   * Rebuild arrow geometry (called when length changes significantly)
   * @param {number} length  total arrow length (metres)
   */
  _rebuildArrow(length) {
    // Clean up old geometry
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
    const opacity = this.options.opacity ?? 1.0
    const segs    = 14

    const r        = 0.022 * scale
    const headLen  = length * 0.2           // head is exactly 1/5 of total
    const shaftLen = Math.max(length - headLen, 0.001)
    const headR    = r * 2.8

    const isTransp = opacity < 1.0

    // ── Shaft material: warm yellow ──────────────────────────────────
    // Low emissiveIntensity — let lighting do the work, avoid colour washout
    const shaftMat = new THREE.MeshStandardMaterial({
      color:             new THREE.Color(ArrowMarker.SHAFT_COLOR),
      emissive:          new THREE.Color(ArrowMarker.SHAFT_COLOR),
      emissiveIntensity: 0.08,
      metalness:         0.15,
      roughness:         0.55,
      transparent:       isTransp,
      opacity,
      depthWrite:        !isTransp,
    })

    // ── Head material: vivid pink ────────────────────────────────────
    const headMat = new THREE.MeshStandardMaterial({
      color:             new THREE.Color(ArrowMarker.HEAD_COLOR),
      emissive:          new THREE.Color(ArrowMarker.HEAD_COLOR),
      emissiveIntensity: 0.08,
      metalness:         0.2,
      roughness:         0.45,
      transparent:       isTransp,
      opacity,
      depthWrite:        !isTransp,
    })

    // Shaft: along +Y (CylinderGeometry default)
    const shaftGeo = new THREE.CylinderGeometry(r, r, shaftLen, segs)
    const shaft    = new THREE.Mesh(shaftGeo, shaftMat)
    shaft.castShadow = true
    shaft.position.y = shaftLen / 2

    // Cone arrowhead: tip points in +Y direction toward parent
    const coneGeo = new THREE.ConeGeometry(headR, headLen, segs)
    const cone    = new THREE.Mesh(coneGeo, headMat)
    cone.castShadow = true
    cone.position.y = shaftLen + headLen / 2

    this._arrowGroup = new THREE.Group()
    this._arrowGroup.add(shaft, cone)
    this.root.add(this._arrowGroup)
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

    // Rebuild geometry only when length changes noticeably
    if (Math.abs(length - this._lastLength) > 0.001) {
      this._lastLength = length
      this._rebuildArrow(length)
    }

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
