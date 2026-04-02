import { useEffect, useMemo, useState } from 'react'
import { SerialBridgeClient } from './services/SerialBridgeClient'
import './SerialDebug.css'

export default function SerialDebugApp({ onBack }) {
  const client = useMemo(() => new SerialBridgeClient(), [])
  const [status, setStatus] = useState('disconnected')
  const [port, setPort] = useState('/dev/ttyUSB0')
  const [baudRate, setBaudRate] = useState(115200)
  const [tx, setTx] = useState('')
  const [lines, setLines] = useState([])

  useEffect(() => {
    const onStatus = (e) => setStatus(e.detail.status)
    const onData = (e) => {
      setLines(prev => [...prev.slice(-399), `${new Date().toLocaleTimeString()}  ${e.detail.direction}  ${e.detail.payload}`])
    }

    client.on('status', onStatus)
    client.on('data', onData)
    return () => {
      client.off('status', onStatus)
      client.off('data', onData)
      client.disconnect()
    }
  }, [client])

  const handleConnect = async () => {
    await client.connect({ port, baudRate: Number(baudRate) })
  }

  const handleDisconnect = () => {
    client.disconnect()
  }

  const handleSend = () => {
    if (!tx.trim()) return
    client.send(tx)
    setTx('')
  }

  return (
    <div className="sd-wrap">
      <div className="sd-header">
        <button className="sd-back" onClick={onBack}>Back</button>
        <h2>Serial Debug</h2>
        <span className={`sd-status ${status}`}>{status}</span>
      </div>

      <div className="sd-toolbar">
        <input className="sd-input" value={port} onChange={e => setPort(e.target.value)} placeholder="/dev/ttyUSB0" />
        <input className="sd-input small" type="number" value={baudRate} onChange={e => setBaudRate(e.target.value)} />
        <button className="sd-btn" onClick={handleConnect}>Connect</button>
        <button className="sd-btn" onClick={handleDisconnect}>Disconnect</button>
        <button className="sd-btn" onClick={() => setLines([])}>Clear</button>
      </div>

      <div className="sd-console">
        {lines.length === 0 ? <div className="sd-empty">No serial data yet.</div> : lines.map((line, i) => <div key={`${i}-${line}`}>{line}</div>)}
      </div>

      <div className="sd-send">
        <input
          className="sd-input"
          value={tx}
          onChange={e => setTx(e.target.value)}
          placeholder="Type command and press Enter"
          onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
        />
        <button className="sd-btn" onClick={handleSend}>Send</button>
      </div>
    </div>
  )
}
