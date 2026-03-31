/**
 * RosDataManager — 话题订阅 / 数据分发层
 * 依赖 RosConnection，与 UI 完全解耦
 * 消息解析使用 Foxglove rosmsg2-serialization
 */

import { getTfManager } from './TfManager'
import { parse } from '@foxglove/rosmsg'
import { MessageReader, MessageWriter } from '@foxglove/rosmsg2-serialization'

export class RosDataManager extends EventTarget {
  constructor(connection) {
    super()
    /** @type {import('./RosConnection').RosConnection} */
    this.conn = connection

    // channel registry: channelId -> channel object
    this._channels = new Map()
    // active subscriptions: topic -> { channelId, subId, listeners: Set<fn> }
    this._subs = new Map()
    // subId -> topic (reverse lookup for incoming messages)
    this._subIdToTopic = new Map()
    // monotonic subscription id counter
    this._nextSubId = 1

    // TF state
    this.tfTree      = new Map()   // childFrame -> { parentFrame, translation, rotation }
    this.allFrames   = new Set()
    this._staticTF   = new Map()
    this._dynamicTF  = new Map()   // frame -> { ...transform, lastUpdate }

    this._bindConnectionEvents()
  }

  // ── Connection events ─────────────────────────────────────────────────

  _bindConnectionEvents() {
    this.conn.on('connect', () => {
      this._emit('connection', { status: 'connected' })
      // 重连后重置 cmd_vel 状态，强制重新 advertise
      this._cmdVelWriter = null
      this._cmdVelChanId = null
      this._resubscribeAll()
      this._autoSubscribeTF()
    })
    this.conn.on('disconnect', () => {
      this._emit('connection', { status: 'disconnected' })
    })
    this.conn.on('reconnecting', () => {
      this._emit('connection', { status: 'reconnecting' })
    })
    this.conn.on('error', ({ detail }) => {
      this._emit('connection', { status: 'error', error: detail?.error })
    })
    this.conn.on('advertise', ({ detail }) => {
      detail?.channels?.forEach(ch => this._channels.set(ch.id, ch))
      this._emit('channels', { channels: Array.from(this._channels.values()) })
      this._autoSubscribeTF()
    })
    this.conn.on('unadvertise', ({ detail }) => {
      detail?.channelIds?.forEach(id => this._channels.delete(id))
      this._emit('channels', { channels: Array.from(this._channels.values()) })
    })
    this.conn.on('message', ({ detail }) => {
      this._onBinaryMessage(detail)
    })
  }

  // ── Public API ────────────────────────────────────────────────────────

  /** Get list of all advertised channels */
  get channels() { return Array.from(this._channels.values()) }

  /**
   * Subscribe to a topic. Callback receives parsed message.
   * Multiple callbacks for the same topic share one WS subscription.
   * @param {string} topic
   * @param {function} callback  fn(parsedMsg, topic)
   * @returns {function} unsubscribe function
   */
  subscribe(topic, callback) {
    if (!this._subs.has(topic)) {
      this._subs.set(topic, { channelId: null, listeners: new Set() })
    }
    const entry = this._subs.get(topic)
    entry.listeners.add(callback)

    // If connected and channel available, send subscribe
    if (this.conn.isConnected && !entry.channelId) {
      this._sendSubscribe(topic)
    }

    return () => this.unsubscribe(topic, callback)
  }

  /**
   * Remove a single callback. If no callbacks remain, unsubscribe from WS.
   */
  unsubscribe(topic, callback) {
    const entry = this._subs.get(topic)
    if (!entry) return
    entry.listeners.delete(callback)
    if (entry.listeners.size === 0) {
      this._sendUnsubscribe(topic)
      this._subs.delete(topic)
    }
  }

  /** Subscribe to connection status changes */
  onConnection(fn) {
    this.on('connection', (e) => fn(e.detail))
  }

