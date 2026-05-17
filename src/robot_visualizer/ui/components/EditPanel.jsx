/**
 * EditPanel — 编辑模式面板（左侧）
 *
 * 插件化架构：每个编辑工具实现 editTool 接口，注册到 EDIT_TOOLS 数组
 * 接口：
 *   id, label, icon, description
 *   defaultState, renderPanel, onSceneClick, onSceneMove
 */
import { useState, useEffect, useRef } from 'react'
import { getRosDataManager } from '../../data/getRosDataManager'
import { SceneCommandBus } from '../../manager/SceneCommandBus'
import './EditPanel.css'

// ── 曲线生成算法 ─────────────────────────────────────────────────────────────

/** 直线：按指定间距等分插值 ─────────────────────────────────────────────
 *  spacing: 插值点间距(m)，默认 1m，最少 3 个点 */
function generateLine(p1, p2, spacing = 1.0) {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d < 0.001) return [{ x: p1.x, y: p1.y, z: p1.z ?? 0, yaw: Math.atan2(dy, dx) }]

  // 按间距等分，最少 3 个点
  const numPts = Math.max(3, Math.ceil(d / spacing))
  const pts = []
  const baseYaw = Math.atan2(dy, dx)

  for (let i = 0; i <= numPts; i++) {
    const t = i / numPts
    pts.push({
      x: p1.x + dx * t,
      y: p1.y + dy * t,
      z: p1.z ?? 0,
      yaw: baseYaw,
    })
  }
  return pts
}

/** 圆弧：从 p1 到 p2，curvature 控制圆弧弯曲程度
 *  curvature ∈ [-1, 1]，|curvature| 越大圆弧越弯曲
 *    |curvature| = 1   → 最大弯曲（半圆）
 *    |curvature| = 0.5 → 中等弯曲
 *    curvature = 0    → 直线
 *  正值 = 左侧，负值 = 右侧
 *  p1 和 p2 严格作为起点和终点
 *  spacing: 插值点间距(m)，默认 1m，最少 3 个点
 */
