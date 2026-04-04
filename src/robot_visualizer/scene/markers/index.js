/**
 * markers/index.js — Marker 系统统一入口
 *
 * 使用方式：
 *   import { createMarker, MarkerManager } from '../scene/markers'
 *
 *   // 工厂创建（自动校验 ROS 消息类型）
 *   const m = createMarker('axes', 'geometry_msgs/msg/PoseStamped', { scale: 0.5 })
 *   m.addToScene(scene)
 *   m.update(rosMsg)
 *
 *   // 批量管理
 *   const mgr = new MarkerManager(scene)
 *   mgr.set('robot_pose', 'axes', 'geometry_msgs/msg/PoseStamped')
 *   mgr.update('robot_pose', rosMsg)
 *   mgr.remove('robot_pose')
 *   mgr.dispose()  // 销毁全部
 *
 * 新增 Marker 类型步骤：
 *   1. 在 src/scene/markers/ 下新建 XxxMarker.js，继承 BaseMarker
 *   2. 在下方 MARKER_REGISTRY 里注册
 */

import { AxesMarker }  from './AxesMarker'
import { PathMarker }  from './PathMarker'
import { TextMarker }  from './TextMarker'
import { ArrowMarker } from './ArrowMarker'
import { PointCloudMarker } from './PointCloudMarker'
// import { PoseMarker } from './PoseMarker'        // 待实现
// import { PointCloudMarker } from './PointCloudMarker'  // 待实现

export { BaseMarker } from './BaseMarker'
export { AxesMarker, PathMarker, TextMarker, ArrowMarker, PointCloudMarker }

const MARKER_REGISTRY = {
  'axes':       AxesMarker,
  'path':       PathMarker,
  'text':       TextMarker,
  'arrow':      ArrowMarker,
  'pointcloud': PointCloudMarker,
  // 'pose':       PoseMarker,
  // 'pointcloud': PointCloudMarker,
}

/**
 * 工厂函数：根据 type 字符串创建对应 Marker 实例
 *
 * @param {string} type        Marker 类型，如 'axes'、'path'
 * @param {string} rosMsgType  ROS 消息类型，必须在该 Marker 的支持列表内
 * @param {object} options     可选参数（scale, color 等）
 * @returns {BaseMarker}
 * @throws 如果 type 未注册或 rosMsgType 不匹配则抛错
 */
export function createMarker(type, rosMsgType, options = {}) {
  const Cls = MARKER_REGISTRY[type]
  if (!Cls) {
    throw new Error(
      `[createMarker] 未知的 Marker 类型 "${type}"。\n` +
      `已注册类型：${Object.keys(MARKER_REGISTRY).join(', ')}`
    )
  }
  return new Cls(rosMsgType, options)
}

/**
 * MarkerManager — 场景内所有 Marker 的生命周期管理器
 *
 * 每个 Marker 有唯一的 key（如 'robot_axes'、'goal_axes'）
 * 支持按 key 更新数据、切换显示、动态替换类型
 */
export class MarkerManager {
  /**
   * @param {THREE.Scene} scene Three.js 场景对象
   */
  constructor(scene) {
    this.scene   = scene
    /** @type {Map<string, import('./BaseMarker').BaseMarker>} */
    this._markers = new Map()
  }

  /**
   * 注册或替换一个 Marker
   * 若同 key 已存在则先 dispose 再重建
   *
   * @param {string} key        唯一标识，如 'robot_pose'
   * @param {string} type       Marker 类型，如 'axes'
   * @param {string} rosMsgType ROS 消息类型
   * @param {object} options    可选参数
   * @returns {import('./BaseMarker').BaseMarker}
   */
  set(key, type, rosMsgType, options = {}) {
    this.remove(key)  // 先清理旧的
    const marker = createMarker(type, rosMsgType, options)
    marker.addToScene(this.scene)
    this._markers.set(key, marker)
    return marker
  }

  /**
   * 传入 ROS 消息数据，驱动对应 Marker 渲染
   * @param {string} key
   * @param {object} data ROS 消息对象
   */
  update(key, data) {
    this._markers.get(key)?.update(data)
  }

  /**
   * 移除并释放单个 Marker
   * @param {string} key
   */
  remove(key) {
    const m = this._markers.get(key)
    if (!m) return
    m.removeFromScene(this.scene)
    m.dispose()
    this._markers.delete(key)
  }

  /**
   * 设置显示/隐藏
   * @param {string} key
   * @param {boolean} visible
   */
  setVisible(key, visible) {
    this._markers.get(key)?.setVisible(visible)
  }

  /** 获取 Marker 实例（用于直接调用特有方法，如 setScale）*/
  get(key) {
    return this._markers.get(key)
  }

  /** 销毁全部 Marker，释放 GPU 资源 */
  dispose(filterFn = null) {
    this._markers.forEach((m, key) => {
      if (!filterFn || filterFn(key, m)) this.remove(key)
    })
  }
}
