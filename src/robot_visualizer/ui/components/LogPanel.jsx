/**
 * LogPanel — ROS 日志面板
 *
 * 订阅 rosgraph_msgs/Log 消息，按 Debug/Info/Warn/Error 分级显示。
 * 参考 RViz LogPanel + Foxglove Studio Logs panel 风格。
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useRos } from '../hooks/useRos'
import './LogPanel.css'

const LEVEL_LABELS = { 1: 'DEBUG', 2: 'INFO', 4: 'WARN', 8: 'ERROR' }
const LEVEL_COLORS = {
  1: '#8e8e93',
  2: '#34c759',
  4: '#ff9f0a',
  8: '#ff3b30',
}
const MAX_LOGS = 500

function fmtTime(stamp) {
  if (!stamp) return '--:--:--'
  const s = stamp.secs ?? stamp.sec ?? 0
  const ns = stamp.nsecs ?? stamp.nsec ?? 0
  const ms = Math.floor(s * 1000 + ns / 1e6)
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms3 = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms3}`
}

export default function LogPanel({ topic = '/rosout' }) {
  const { status, subscribe } = useRos()
  const [logs, setLogs] = useState([])
  const [filter, setFilter] = useState(0)  // 0 = all, 1/2/4/8 = level
  const bottomRef = useRef(null)
  const autoScrollRef = useRef(true)
  const subRef = useRef(null)

  const handleScroll = useCallback((e) => {
    const el = e.target
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
    autoScrollRef.current = atBottom
  }, [])

  useEffect(() => {
    const unsub = subscribe(topic, (msg) => {
      if (!msg) return
      const level = msg.level ?? msg.header?.level ?? 2
      setLogs(prev => {
        const entry = {
          id: Date.now() + Math.random(),
          level,
          stamp: msg.header?.stamp ?? msg.stamp,
          name: msg.name || '',
          msg: msg.msg || '',
          file: msg.file || '',
          function: msg.function || '',
          topics: msg.topics || [],
        }
        const next = [...prev, entry]
        return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next
      })
    })
    subRef.current = unsub
    return () => { unsub && unsub() }
  }, [subscribe, topic])

  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  const filtered = filter === 0 ? logs : logs.filter(l => l.level === filter)

  return (
    <div className="log-panel">
      {/* Toolbar */}
      <div className="log-toolbar">
        <div className="log-filter">
          {[{ v: 0, l: 'ALL' }, { v: 2, l: 'INFO' }, { v: 4, l: 'WARN' }, { v: 8, l: 'ERROR' }].map(f => (
            <button
              key={f.v}
              className={`log-filter-btn ${filter === f.v ? 'on' : ''}`}
              style={filter === f.v && f.v !== 0 ? { color: LEVEL_COLORS[f.v] } : {}}
              onClick={() => setFilter(f.v)}
            >
              {f.l}
            </button>
          ))}
        </div>
        <button className="log-clear-btn" onClick={() => setLogs([])}>Clear</button>
        <span className="log-count">{filtered.length}{filter !== 0 && filter !== logs.length ? ` / ${logs.length}` : ''}</span>
      </div>

      {/* Log list */}
      <div className="log-list" onScroll={handleScroll}>
        {status !== 'connected' && (
          <div className="log-empty">Connecting to ROS…</div>
        )}
        {status === 'connected' && filtered.length === 0 && (
          <div className="log-empty">No log messages{filter !== 0 ? ' at this level' : ''}</div>
        )}
        {filtered.map(entry => (
          <div key={entry.id} className="log-entry">
            <span className="log-time">{fmtTime(entry.stamp)}</span>
            <span className="log-badge" style={{ color: LEVEL_COLORS[entry.level] }}>
              {LEVEL_LABELS[entry.level] || 'INFO'}
            </span>
            {entry.name && <span className="log-name">{entry.name}</span>}
            <span className="log-msg">{entry.msg}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
