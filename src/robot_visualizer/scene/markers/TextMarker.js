import * as THREE from 'three'
import { BaseMarker } from './BaseMarker'

/**
 * TextMarker — Canvas Sprite 文字标签
 *
 * 天然 billboard（始终面向相机），不受光照影响。
 * 可单独使用，也可由 AxesMarker 等内部创建。
 *
 * options:
 *  text        {string}  显示文字
 *  worldHeight {number}  标签在世界空间的高度（米），默认 0.3
 *  color       {string}  文字颜色，默认 'rgba(255,255,255,0.95)'
 *  fontSize    {number}  Canvas 字体大小（px），默认 48
 */
export class TextMarker extends BaseMarker {
  static get TYPE() { return 'text' }

  static get ROS_MSG_TYPES() {
    return [
      'geometry_msgs/msg/PoseStamped',
      'geometry_msgs/msg/Pose',
      'nav_msgs/msg/Odometry',
      '__static__',  // 静态标签，不随 ROS 消息更新位置
    ]
  }

  _build() {
    this._sprite = null
    const text = this.options.text ?? ''
    if (text) {
      this._sprite = TextMarker.makeSprite(text, {
        worldHeight: this.options.worldHeight ?? 0.3,
        color:       this.options.color       ?? 'rgba(255,255,255,0.95)',
        fontSize:    this.options.fontSize    ?? 48,
      })
      this.root.add(this._sprite)
    }
  }

  /**
   * 静态工厂：创建一个 Canvas Sprite
   * 可被 AxesMarker 等其他 Marker 直接调用，不需要完整 TextMarker 实例。
   *
   * @param {string} text
   * @param {{ worldHeight?: number, color?: string, fontSize?: number }} opts
   * @returns {THREE.Sprite}
   */
  static makeSprite(text, opts = {}) {
    const worldHeight = opts.worldHeight ?? 0.3
    const color       = opts.color       ?? 'rgba(255,255,255,0.95)'
    const fontSize    = opts.fontSize    ?? 48
    const padding     = 16

    const canvas = document.createElement('canvas')
    const ctx    = canvas.getContext('2d')

    ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`
    const tw = ctx.measureText(text).width
    canvas.width  = Math.max(128, tw + padding * 2)
    canvas.height = fontSize + padding * 2

    // 重置 font（canvas resize 后需重设）
    ctx.font         = `bold ${fontSize}px "JetBrains Mono", monospace`
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'

    // 黑色描边
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    ctx.lineWidth   = 5
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2)

    // 填充
    ctx.fillStyle = color
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)

    const tex = new THREE.CanvasTexture(canvas)
    tex.needsUpdate = true

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map:         tex,
      transparent: true,
      alphaTest:   0.05,
      depthTest:   false,
    }))

    const aspect = canvas.width / canvas.height
    sprite.scale.set(worldHeight * aspect, worldHeight, 1)
    return sprite
  }

  /** 更新文字内容（重建 sprite） */
  setText(text) {
    if (this._sprite) {
      this._sprite.material?.map?.dispose()
      this._sprite.material?.dispose()
      this.root.remove(this._sprite)
      this._sprite = null
    }
    this.options.text = text
    if (!text) return
    this._sprite = TextMarker.makeSprite(text, {
      worldHeight: this.options.worldHeight ?? 0.3,
      color:       this.options.color       ?? 'rgba(255,255,255,0.95)',
      fontSize:    this.options.fontSize    ?? 48,
    })
    this.root.add(this._sprite)
  }

  /** 更新位置（用于跟随某个坐标） */
  update(data) {
    if (!data) return
    let pos = null
    switch (this.rosMsgType) {
      case 'geometry_msgs/msg/PoseStamped':
        pos = data.pose?.position; break
      case 'geometry_msgs/msg/Pose':
        pos = data.position; break
      case 'nav_msgs/msg/Odometry':
        pos = data.pose?.pose?.position; break
      default: return
    }
    if (pos) this.root.position.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0)
  }

  dispose() {
    if (this._sprite) {
      this._sprite.material?.map?.dispose()
      this._sprite.material?.dispose()
      this._sprite = null
    }
    super.dispose()
  }
}
