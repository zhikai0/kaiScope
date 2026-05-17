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

export default function TopNav({ editorMode, onToggleEditor, toolMode, onToggleTool, onBack }) {
  const { status, channels, connect, disconnect } = useRos()
  const isConnected = status === 'connected'

  const handleFoxglove = () => {
    if (isConnected) disconnect()
    else connect()
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

      {/* CENTER — Editor button */}
      <button
        className={`tb-editor ${editorMode ? 'active' : ''}`}
        onClick={onToggleEditor}
        title="Path Editor"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
        </svg>
        <span>Editor</span>
      </button>

      <div className="tb-div"/>

      {/* CENTER — Tool button */}
      <button
        className={`tb-tool ${toolMode ? 'active' : ''}`}
        onClick={onToggleTool}
        title="Tool Palette"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
        </svg>
        <span>Tool</span>
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
