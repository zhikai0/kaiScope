import * as THREE from 'three'
import { BaseMarker } from './BaseMarker'
import { TextMarker } from './TextMarker'

/**
 * AxesMarker — RViz-style coordinate axes marker
 *
 * Appearance:
 *  - Pure cylinder shaft (no arrowhead), length = scale, radialSegments = 16
 *  - X = #cc0000 (deep red)  Y = #00cc00 (deep green)  Z = #0000cc (deep blue)
 *  - MeshStandardMaterial with metalness/roughness + emissive glow
 *  - Canvas Sprite text label — as child of root, auto-follows position.
 *    Rotation is always identity (never rotates with TF frame).
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
 *  labelSize  {number}  label world height (m), default 0.45
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

  static COLORS = {
    x: 0xcc0000,
    y: 0x00cc00,
    z: 0x0000cc,
  }

  _build() {
    const scale     = this.options.scale    ?? 1.0
    const radius    = (this.options.radius  ?? 0.04) * scale
    const label     = this.options.label    ?? ''
    const showLabel = this.options.showLabel !== false

    this.root.add(AxesMarker._makeAxis(scale, radius, AxesMarker.COLORS.x, 'x'))
    this.root.add(AxesMarker._makeAxis(scale, radius, AxesMarker.COLORS.y, 'y'))
    this.root.add(AxesMarker._makeAxis(scale, radius, AxesMarker.COLORS.z, 'z'))

    this._labelSprite  = null
    this._labelVisible = showLabel
    this._labelScale   = scale

    if (label) {
      this._attachLabel(label)
    }
  }

  /**
   * Attach label sprite as child of root.
   * Position is fixed in root local space (below origin).
   * onBeforeRender resets rotation to identity so label never rotates.
   */
  _attachLabel(text) {
    if (!text) return
    this._detachLabel()

    const h = this.options.labelSize ?? 0.45
    this._labelSprite = TextMarker.makeSprite(text, { worldHeight: h })
    this._labelSprite.visible = this._labelVisible

    const scale = this._labelScale
    // Fixed local position: below the origin (in root local space)
    this._labelSprite.position.set(0, -scale * 0.22, 0)

    // Reset rotation to identity each frame so label never rotates with axes
    this._labelSprite.onBeforeRender = () => {
      if (this._labelSprite) {
        this._labelSprite.rotation.set(0, 0, 0)
      }
    }

    this.root.add(this._labelSprite)
  }

  _detachLabel() {
    if (this._labelSprite) {
      this.root.remove(this._labelSprite)
      this._labelSprite.material?.map?.dispose()
      this._labelSprite.material?.dispose()
      this._labelSprite = null
    }
  }

  static _makeAxis(len, r, color, axis) {
    const group = new THREE.Group()
    const segs  = 16

    const col = new THREE.Color(color)
    const mat = new THREE.MeshStandardMaterial({
      color:              col,
      emissive:           col,
      emissiveIntensity:  0.3,
      metalness:          0.5,
      roughness:          0.4,
    })

    const shaftGeo = new THREE.CylinderGeometry(r, r, len, segs)
    const shaft    = new THREE.Mesh(shaftGeo, mat)
    shaft.castShadow = true
    shaft.position.y = len / 2

    group.add(shaft)

    if (axis === 'x') group.rotation.z = -Math.PI / 2
    if (axis === 'z') group.rotation.x =  Math.PI / 2

    return group
  }

  addToScene(scene) {
    super.addToScene(scene)
    // Re-attach label if it was detached (e.g., after dispose)
    if (!this._labelSprite && this.options.label) {
      this._attachLabel(this.options.label)
    }
  }

  removeFromScene(scene) {
    this._detachLabel()
    super.removeFromScene(scene)
  }

  setVisible(visible) {
    super.setVisible(visible)
    if (this._labelSprite) this._labelSprite.visible = visible
  }

  setLabelVisible(visible) {
    this._labelVisible = visible
    if (this._labelSprite) this._labelSprite.visible = visible
  }

  setLabel(text, worldHeight) {
    if (worldHeight !== undefined) this.options.labelSize = worldHeight
    this.options.label = text
    if (text) this._attachLabel(text)
    else this._detachLabel()
  }

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
  }

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
        return
    }

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
