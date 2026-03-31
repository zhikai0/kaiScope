import { useRef, useEffect, useCallback, useState } from 'react'
import { getControlManager } from '../../manager/ControlManager'
import './VirtualJoystick.css'

// ── SingleJoystick ───────────────────────────────────────────────────────
function SingleJoystick({ side, onMove, onRelease }) {
  const baseRef  = useRef(null)
  const knobRef  = useRef(null)
  const activeRef = useRef(false)
  const touchIdRef = useRef(null)

  const getCenter = () => {
    const r = baseRef.current.getBoundingClientRect()
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: r.width / 2 }
  }

  const moveKnob = useCallback((clientX, clientY) => {
    if (!baseRef.current) return
    const { cx, cy, radius } = getCenter()
    const deadzone = 3
    let dx = clientX - cx
    let dy = clientY - cy
    const dist = Math.sqrt(dx*dx + dy*dy)
    const maxR  = radius * 0.60
    if (dist > maxR) { dx = dx/dist*maxR; dy = dy/dist*maxR }
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
    }
    const nx = Math.abs(dx) < deadzone ? 0 : dx / maxR
    const ny = Math.abs(dy) < deadzone ? 0 : dy / maxR
    console.log(`[Joystick:${side}] move dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} nx=${nx.toFixed(2)} ny=${ny.toFixed(2)}`)
    onMove?.({ x: nx, y: -ny })  // y 取反：上推正值
  }, [onMove, side])

  const doRelease = useCallback(() => {
    activeRef.current  = false
    touchIdRef.current = null
    if (knobRef.current) knobRef.current.style.transform = 'translate(-50%, -50%)'
    onRelease?.()
  }, [onRelease])

  useEffect(() => {
    const base = baseRef.current
    if (!base) return

    const onTouchStart = (e) => {
      e.preventDefault()
      if (activeRef.current) return  // 已有触点
      const t = e.changedTouches[0]
      activeRef.current  = true
      touchIdRef.current = t.identifier
      moveKnob(t.clientX, t.clientY)
    }
    const onTouchMove = (e) => {
      e.preventDefault()
      for (const t of e.changedTouches) {
        if (t.identifier === touchIdRef.current) { moveKnob(t.clientX, t.clientY); break }
      }
    }
    const onTouchEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === touchIdRef.current) { doRelease(); break }
      }
    }

    const onMouseDown = (e) => {
      e.preventDefault()
      if (activeRef.current) return
      activeRef.current = true
      moveKnob(e.clientX, e.clientY)
      const onMM = (ev) => { if (activeRef.current) moveKnob(ev.clientX, ev.clientY) }
      const onMU = () => {
        doRelease()
        window.removeEventListener('mousemove', onMM)
        window.removeEventListener('mouseup',   onMU)
        window.removeEventListener('mouseleave', onMU)
      }
      const onML = () => {
        if (activeRef.current) doRelease()
        window.removeEventListener('mousemove', onMM)
        window.removeEventListener('mouseup',   onMU)
        window.removeEventListener('mouseleave', onML)
      }
      window.addEventListener('mousemove', onMM)
      window.addEventListener('mouseup',   onMU)
      window.addEventListener('mouseleave', onML)
    }

    base.addEventListener('touchstart', onTouchStart, { passive: false })
    base.addEventListener('touchmove',  onTouchMove,  { passive: false })
    base.addEventListener('touchend',   onTouchEnd)
    base.addEventListener('mousedown',  onMouseDown)
    return () => {
      base.removeEventListener('touchstart', onTouchStart)
      base.removeEventListener('touchmove',  onTouchMove)
      base.removeEventListener('touchend',   onTouchEnd)
      base.removeEventListener('mousedown',  onMouseDown)
    }
  }, [moveKnob, doRelease])

  const LABELS = { left: { top:'前', bottom:'后', left:'左', right:'右' }, right: { top:'左转', bottom:'右转' } }
  const lb = LABELS[side]

  return (
    <div className={`vj-base vj-${side}`} ref={baseRef}>
      <div className="vj-ring"/>
      {lb.top    && <span className="vj-dir vj-dir-t">{lb.top}</span>}
      {lb.bottom && <span className="vj-dir vj-dir-b">{lb.bottom}</span>}
      {lb.left   && <span className="vj-dir vj-dir-l">{lb.left}</span>}
      {lb.right  && <span className="vj-dir vj-dir-r">{lb.right}</span>}
      <div className="vj-knob" ref={knobRef}/>
      <span className="vj-label">{side === 'left' ? '线速度' : '角速度'}</span>
    </div>
  )
}

