export class SerialBridgeClient {
  constructor() {
    this._target = new EventTarget()
    this._connected = false
    this._port = ''
    this._baudRate = 115200
  }

  on(type, handler) { this._target.addEventListener(type, handler) }
  off(type, handler) { this._target.removeEventListener(type, handler) }

  _emit(type, detail) {
    this._target.dispatchEvent(new CustomEvent(type, { detail }))
  }

  async connect({ port, baudRate }) {
    this._port = port
    this._baudRate = baudRate
    this._connected = true
    this._emit('status', { status: 'connected' })
    this._emit('data', { direction: 'SYS', payload: `Connected ${port} @ ${baudRate}` })
  }

  disconnect() {
    if (!this._connected) return
    this._connected = false
    this._emit('status', { status: 'disconnected' })
    this._emit('data', { direction: 'SYS', payload: 'Disconnected' })
  }

  send(payload) {
    if (!this._connected) return
    this._emit('data', { direction: 'TX ', payload })
  }
}
