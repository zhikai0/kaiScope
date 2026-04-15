import { SerialBridgeClient } from '../services/SerialBridgeClient'

export class BusSessionManager {
  constructor(client = new SerialBridgeClient()) {
    this.client = client
    this._target = new EventTarget()
    this._state = {
      wsStatus: 'disconnected',
      uartOpen: false,
      canOpen: false,
      uartPorts: [],
      canPorts: [],
    }

    this._onStatus = (e) => {
      this._state.wsStatus = e.detail.status
      this._emit('state', this.snapshot())
    }

    this._onBridge = (event) => {
      const msg = event.detail || {}
      if (msg.kind === 'uart') this._state.uartOpen = !!msg.open
      if (msg.kind === 'can') this._state.canOpen = !!msg.open
      this._emit('state', this.snapshot())
      if (msg.message) this._emit('log', msg.message)
    }

    this._onPortList = (event) => {
      const msg = event.detail || {}
      this._state.uartPorts = Array.isArray(msg.uart) ? msg.uart : []
      this._state.canPorts = Array.isArray(msg.can) ? msg.can : []
      this._emit('state', this.snapshot())
    }

    this._onUartRx = (event) => this._emit('uart_rx', event.detail || {})
    this._onCanRx = (event) => this._emit('can_rx', event.detail || {})
  }

  on(type, handler) { this._target.addEventListener(type, handler) }
  off(type, handler) { this._target.removeEventListener(type, handler) }

  _emit(type, detail) {
    this._target.dispatchEvent(new CustomEvent(type, { detail }))
  }

  snapshot() {
    return { ...this._state }
  }

  async start() {
    this.client.on('status', this._onStatus)
    this.client.on('bridge_status', this._onBridge)
    this.client.on('port_list', this._onPortList)
    this.client.on('uart_rx', this._onUartRx)
    this.client.on('can_rx', this._onCanRx)

    await this.client.connect()
    this._emit('log', 'bridge connected')
    try {
      await this.refreshPorts()
    } catch (e) {
      this._emit('log', `refresh ports failed: ${e.message}`)
    }
  }

  stop() {
    this.client.off('status', this._onStatus)
    this.client.off('bridge_status', this._onBridge)
    this.client.off('port_list', this._onPortList)
    this.client.off('uart_rx', this._onUartRx)
    this.client.off('can_rx', this._onCanRx)
    this.client.disconnect()
  }

  async refreshPorts() {
    const data = await this.client.listPorts()
    this._state.uartPorts = Array.isArray(data?.uart) ? data.uart : []
    this._state.canPorts = Array.isArray(data?.can) ? data.can : []
    this._emit('state', this.snapshot())
    return data
  }

  openUart(cfg) { return this.client.openUart(cfg) }
  closeUart() { return this.client.closeUart() }
  writeUartText(text) { return this.client.writeUartText(text) }
  writeUartHex(hex) { return this.client.writeUartHex(hex) }

  openCan(cfg) { return this.client.openCan(cfg) }
  closeCan() { return this.client.closeCan() }
  sendCan(frame) { return this.client.sendCan(frame) }

  testStartRxLog() { return this.client.testStartRxLog() }
  testStopRxLog() { return this.client.testStopRxLog() }
  testStartFakePlot(hz) { return this.client.testStartFakePlot(hz) }
  testStopFakePlot() { return this.client.testStopFakePlot() }
}
