/**
 * DisplayManager — UI 操作 ↔ 数据层桥接器
 *
 * 架构:
 *   UI (LeftPanel/Displays) ──subscribe──▶ DisplayManager ──request──▶ RosDataManager
 *   RosDataManager ──data──▶ DisplayManager ──publish──▶ Consumers (Viewport3D etc.)
 *
 * 职责:
 *  1. 订阅 UI 操作事件 (display add/remove/toggle/param change)
 *  2. 根据操作向 RosDataManager 发起 subscribe/unsubscribe
 *  3. 接收数据并按 displayId 分发给渲染层
 *  4. UI 和 Data 层完全解耦，互不直接引用
 */

import { routeParam, SceneCommandBus } from './SceneCommandBus'
import { getTfManager } from '../data/TfManager'

// ── Event bus (tiny typed pub/sub) ───────────────────────────────────────
class EventBus extends EventTarget {
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })) }
  on(type, fn)  { this.addEventListener(type, fn) }
  off(type, fn) { this.removeEventListener(type, fn) }
}

// ── DisplayManager ────────────────────────────────────────────────────────
export class DisplayManager extends EventBus {
  constructor() {
    super()
    /** @type {import('./RosDataManager').RosDataManager | null} */
    this._dataMgr = null

    // Active display entries: uid -> { id, topic, checked, params }
    this._displays = new Map()

    // Data subscriptions: topic -> Set<uid>  (which displays need this topic)
    this._topicUids = new Map()

    // Per-display data callbacks: uid -> fn(msg, topic)
    this._dataCallbacks = new Map()

    // Unsubscribe handles from RosDataManager: topic -> fn
    this._unsubFns = new Map()

    // Cache latest robot_description payload per display uid.
    // Used to replay URDF into newly mounted 3D scenes.
    this._lastRobotModel = new Map()

    SceneCommandBus.on('scene:ready', () => {
      this._replayRobotModelsToScene()
    })
    SceneCommandBus.on('scene:reset', () => {
      this._replayRobotModelsToScene()
    })
  }

  // ── Connect to data layer ────────────────────────────────────────────

  /**
   * Attach a RosDataManager instance.
   * Call once at app init. Can be swapped at runtime.
   */
  setDataManager(mgr) {
    // Clean up old subscriptions
    if (this._dataMgr) {
      this._unsubFns.forEach(fn => fn())
      this._unsubFns.clear()
    }
    this._dataMgr = mgr
    // Re-subscribe all active displays
    this._displays.forEach((disp) => {
      if (disp.checked && disp.topic) this._ensureSubscribed(disp.topic, disp.uid)
    })
  }

  // ── UI event handlers (called by LeftPanel / display components) ─────

  /**
   * Add a display.
   * @param {{ uid, id, label, topic?, checked, params? }} display
   */
  addDisplay(display) {
    this._displays.set(display.uid, {
      ...display,
      checked: display.checked !== false,
      params:  display.params || {},
    })
    // robotmodel: 只在勾选时订阅/渲染，未勾选时等待用户勾选后再处理
    if (display.id === 'robotmodel') {
      if (display.checked !== false) {
        if (display.topic) this._ensureSubscribed(display.topic, display.uid)
        if (this._lastRobotModel.has(display.uid)) {
          const urdfText = this._lastRobotModel.get(display.uid)
          SceneCommandBus.dispatch({ type: 'scene:urdf:load', uid: display.uid, urdfText })
        }
      }
      this.emit('displays', { displays: this._getDisplayList() })
      return
    }
    if (display.checked !== false) {
      if (display.topic) this._ensureSubscribed(display.topic, display.uid)
    }
    this.emit('displays', { displays: this._getDisplayList() })
  }

  /**
   * Remove a display.
   */
  removeDisplay(uid) {
    const disp = this._displays.get(uid)
    if (!disp) return
    this._displays.delete(uid)
    if (disp.topic) this._maybeUnsubscribe(disp.topic, uid)
    this._dataCallbacks.delete(uid)

    // ── Cleanup scene resources (Generic & Specific) ────────────────
    // 1. Remove any markers associated with this display UID
    SceneCommandBus.dispatch({ type: 'scene:marker:remove', key: `path_${uid}` })
    SceneCommandBus.dispatch({ type: 'scene:marker:remove', key: `pointcloud_${uid}` })
    SceneCommandBus.dispatch({ type: 'scene:marker:remove', key: `marker_${uid}` })

    // 2. Specific cleanup based on display type ID
    if (disp.id === 'robotmodel') {
      SceneCommandBus.dispatch({ type: 'scene:urdf:dispose', uid })
      this._lastRobotModel.delete(uid)
    }

    this.emit('displays', { displays: this._getDisplayList() })
  }

