import * as THREE from 'three'
import { BaseMarker } from './BaseMarker'
import { TextMarker } from './TextMarker'

// Reusable object to avoid per-frame GC
const _worldPos = new THREE.Vector3()

/**
 * AxesMarker — RViz-style coordinate axes marker
 *
 * Appearance:
 *  - Pure cylinder shaft (no arrowhead), length = scale, radialSegments = 16
 *  - End cap sphere at tip of each axis, radius 0.05 * scale
 *  - X = #cc0000 (deep red)  Y = #00cc00 (deep green)  Z = #0000cc (deep blue)
 *  - MeshStandardMaterial with metalness/roughness + emissive glow
 *  - Canvas Sprite text label — lives on parent (rosRoot), only follows position,
 *    orientation is ALWAYS identity (never rotates with TF frame)
 *
 * Supported ROS message types:
 *  - geometry_msgs/msg/PoseStamped
 *  - geometry_msgs/msg/Pose
 *  - nav_msgs/msg/Odometry
 *  - tf2_msgs/msg/TFMessage
 *
 * options:
 *  scale      {number}  axis total length, default 1.0
 *  radius     {number}  shaft radius, default 0.04
 *  showLabel  {boolean} show frame name label, default true
 *  label      {string}  label text
 *  labelSize  {number}  label world height (m), default 0.3
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

  // Deep, saturated axis colors as specified
  static COLORS = {
    x: 0xcc0000,  // deep red
    y: 0x00cc00,  // deep green
    z: 0x0000cc,  // deep blue
  }

  _build() {
    const scale     = this.options.scale    ?? 1.0
    const radius    = (this.options.radius  ?? 0.04) * scale
    const label     = this.options.label    ?? ''
    const showLabel = this.options.showLabel !== false

    // Three cylinder axes (16 radial segments, smooth)
    // scale=1.0 → each axis is 1 metre long
    this.root.add(AxesMarker._makeAxis(scale, radius, AxesMarker.COLORS.x, 'x'))
    this.root.add(AxesMarker._makeAxis(scale, radius, AxesMarker.COLORS.y, 'y'))
    this.root.add(AxesMarker._makeAxis(scale, radius, AxesMarker.COLORS.z, 'z'))

    // ── Text label ─────────────────────────────────────────────────
    // IMPORTANT: the sprite is NOT added to this.root.
    // It is added to this.root.parent (rosRoot) so it inherits NO rotation.
    // We manually sync its world position each frame in onBeforeRender.
    this._labelSprite  = null
    this._labelParent  = null   // will be set when addToScene is called
    this._labelVisible = showLabel
    this._labelText    = label
    this._labelScale   = scale

    // If root is already attached, build label now
    if (this.root.parent) {
      this._attachLabel()
    }
  }

  /**
   * Called after the root group has been added to a parent (rosRoot).
   * Attaches the label sprite to the parent so it is rotation-free.
   */
  _attachLabel() {
    const parent = this.root.parent
    if (!parent || !this._labelText) return
    if (this._labelSprite && this._labelParent === parent) return  // already attached

    // Clean up old sprite if parent changed
    this._detachLabel()

    this._labelParent = parent
    const h = this.options.labelSize ?? 0.45
    this._labelSprite = TextMarker.makeSprite(this._labelText, { worldHeight: h })
    this._labelSprite.visible = this._labelVisible

    // Position the sprite in rosRoot local space.
    // Since both this.root and the sprite are children of rosRoot (parent),
    // this.root.position is already in rosRoot local coords.
    // We simply copy that position and add a downward offset along rosRoot's
    // local -Y axis (which is world -Z in ROS Z-up, i.e. below the frame).
    // No matrix inversion needed — avoids the rotation artifact.
    const scale = this._labelScale
    this._labelSprite.onBeforeRender = () => {
      // root.position is in parent (rosRoot) local space — use it directly
      this._labelSprite.position.set(
        this.root.position.x,
        this.root.position.y - scale * 0.22,
        this.root.position.z,
      )
    }

    parent.add(this._labelSprite)
  }

  /** Remove label sprite from its parent */
  _detachLabel() {
    if (this._labelSprite && this._labelParent) {
      this._labelParent.remove(this._labelSprite)
      this._labelSprite.material?.map?.dispose()
      this._labelSprite.material?.dispose()
      this._labelSprite = null
      this._labelParent = null
    }
  }

  /**
   * Build a single axis — pure cylinder shaft + end-cap sphere.
   * No arrowhead: clean cylindrical look.
   *
   * @param {number} len      total length
   * @param {number} r        shaft radius
   * @param {number} color    hex color
   * @param {'x'|'y'|'z'} axis
   */
  static _makeAxis(len, r, color, axis) {
    const group = new THREE.Group()
    const segs  = 16  // smooth circle cross-section

    const col = new THREE.Color(color)
    const mat = new THREE.MeshStandardMaterial({
      color:             col,
      emissive:          col,
      emissiveIntensity: 0.3,
      metalness:         0.5,
      roughness:         0.4,
    })

    // Shaft — full length along Y, centered at Y = len/2
    // CylinderGeometry has flat circular caps by default (not spherical)
    const shaftGeo = new THREE.CylinderGeometry(r, r, len, segs)
    const shaft    = new THREE.Mesh(shaftGeo, mat)
    shaft.castShadow = true
    shaft.position.y = len / 2

    group.add(shaft)

    // Rotate to correct world axis direction
    if (axis === 'x') group.rotation.z = -Math.PI / 2
    if (axis === 'z') group.rotation.x =  Math.PI / 2
    // Y axis: no rotation

    return group
  }

  // ── Override addToScene / removeFromScene to manage label lifecycle ──

  addToScene(scene) {
    super.addToScene(scene)
    this._attachLabel()
  }

  removeFromScene(scene) {
    this._detachLabel()
    super.removeFromScene(scene)
  }

  /** Show/hide text label */
  setLabelVisible(visible) {
    this._labelVisible = visible
    if (this._labelSprite) this._labelSprite.visible = visible
  }

  /** Update label text (rebuilds sprite) */
  setLabel(text, worldHeight) {
    if (worldHeight !== undefined) this.options.labelSize = worldHeight
    this._labelText = text
    this._detachLabel()
    if (text) this._attachLabel()
  }

  /** Rebuild all geometry (called when scale changes) */
  rebuild() {
    this._detachLabel()
    while (this.root.children.length) {
      const c = this.root.children[0]
      c.traverse(o => {
        o.geometry?.dispose()
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose())
        else o.material?.dispose()
      })
      this.root.remove(c)
    }
    this._labelSprite = null
    this._build()
    if (this.root.parent) this._attachLabel()
  }

  // ── update (receive ROS messages, update pose) ──────────────────────

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
        console.warn(`[AxesMarker] Unknown message type: ${this.rosMsgType}`)
        return
    }

    // rosRoot already applies Z-up → Y-up; use ROS coordinates directly
    if (pos) {
      this.root.position.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0)
    }
    if (ori) {
      this.root.quaternion.set(ori.x ?? 0, ori.y ?? 0, ori.z ?? 0, ori.w ?? 1)
    }
  }

  dispose() {
    this._detachLabel()
    super.dispose()
  }
}