function generateArc(p1, p2, curvature, spacing = 1.0) {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d < 0.001) return [{ x: p1.x, y: p1.y, z: p1.z ?? 0, yaw: 0 }]

  // 曲率为0 → 直线
  if (Math.abs(curvature) < 1e-6) return generateLine(p1, p2, spacing)

  const sign = Math.sign(curvature)  // +1 = 左侧，-1 = 右侧
  const kappa = Math.abs(curvature)

  // 弦的中点和角度
  const midX = (p1.x + p2.x) / 2
  const midY = (p1.y + p2.y) / 2
  const chordAngle = Math.atan2(dy, dx)

  // sagitta 控制弯曲程度
  const sagitta = kappa * d

  // 半径由几何关系决定：r² = (d/2)² + sagitta²
  const r = Math.sqrt((d / 2) * (d / 2) + sagitta * sagitta)

  // 圆心在垂直平分线上
  // sign=+1：左侧，sign=-1：右侧
  const perpAngle = chordAngle + sign * Math.PI / 2
  const cx = midX + sagitta * Math.cos(perpAngle)
  const cy = midY + sagitta * Math.sin(perpAngle)

  // p1 和 p2 到圆心的角度
  const startAngle = Math.atan2(p1.y - cy, p1.x - cx)
  const endAngle   = Math.atan2(p2.y - cy, p2.x - cx)

  // 计算圆心角（弧长）
  let deltaAngle = endAngle - startAngle
  // 规范化到 [-π, π]
  while (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI
  while (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI

  // 确保走正确的方向
  if (sign > 0 && deltaAngle < 0) deltaAngle += 2 * Math.PI
  if (sign < 0 && deltaAngle > 0) deltaAngle -= 2 * Math.PI

  const arcLength = r * Math.abs(deltaAngle)

  // 插值点按 spacing 间距等分，最少 3 个点
  const numPts = Math.max(3, Math.ceil(arcLength / spacing))

  const pts = []
  for (let i = 0; i <= numPts; i++) {
    const t = i / numPts
    const a = startAngle + deltaAngle * t
    const localYaw = a + sign * Math.PI / 2
    pts.push({
      x: cx + r * Math.cos(a),
      y: cy + r * Math.sin(a),
      z: p1.z ?? 0,
      yaw: localYaw,
    })
  }

  // 强制首尾点严格等于 p1/p2
  pts[0] = { x: p1.x, y: p1.y, z: p1.z ?? 0, yaw: pts[0].yaw }
  pts[pts.length - 1] = { x: p2.x, y: p2.y, z: p2.z ?? 0, yaw: pts[pts.length - 1].yaw }

  return pts
}

// ── 路径工具面板 ─────────────────────────────────────────────────────────────

const PATH_SCHEMA = `std_msgs/Header header
geometry_msgs/PoseStamped[] poses
================================================================================
MSG: std_msgs/Header
builtin_interfaces/Time stamp
string frame_id
================================================================================
MSG: builtin_interfaces/Time
int32 sec
uint32 nanosec
================================================================================
MSG: geometry_msgs/PoseStamped
std_msgs/Header header
geometry_msgs/Pose pose
================================================================================
MSG: geometry_msgs/Pose
geometry_msgs/Point position
geometry_msgs/Quaternion orientation
================================================================================
MSG: geometry_msgs/Point
float64 x
float64 y
float64 z
================================================================================
MSG: geometry_msgs/Quaternion
float64 x
float64 y
float64 z
float64 w
`

// ── PathTool hooks（必须在 EditPanel 顶层调用，不能放在工具函数里）──
function usePathTool(state, setState) {
  const mgrRef = useRef(null)
  const intervalRef = useRef(null)
  const stateRef = useRef(state)

  // 保持 stateRef 最新
  useEffect(() => {
    stateRef.current = state
  })

  // 外部可调用：开始/停止发布
  const startPublish = () => {
    if (intervalRef.current) return // 已在发布
    const mgr = getRosDataManager()
    if (!mgr) return
    mgrRef.current = mgr
    intervalRef.current = setInterval(() => {
      const cur = stateRef.current
      if (!cur.points.length) return
      const nowMs = Date.now()
      const sec = Math.floor(nowMs / 1000)
      const nanosec = Math.floor((nowMs % 1000) * 1e6)
      const poses = cur.points.map(p => {
        const half = (p.yaw || 0) * 0.5
        return {
          header: { stamp: { sec, nanosec }, frame_id: cur.frameId },
          pose: {
            position: { x: p.x, y: p.y, z: p.z || 0 },
            orientation: { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) },
          },
        }
      })
      mgrRef.current.publishGenericCdr(cur.topic, 'nav_msgs/msg/Path', PATH_SCHEMA, {
        header: { stamp: { sec, nanosec }, frame_id: cur.frameId },
        poses,
      })
    }, 1000)
    setState(prev => ({ ...prev, publishing: true }))
  }

  const stopPublish = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (mgrRef.current) {
      mgrRef.current.releaseGenericPublisher(stateRef.current.topic)
      mgrRef.current = null
    }
    setState(prev => ({ ...prev, publishing: false }))
  }

  const {
    points = [],
    curveType = 'arc',
    p1 = null,
    p2 = null,
    curvature = 0,
    spacing = 1.0,
  } = state

  // ── 实时预览：p1/p2/curveType/curvature/spacing 任意变化 → 立即生成曲线 + 渲染端点 ─
  // 如果已有路径，则自动将 p1 设为路径终点
  const actualP1 = points.length > 0 ? points[points.length - 1] : p1

  useEffect(() => {
    const livePts = generatePoints(actualP1)
    SceneCommandBus.dispatch({
      type: 'scene:editpath:update',
      points,
      previewPts: livePts,
      p1: actualP1,
      p2,
    })
  }, [points, actualP1, p2, curveType, curvature, spacing])

  // ── 场景双击 → 已有路径时直接设 p2，无路径时先设 p1 再设 p2 ─────────────
  useEffect(() => {
    const handler = (e) => {
      const { rosX, rosY, rosZ } = e.detail
      if (rosX == null && rosY == null) return
      const pt = { x: rosX, y: rosY, z: rosZ || 0, yaw: 0 }
      setState(prev => {
        if (prev.points.length > 0) {
          // 已有路径：直接设 p2
          return { ...prev, p2: { x: pt.x, y: pt.y } }
        } else if (!prev._clickedOnce) {
          // 无路径：第一次点击设 p1（如果已有 p1/p2 则重置重新开始）
          return { ...prev, p1: { x: pt.x, y: pt.y }, p2: null, _clickedOnce: true }
        } else {
          // 无路径：第二次点击设 p2
          return { ...prev, p2: { x: pt.x, y: pt.y }, _clickedOnce: false }
        }
      })
    }
    window.addEventListener('toolpanel:editdblclick', handler)
    return () => window.removeEventListener('toolpanel:editdblclick', handler)
  }, [])

  const generatePoints = (startPt) => {
    if (!startPt || !p2) return []  // 只有起点和终点都设置后才生成预览
    if (curveType === 'line') {
      return generateLine({ ...startPt, z: 0 }, { ...p2, z: 0 }, spacing)
    } else {
      return generateArc({ ...startPt, z: 0 }, { ...p2, z: 0 }, curvature, spacing)
    }
  }

  return { generatePoints, startPublish, stopPublish }
}