  /**
   * Toggle display visibility (checked state).
   */
  toggleDisplay(uid, checked) {
    const disp = this._displays.get(uid)
    if (!disp) return
    disp.checked = checked
    if (disp.topic) {
      if (checked) this._ensureSubscribed(disp.topic, uid)
      else         this._maybeUnsubscribe(disp.topic, uid)
    }
    // 取消勾选时清除场景中的 marker
    if (!checked) {
      SceneCommandBus.dispatch({ type: 'scene:marker:remove', key: `path_${uid}` })
      SceneCommandBus.dispatch({ type: 'scene:marker:remove', key: `pointcloud_${uid}` })
      // robotmodel 取消勾选时销毁 URDF 模型
      if (disp.id === 'robotmodel') {
        SceneCommandBus.dispatch({ type: 'scene:urdf:dispose', uid })
      }
    } else {
      // robotmodel 勾选时立即重放缓存的 URDF（如果有）
      if (disp.id === 'robotmodel' && this._lastRobotModel.has(uid)) {
        const urdfText = this._lastRobotModel.get(uid)
        SceneCommandBus.dispatch({ type: 'scene:urdf:load', uid, urdfText })
      }
    }
    this.emit('displays', { displays: this._getDisplayList() })
  }

  /**
   * Update a parameter for a display.
   * Also handles topic change (re-subscribe).
   */
  updateParam(uid, key, value) {
    const disp = this._displays.get(uid)
    if (!disp) return
    const prevTopic = disp.topic
    disp.params = { ...disp.params, [key]: value }
    if (key === 'topic') {
      disp.topic = value
      // topic 变更时先清除旧 marker
      SceneCommandBus.dispatch({ type: 'scene:marker:remove', key: `path_${uid}` })
      SceneCommandBus.dispatch({ type: 'scene:marker:remove', key: `pointcloud_${uid}` })
      if (disp.checked) {
        if (prevTopic) this._maybeUnsubscribe(prevTopic, uid)
        if (value) this._ensureSubscribed(value, uid)
      }
    }
    // Route param change to scene/map command bus
    routeParam(disp.id, key, value)
    // path 样式参数变化时直接更新 marker
    if (disp.id === 'path' && (key === 'color' || key === 'alpha' || key === 'lineStyle' || key === 'lineWidth')) {
      const markerKey = `path_${uid}`
      SceneCommandBus.dispatch({ type: 'scene:marker:style', key: markerKey, style: { [key]: value } })
    }
    if (disp.id === 'pointcloud' && (key === 'color' || key === 'alpha' || key === 'pointSize')) {
      const markerKey = `pointcloud_${uid}`
      const styleKey = key === 'pointSize' ? 'size' : key
      SceneCommandBus.dispatch({ type: 'scene:marker:style', key: markerKey, style: { [styleKey]: value } })
    }
    this.emit('paramChanged', { uid, key, value, displayId: disp.id })
  }

  /**
   * Register a callback to receive data for a specific display.
   * Returns unregister function.
   * @param {string} uid
   * @param {function} fn  fn(parsedMsg, topic)
   */
  onData(uid, fn) {
    this._dataCallbacks.set(uid, fn)
    return () => this._dataCallbacks.delete(uid)
  }

  /**
   * Get current list of displays (snapshot).
   */
  getDisplays() { return this._getDisplayList() }

  // ── Internal ──────────────────────────────────────────────────────────

  _getDisplayList() {
    return Array.from(this._displays.values())
  }

  _ensureSubscribed(topic, uid) {
    if (!topic) return
    if (!this._topicUids.has(topic)) this._topicUids.set(topic, new Set())
    if (uid) this._topicUids.get(topic).add(uid)

    // Only subscribe to RosDataManager once per topic
    if (this._unsubFns.has(topic)) return
    if (!this._dataMgr) return

    const unsub = this._dataMgr.subscribe(topic, (msg, t) => {
      // Dispatch to all displays watching this topic
      const uids = this._topicUids.get(t) || []
      uids.forEach(id => {
        const disp = this._displays.get(id)
        if (!disp?.checked) return
        const cb = this._dataCallbacks.get(id)
        if (cb) { try { cb(msg, t) } catch (e) { console.error('[DisplayManager]', e) } }

        // ── Path rendering pipeline ──────────────────────────────────
        if (disp.id === 'path' || disp.id === 'history') {
          this._handlePathMsg(msg, disp)
        }
        // ── PointCloud rendering pipeline ───────────────────────────
        if (disp.id === 'pointcloud') {
          this._handlePointCloudMsg(msg, disp)
        }
        // ── RobotModel rendering pipeline ────────────────────────────
        if (disp.id === 'robotmodel') {
          console.log(`[DisplayManager] robotmodel msg received, uid=${disp.uid}, type=${typeof msg}, keys=${Object.keys(msg||{}).join(',')}`)
          this._handleRobotModelMsg(msg, disp)
        }
      })
      // Also emit globally for any panel that wants raw data
      this.emit('data', { topic: t, msg })
    })
    this._unsubFns.set(topic, unsub || (() => {}))
  }

  _maybeUnsubscribe(topic, uid) {
    if (!this._topicUids.has(topic)) return
    const uids = this._topicUids.get(topic)
    if (uid) uids.delete(uid)
    // If no more displays need this topic, unsubscribe from data layer
    if (uids.size === 0) {
      this._topicUids.delete(topic)
      const unsub = this._unsubFns.get(topic)
      if (unsub) { unsub(); this._unsubFns.delete(topic) }
    }
  }

