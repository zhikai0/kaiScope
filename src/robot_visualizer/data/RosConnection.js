/**
 * RosConnection — 纯 WebSocket 连接层
 * 实现 Foxglove WebSocket v1 协议
 * 完全独立于 UI，无任何 React 依赖
 */

export class RosConnection extends EventTarget {
  constructor(url) {
    super()
    this.url = url || this._defaultUrl()
    this.ws = null
    this.isConnected = false
    this.isConnecting = false
    this.shouldReconnect = false
    this._reconnectTimer = null
    this._reconnectDelay = 1500
  }

  _defaultUrl() {
    const host = window.location.hostname || 'localhost'
    return `ws://${host}:8765`
  }

  // ── Public API ────────────────────────────────────────────────────────

  connect() {
    if (this.isConnecting || this.isConnected) return
    this.isConnecting = true
    this.shouldReconnect = true
    this._emit('connecting')
    this._open()
  }

  disconnect() {
    this.shouldReconnect = false
    clearTimeout(this._reconnectTimer)
    this.ws?.close()
    this.ws = null
    this.isConnected = false
    this.isConnecting = false
    this._emit('disconnect')
  }

  unadvertise(channelId) {
    if (!this.isConnected || !this.ws || !channelId) return
    try {
      this.ws.send(JSON.stringify({
        op: 'unadvertise',
        channelIds: [channelId],
      }))
    } catch (e) {
      console.warn('[RosConnection] unadvertise error', e)
    }
  }

  send(obj) {
    if (!this.isConnected || !this.ws) return
    try { this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)) }
    catch (e) { console.warn('[RosConnection] send error', e) }
  }

  /**
   * 声明客户端发布 channel（Foxglove v1 客户端发布）
   * @returns {number} channelId
   */
  advertise({ topic, encoding, schemaName }) {
    if (!this.isConnected || !this.ws) return null
    const chanId = this._nextClientChanId = (this._nextClientChanId || 0) + 1
    try {
      this.ws.send(JSON.stringify({
        op: 'advertise',
        channels: [{ id: chanId, topic, encoding, schemaName }]
      }))
    } catch(e) { console.warn('[RosConnection] advertise error', e); return null }
    return chanId
  }

  /**
   * 发送已序列化的二进制消息
   * @param {number} channelId
   * @param {Uint8Array} data
   */
  sendMessage(channelId, data) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    const payload = data instanceof Uint8Array ? data : new Uint8Array(data)
    // Foxglove WebSocket v1 客户端发布帧: [0x01:1][channelId:4LE][payload]
    // 注意：客户端发布帧没有 timestamp 字段，只有服务端下行消息才有
    const buf  = new ArrayBuffer(1 + 4 + payload.byteLength)
    const view = new DataView(buf)
    const u8   = new Uint8Array(buf)
    view.setUint8(0,  0x01)
    view.setUint32(1, channelId, true)
    u8.set(payload, 5)
    try { this.ws.send(buf) }
    catch(e) { console.warn('[RosConnection] sendMessage error', e) }
  }

  // ── Internal ──────────────────────────────────────────────────────────

  _open() {
    try {
      this.ws = new WebSocket(this.url, ['foxglove.websocket.v1'])
      this.ws.binaryType = 'arraybuffer'

      this.ws.onopen = () => {
        this.isConnected = true
        this.isConnecting = false
        clearTimeout(this._reconnectTimer)
        this._emit('connect')
      }

      this.ws.onclose = () => {
        this.isConnected = false
        this.isConnecting = false
        this._emit('disconnect')
        if (this.shouldReconnect) this._scheduleReconnect()
      }

      this.ws.onerror = (e) => {
        this.isConnecting = false
        this._emit('error', { error: e })
        if (this.shouldReconnect && !this.isConnected) this._scheduleReconnect()
      }

      this.ws.onmessage = (ev) => this._onMessage(ev)
    } catch (e) {
      this.isConnecting = false
      this._emit('error', { error: e })
      if (this.shouldReconnect) this._scheduleReconnect()
    }
  }

  _onMessage(ev) {
    if (ev.data instanceof ArrayBuffer) {
      // Binary: Foxglove data message
      // Byte 0: opcode (0x01 = message)
      // Byte 1: subscriptionId (simplified; real protocol uses 4-byte LE)
      const view = new DataView(ev.data)
      const subscriptionId = view.getUint32(1, true) // bytes 1-4, little-endian
      const data = new Uint8Array(ev.data, 13)        // payload starts at byte 13
      this._emit('message', { subscriptionId, data })
    } else {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.op === 'advertise')   this._emit('advertise',   { channels: msg.channels })
        if (msg.op === 'unadvertise') this._emit('unadvertise', { channelIds: msg.channelIds })
        if (msg.op === 'status')      this._emit('status',      { msg })
      } catch (_) {}
    }
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer)
    this._reconnectTimer = setTimeout(() => {
      if (this.shouldReconnect && !this.isConnected && !this.isConnecting) {
        this.isConnecting = true
        this._emit('reconnecting')
        this._open()
      }
    }, this._reconnectDelay)
  }

  /** dispatch a CustomEvent and call plain on* listeners */
  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }

  /** Convenience: addEventListener shorthand */
  on(type, fn)  { this.addEventListener(type, fn) }
  off(type, fn) { this.removeEventListener(type, fn) }
}