  /** Subscribe to channel list changes */
  onChannels(fn) {
    this.on('channels', (e) => fn(e.detail.channels))
  }

  /** Get all known TF frame IDs */
  getFrames() { return Array.from(this.allFrames) }

  /**
   * Publish geometry_msgs/Twist to /cmd_vel
   * CDR encoding via MessageWriter
   */
  publishCmdVel(linear = { x:0, y:0, z:0 }, angular = { x:0, y:0, z:0 }) {
    if (this.conn?.ws?.readyState !== WebSocket.OPEN) return

    // 已就绪，直接发
    if (this._cmdVelWriter && this._cmdVelChanId) {
      this._sendCmdVelCdr(linear, angular)
      return
    }

    // 首次：advertise + 构建 MessageWriter
    // /cmd_vel 是客户端发布话题，服务端不会 advertise 回来，需按 schemaName 查找同类型 channel 获取 schema
    const ch = Array.from(this._channels.values()).find(
      c => c.schemaName === 'geometry_msgs/msg/Twist' && c.schema
    )
    if (!ch?.schema) {
      console.warn('[RosDataManager] no Twist schema available yet, channels:', Array.from(this._channels.values()).map(c => c.topic))
      return
    }

    const chanId = this.conn.advertise({
      topic:      '/cmd_vel',
      encoding:   'cdr',
      schemaName: 'geometry_msgs/msg/Twist',
    })
    if (!chanId) return

    try {
      const msgDef = parse(ch.schema, { ros2: true })
      this._cmdVelWriter  = new MessageWriter(msgDef)
      this._cmdVelChanId  = chanId
      console.log('[RosDataManager] cmd_vel ready, chanId=', chanId, 'schema from topic:', ch.topic)
      this._sendCmdVelCdr(linear, angular)
    } catch(e) {
      console.warn('[RosDataManager] cmd_vel setup error', e)
    }
  }

  _sendCmdVelCdr(linear, angular) {
    const message = {
      linear:  { x: +(linear.x  ?? 0), y: 0, z: 0 },
      angular: { x: 0, y: 0, z: +(angular.z ?? 0) },
    }
    try {
      // MessageWriter.writeMessage() 已包含 CDR encapsulation header，直接发送即可
      const payload = this._cmdVelWriter.writeMessage(message)
      console.log('[RosDataManager] payload bytes:', Array.from(payload.slice(0, 20)).map(b => b.toString(16).padStart(2,'0')).join(' '))
      this.conn.sendMessage(this._cmdVelChanId, payload)
    } catch(e) {
      console.warn('[RosDataManager] _sendCmdVelCdr error', e)
    }
  }

  _doPublishCmdVel(linear, angular) { this.publishCmdVel(linear, angular) }

  // ── Internal: subscribe/unsubscribe wire ──────────────────────────────

  _sendSubscribe(topic) {
    const ch = Array.from(this._channels.values()).find(c => c.topic === topic)
    if (!ch) {
      console.debug(`[RosDataManager] channel not yet advertised for: ${topic}`)
      return  // channel not yet advertised; will retry on next advertise
    }

    const entry = this._subs.get(topic)
    if (!entry) return

    // If already subscribed with a valid subId, don't re-subscribe
    if (entry.subId) return

    const subId = this._nextSubId++
    entry.channelId = ch.id
    entry.subId = subId
    this._subIdToTopic.set(subId, topic)

    console.debug(`[RosDataManager] subscribing: ${topic} (subId=${subId}, channelId=${ch.id})`)
    this.conn.send({ op: 'subscribe', subscriptions: [{ id: subId, channelId: ch.id }] })
  }

  _sendUnsubscribe(topic) {
    const entry = this._subs.get(topic)
    if (!entry?.subId) return
    this._subIdToTopic.delete(entry.subId)
    this.conn.send({ op: 'unsubscribe',     subscriptionIds: [entry.subId] })
  }

