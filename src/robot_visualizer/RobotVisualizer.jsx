/**
 * RobotVisualizer.jsx — Robot Visualizer 主组件
 * 
 * 将原来的 App.jsx 逻辑移到这里
 */
import React, { useState, useCallback, useRef, useEffect } from 'react'
import TopNav from './ui/panels/TopNav'
import LeftPanel from './ui/panels/LeftPanel'
import Viewport3D from './scene/Viewport3D'
import ImagePanel from './ui/components/ImagePanel'
import VirtualJoystick from './ui/components/VirtualJoystick'
import { getTfManager, injectMockTfTree } from './data/TfManager'
import { getTfDisplayManager } from './manager/TfDisplayManager'
import './RobotVisualizer.css'

// 开发用 mock TF 数据
if (getTfManager().getTfTree().size === 0) {
  injectMockTfTree(getTfManager())
}
getTfDisplayManager()

const PANEL_TYPES = [
  { id:'3d',    label:'3D Scene', icon:'🧊' },
  { id:'plot',  label:'Plot',     icon:'📈' },
  { id:'tf',    label:'TF Tree',  icon:'📐' },
  { id:'log',   label:'Logs',     icon:'📋' },
  { id:'param', label:'Params',   icon:'⚙️' },
  { id:'image', label:'Image',    icon:'🖼️' },
]

// ── Drag resize hook ──────────────────────────────────────────────────────
function useDragResize(direction, onDelta) {
  const dragging = useRef(false)
  const start    = useRef(0)

  const onMouseDown = useCallback((e) => {
    dragging.current = true
    start.current = direction === 'h' ? e.clientX : e.clientY
    e.preventDefault()
  }, [direction])

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return
      const pos = direction === 'h' ? e.clientX : e.clientY
      onDelta(pos - start.current)
      start.current = pos
    }
    const onUp = () => { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', e => {
      if (!dragging.current) return
      const pos = direction === 'h' ? e.touches[0].clientX : e.touches[0].clientY
      onDelta(pos - start.current)
      start.current = pos
    }, { passive: false })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [direction, onDelta])

  return onMouseDown
}

function HResizeHandle({ onDelta }) {
  const onDown = useDragResize('h', onDelta)
  return <div className="resize-h" onMouseDown={onDown} onTouchStart={onDown} />
}

function VResizeHandle({ onDelta }) {
  const onDown = useDragResize('v', onDelta)
  return <div className="resize-v" onMouseDown={onDown} onTouchStart={onDown} />
}