// ── ConfigPanel ──────────────────────────────────────────────────────────
function ConfigPanel({ onClose }) {
  const ctrl = getControlManager()
  // draft: local copy, not applied until Confirm
  const [draft, setDraft] = useState(() => ctrl.getConfig())

  const update = (key, raw) => {
    const v = parseFloat(raw)
    if (isNaN(v) || v <= 0) return
    setDraft(prev => ({ ...prev, [key]: v }))
  }

  const handleConfirm = () => {
    ctrl.setConfig(draft)
    onClose()
  }

  const handleCancel = () => {
    onClose()
  }

  const rows = [
    { key: 'maxLinear',    label: '最大线速度',  unit: 'm/s',    min: 0.1, step: 0.1 },
    { key: 'maxAngular',   label: '最大角速度',  unit: 'rad/s',  min: 0.1, step: 0.1 },
    { key: 'linearAccel',  label: '线加速度',    unit: 'm/s²',   min: 0.1, step: 0.1 },
    { key: 'linearDecel',  label: '线减速度',    unit: 'm/s²',   min: 0.1, step: 0.1 },
    { key: 'angularAccel', label: '角加速度',    unit: 'rad/s²', min: 0.1, step: 0.1 },
    { key: 'angularDecel', label: '角减速度',    unit: 'rad/s²', min: 0.1, step: 0.1 },
  ]

  return (
    <div className="vj-config-panel" onClick={e => e.stopPropagation()}>
      <div className="vj-cfg-hdr">
        <span className="vj-cfg-title">控制参数</span>
        <button className="vj-cfg-close" onClick={handleCancel}>✕</button>
      </div>
      <div className="vj-cfg-body">
        {rows.map(r => (
          <div key={r.key} className="vj-cfg-row">
            <span className="vj-cfg-lbl">{r.label}</span>
            <div className="vj-cfg-input-wrap">
              <input
                className="vj-cfg-input"
                type="number"
                min={r.min} step={r.step}
                value={draft[r.key]}
                onChange={e => update(r.key, e.target.value)}
              />
              <span className="vj-cfg-unit">{r.unit}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="vj-cfg-footer">
        <button className="vj-cfg-btn vj-cfg-cancel" onClick={handleCancel}>取消</button>
        <button className="vj-cfg-btn vj-cfg-confirm" onClick={handleConfirm}>确认</button>
      </div>
    </div>
  )
}

// ── VirtualJoystick ──────────────────────────────────────────────────────
export default function VirtualJoystick({ visible, onConfigOpen, showConfig, onConfigClose }) {
  const ctrl = getControlManager()

  const handleLeftMove    = useCallback(({ y }) => ctrl.setLeftY(y),    [ctrl])
  const handleLeftRelease = useCallback(()       => ctrl.releaseLeft(),  [ctrl])
  const handleRightMove   = useCallback(({ x }) => ctrl.setRightX(x),   [ctrl])
  const handleRightRelease= useCallback(()       => ctrl.releaseRight(), [ctrl])

  useEffect(() => { if (!visible) ctrl.stop() }, [visible, ctrl])

  if (!visible) return null

  return (
    <>
      {showConfig && (
        <div className="vj-config-backdrop" onClick={onConfigClose}>
          <ConfigPanel onClose={onConfigClose}/>
        </div>
      )}
      <div className="vj-overlay">
        <SingleJoystick side="left"  onMove={handleLeftMove}  onRelease={handleLeftRelease}/>
        <SingleJoystick side="right" onMove={handleRightMove} onRelease={handleRightRelease}/>
      </div>
    </>
  )
}