  /** On reconnect, re-send all active subscriptions */
  _resubscribeAll() {
    for (const [topic, entry] of this._subs.entries()) {
      // Reset channelId and subId so _sendSubscribe will re-issue
      if (entry.subId) this._subIdToTopic.delete(entry.subId)
      entry.channelId = null
      entry.subId = null
      this._sendSubscribe(topic)
    }
  }

  /** Auto-subscribe TF topics whenever channels update */
  _autoSubscribeTF() {
    ['/tf', '/tf_static'].forEach(topic => {
      // Register listener if not already registered
      if (!this._subs.has(topic)) {
        this.subscribe(topic, (msg) => this._processTF(topic, msg))
      } else {
        // Entry exists but may not have channelId yet — retry send
        const entry = this._subs.get(topic)
        if (!entry.channelId && this.conn.isConnected) {
          this._sendSubscribe(topic)
        }
      }
    })
  }

  // ── Message dispatch ──────────────────────────────────────────────────

  _onBinaryMessage({ subscriptionId, data }) {
    const topic = this._subIdToTopic.get(subscriptionId)
    if (!topic) return
    const entry = this._subs.get(topic)
    if (!entry || entry.listeners.size === 0) return

    // Find channel for schema
    const ch = entry.channelId ? this._channels.get(entry.channelId) : null
    if (!ch) return

    this._parseAndDispatch(topic, ch, data, entry.listeners)
  }

  // Cache MessageReader per channelId to avoid re-parsing schema every message
  _getReader(ch) {
    if (!this._readers) this._readers = new Map()
    if (this._readers.has(ch.id)) return this._readers.get(ch.id)
    try {
      const reader = new MessageReader(parse(ch.schema, { ros2: true }))
      this._readers.set(ch.id, reader)
      return reader
    } catch (e) {
      console.warn('[RosDataManager] failed to build MessageReader for', ch.topic, e)
      return null
    }
  }

  _parseAndDispatch(topic, channel, data, listeners) {
    try {
      let msg
      if (channel.encoding === 'json') {
        msg = JSON.parse(new TextDecoder().decode(data))
      } else if (channel.encoding === 'ros2' || channel.encoding === 'cdr') {
        const reader = this._getReader(channel)
        if (reader) {
          msg = reader.readMessage(data)
        } else {
          msg = { _raw: data, _topic: topic, _schema: channel.schemaName }
        }
      } else {
        msg = data
      }
      listeners.forEach(fn => {
        try { fn(msg, topic) } catch (e) { console.error('[RosDataManager] listener error', e) }
      })
    } catch (e) {
      console.warn('[RosDataManager] parse error', topic, e)
    }
  }

  // ── TF processing ─────────────────────────────────────────────────────

  _processTF(topic, tfMsg) {
    const isStatic = topic === '/tf_static'
    const transforms = tfMsg?.transforms || []
    transforms.forEach(tf => {
      const child  = tf.child_frame_id
      const parent = tf.header?.frame_id || 'world'
      if (!child) return
      const entry = {
        parentFrame:  parent,
        childFrame:   child,
        translation:  tf.transform?.translation  || { x:0, y:0, z:0 },
        rotation:     tf.transform?.rotation     || { x:0, y:0, z:0, w:1 },
        lastUpdate:   Date.now(),
        isStatic,
      }
      this.tfTree.set(child, entry)
      this.allFrames.add(child)
      this.allFrames.add(parent)
      if (isStatic) this._staticTF.set(child, entry)
      else          this._dynamicTF.set(child, entry)
    })
    // Forward to TfManager singleton so UI TF tree stays in sync
    try { getTfManager().processTFMessage(tfMsg, isStatic) } catch (_) {}
    this._emit('tf', { tree: this.tfTree, frames: this.getFrames() })
  }

  // ── EventTarget helpers ───────────────────────────────────────────────
  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }
  on(type, fn)  { this.addEventListener(type, fn) }
  off(type, fn) { this.removeEventListener(type, fn) }
}