function PanelCell({ ptype, onChangeType, onSplitH, onSplitV, onClose, canClose, hideHeader }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pt = PANEL_TYPES.find(x => x.id === ptype) || PANEL_TYPES[0]

  return (
    <div className="pcell">
      {!hideHeader && (
        <div className="pcell-hdr">
        <span className="pcell-title">{pt.icon} {pt.label}</span>
        <div className="pcell-actions">
          <button className="pcell-btn" title="Split right" onClick={onSplitH}>⊞</button>
          <button className="pcell-btn" title="Split down"  onClick={onSplitV}>⊟</button>
          <button className="pcell-btn" title="Change type" onClick={()=>setMenuOpen(v=>!v)}>⋯</button>
          {canClose && <button className="pcell-btn close" title="Close" onClick={onClose}>✕</button>}
        </div>
        {menuOpen && (
          <div className="pcell-menu">
            {PANEL_TYPES.map(p => (
              <button key={p.id}
                className={`pcell-menu-item ${ptype===p.id?'active':''}`}
                onClick={()=>{ onChangeType(p.id); setMenuOpen(false) }}>
                {p.icon} {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
      )}
      <div className="pcell-body" onClick={menuOpen?()=>setMenuOpen(false):undefined}>
        {ptype === '3d'
          ? <Viewport3D />
          : ptype === 'image'
          ? <ImagePanel />
          : <div className="pcell-placeholder">
              <span className="pp-icon">{pt.icon}</span>
              <p className="pp-label">{pt.label}</p>
              <span className="pp-sub">Connect ROS/WebSocket to stream data</span>
            </div>
        }
      </div>
    </div>
  )
}

function PanelColumn({ col, colIdx, totalPanels, onSplitH, onSplitV, onClose, onChangeType, onRowResize }) {
  const [rowSizes, setRowSizes] = useState(() => col.map(() => 1))

  useEffect(() => {
    setRowSizes(prev => {
      if (prev.length === col.length) return prev
      const next = col.map((_, i) => prev[i] ?? 1)
      return next
    })
  }, [col.length])

  const total = rowSizes.reduce((a, b) => a + b, 0)

  const handleRowDelta = useCallback((rowIdx, deltaY) => {
    setRowSizes(prev => {
      const next = [...prev]
      const containerH = document.querySelector('.panel-layout')?.clientHeight || window.innerHeight
      const delta = (deltaY / containerH) * total
      next[rowIdx]   = Math.max(0.1, next[rowIdx] + delta)
      next[rowIdx+1] = Math.max(0.1, next[rowIdx+1] - delta)
      return next
    })
  }, [total])

  return (
    <div className="panel-col" style={{display:'flex',flexDirection:'column',flex:1,minWidth:0,overflow:'hidden'}}>
      {col.map((ptype, rowIdx) => (
        <React.Fragment key={`${colIdx}-${rowIdx}`}>
          <div style={{flex: rowSizes[rowIdx]||1, minHeight:0, display:'flex', flexDirection:'column', overflow:'hidden'}} >
            <PanelCell
              ptype={ptype}
              canClose={totalPanels > 1}
              hideHeader={totalPanels === 1}
              onSplitH={()=>onSplitH(colIdx, rowIdx)}
              onSplitV={()=>onSplitV(colIdx, rowIdx)}
              onClose={()=>onClose(colIdx, rowIdx)}
              onChangeType={(t)=>onChangeType(colIdx, rowIdx, t)}
            />
          </div>
          {rowIdx < col.length - 1 && (
            <VResizeHandle key={`vr-${rowIdx}`} onDelta={(dy) => handleRowDelta(rowIdx, dy)} />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

function PanelLayout({ layout, onUpdate }) {
  const [colSizes, setColSizes] = useState(() => layout.map(() => 1))

  useEffect(() => {
    setColSizes(prev => {
      if (prev.length === layout.length) return prev
      return layout.map((_, i) => prev[i] ?? 1)
    })
  }, [layout.length])

  const total = colSizes.reduce((a, b) => a + b, 0)

  const handleColDelta = useCallback((colIdx, deltaX) => {
    setColSizes(prev => {
      const next = [...prev]
      const containerW = document.querySelector('.panel-layout')?.clientWidth || window.innerWidth
      const delta = (deltaX / containerW) * total
      next[colIdx]   = Math.max(0.1, next[colIdx] + delta)
      next[colIdx+1] = Math.max(0.1, next[colIdx+1] - delta)
      return next
    })
  }, [total])

  const handleSplitH = (colIdx, rowIdx) => {
    const next = [...layout]
    next.splice(colIdx + 1, 0, ['plot'])
    onUpdate(next)
  }
  const handleSplitV = (colIdx, rowIdx) => {
    onUpdate(layout.map((col, ci) =>
      ci === colIdx ? [...col.slice(0, rowIdx+1), 'plot', ...col.slice(rowIdx+1)] : col
    ))
  }
  const handleClose = (colIdx, rowIdx) => {
    const next = layout.map((col, ci) =>
      ci === colIdx ? col.filter((_,ri) => ri !== rowIdx) : col
    ).filter(col => col.length > 0)
    onUpdate(next.length ? next : [['3d']])
  }
  const handleChangeType = (colIdx, rowIdx, t) => {
    onUpdate(layout.map((col, ci) =>
      ci === colIdx ? col.map((p, ri) => ri === rowIdx ? t : p) : col
    ))
  }

  const totalPanels = layout.reduce((s,c)=>s+c.length, 0)

  return (
    <div className="panel-layout">
      {layout.map((col, colIdx) => (
        <React.Fragment key={colIdx}>
          <div style={{flex: colSizes[colIdx]||1, minWidth:0, display:'flex', flexDirection:'column', overflow:'hidden'}} >
            <PanelColumn
              col={col} colIdx={colIdx}
              totalPanels={totalPanels}
              onSplitH={handleSplitH}
              onSplitV={handleSplitV}
              onClose={handleClose}
              onChangeType={handleChangeType}
            />
          </div>
          {colIdx < layout.length - 1 && (
            <HResizeHandle key={`hr-${colIdx}`} onDelta={(dx)=>handleColDelta(colIdx, dx)} />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

export default function RobotVisualizer({ onBack }) {
  const [layout, setLayout] = useState([['3d']])
  const [displaysVisible, setDisplaysVisible] = useState(true)
  const [controlMode, setControlMode] = useState(false)
  const [showJoystickConfig, setShowJoystickConfig] = useState(false)

  const handleToggleControl = () => {
    setControlMode(v => {
      const next = !v
      if (next) setShowJoystickConfig(true)
      else      setShowJoystickConfig(false)
      return next
    })
  }

  const isSingle = layout.length === 1 && layout[0].length === 1

  const splitDown = () => setLayout([['3d', 'plot']])

  const splitImage = useCallback((_topic) => {
    setLayout(prev => {
      const flat = prev.flat()
      if (prev.length === 1) {
        return [prev[0], ['image']]
      }
      const rightColIdx = prev.length - 1
      const rightCol    = prev[rightColIdx]
      if (rightCol.filter(p => p === 'image').length >= 4) return prev
      const next = prev.map((col, i) =>
        i === rightColIdx ? [...col, 'image'] : col
      )
      return next
    })
  }, [])

  return (
    <div className="app-shell">
      <PanelLayout layout={layout} onUpdate={setLayout} />
      <VirtualJoystick
        visible={controlMode}
        showConfig={showJoystickConfig}
        onConfigClose={() => setShowJoystickConfig(false)}
      />
      <TopNav
        onToggleDisplays={()=>setDisplaysVisible(v=>!v)}
        displaysVisible={displaysVisible}
        controlMode={controlMode}
        onToggleControl={handleToggleControl}
        onOpenControlConfig={() => { setControlMode(true); setShowJoystickConfig(true) }}
        onBack={onBack}
      />
      <LeftPanel visible={displaysVisible} onVisibleChange={setDisplaysVisible} onImageAdd={splitImage}/>

      {isSingle && (
        <div className="view-sw">
          <button className="vsw on">3D</button>
          <div className="vsw-split-wrap">
            <button className="vsw" onClick={splitDown} title="Split view">⊟</button>
          </div>
        </div>
      )}
    </div>
  )
}