  /**
   * Handle std_msgs/String /robot_description:
   * 收到 URDF XML 字符串后，通过 SceneCommandBus 通知 Viewport3D 加载 URDF 模型
   */
  _handleRobotModelMsg(msg, disp) {
    // std_msgs/String: msg.data 是字符串
    const urdfText = typeof msg === 'string' ? msg : (msg?.data ?? '')
    console.log(`[DisplayManager] _handleRobotModelMsg: urdfText length=${urdfText?.length}, hasRobot=${urdfText?.includes('<robot')}`)
    if (!urdfText || !urdfText.includes('<robot')) return

    this._lastRobotModel.set(disp.uid, urdfText)

    // 只在勾选时才加载到场景
    if (!disp.checked) return

    SceneCommandBus.dispatch({
      type:     'scene:urdf:load',
      uid:      disp.uid,
      urdfText,
    })
  }

  _replayRobotModelsToScene() {
    this._displays.forEach((disp, uid) => {
      if (disp.id !== 'robotmodel' || !disp.checked) return
      const urdfText = this._lastRobotModel.get(uid)
      if (!urdfText) return
      SceneCommandBus.dispatch({
        type: 'scene:urdf:load',
        uid,
        urdfText,
      })
    })
  }

  _handlePointCloudMsg(msg, disp) {
    const key = `pointcloud_${disp.uid}`
    if (!msg) {
      SceneCommandBus.dispatch({ type: 'scene:marker:remove', key })
      return
    }

    SceneCommandBus.dispatch({
      type: 'scene:marker:set',
      markerType: 'pointcloud',
      key,
      rosMsgType: disp.rosMsgType || 'sensor_msgs/msg/PointCloud2',
      options: {
        color: disp.params?.color || '#66ccff',
        size: disp.params?.pointSize ?? 0.04,
        alpha: disp.params?.alpha ?? 1,
      },
    })

    SceneCommandBus.dispatch({
      type: 'scene:marker:update',
      key,
      data: msg,
    })
  }

  /**
   * Handle nav_msgs/Path message:
   * 1. Get fixed frame from global display params
   * 2. Transform each pose from header frame to fixed frame via TfManager
   * 3. Dispatch scene:marker:set + scene:marker:update to Viewport3D
   */
  _handlePathMsg(msg, disp) {
    const key = `path_${disp.uid}`

    if (!msg?.poses?.length) {
      // 清空路径
      SceneCommandBus.dispatch({ type: 'scene:marker:remove', key })
      return
    }

    const tfMgr      = getTfManager()
    const globalDisp = Array.from(this._displays.values()).find(d => d.id === 'global')
    const fixedFrame = globalDisp?.params?.fixedFrame || 'map'
    const srcFrame   = msg.header?.frame_id || fixedFrame

    const points = []
    for (const pose of msg.poses) {
      const p = pose.pose?.position
      if (!p) continue
      // 用 lookupTransform 计算 srcFrame → fixedFrame 的变换
      if (srcFrame === fixedFrame) {
        points.push({ x: p.x, y: p.y, z: p.z })
      } else {
        const tf = tfMgr.lookupTransform(fixedFrame, srcFrame)
        if (tf) {
          // 应用变换：先旋转后平移
          const rotated = _quatRotVec(tf.rotation, { x: p.x, y: p.y, z: p.z })
          points.push({
            x: tf.translation.x + rotated.x,
            y: tf.translation.y + rotated.y,
            z: tf.translation.z + rotated.z,
          })
        } else {
          points.push({ x: p.x, y: p.y, z: p.z })
        }
      }
    }

    if (!points.length) return

    // 确保 marker 已创建
    SceneCommandBus.dispatch({
      type:       'scene:marker:set',
      markerType: 'path',
      key,
      rosMsgType: '__preprocessed__',
      options: {
        color:     disp.params?.color     || '#19ff00',
        alpha:     disp.params?.alpha     ?? 1,
        lineStyle: disp.params?.lineStyle || 'solid',
      },
    })

    // 更新路径数据
    SceneCommandBus.dispatch({
      type: 'scene:marker:update',
      key,
      data: { points },
    })
  }
}

// ── 内部四元数旋转工具（避免依赖 TfManager 内部函数） ──────────────────
function _quatRotVec(q, v) {
  if (!q) return v
  const { x: qx, y: qy, z: qz, w: qw } = q
  const { x: vx, y: vy, z: vz } = v
  // p' = q * p * q^-1
  const ix =  qw*vx + qy*vz - qz*vy
  const iy =  qw*vy + qz*vx - qx*vz
  const iz =  qw*vz + qx*vy - qy*vx
  const iw = -qx*vx - qy*vy - qz*vz
  return {
    x: ix*qw + iw*(-qx) + iy*(-qz) - iz*(-qy),
    y: iy*qw + iw*(-qy) + iz*(-qx) - ix*(-qz),
    z: iz*qw + iw*(-qz) + ix*(-qy) - iy*(-qx),
  }
}

// Singleton
let _instance = null
export function getDisplayManager() {
  if (!_instance) _instance = new DisplayManager()
  return _instance
}
