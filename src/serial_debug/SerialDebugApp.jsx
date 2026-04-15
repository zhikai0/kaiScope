import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RingSeries } from './ringBuffer'
import { parseLineToChannels } from './parser'
import { fmtClock, nowSeconds } from './time'
import { BusSessionManager } from './manager/BusSessionManager'
import UPlotPanel from './ui/components/UPlotPanel'
import { useDragResize } from './ui/layout/useDragResize'
import { useLocalPersist } from '../robot_visualizer/ui/hooks/useLocalPersist'
import './SerialDebug.css'

const NAV = [
  { id: 'connect', icon: '🔌', label: '协议与连接' },
  { id: 'command', icon: '⌨️', label: '命令' },
  { id: 'widget', icon: '🧩', label: '控件' },
]

const DEFAULT_UART = { port: '/dev/ttyUSB0', baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none' }
const DEFAULT_CAN = { channel: 'can0', bitrate: 500000 }

export default function SerialDebugApp({ onBack }) {
  const session = useMemo(() => new BusSessionManager(), [])
  const series = useMemo(() => new RingSeries(8000), [])

  const [activeNav, setActiveNav] = useLocalPersist('sdbg-nav', 'connect')
  const [leftPanelW, setLeftPanelW] = useLocalPersist('sdbg-panel-w', 250)
  const [bottomH, setBottomH] = useLocalPersist('sdbg-bottom-h', 220)

  const [wsStatus, setWsStatus] = useState('disconnected')
  const [uartOpen, setUartOpen] = useState(false)
  const [canOpen, setCanOpen] = useState(false)
  const [uartCfg, setUartCfg] = useLocalPersist('sdbg-uart', DEFAULT_UART)
  const [canCfg, setCanCfg] = useLocalPersist('sdbg-can', DEFAULT_CAN)
  const [uartPorts, setUartPorts] = useState([])
  const [canPorts, setCanPorts] = useState([])
  const [selectedBus, setSelectedBus] = useState('')

  const [protocol, setProtocol] = useLocalPersist('sdbg-protocol', 'csv')
  const [delimiter, setDelimiter] = useLocalPersist('sdbg-delimiter', ',')
  const [enabledChannels, setEnabledChannels] = useLocalPersist('sdbg-channels', [])

  const [txText, setTxText] = useState('')

  const [rxLog, setRxLog] = useState([])
  const [sysLog, setSysLog] = useState([])
  const [widgets, setWidgets] = useLocalPersist('sdbg-widgets', ['plot'])
  const [testHz, setTestHz] = useLocalPersist('sdbg-test-hz', 20)

  const shellRef = useRef(null)
  const rightRef = useRef(null)
  const bottomRxLogRef = useRef(null)
  const parseRef = useRef({ protocol: 'csv', delimiter: ',' })

  const buses = useMemo(() => [
    ...uartPorts.map(name => ({ kind: 'uart', name })),
    ...canPorts.map(name => ({ kind: 'can', name })),
  ], [uartPorts, canPorts])

  const logSys = useCallback((line) => setSysLog(prev => [...prev.slice(-199), `${fmtClock()} ${line}`]), [])
  const logRx = useCallback((line) => setRxLog(prev => [...prev.slice(-599), line]), [])
  const addWidget = useCallback((id) => setWidgets(prev => (prev.includes(id) ? prev : [...prev, id])), [])
  const delWidget = useCallback((id) => setWidgets(prev => prev.filter(x => x !== id)), [])

  const onMainDelta = useCallback((dx) => {
    const w = shellRef.current?.clientWidth || window.innerWidth
    setLeftPanelW(prev => Math.max(200, Math.min(Math.floor(w * 0.38), prev + dx)))
  }, [])
  const onVerticalDelta = useCallback((dy) => {
    const h = rightRef.current?.clientHeight || window.innerHeight
    setBottomH(prev => Math.max(150, Math.min(Math.floor(h * 0.7), prev - dy)))
  }, [])
  const hDrag = useDragResize('h', onMainDelta)
  const vDrag = useDragResize('v', onVerticalDelta)

  useEffect(() => { parseRef.current = { protocol, delimiter } }, [protocol, delimiter])

  useEffect(() => {
    const onState = (e) => {
      const s = e.detail || {}
      setWsStatus(s.wsStatus || 'disconnected')
      setUartOpen(!!s.uartOpen)
      setCanOpen(!!s.canOpen)
      setUartPorts(Array.isArray(s.uartPorts) ? s.uartPorts : [])
      setCanPorts(Array.isArray(s.canPorts) ? s.canPorts : [])
    }
    const onLog = (e) => logSys(`[SYS] ${e.detail}`)
    const onUartRx = (e) => {
      const text = e.detail?.text ?? ''
      logRx(`${fmtClock()} [UART RX] ${text}`)
      const { protocol: p, delimiter: d } = parseRef.current
      const vals = parseLineToChannels(text, p, d)
      if (vals) {
        const nextCount = vals.length
        if (nextCount > 0) {
          setEnabledChannels((prev) => {
            if (nextCount <= prev.length) return prev
            return Array.from({ length: nextCount }, (_, i) => (prev[i] ?? true))
          })
        }
        series.push(nowSeconds(), vals)
      }
    }
    const onCanRx = (e) => {
      const id = e.detail?.id ?? 0
      const data = e.detail?.data ?? ''
      logRx(`${fmtClock()} [CAN RX ] id=0x${id.toString(16)} data=${data}`)
    }

    session.on('state', onState)
    session.on('log', onLog)
    session.on('uart_rx', onUartRx)
    session.on('can_rx', onCanRx)

    session.start().catch((e) => logSys(`[ERR] bridge connect failed: ${e.message}`))
    return () => {
      session.off('state', onState)
      session.off('log', onLog)
      session.off('uart_rx', onUartRx)
      session.off('can_rx', onCanRx)
      session.stop()
    }
  }, [logRx, logSys, series, session])

  useEffect(() => {
    if (buses.length === 0) return
    if (buses.some(b => `${b.kind}:${b.name}` === selectedBus)) return
    const first = buses[0]
    setSelectedBus(`${first.kind}:${first.name}`)
  }, [buses, selectedBus])

  useEffect(() => {
    if (!selectedBus) return
    const [kind, name] = selectedBus.split(':')
    if (kind === 'uart') setUartCfg(prev => ({ ...prev, port: name }))
    if (kind === 'can') setCanCfg(prev => ({ ...prev, channel: name }))
  }, [selectedBus])

  useEffect(() => {
    const el = bottomRxLogRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [rxLog])

  const refresh = async () => { try { await session.refreshPorts(); logSys('[SYS] refreshed bus list') } catch (e) { logSys(`[ERR] list ports failed: ${e.message}`) } }
  const openSel = async () => {
    if (!selectedBus) return logSys('[ERR] no bus selected')
    const [kind] = selectedBus.split(':')
    try {
      logSys(`[SYS] opening ${selectedBus}`)
      if (kind === 'uart') {
        await session.openUart({ ...uartCfg })
        logSys(`[SYS] UART opened ${uartCfg.port} @ ${uartCfg.baudRate}`)
      }
      if (kind === 'can') {
        await session.openCan({ ...canCfg })
        logSys(`[SYS] CAN opened ${canCfg.channel} @ ${canCfg.bitrate}`)
      }
    } catch (e) { logSys(`[ERR] open bus failed: ${e.message}`) }
  }
  const closeSel = async () => {
    if (!selectedBus) return logSys('[ERR] no bus selected')
    const [kind] = selectedBus.split(':')
    try {
      logSys(`[SYS] closing ${selectedBus}`)
      if (kind === 'uart') {
        await session.closeUart()
        logSys('[SYS] UART closed')
      }
      if (kind === 'can') {
        await session.closeCan()
        logSys('[SYS] CAN closed')
      }
    } catch (e) { logSys(`[ERR] close bus failed: ${e.message}`) }
  }

  const sendText = async () => { if (!txText.trim()) return; try { await session.writeUartText(txText); logRx(`${fmtClock()} [UART TX] ${txText}`); setTxText('') } catch (e) { logSys(`[ERR] UART send failed: ${e.message}`) } }

  const testStartRxLog = async () => { try { await session.testStartRxLog(); logSys('[TEST] RX日志已开启') } catch (e) { logSys(`[ERR] test_start_rx_log failed: ${e.message}`) } }
  const testStopRxLog = async () => { try { await session.testStopRxLog(); logSys('[TEST] RX日志已关闭') } catch (e) { logSys(`[ERR] test_stop_rx_log failed: ${e.message}`) } }
  const testStartFakePlot = async () => { try { await session.testStartFakePlot(Number(testHz) || 20); logSys(`[TEST] fake plot started @ ${Number(testHz) || 20}Hz`) } catch (e) { logSys(`[ERR] test_start_fake_plot failed: ${e.message}`) } }
  const testStopFakePlot = async () => { try { await session.testStopFakePlot(); logSys('[TEST] fake plot stopped') } catch (e) { logSys(`[ERR] test_stop_fake_plot failed: ${e.message}`) } }

  const selKind = selectedBus.split(':')[0] || ''
  const selOpen = selKind === 'uart' ? uartOpen : selKind === 'can' ? canOpen : false

  return (
    <div className="sdbg-shell" ref={shellRef} onContextMenu={(e) => e.preventDefault()}>
      <div className="sdbg-nav-rail">
        <button className="sdbg-nav-back" onClick={onBack}>←</button>
        {NAV.map(n => (
          <button key={n.id} title={n.label} className={`sdbg-nav-item ${activeNav === n.id ? 'active' : ''}`} onClick={() => setActiveNav(n.id)}>
            <span className="sdbg-nav-icon">{n.icon}</span>
          </button>
        ))}
      </div>

      <div className="sdbg-option-panel" style={{ width: leftPanelW }}>
        <div className="sdbg-option-head">{NAV.find(n => n.id === activeNav)?.label}</div>
        {activeNav === 'connect' && (
          <>
            <div className="sdbg-row"><span className={`sdbg-pill ${wsStatus === 'connected' ? 'ok' : 'off'}`}>WS {wsStatus}</span><button className="sdbg-btn" onClick={refresh}>刷新设备</button></div>
            <div className="sdbg-row"><select className="sdbg-select grow" value={selectedBus} onChange={e => setSelectedBus(e.target.value)}>{buses.length===0?<option value="">No bus device</option>:buses.map(b=><option key={`${b.kind}:${b.name}`} value={`${b.kind}:${b.name}`}>{`${b.kind.toUpperCase()} ${b.name}`}</option>)}</select></div>
            <div className="sdbg-row"><button className="sdbg-btn primary" onClick={openSel}>Open</button><button className="sdbg-btn danger" onClick={closeSel}>Close</button><span className={`sdbg-pill ${selOpen?'ok':'off'}`}>{selOpen?'OPEN':'CLOSED'}</span></div>
            <div className="sdbg-row"><input className="sdbg-input" type="number" value={uartCfg.baudRate} onChange={e => setUartCfg(v => ({ ...v, baudRate: Number(e.target.value) }))} /><span className="sdbg-muted">UART Baud</span></div>
            <div className="sdbg-row"><input className="sdbg-input" type="number" value={canCfg.bitrate} onChange={e => setCanCfg(v => ({ ...v, bitrate: Number(e.target.value) }))} /><span className="sdbg-muted">CAN Bitrate</span></div>
            <div className="sdbg-row"><select className="sdbg-select" value={protocol} onChange={e=>setProtocol(e.target.value)}><option value="csv">CSV</option><option value="custom">Custom</option></select><input className="sdbg-input" value={delimiter} onChange={e=>setDelimiter(e.target.value||',')} /></div>
          </>
        )}
        {activeNav === 'command' && (
          <>
            <div className="sdbg-row"><button className="sdbg-btn" onClick={()=>setTxText('status')}>填充 status</button><button className="sdbg-btn" onClick={()=>setTxText('help')}>填充 help</button></div>
            <div className="sdbg-row"><button className="sdbg-btn" onClick={()=>setRxLog([])}>清空RX</button><button className="sdbg-btn" onClick={()=>setSysLog([])}>清空日志</button></div>
            <div className="sdbg-row"><button className="sdbg-btn" onClick={testStartRxLog}>TEST 开启RX日志</button><button className="sdbg-btn" onClick={testStopRxLog}>TEST 关闭RX日志</button></div>
            <div className="sdbg-row"><input className="sdbg-input" style={{width: 90}} type="number" value={testHz} onChange={e=>setTestHz(e.target.value)} /><button className="sdbg-btn" onClick={testStartFakePlot}>TEST 启动假数据</button><button className="sdbg-btn" onClick={testStopFakePlot}>TEST 停止假数据</button></div>
            <div className="sdbg-logbox">{sysLog.slice(-20).map((l,i)=><div key={`${i}-${l}`}>{l}</div>)}</div>
          </>
        )}
        {activeNav === 'widget' && (
          <>
            <div className="sdbg-row"><button className="sdbg-btn" onClick={()=>addWidget('plot')}>添加 Plot</button></div>
            <div className="sdbg-row"><button className="sdbg-btn" onClick={()=>addWidget('rxlog')}>添加 RX Log</button></div>
            <div className="sdbg-row"><button className="sdbg-btn" onClick={()=>setWidgets(['plot'])}>重置默认</button></div>
          </>
        )}
      </div>

      <div className="sdbg-divider-h" {...hDrag} />

      <div className="sdbg-right" ref={rightRef} style={{ gridTemplateRows: `minmax(0, 1fr) 8px ${bottomH}px 52px` }}>
        <div className="sdbg-top">
          {widgets.length === 0 && <div className="sdbg-empty">从左侧添加控件</div>}
          {widgets.includes('plot') && (
            <div className="sdbg-card sdbg-card-fill">
              <div className="sdbg-card-head"><span>Plot</span><button className="sdbg-mini" onClick={()=>delWidget('plot')}>×</button></div>
              <div className="sdbg-row">{enabledChannels.map((enabled, i)=><label key={i} className="sdbg-muted"><input type="checkbox" checked={enabled} onChange={e=>setEnabledChannels(prev=>prev.map((v,idx)=>idx===i?e.target.checked:v))} /> CH{i+1}</label>)}</div>
              <UPlotPanel series={series} enabledChannels={enabledChannels} />
            </div>
          )}
          {widgets.includes('rxlog') && (
            <div className="sdbg-card">
              <div className="sdbg-card-head"><span>RX Log</span><button className="sdbg-mini" onClick={()=>delWidget('rxlog')}>×</button></div>
              <div className="sdbg-logbox growbox">{rxLog.map((l,i)=><div key={`${i}-${l}`}>{l}</div>)}</div>
            </div>
          )}
        </div>
        <div className="sdbg-divider-v" {...vDrag} />
        <div className="sdbg-bottom">
          <div className="sdbg-logbox growbox" ref={bottomRxLogRef}>{rxLog.map((l,i)=><div key={`${i}-${l}`}>{l}</div>)}</div>
        </div>
        <div className="sdbg-sendbar">
          <div className="sdbg-row"><input className="sdbg-input grow" value={txText} onChange={e=>setTxText(e.target.value)} placeholder="UART ASCII" /><button className="sdbg-btn" onClick={sendText}>Send</button></div>
        </div>
      </div>
    </div>
  )
}
