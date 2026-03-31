import { useRef } from 'react'
import { useRos } from '../hooks/useRos'
import './TopNav.css'

const STATUS_COLOR = {
  connected:    'var(--green)',
  connecting:   'var(--orange)',
  reconnecting: 'var(--orange)',
  error:        'var(--red)',
  disconnected: 'var(--text-3)',
}
const STATUS_LABEL = {
  connected:    'Connected',
  connecting:   'Connecting…',
  reconnecting: 'Reconnecting…',
  error:        'Error',
  disconnected: 'Foxglove',
}

export default function TopNav({ onToggleDisplays, displaysVisible, controlMode, onToggleControl, onOpenControlConfig, onBack }) {
  const { status, channels, connect, disconnect } = useRos()

  const isConnected = status === 'connected'

  const handleFoxglove = () => {
    if (isConnected) disconnect()
    else connect()
  }

  // 长按 Control 按钮打开配置
  const pressTimer = useRef(null)
  const handleControlMouseDown = () => {
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null
      onOpenControlConfig?.()
    }, 500)
  }
  const handleControlMouseUp = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
      onToggleControl?.()
    }
  }
  const handleControlContextMenu = (e) => {
    e.preventDefault()
    onOpenControlConfig?.()
  }

  return (
    <header className="toolbar-capsule">
      {/* BACK button */}
      {onBack && (
        <>
          <button
            className="tb-back"
            onClick={onBack}
            title="返回主菜单"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            <span>Back</span>
          </button>
          <div className="tb-div"/>
        </>
      )}

      {/* LEFT — Displays toggle */}
      <button
        className={`tb-displays ${displaysVisible ? 'active' : ''}`}
        onClick={onToggleDisplays}
        title="Toggle Displays Panel"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="18" rx="1"/>
          <rect x="14" y="3" width="7" height="8" rx="1"/>
          <rect x="14" y="15" width="7" height="6" rx="1"/>
        </svg>
        <span>Displays</span>
      </button>

      <div className="tb-div"/>

      {/* CENTER — Control button */}
      <button
        className={`tb-control ${controlMode ? 'active' : ''}`}
        onMouseDown={handleControlMouseDown}
        onMouseUp={handleControlMouseUp}
        onMouseLeave={() => { if(pressTimer.current){ clearTimeout(pressTimer.current); pressTimer.current=null } }}
        onContextMenu={handleControlContextMenu}
        title="点击开关摇杆 | 长按/右键 配置参数"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3"/>
          <circle cx="12" cy="12" r="9"/>
          <line x1="12" y1="3" x2="12" y2="6"/>
          <line x1="12" y1="18" x2="12" y2="21"/>
          <line x1="3" y1="12" x2="6" y2="12"/>
          <line x1="18" y1="12" x2="21" y2="12"/>
        </svg>
        <span>Control</span>
      </button>

      <div className="tb-div"/>

      {/* RIGHT — Foxglove connect */}
      <button
        className={`tb-connect ${isConnected ? 'connected' : ''} status-${status}`}
        onClick={handleFoxglove}
        title={isConnected ? '断开 Foxglove Bridge' : '连接 Foxglove Bridge (ws://localhost:8765)'}
      >
        <span>🔌</span>
        <span>{STATUS_LABEL[status] || 'Foxglove'}</span>
        {channels.length > 0 && <span className="tb-ch-count">{channels.length}</span>}
      </button>

      <div className="tb-div"/>

      {/* Connection status dot */}
      <div className="tb-status">
        <span className="tb-dot" style={{background: STATUS_COLOR[status]}}/>
      </div>
    </header>
  )
}
