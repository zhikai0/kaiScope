export class SerialBridgeClient {
  constructor(url = import.meta.env.VITE_BUS_BRIDGE_WS || 'ws://127.0.0.1:8764') {
    this.url = url
    this._target = new EventTarget()
    this._ws = null
    this._reqSeq = 1
    this._pending = new Map()
    this._connectPromise = null
  }

  on(type, handler) { this._target.addEventListener(type, handler) }
  off(type, handler) { this._target.removeEventListener(type, handler) }

  _emit(type, detail = {}) {
    this._target.dispatchEvent(new CustomEvent(type, { detail }))
  }

  connect() {
    if (this._ws?.readyState === WebSocket.OPEN) return Promise.resolve()
    if (this._ws?.readyState === WebSocket.CONNECTING && this._connectPromise) return this._connectPromise

    this._emit('status', { status: 'connecting' })

    const ws = new WebSocket(this.url)
    this._ws = ws

    this._connectPromise = new Promise((resolve, reject) => {
      let settled = false
      const done = (fn, val) => {
        if (settled) return
        settled = true
        this._connectPromise = null
        fn(val)
      }

      const timer = setTimeout(() => {
        try { ws.close() } catch {}
        done(reject, new Error('ws connect timeout'))
      }, 3000)

      ws.onopen = () => {
        clearTimeout(timer)
        this._emit('status', { status: 'connected' })
        done(resolve)
      }

      ws.onmessage = (event) => {
        let msg = null
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }

        if (msg.type === 'response' && msg.req_id) {
          const pending = this._pending.get(msg.req_id)
          if (!pending) return
          this._pending.delete(msg.req_id)
          if (msg.ok) pending.resolve(msg.data)
          else pending.reject(new Error(msg.error || 'bridge error'))
          return
        }

        if (msg.type) this._emit(msg.type, msg)
        this._emit('message', msg)
      }

      ws.onerror = () => {
        this._emit('status', { status: 'error' })
      }

      ws.onclose = (event) => {
        clearTimeout(timer)
        this._emit('status', { status: 'disconnected', code: event?.code ?? 0, reason: event?.reason ?? '' })
        for (const [, pending] of this._pending) pending.reject(new Error('ws closed'))
        this._pending.clear()
        this._ws = null
        if (!settled) done(reject, new Error('ws closed during connect'))
      }
    })

    return this._connectPromise
  }

  disconnect() {
    try { this._ws?.close() } catch {}
    this._ws = null
    this._connectPromise = null
  }

  async _send(op, payload = {}) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      await this.connect()
    }

    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error('ws not connected')
    }

    const reqId = `r-${Date.now()}-${this._reqSeq++}`
    const packet = { op, req_id: reqId, ...payload }

    return new Promise((resolve, reject) => {
      this._pending.set(reqId, { resolve, reject })
      this._ws.send(JSON.stringify(packet))
      setTimeout(() => {
        const pending = this._pending.get(reqId)
        if (!pending) return
        this._pending.delete(reqId)
        reject(new Error(`${op} timeout`))
      }, 4000)
    })
  }

  listPorts() { return this._send('list_ports') }

  openUart(config) { return this._send('open_uart', { config }) }
  closeUart() { return this._send('close_uart') }
  writeUartText(text) { return this._send('uart_write', { mode: 'text', text }) }
  writeUartHex(hex) { return this._send('uart_write', { mode: 'hex', hex }) }

  openCan(config) { return this._send('open_can', { config }) }
  closeCan() { return this._send('close_can') }
  sendCan(frame) { return this._send('can_send', { frame }) }

  testStartRxLog() { return this._send('test_start_rx_log') }
  testStopRxLog() { return this._send('test_stop_rx_log') }
  testStartFakePlot(hz = 20) { return this._send('test_start_fake_plot', { hz }) }
  testStopFakePlot() { return this._send('test_stop_fake_plot') }
}
