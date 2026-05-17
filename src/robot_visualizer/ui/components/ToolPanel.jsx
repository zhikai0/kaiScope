import { useState, useCallback, useRef, useEffect } from 'react'
import { getControlManager } from '../../manager/ControlManager'
import { getRosDataManager } from '../../data/getRosDataManager'
import './VirtualJoystick.css'
import './ToolPanel.css'

// ── ConfigPanel ──────────────────────────────────────────────────────────────
function ConfigPanel({ onClose, onConfirm }) {
  const ctrl = getControlManager()
  const [draft, setDraft] = useState(() => ctrl.getConfig())
  const update = (k, raw) => {
    const v = parseFloat(raw)
    if (isNaN(v) || v <= 0) return
    setDraft(p => ({ ...p, [k]: v }))
  }
  const handleConfirm = () => { ctrl.setConfig(draft); onConfirm?.(); onClose() }
  const rows = [
    { key: 'maxLinear',    label: '最大线速度', unit: 'm/s',    min: 0.1, step: 0.1 },
    { key: 'maxAngular',   label: '最大角速度', unit: 'rad/s',  min: 0.1, step: 0.1 },
    { key: 'linearAccel',  label: '线加速度',   unit: 'm/s²',   min: 0.1, step: 0.1 },
    { key: 'angularAccel', label: '角加速度',   unit: 'rad/s²', min: 0.1, step: 0.1 },
  ]
  return (
    <div className="tp-cfg-panel" onClick={e => e.stopPropagation()}>
      <div className="tp-cfg-hdr"><span>控制参数</span><button className="tp-cfg-close" onClick={onClose}>✕</button></div>
      <div className="tp-cfg-body">
        {rows.map(r => (
          <div key={r.key} className="tp-cfg-row">
            <span className="tp-cfg-lbl">{r.label}</span>
            <div className="tp-cfg-input-wrap">
              <input className="tp-cfg-input" type="number" min={r.min} step={r.step}
                value={draft[r.key]} onChange={e => update(r.key, e.target.value)}/>
              <span className="tp-cfg-unit">{r.unit}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="tp-cfg-footer">
        <button className="tp-cfg-btn tp-cfg-cancel" onClick={onClose}>取消</button>
        <button className="tp-cfg-btn tp-cfg-confirm" onClick={handleConfirm}>确认</button>
      </div>
    </div>
  )
}

// ── SingleJoystick (inline) ──────────────────────────────────────────────────
function SingleJoystick({ side, onMove, onRelease }) {
  const baseRef  = useRef(null)
  const knobRef  = useRef(null)
  const activeRef = useRef(false)
  const getCenter = () => {
    const r = baseRef.current.getBoundingClientRect()
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: r.width / 2 }
  }
  const moveKnob = useCallback((cx, cy) => {
    if (!baseRef.current) return
    const { cx: ccx, cy: ccy, radius } = getCenter()
    const deadzone = 3
    let dx = cx - ccx, dy = cy - ccy
    const dist = Math.sqrt(dx*dx + dy*dy)
    const maxR = radius * 0.60
    if (dist > maxR) { dx = dx/dist*maxR; dy = dy/dist*maxR }
    if (knobRef.current) knobRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
    const nx = Math.abs(dx) < deadzone ? 0 : dx / maxR
    const ny = Math.abs(dy) < deadzone ? 0 : dy / maxR
    onMove?.({ x: nx, y: -ny })
  }, [onMove])
  const doRelease = useCallback(() => {
    activeRef.current = false
    if (knobRef.current) knobRef.current.style.transform = 'translate(-50%, -50%)'
    onRelease?.()
  }, [onRelease])
  const onMouseDown = (e) => {
    e.preventDefault()
    if (activeRef.current) return
    activeRef.current = true
    moveKnob(e.clientX, e.clientY)
    const onMM = (ev) => { if (activeRef.current) moveKnob(ev.clientX, ev.clientY) }
    const onMU = () => { doRelease(); window.removeEventListener('mousemove', onMM); window.removeEventListener('mouseup', onMU) }
    const onML = () => { if (activeRef.current) doRelease(); window.removeEventListener('mousemove', onMM); window.removeEventListener('mouseup', onMU) }
    window.addEventListener('mousemove', onMM)
    window.addEventListener('mouseup', onMU)
    window.addEventListener('mouseleave', onML)
  }
  return (
    <div className={`vj-base vj-${side}`} ref={baseRef} onMouseDown={onMouseDown}>
      <div className="vj-ring"/><div className="vj-knob" ref={knobRef}/>
      <span className="vj-label">{side === 'left' ? '线速度' : '角速度'}</span>
    </div>
  )
}

// ── Placed capsule button (draggable + click-to-trigger) ───────────────────
function PlacedBtn({ item, onRemove, onDrag, onTrigger, isActive }) {
  const DRAG_THRESHOLD = 4
  const ICONS = { goalpose: '🏁', joystick: '🎮', button: '📤', navpath: '🛤️' }

  const onPointerDown = (e) => {
    if (e.target.tagName === 'BUTTON') return
    e.preventDefault()
    e.stopPropagation()
    const sx = e.clientX, sy = e.clientY
    const ox = item.position.x, oy = item.position.y
    let moved = false
    const onMove = (me) => {
      if (!moved && Math.sqrt((me.clientX-sx)**2+(me.clientY-sy)**2) > DRAG_THRESHOLD) moved = true
      if (moved) onDrag(item.id, ox + (me.clientX-sx), oy + (me.clientY-sy))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!moved) onTrigger?.(item)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      className={`tp-fixed-btn ${isActive ? 'tp-fixed-active' : ''}`}
      style={{ left: item.position.x, top: item.position.y }}
      onPointerDown={onPointerDown}
    >
      <span className="tp-fixed-icon">{ICONS[item.presetType] || ICONS.button}</span>
      <span className="tp-fixed-label">{item.label}</span>
      <button className="tp-fixed-del" onClick={e => { e.stopPropagation(); onRemove(item.id) }}>✕</button>
    </div>
  )
}

// ── Ghost preview (follows cursor) ──────────────────────────────────────────
function GhostPreview({ item, x, y }) {
  if (!item) return null
  const ICONS = { goalpose: '🏁', joystick: '🎮', button: '📤', navpath: '🛤️' }
  return (
    <div className="tp-ghost" style={{ left: x, top: y }}>
      <span className="tp-ghost-icon">{ICONS[item.presetType] || ICONS.button}</span>
      <span className="tp-ghost-label">{item.label}</span>
    </div>
  )
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function ToolPanel({ visible, onClose, editorMode, onEditorModeChange, goalposeMode, onGoalposeModeChange }) {
  const ctrl = getControlManager()
  const [tools,   setTools]   = useState([])      // 已添加的工具（含预设 + 自定义）
  const [placed,  setPlaced]  = useState([])      // 已放置到场景（初始空，由 useEffect 从 localStorage 加载）
  const [placing, setPlacing] = useState(null)    // 当前放置中的工具
  const [ghostPos, setGhostPos] = useState({ x: -9999, y: -9999 })
  const [joystickOn, setJoystickOn] = useState(false)
  const [showCtrlCfg, setShowCtrlCfg] = useState(false)
  // ref 避免 placement useEffect 依赖 placing 导致闭包过期问题
  const placingRef = useRef(null)

  // ── 挂载时从 localStorage 加载 placed（仅一次，避免 effect 覆盖空初始值）──
  const mountedRef = useRef(false)
  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true
    const data = loadPlaced()
    setPlaced(data)
  }, [])

  const PRESETS = [
    { id: 'preset-goalpose', presetType: 'goalpose', label: '2D GoalPose', topic: '/move_base_simple/goal', msgType: 'geometry_msgs/PoseStamped', type: 'button', icon: '🏁' },
    { id: 'preset-joystick',  presetType: 'joystick',  label: 'Control',     topic: '/cmd_vel',               msgType: 'geometry_msgs/Twist',     type: 'joystick', icon: '🎮' },
  ]

const PLACED_STORAGE_KEY = 'kaiscope-placed-tools'

function loadPlaced() {
  try {
    const raw = localStorage.getItem(PLACED_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) {
  }
  return []
}

function savePlaced(items) {
  try {
    localStorage.setItem(PLACED_STORAGE_KEY, JSON.stringify(items))
  } catch (e) {
    // silent
  }
}

// ── 同步放置状态到 window（Viewport3D 监听） ──────────────────────
useEffect(() => {
  placingRef.current = placing
  window.__tp_placingMode = !!placing
  window.dispatchEvent(new CustomEvent('toolpanel:placingchange'))
}, [placing])

// ── 同步 goalpose 模式到 window（Viewport3D 监听） ────────────────
  useEffect(() => {
    window.__tp_goalposeMode = !!goalposeMode
    window.dispatchEvent(new CustomEvent('toolpanel:goalposemodechange'))
  }, [goalposeMode])

  // ── 鼠标跟随 ghost ────────────────────────────────────────────────
  useEffect(() => {
    if (!placing) return
    const onMove = (e) => setGhostPos({ x: e.clientX, y: e.clientY })
    const onLeave = () => setGhostPos({ x: -9999, y: -9999 })
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseleave', onLeave)
    }
  }, [placing])

  // ── 点击场景 → 放置按钮（用 ref 读取 placing 避免闭包过期） ──────────
  useEffect(() => {
    const handler = (e) => {
      const item = placingRef.current
      if (!item) return
      const newItem = { ...item, position: { x: e.detail.screenX, y: e.detail.screenY } }
      setPlaced(prev => {
        const idx = prev.findIndex(c => c.id === item.id)
        const next = idx >= 0 ? prev.map((c, i) => i === idx ? newItem : c) : [...prev, newItem]
        savePlaced(next)
        return next
      })
      setPlacing(null)
      setGhostPos({ x: -9999, y: -9999 })
    }
    window.addEventListener('toolpanel:placementclick', handler)
    return () => window.removeEventListener('toolpanel:placementclick', handler)
  }, [])

  // ── placed 变更时持久化 ───────────────────────────────────────────
  useEffect(() => {
    if (!mountedRef.current) return
    savePlaced(placed)
  }, [placed])

  // ── 点击已放置的按钮 ───────────────────────────────────────────────
  const handleTrigger = useCallback((item) => {
    if (editorMode || goalposeMode) return
    if (item.presetType === 'goalpose') {
      // 激活 goalpose 拖拽模式（独立于 editorMode）
      onGoalposeModeChange?.(true)
    } else if (item.presetType === 'joystick') {
      setJoystickOn(v => !v)
    } else {
      const mgr = getRosDataManager()
      if (!mgr) return
      if (item.schema && item.msgType) {
        mgr.publishGenericCdr(item.topic, item.msgType, item.schema, item.config ?? {})
      } else {
        try { mgr.publishGeneric?.(item.topic, item.msgType, JSON.parse(item.config?.jsonPayload ?? '{}')) }
        catch { mgr.publishGeneric?.(item.topic, item.msgType, {}) }
      }
    }
  }, [editorMode, goalposeMode, onGoalposeModeChange])

  // ── 拖拽 ───────────────────────────────────────────────────────────
  const handleDrag = useCallback((id, x, y) => {
    setPlaced(prev => { const next = prev.map(c => c.id === id ? { ...c, position: { x, y } } : c); savePlaced(next); return next })
  }, [])

  const handleRemovePlaced = (id) => {
    setPlaced(prev => { const next = prev.filter(c => c.id !== id); savePlaced(next); return next })
  }

  const handleRemoveTool = (id) => {
    setTools(prev => prev.filter(t => t.id !== id))
  }

  // ── 点击预设/自定义卡片 → 进入放置模式 ─────────────────────────────
  const handlePlaceItem = useCallback((item) => {
    setPlacing({ ...item })
  }, [])

  // ── 选中/取消 joystick → advertise / unadvertise /cmd_vel ──────────
  useEffect(() => {
    const mgr = getRosDataManager()
    if (joystickOn) {
      mgr?.publishCmdVel?.()
    } else {
      mgr?.releaseCmdVelPublisher?.()
    }
    return () => { mgr?.releaseCmdVelPublisher?.() }
  }, [joystickOn])

  // ── joystick 激活时自动弹出配置面板 ──────────────────────────────────
  useEffect(() => {
    if (joystickOn) setShowCtrlCfg(true)
  }, [joystickOn])

  const setLeftY   = useCallback((y) => ctrl.setLeftY(y),   [ctrl])
  const releaseL  = useCallback(()    => ctrl.releaseLeft(),  [ctrl])
  const setRightX  = useCallback((x) => ctrl.setRightX(x),  [ctrl])
  const releaseR  = useCallback(()    => ctrl.releaseRight(), [ctrl])

  const goalPoseActive = !!goalposeMode

  // ── PlacedBtn 始终渲染（面板关闭后仍在场景可见）─────────────────────
  const placedBtns = placed.map(item => (
    <PlacedBtn
      key={item.id}
      item={item}
      isActive={
        (item.presetType === 'goalpose' && goalPoseActive) ||
        (item.presetType === 'joystick' && joystickOn)
      }
      onRemove={handleRemovePlaced}
      onDrag={handleDrag}
      onTrigger={handleTrigger}
    />
  ))

  // ── 摇杆覆盖层（面板关闭后也渲染，handleTrigger 始终最新）──────────
  // 编辑模式下禁用摇杆
  useEffect(() => {
    if (editorMode && joystickOn) setJoystickOn(false)
  }, [editorMode])

  const joystickOverlay = joystickOn && !editorMode ? (
    <>
      <div className="tp-vj-overlay">
        <SingleJoystick side="left"
          onMove={({ y }) => setLeftY(y)}
          onRelease={releaseL}
        />
        <SingleJoystick side="right"
          onMove={({ x }) => setRightX(x)}
          onRelease={releaseR}
        />
      </div>
      {showCtrlCfg && (
        <div className="tp-cfg-backdrop" onClick={() => setShowCtrlCfg(false)}>
          <ConfigPanel onClose={() => setShowCtrlCfg(false)} onConfirm={() => setShowCtrlCfg(false)}/>
        </div>
      )}
    </>
  ) : null

  // ── 面板关闭时：渲染场景按钮 + 摇杆层 ─────────────────────────────
  if (!visible) {
    return (
      <>
        {placedBtns}
        {joystickOverlay}
      </>
    )
  }

  return (
    <>
      {/* Ghost preview */}
      <GhostPreview item={placing} x={ghostPos.x} y={ghostPos.y}/>

      {/* 已放置胶囊按钮 */}
      {placedBtns}

      {/* 摇杆覆盖层 */}
      {joystickOverlay}

      {/* 工具面板侧边栏 */}
      <div className="tp-sidebar">
        <div className="tp-header">
          <span className="tp-title">Tool</span>
          <button className="tp-close" onClick={onClose}>✕</button>
        </div>

        {/* 预设工具 */}
        <div className="tp-section">
          <div className="tp-section-label">预设工具</div>
          {PRESETS.map(p => {
            const placed_item = !!placed.find(c => c.id === p.id)
            const isPlacing = placing?.id === p.id
            return (
              <div
                key={p.id}
                className={`tp-preset-card ${isPlacing ? 'placing' : ''} ${placed_item ? 'placed' : ''}`}
                onClick={() => handlePlaceItem(p)}
                title={placed_item ? '重新放置' : '添加并放置'}
              >
                <div className="tp-preset-row">
                  <span className="tp-preset-icon">{p.icon}</span>
                  <div className="tp-preset-info">
                    <span className="tp-preset-name">{p.label}</span>
                    <span className="tp-preset-topic">{p.topic}</span>
                  </div>
                  <span className={`tp-preset-badge ${isPlacing ? 'placing' : ''} ${placed_item ? 'placed' : ''}`}>
                    {isPlacing ? '✕' : placed_item ? '✓' : '📍'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* 自定义发布 */}
        <div className="tp-section">
          <div className="tp-section-label">自定义发布</div>
          {tools.filter(t => t.presetType == null).map(item => (
            <div key={item.id} className="tp-custom-item">
              <div className="tp-custom-row">
                <span className="tp-custom-icon">{item.type === 'joystick' ? '🎮' : '📤'}</span>
                <div className="tp-custom-info">
                  <span className="tp-custom-label">{item.label}</span>
                  <span className="tp-custom-topic">{item.topic}</span>
                </div>
                <button className="tp-custom-place" onClick={() => handlePlaceItem(item)} title="放置到场景">📍</button>
                <button className="tp-custom-del" onClick={() => handleRemoveTool(item.id)}>✕</button>
              </div>
              {item.schema && (
                <div className="tp-custom-cfg">
                  <div className="tp-custom-cfg-label">消息内容 (JSON)</div>
                  <textarea
                    className="tp-custom-cfg-input"
                    rows={3}
                    value={(() => {
                      try { return JSON.stringify(item.config, null, 2) } catch { return '{}' }
                    })()}
                    onChange={e => {
                      try {
                        setTools(prev => prev.map(t => t.id === item.id
                          ? { ...t, config: JSON.parse(e.target.value) }
                          : t))
                      } catch {}
                    }}
                  />
                </div>
              )}
            </div>
          ))}
          <AddCustomForm onAdd={(item) => { setTools(prev => [...prev, item]) }}/>
        </div>
      </div>
    </>
  )
}

// ── Add custom form ──────────────────────────────────────────────────────────
function AddCustomForm({ onAdd }) {
  const [topic, setTopic]       = useState('')
  const [msgType, setMsgType]   = useState('geometry_msgs/PoseStamped')
  const [schema, setSchema]     = useState('')
  const [ctrlType, setCtrlType] = useState('button')
  const [label, setLabel]       = useState('')

  const handleAdd = () => {
    if (!topic.trim()) return
    onAdd({
      id: `custom-${Date.now()}`,
      presetType: null,
      topic: topic.trim(),
      msgType,
      type: ctrlType,
      label: label.trim() || topic.split('/').pop(),
      schema: schema.trim() || null,
      config: { jsonPayload: '{}' },
    })
    setTopic(''); setLabel(''); setSchema('')
  }

  return (
    <div className="tp-add-form">
      <input className="tp-input" placeholder="Topic, 如 /cmd_vel" value={topic} onChange={e => setTopic(e.target.value)}/>
      <select className="tp-select" value={msgType} onChange={e => setMsgType(e.target.value)}>
        {['geometry_msgs/PoseStamped', 'geometry_msgs/Twist', 'nav_msgs/Path', 'std_msgs/String', 'std_msgs/Float64', 'sensor_msgs/Joy'].map(t =>
          <option key={t} value={t}>{t.split('/').pop()}</option>)}
      </select>
      <div className="tp-ctrl-type-row">
        <label><input type="radio" name="ctrlType2" value="button" checked={ctrlType === 'button'} onChange={() => setCtrlType('button')}/> 按钮</label>
        <label><input type="radio" name="ctrlType2" value="joystick" checked={ctrlType === 'joystick'} onChange={() => setCtrlType('joystick')}/> 摇杆</label>
      </div>
      <input className="tp-input" placeholder="显示名称（可选）" value={label} onChange={e => setLabel(e.target.value)}/>
      <div className="tp-schema-label">
        <span>ROS2 Schema</span>
        <a className="tp-schema-hint" href="https://docs.ros.org/en/rolling/Concepts/About-ROS-Interfaces.html" target="_blank" rel="noopener">格式参考</a>
      </div>
      <textarea
        className="tp-schema-input"
        placeholder={"# ros2 interface show geometry_msgs/msg/Twist\nVector3  linear\nVector3  angular\nMSG: geometry_msgs/Vector3\nfloat64 x\nfloat64 y\nfloat64 z"}
        value={schema}
        onChange={e => setSchema(e.target.value)}
        rows={6}
      />
      <button className="tp-add-btn" onClick={handleAdd} disabled={!topic.trim()}>+ 添加</button>
    </div>
  )
}
