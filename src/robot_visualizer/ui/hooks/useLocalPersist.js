/**
 * useLocalPersist — 通用 localStorage 持久化 hook
 *
 * 用法:
 *   const [value, setValue] = useLocalPersist('my-key', defaultValue)
 *
 * 支持自动 JSON 序列化/反序列化。
 * 页面刷新后自动从 localStorage 恢复值。
 * 首次访问时若 localStorage 无值则用 defaultValue 初始化。
 */
import { useState, useEffect } from 'react'

export function useLocalPersist(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored === null) return defaultValue
      return JSON.parse(stored)
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (e) {
      console.warn(`[useLocalPersist] Failed to save "${key}":`, e)
    }
  }, [key, value])

  return [value, setValue]
}

/**
 * useSessionPersist — 同上，但用 sessionStorage
 * 标签页关闭后丢失，适合临时恢复（如浏览器刷新后恢复输入内容）
 */
export function useSessionPersist(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = sessionStorage.getItem(key)
      if (stored === null) return defaultValue
      return JSON.parse(stored)
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value))
    } catch (e) {
      console.warn(`[useSessionPersist] Failed to save "${key}":`, e)
    }
  }, [key, value])

  return [value, setValue]
}

/**
 * 清除某个缓存键
 */
export function clearPersist(key) {
  try {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  } catch {}
}
