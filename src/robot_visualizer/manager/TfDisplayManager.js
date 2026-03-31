/**
 * TfDisplayManager — TF 显示管理器
 *
 * 职责：
 *  1. 持有 fixedFrame + TF settings（showAxes/showNames/hidden/scale）
 *  2. 监听 TfManager 的 'update' 事件
 *  3. 根据 settings + hidden 集合，计算每个可见 frame 相对 fixedFrame 的绝对位置
 *  4. 通过 SceneCommandBus 创建/更新/删除场景中的 AxesMarker
 *
 * 数据流：
 *   TfManager.on('update') ──▶ TfDisplayManager._sync()
 *                                      ↓
 *                           SceneCommandBus.dispatch('scene:marker:set')    (首次)
 *                           SceneCommandBus.dispatch('scene:marker:update') (后续)
 *                           SceneCommandBus.dispatch('scene:marker:remove') (frame 消失)
 */

import { getTfManager } from '../data/TfManager'
import { SceneCommandBus } from './SceneCommandBus'

// ROS 消息类型：用 geometry_msgs/msg/Pose 表示绝对位姿（最简单，无 header）
const AXES_ROS_TYPE = 'geometry_msgs/msg/Pose'

export class TfDisplayManager {
  constructor() {
    /** @type {string} 固定坐标系，默认取 TF 树根帧 */
    this.fixedFrame = ''

    /** @type {{ showAxes, showNames, showArrows, markerScale, allEnabled }} */
    this.settings = {
      showAxes:    true,
      showNames:   true,
      showArrows:  true,
      markerScale: 1.0,
      allEnabled:  true,
    }

    /** @type {Set<string>} 用户手动隐藏的 frame 名称 */
    this.hiddenFrames = new Set()

    /** @type {boolean} TF display 是否整体启用（DNode 勾选框） */
    this.enabled = true

    /** @type {Set<string>} 当前场景中已创建的 axes marker key */
    this._activeKeys = new Set()

    /** @type {Set<string>} 当前场景中已创建的 arrow marker key */
    this._activeArrowKeys = new Set()

    /** @type {Set<function>} fixedFrame 变化监听器 */
    this._fixedFrameListeners = new Set()

    // 绑定 TfManager 更新事件
    this._onTfUpdate = () => {
      // 若 fixedFrame 还未设置，取树根帧
      if (!this.fixedFrame) this._autoSetFixedFrame()
      this._sync()
    }
    getTfManager().on('update', this._onTfUpdate)

    // 场景就绪后再次同步（Viewport3D handlers 注册完毕后）
    this._onSceneReady = () => {
      this._activeKeys.clear()
      this._sync()
    }
    this._unregSceneReady = SceneCommandBus.register('scene:ready', this._onSceneReady)

    // 首次尝试自动设置根帧
    this._autoSetFixedFrame()
    this._sync()
  }

  // ── 自动取根帧 ──────────────────────────────────────────────────────

  /**
   * 从 TfManager 的 TF 树里找根帧（parentFrame === null），设为 fixedFrame
   * 找到后通知所有监听者
   */
  _autoSetFixedFrame() {
    const tfTree = getTfManager().getTfTree()
    if (!tfTree.size) return
    // 根帧：parentFrame 为 null
    for (const [name, node] of tfTree) {
      if (node.parentFrame === null) {
        if (this.fixedFrame !== name) {
          this.fixedFrame = name
          this._emitFixedFrame(name)
        }
        return
      }
    }
  }

  // ── fixedFrame 变化通知 ──────────────────────────────────────────────

  /**
   * 订阅 fixedFrame 变化（UI 用于同步下拉框默认值）
   * @param {function} fn  fn(frameName: string)
   * @returns {function} 取消订阅
   */
  onFixedFrameChange(fn) {
    this._fixedFrameListeners.add(fn)
    // 立即回调当前值
    if (this.fixedFrame) fn(this.fixedFrame)
    return () => this._fixedFrameListeners.delete(fn)
  }

  _emitFixedFrame(frame) {
    this._fixedFrameListeners.forEach(fn => { try { fn(frame) } catch(e) {} })
  }

  // ── 外部接口（由 UI 层调用） ─────────────────────────────────────────

  /**
   * 设置固定坐标系（来自 GlobalOptions 的 fixedFrame 选择）
   * @param {string} frame
   */
  setFixedFrame(frame) {
    this.fixedFrame = frame || this.fixedFrame
    this._emitFixedFrame(this.fixedFrame)
    this._sync()
  }

  /**
   * 更新 TF 显示设置（showAxes/showNames/markerScale 等）
   * @param {Partial<TfDisplayManager['settings']>} patch
   */
  updateSettings(patch) {
    this.settings = { ...this.settings, ...patch }
    this._sync()
  }

  /**
   * 设置单个 frame 的可见性
   * @param {string} frameName
   * @param {boolean} visible
   */
  setFrameVisible(frameName, visible) {
    if (visible) this.hiddenFrames.delete(frameName)
    else         this.hiddenFrames.add(frameName)
    // 绕过节流，立即同步（用户主动操作，需要即时响应）
    this._lastSync = 0
    this._sync()
  }

  /**
   * 整体启用/禁用 TF display（对应 DNode 勾选框）
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled
    if (!enabled) {
      this._clearAll()
    } else {
      this._sync()
    }
  }

  /**
   * 销毁，移除事件监听
   */
  destroy() {
    getTfManager().off('update', this._onTfUpdate)
    if (this._unregSceneReady) this._unregSceneReady()
    this._fixedFrameListeners.clear()
    this._clearAll()
  }

  // ── 内部逻辑 ────────────────────────────────────────────────────────

