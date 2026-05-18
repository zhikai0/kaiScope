/**
 * useRos — React hook for consuming RosConnection + RosDataManager
 *
 * Usage:
 *   const { status, channels, subscribe } = useRos()
 *
 *   useEffect(() => {
 *     const unsub = subscribe('/scan', (msg) => console.log(msg))
 *     return unsub
 *   }, [subscribe])
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { RosConnection } from '../../data/RosConnection'
import { RosDataManager } from '../../data/RosDataManager'
import { dispatchConnectionChange } from '../../manager/SceneCommandBus'

// Singleton instances — shared across all components
let _conn = null
let _mgr  = null

function getInstances(url) {
  if (!_conn) {
    // 如果没传 url，尝试从 localStorage 读取
    const savedUrl = _getSavedWsUrl()
    _conn = new RosConnection(url ?? savedUrl ?? undefined)
    _mgr  = new RosDataManager(_conn)
  }
  return { conn: _conn, mgr: _mgr }
}

function _getSavedWsUrl() {
  try {
    return localStorage.getItem('kaiscope-ws-url') || ''
  } catch { return '' }
}

export function getSavedWsUrl() {
  return _getSavedWsUrl()
}

export function getSharedMgr() {
  return getInstances(undefined).mgr
}

export function getSharedConn() {
  return _conn
}

export function reconnectWithUrl(url) {
  if (_conn) {
    _conn.disconnect()
    _conn = null
    _mgr = null
  }
  // 切换连接前清空缓存
  dispatchConnectionChange()
  getInstances(url || undefined)
  return { conn: _conn, mgr: _mgr }
}

/**
 * @param {string} [url]  ws://host:8765  (defaults to current host)
 */
export function useRos(url) {
  const { conn, mgr } = getInstances(url)

  const [status,   setStatus]   = useState('disconnected')
  const [channels, setChannels] = useState([])
  const [frames,   setFrames]   = useState([])

  useEffect(() => {
    const onConn = (e) => setStatus(e.detail.status)
    const onCh   = (e) => setChannels(e.detail.channels)
    const onTf   = (e) => setFrames(e.detail.frames)

    mgr.on('connection', onConn)
    mgr.on('channels',   onCh)
    mgr.on('tf',         onTf)

    // Start connection if not already
    if (!conn.isConnected && !conn.isConnecting) {
      conn.connect()
    } else {
      setStatus(conn.isConnected ? 'connected' : 'connecting')
      setChannels(mgr.channels)
    }

    return () => {
      mgr.off('connection', onConn)
      mgr.off('channels',   onCh)
      mgr.off('tf',         onTf)
    }
  }, [conn, mgr])

  /**
   * Subscribe to a ROS topic.
   * Returns an unsubscribe function (use in useEffect cleanup).
   */
  const subscribe = useCallback((topic, callback) => {
    return mgr.subscribe(topic, callback)
  }, [mgr])

  const connect    = useCallback(() => conn.connect(),    [conn])
  const disconnect = useCallback(() => conn.disconnect(), [conn])

  return {
    /** 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error' */
    status,
    /** Array of advertised channel objects */
    channels,
    /** Array of TF frame IDs */
    frames,
    /** subscribe(topic, fn) => unsubFn */
    subscribe,
    connect,
    disconnect,
    /** Direct refs if needed */
    conn,
    mgr,
  }
}
