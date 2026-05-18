import { useState, useEffect, useRef } from 'react'
import './SettingsModal.css'
import { reconnectWithUrl, getSavedWsUrl } from '../hooks/useRos'

const STORAGE_KEY = 'kaiscope-ws-url'

export function saveWsUrl(url) {
  try {
    if (url) localStorage.setItem(STORAGE_KEY, url)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

export function applyWsUrl(url) {
  const trimmed = (url || '').trim()
  saveWsUrl(trimmed)
  reconnectWithUrl(trimmed || undefined)
}

export default function SettingsModal({ open, onClose }) {
  const [url, setUrl] = useState('')
  const [show, setShow] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    setShow(open)
    if (open) {
      setUrl(getSavedWsUrl())
      setTimeout(() => inputRef.current?.select(), 50)
    }
  }, [open])

  const handleSave = () => {
    applyWsUrl(url)
    onClose?.()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') onClose?.()
  }

  if (!show) return null

  return (
    <div className="sm-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="sm-panel">
        <div className="sm-header">
          <span>Settings</span>
          <button className="sm-close" onClick={onClose}>×</button>
        </div>
        <div className="sm-body">
          <label className="sm-label">WebSocket URL</label>
          <input
            ref={inputRef}
            className="sm-input"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="ws://192.168.1.100:8765"
            spellCheck={false}
          />
          <p className="sm-hint">留空则自动使用浏览器地址连接</p>
        </div>
        <div className="sm-footer">
          <button className="sm-btn sm-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="sm-btn sm-btn-save" onClick={handleSave}>Save &amp; Reconnect</button>
        </div>
      </div>
    </div>
  )
}