  /**
   * 核心同步方法：从 TfManager 获取树，计算各 frame 绝对位姿，
   * 驱动 scene marker 增删改
   */
  _sync() {
    if (!this.enabled) {
      this._clearAll()
      return
    }

    if (!this.settings.showAxes) {
      // 仅清除 axes，保留 arrows（如有）
      this._activeKeys.forEach(key => {
        SceneCommandBus.dispatch({ type: 'scene:marker:remove', key })
      })
      this._activeKeys.clear()
    }

    // 节流：10Hz，避免 TF 高频更新导致每帧重建 marker
    const now = Date.now()
    if (this._lastSync && now - this._lastSync < 100) return
    this._lastSync = now

    const tfMgr  = getTfManager()
    const tfTree = tfMgr.getTfTree()

    const wantedKeys      = new Set()
    const wantedArrowKeys = new Set()

    // ── 第一遍：计算所有 frame 的绝对位姿，填充 framePositions
    // 必须在 showAxes 判断之外，确保 arrow 也能拿到位置数据
    const framePositions = new Map()  // frameName -> {x, y, z}
    const framePoses     = new Map()  // frameName -> { translation, rotation }

    tfTree.forEach((_node, frameName) => {
      if (!this.settings.allEnabled) return
      if (this.hiddenFrames.has(frameName)) return

      let translation, rotation
      if (frameName === this.fixedFrame) {
        translation = { x: 0, y: 0, z: 0 }
        rotation    = { x: 0, y: 0, z: 0, w: 1 }
      } else {
        const tf = tfMgr.lookupTransform(this.fixedFrame, frameName)
        if (!tf) return
        translation = tf.translation
        rotation    = tf.rotation
      }

      framePositions.set(frameName, translation)
      framePoses.set(frameName, { translation, rotation })
    })

    // ── 第二遍：根据位姿数据创建/更新 Axes markers
    framePoses.forEach(({ translation, rotation }, frameName) => {
      if (this.settings.showAxes) {
        const key = `tf_axes_${frameName}`
        wantedKeys.add(key)

        const poseMsg = {
          position:    { x: translation.x, y: translation.y, z: translation.z },
          orientation: { x: rotation.x,    y: rotation.y,    z: rotation.z,    w: rotation.w ?? 1 },
        }

        if (!this._activeKeys.has(key)) {
          SceneCommandBus.dispatch({
            type:       'scene:marker:set',
            markerType: 'axes',
            key,
            rosMsgType: AXES_ROS_TYPE,
            options: {
              scale:     this.settings.markerScale,
              label:     frameName,
              showLabel: this.settings.showNames,
              labelSize: 0.45 * this.settings.markerScale,
            },
          })
          this._activeKeys.add(key)
        } else {
          SceneCommandBus.dispatch({
            type:    'scene:marker:labelVisible',
            key,
            visible: this.settings.showNames,
          })
        }

        SceneCommandBus.dispatch({
          type: 'scene:marker:update',
          key,
          data: poseMsg,
        })
      }
    })

    // ── Arrow markers（子 → 父）──────────────────────────────────────
    if (this.settings.showArrows) {
      tfTree.forEach((node, frameName) => {
        if (!this.settings.allEnabled) return
        if (this.hiddenFrames.has(frameName)) return
        if (!node.parentFrame) return  // 根帧无父节点
        if (this.hiddenFrames.has(node.parentFrame)) return

        const childPos  = framePositions.get(frameName)
        const parentPos = framePositions.get(node.parentFrame)
        if (!childPos || !parentPos) return

        const arrowKey = `tf_arrow_${frameName}`
        wantedArrowKeys.add(arrowKey)

        if (!this._activeArrowKeys.has(arrowKey)) {
          SceneCommandBus.dispatch({
            type:       'scene:marker:set',
            markerType: 'arrow',
            key:        arrowKey,
            rosMsgType: '__arrow__',
            options: {
              scale:   this.settings.markerScale,
              color:   0xffaa00,
              opacity: 1.0,
            },
          })
          this._activeArrowKeys.add(arrowKey)
        }

        SceneCommandBus.dispatch({
          type: 'scene:marker:update',
          key:  arrowKey,
          data: { childPos, parentPos },
        })
      })
    }

    // 移除已消失的 axes marker
    this._activeKeys.forEach(key => {
      if (!wantedKeys.has(key)) {
        SceneCommandBus.dispatch({ type: 'scene:marker:remove', key })
        this._activeKeys.delete(key)
      }
    })

    // 移除已消失或已关闭的 arrow marker
    this._activeArrowKeys.forEach(key => {
      if (!wantedArrowKeys.has(key)) {
        SceneCommandBus.dispatch({ type: 'scene:marker:remove', key })
        this._activeArrowKeys.delete(key)
      }
    })
  }

  /**
   * markerScale 改变时需要重建所有 marker（几何体不同）
   * @param {number} scale
   */
  _rebuildScale(scale) {
    // 清空全部，再触发 sync 重建
    this._clearAll()
    this.settings.markerScale = scale
    this._sync()
  }

  /** 清空场景中所有 TF marker（axes + arrows）*/
  _clearAll() {
    this._activeKeys.forEach(key => {
      SceneCommandBus.dispatch({ type: 'scene:marker:remove', key })
    })
    this._activeKeys.clear()
    this._activeArrowKeys.forEach(key => {
      SceneCommandBus.dispatch({ type: 'scene:marker:remove', key })
    })
    this._activeArrowKeys.clear()
  }
}

// ── 单例 ───────────────────────────────────────────────────────────────
let _instance = null
export function getTfDisplayManager() {
  if (!_instance) _instance = new TfDisplayManager()
  return _instance
}
