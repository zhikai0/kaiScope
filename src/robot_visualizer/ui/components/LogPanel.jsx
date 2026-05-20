/**
 * LogPanel — ROS 日志面板
 *
 * 订阅 rosgraph_msgs/Log 消息，按 Debug/Info/Warn/Error 分级显示。
 * 参考 RViz LogPanel + Foxglove Studio Logs panel 风格。
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
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

// 将 level 值映射到标准级别
// 标准 ROS: DEBUG=1, INFO=2, WARN=4, ERROR=8
// rclcpp 风格: DEBUG=10, INFO=20, WARN=30, ERROR=40
function normalizeLevel(level) {
  if (level === 1) return 1
  if (level === 2) return 2
  if (level === 4) return 4
  if (level === 8) return 8
  if (level === 16) return 8 // FATAL -> ERROR

  // rclcpp 风格
  if (level === 10) return 1
  if (level === 20) return 2
  if (level === 30) return 4
  if (level === 40) return 8
  if (level === 50) return 8 // FATAL -> ERROR

  return level
}

// 点击某级别时，同时显示该级别及更高级别的消息
const LEVEL_FILTERS = [
  { v: 0, l: 'ALL',   desc: '全部' },
  { v: 2, l: 'INFO',  desc: '信息' },
  { v: 4, l: 'WARN',  desc: '警告' },
  { v: 8, l: 'ERROR', desc: '错误' },
]

export default function LogPanel({ topic = '/rosout' }) {
  const { status, subscribe } = useRos()
  const [logs, setLogs] = useState([])
  const [levelFilter, setLevelFilter] = useState(0)  // 0 = all
  const [nodeFilter, setNodeFilter] = useState('')    // '' = all
  const bottomRef = useRef(null)
  const autoScrollRef = useRef(true)
  const subRef = useRef(null)
  const idCounterRef = useRef(0)

  const handleScroll = useCallback((e) => {
    const el = e.target
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
    autoScrollRef.current = atBottom
  }, [])

  useEffect(() => {
    const unsub = subscribe(topic, (msg) => {
      if (!msg) return
      const rawLevel = msg.level ?? 2
      const level = normalizeLevel(rawLevel)
      setLogs(prev => {
        const next = [...prev, {
          id: ++idCounterRef.current,
          level,
          stamp: msg.header?.stamp ?? msg.stamp,
          name: msg.name || '',
          msg: msg.msg || '',
          file: msg.file || '',
          function: msg.function || '',
          topics: msg.topics || [],
        }]
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

  // 收集所有 node 名称用于下拉框
  const nodeNames = useMemo(() => {
    const names = [...new Set(logs.map(l => l.name).filter(Boolean))]
    return names.sort()
  }, [logs])

  // 过滤逻辑：level 过滤显示该级别及更高级别的消息
  const filtered = useMemo(() => {
    return logs.filter(entry => {
      // Level 过滤：显示 >= 选定级别的消息
      if (levelFilter !== 0 && entry.level < levelFilter) {
        return false
      }
      // Node 过滤
      if (nodeFilter && entry.name !== nodeFilter) {
        return false
      }
      return true
    })
  }, [logs, levelFilter, nodeFilter])

  // 各级别的计数（各自独立计数）
  const counts = useMemo(() => {
    const c = { INFO: 0, WARN: 0, ERROR: 0, ALL: logs.length }
    logs.forEach(l => {
      if (l.level === 2) c.INFO++
      if (l.level === 4) c.WARN++
      if (l.level === 8) c.ERROR++
    })
    return c
  }, [logs])

  return (
    <div className="log-panel">
      {/* Toolbar */}
      <div className="log-toolbar">
        <div className="log-filter">
          {LEVEL_FILTERS.map(f => (
            <button
              key={f.v}
              className={`log-filter-btn ${levelFilter === f.v ? 'on' : ''}`}
              style={levelFilter === f.v && f.v !== 0 ? { color: LEVEL_COLORS[f.v] } : {}}
              onClick={() => setLevelFilter(f.v)}
            >
              {f.l}({counts[f.l] || 0})
            </button>
          ))}
        </div>

        {/* Node 过滤下拉框 */}
        <select
          className={`log-node-select${nodeFilter ? ' has-value' : ''}`}
          value={nodeFilter}
          onChange={e => setNodeFilter(e.target.value)}
        >
          <option value="">All Nodes ({nodeNames.length})</option>
          {nodeNames.map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>

        <button className="log-clear-btn" onClick={() => setLogs([])}>Clear</button>
      </div>

      {/* Log list */}
      <div className="log-list" onScroll={handleScroll}>
        {status !== 'connected' && (
          <div className="log-empty">Connecting to ROS…</div>
        )}
        {status === 'connected' && filtered.length === 0 && (
          <div className="log-empty">No log messages</div>
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
