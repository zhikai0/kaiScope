/**
 * SceneCommandBus — 场景命令总线
 *
 * 架构:
 *   UI (LeftPanel params)  ──updateParam──▶  DisplayManager
 *                                                  ↓
 *                                         SceneCommandBus.dispatch(cmd)
 *                                         /                      \
 *                              Viewport3D/THREE.js         RosDataManager
 *                              (scene commands)            (topic subscribe)
 *
 * 命令类型 (cmd.type):
 *   scene:background   - 修改 3D 场景背景色
 *   scene:grid:color   - 修改网格颜色
 *   scene:grid:size    - 修改网格 cell size
 *   scene:grid:alpha   - 修改网格透明度
 *   scene:grid:visible - 显示/隐藏网格
 *   topic:subscribe    - 订阅 ROS topic
 *   topic:unsubscribe  - 取消订阅
 *
 * 使用:
 *   // 注册渲染层处理器 (在 Viewport3D useEffect 里)
 *   SceneCommandBus.register('scene:background', ({color}) => { scene.background.set(color) })
 *
 *   // 发送命令 (由 DisplayManager 调用)
 *   SceneCommandBus.dispatch({ type:'scene:grid:color', color:'#888899' })
 */

class _SceneCommandBus extends EventTarget {
  constructor() {
    super()
    // type -> Set<fn>
    this._handlers = new Map()
  }

  /**
   * Register a handler for a command type.
   * Returns unregister function.
   * @param {string} type
   * @param {function} fn  fn(cmd)
   */
  register(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set())
    this._handlers.get(type).add(fn)
    return () => this._handlers.get(type)?.delete(fn)
  }

  /**
   * Dispatch a command to all registered handlers.
   * @param {{ type: string, [key: string]: any }} cmd
   */
  dispatch(cmd) {
    if (!cmd?.type) return
    const fns = this._handlers.get(cmd.type)
    if (fns) {
      fns.forEach(fn => {
        try { fn(cmd) }
        catch (e) { console.error(`[SceneCommandBus] handler error for ${cmd.type}:`, e) }
      })
    }
    // Also emit as event for any listeners
    this.dispatchEvent(new CustomEvent(cmd.type, { detail: cmd }))
  }

  on(type, fn)  { this.addEventListener(type, fn) }
  off(type, fn) { this.removeEventListener(type, fn) }
}

export const SceneCommandBus = new _SceneCommandBus()

// ── Param -> Command routing table ───────────────────────────────────────
// Maps { displayTypeId, paramKey } -> fn(value) -> cmd
export const PARAM_ROUTES = {
  // Global Options
  'global:background': (v) => ({ type: 'scene:background', color: v }),
  'global:fixedFrame': (v) => ({ type: 'scene:fixedFrame', frame: v }),
  'global:fps':        (v) => ({ type: 'scene:fps', fps: v }),

  // Grid display params
  'grid:cellCount': (v) => ({ type: 'scene:grid:count',   count: parseInt(v) }),
  'grid:cellSize':  (v) => ({ type: 'scene:grid:size',    size: parseFloat(v) }),
  'grid:alpha':     (v) => ({ type: 'scene:grid:alpha',   alpha: parseFloat(v) }),
  'grid:color':     (v) => ({ type: 'scene:grid:color',   color: v }),
  'grid:visible':   (v) => ({ type: 'scene:grid:visible', visible: !!v }),

  // Map display params (handled by mapStore, not scene)
  'map:layer':     (v) => ({ type: 'map:layer',   layer: v }),
  'map:alpha':     (v) => ({ type: 'map:alpha',   alpha: parseFloat(v) }),
  'map:zoom':      (v) => ({ type: 'map:zoom',    zoom: parseInt(v) }),
  'map:longitude': (v) => ({ type: 'map:flyTo',   axis: 'lng', value: parseFloat(v) }),
  'map:latitude':  (v) => ({ type: 'map:flyTo',   axis: 'lat', value: parseFloat(v) }),

  // Topic-based displays — trigger subscribe
  'path:topic':       (v) => ({ type: 'topic:change', topic: v }),
  'path:color':       (v) => ({ type: 'scene:path:color',     color: v }),
  'path:alpha':       (v) => ({ type: 'scene:path:alpha',     alpha: parseFloat(v) }),
  'path:lineStyle':   (v) => ({ type: 'scene:path:lineStyle', style: v }),
  'robotmodel:topic': (v) => ({ type: 'topic:change', topic: v }),
  'laserscan:topic':  (v) => ({ type: 'topic:change', topic: v }),
  'pointcloud:topic': (v) => ({ type: 'topic:change', topic: v }),
  'image:topic':      (v) => ({ type: 'topic:change', topic: v }),
}

/**
 * Route a param change to the appropriate command.
 * @param {string} displayTypeId  e.g. 'grid'
 * @param {string} paramKey       e.g. 'cellSize'
 * @param {*}      value
 */
export function routeParam(displayTypeId, paramKey, value) {
  const key = `${displayTypeId}:${paramKey}`
  const routeFn = PARAM_ROUTES[key]
  if (routeFn) {
    const cmd = routeFn(value)
    if (cmd) SceneCommandBus.dispatch(cmd)
  }
}