function generatePointsStatic(curveType, p1, p2, curvature, spacing) {
  if (curveType === 'line') {
    return generateLine({ ...p1, z: 0 }, { ...p2, z: 0 }, spacing)
  } else {
    return generateArc({ ...p1, z: 0 }, { ...p2, z: 0 }, curvature, spacing)
  }
}

// ── PathTool UI（纯展示组件，无状态，无 hooks）─────────────────────────────────
function PathToolUI({ state, setState, startPublish, stopPublish }) {
  const {
    points = [],
    topic = '/edited_path',
    frameId = 'map',
    curveType = 'arc',
    p1 = { x: 0, y: 0 },
    p2 = { x: 5, y: 0 },
    curvature = 0,
    spacing = 1.0,
    publishing = false,
  } = state

  // 实际起点：有路径点队列就用最后一个点，没有就用 p1
  const actualP1 = points.length > 0 ? points[points.length - 1] : p1

  const set = updater => setState(updater)

  const applyCurve = () => setState(prev => {
    const startPt = prev.points.length > 0 ? prev.points[prev.points.length - 1] : prev.p1
    if (!startPt || !prev.p2) return prev
    const newPts = generatePointsStatic(prev.curveType, startPt, prev.p2, prev.curvature, prev.spacing ?? 1.0)
    return { ...prev, points: [...(prev.points || []), ...newPts] }
  })

  const removePoint = idx => set(prev => ({ ...prev, points: prev.points.filter((_, i) => i !== idx) }))

  const clearPoints = () => {
    if (publishing) stopPublish()
    setState(prev => ({ ...prev, points: [], p1: null, p2: null, _clickedOnce: false }))
  }

  const togglePublish = () => {
    if (publishing) {
      stopPublish()
    } else {
      startPublish()
    }
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ topic, frameId, points }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `path_${Date.now()}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        setState(prev => ({
          ...prev,
          topic: data.topic ?? prev.topic,
          frameId: data.frameId ?? prev.frameId,
          points: data.points ?? [],
        }))
      } catch {}
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="ep-tool-content">
      {/* Topic / Frame */}
      <div className="ep-field-row">
        <span className="ep-label">Topic</span>
        <input className="ep-input" value={topic} onChange={e => set(s => ({ ...s, topic: e.target.value }))}/>
      </div>
      <div className="ep-field-row">
        <span className="ep-label">Frame</span>
        <input className="ep-input" value={frameId} onChange={e => set(s => ({ ...s, frameId: e.target.value }))}/>
      </div>

      {/* 曲线类型 */}
      <div className="ep-curve-type-row">
        {['line', 'arc'].map(t => (
          <button
            key={t}
            className={`ep-curve-btn ${curveType === t ? 'active' : ''}`}
            onClick={() => set(s => ({ ...s, curveType: t }))}
          >
            {t === 'line' ? '直线' : '圆弧'}
          </button>
        ))}
      </div>

      {/* P1 / P2 坐标 */}
      <div className="ep-two-pt-row">
        <div className="ep-pt-group">
          <div className="ep-pt-label">{points.length > 0 ? '连接点' : '起点 P1'}</div>
          <div className="ep-pt-fields">
            <label>X<input type="number" value={actualP1?.x ?? ''} step={0.5} readOnly/></label>
            <label>Y<input type="number" value={actualP1?.y ?? ''} step={0.5} readOnly/></label>
          </div>
        </div>
        <div className="ep-pt-group">
          <div className="ep-pt-label">终点 P2</div>
          <div className="ep-pt-fields">
            <label>X<input type="number" value={p2?.x ?? ''} step={0.5}
              onChange={e => set(s => ({ ...s, p2: { ...s.p2, x: +e.target.value } }))}/></label>
            <label>Y<input type="number" value={p2?.y ?? ''} step={0.5}
              onChange={e => set(s => ({ ...s, p2: { ...s.p2, y: +e.target.value } }))}/></label>
          </div>
        </div>
      </div>

      {/* 曲率 */}
      <div className="ep-field-row">
        <span className="ep-label">曲率 κ</span>
        <input type="range" className="ep-range"
          min={-1} max={1} step={0.05}
          value={curvature}
          onChange={e => set(s => ({ ...s, curvature: +e.target.value }))}/>
        <span className="ep-range-val">{curvature.toFixed(2)}</span>
      </div>

      {/* 插值间距 */}
      <div className="ep-field-row">
        <span className="ep-label">间距 m</span>
        <input type="range" className="ep-range"
          min={0.2} max={3} step={0.1}
          value={spacing}
          onChange={e => set(s => ({ ...s, spacing: +e.target.value }))}/>
        <span className="ep-range-val">{spacing.toFixed(1)}</span>
      </div>

      <div className="ep-field-row ep-add-row">
        <button
          className="ep-btn ep-btn-secondary"
          disabled={!actualP1 || !p2}
          onClick={applyCurve}
        >
          + 添加到路径点
        </button>
      </div>

      <div className="ep-divider"/>
      <div className="ep-hint ep-hint-small">{points.length > 0 ? '双击设置终点，然后点击添加' : '双击1次设起点，双击2次设终点'}</div>

      <div className="ep-divider"/>

      {/* 已有点列表 */}
      <div className="ep-points-header">
        <span>路径点 <span className="ep-badge">{points.length}</span></span>
        <button className="ep-btn-ghost ep-btn-sm" onClick={clearPoints} disabled={!points.length}>清除</button>
      </div>
      <div className="ep-points-list">
        {points.length === 0 && <div className="ep-empty-hint">双击场景放置起点和终点，用曲线工具生成追加路径</div>}
        {points.map((p, i) => (
          <div key={i} className="ep-point-item">
            <span className="ep-point-idx">{i + 1}</span>
            <span className="ep-point-coord">({p.x.toFixed(2)}, {p.y.toFixed(2)})</span>
            <span className="ep-point-yaw">θ={((p.yaw || 0) * 180 / Math.PI).toFixed(0)}°</span>
            <button className="ep-point-del" onClick={() => removePoint(i)}>✕</button>
          </div>
        ))}
      </div>

      {/* 发布 / 导入导出 */}
      <div className="ep-actions">
        <button
          className={`ep-btn ${publishing ? 'ep-btn-danger' : 'ep-btn-primary'}`}
          onClick={togglePublish}
          disabled={!points.length}
        >
          {publishing ? '停止发布' : '开始发布'}
        </button>
      </div>
      <div className="ep-import-export">
        <label className="ep-btn ep-btn-ghost ep-btn-sm ep-file-label">
          导入 JSON
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport}/>
        </label>
        <button className="ep-btn ep-btn-ghost ep-btn-sm" onClick={handleExport} disabled={!points.length}>导出 JSON</button>
      </div>
    </div>
  )
}

// ── Edit tools registry ──────────────────────────────────────────────────────
const EDIT_TOOLS = [
  {
    id: 'path',
    label: '路径',
    icon: '🛤️',
    description: '生成和编辑导航路径',
    defaultState: { points: [], topic: '/edited_path', frameId: 'map', curveType: 'line', p1: null, p2: null, curvature: 0, spacing: 1.0, _clickedOnce: false },
    renderPanel: PathToolUI,
    // onSceneClick 由 PathTool 内部 useEffect 注册
  },
]

export { EDIT_TOOLS }

// ── Main EditPanel component ──────────────────────────────────────────────────
const STORAGE_KEY = 'kaiScope_editPath'

function loadPersistedState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return null
}

function savePersistedState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

export default function EditPanel({ editorMode, onClose }) {
  const [activeTool, setActiveTool] = useState('path')
  const persisted = loadPersistedState()

  const [toolStates, setToolStates] = useState(() => {
    const defaults = Object.fromEntries(EDIT_TOOLS.map(t => [t.id, { ...t.defaultState }]))
    if (persisted) {
      // 恢复持久化状态
      return { ...defaults, ...persisted }
    }
    return defaults
  })

  // setState 可在 useState 后立即定义，不依赖条件渲染
  const setState = (updater) => {
    if (typeof updater === 'function') {
      setToolStates(prev => {
        const next = { ...prev, [activeTool]: updater(prev[activeTool]) }
        savePersistedState(next)
        return next
      })
    } else {
      setToolStates(prev => {
        const next = { ...prev, [activeTool]: updater }
        savePersistedState(next)
        return next
      })
    }
  }

  // usePathTool 必须在所有 useState/useEffect 之后、if(!editorMode) 之前无条件调用，
  // 否则 editorMode 切换时 Hook 顺序会变，触发 React 崩溃
  const tool = EDIT_TOOLS.find(t => t.id === activeTool)
  const state = tool ? toolStates[activeTool] : null
  const { startPublish, stopPublish } = usePathTool(state, setState)

  // ── 同步编辑模式状态到 window ─────────────────────────────────
  useEffect(() => {
    window.__ep_editMode = editorMode
    window.dispatchEvent(new CustomEvent('toolpanel:editmodechange'))
    if (!editorMode) {
      SceneCommandBus.dispatch({ type: 'scene:editpath:update', points: [], previewPts: [] })
    }
  }, [editorMode])

  if (!editorMode) return null

  return (
    <div className="ep-panel">
      <div className="ep-header">
        <span className="ep-title">路径编辑器</span>
        <button className="ep-close" onClick={onClose}>✕</button>
      </div>

      <div className="ep-tool-tabs">
        {EDIT_TOOLS.map(t => (
          <button
            key={t.id}
            className={`ep-tool-tab ${activeTool === t.id ? 'active' : ''}`}
            onClick={() => setActiveTool(t.id)}
            title={t.description}
          >
            <span className="ep-tool-tab-icon">{t.icon}</span>
            <span className="ep-tool-tab-label">{t.label}</span>
          </button>
        ))}
      </div>

      {tool && (
        <div className="ep-tool-body">
          {tool.renderPanel({ state, setState, startPublish, stopPublish })}
        </div>
      )}

      <div className="ep-footer-hint">双击场景添加点 · Esc 退出编辑</div>
    </div>
  )
}
