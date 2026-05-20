import { useState, useEffect, useContext, createContext, useCallback } from 'react'

// ── Global state update notifier ───────────────────────────────────────────────
const UpdateContext = createContext(null)

// Provider component - wrap your app with this
export function PersistProvider({ children }) {
  const [version, setVersion] = useState(0)
  
  const notifyUpdate = useCallback(() => {
    setVersion(v => v + 1)
  }, [])
  
  return (
    <UpdateContext.Provider value={{ version, notifyUpdate }}>
      {children}
    </UpdateContext.Provider>
  )
}

function usePersistVersion() {
  const ctx = useContext(UpdateContext)
  return ctx ? ctx.version : 0
}

/**
 * useLocalPersist — 通用 localStorage 持久化 hook
 * 
 * 用法:
 *   const [value, setValue] = useLocalPersist('my-key', defaultValue)
 * 
 * 特性：
 * - 自动 JSON 序列化/反序列化
 * - 页面刷新后自动从 localStorage 恢复
 * - 状态更新会通知所有使用相同 key 的组件重新渲染
 */
export function useLocalPersist(key, defaultValue) {
  const persistVersion = usePersistVersion()
  
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored === null) return defaultValue
      return JSON.parse(stored)
    } catch {
      return defaultValue
    }
  })

  // Sync with localStorage on any update (from this or other components)
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (e) {
      console.warn(`[useLocalPersist] Failed to save "${key}":`, e)
    }
  }, [key, value])

  // Re-read from localStorage when another component updates the same key
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored !== null) {
        const parsed = JSON.parse(stored)
        if (JSON.stringify(parsed) !== JSON.stringify(value)) {
          setValue(parsed)
        }
      }
    } catch {}
  }, [key, persistVersion])

  return [value, setValue]
}

/**
 * useSessionPersist — 同上，但用 sessionStorage
 */
export function useSessionPersist(key, defaultValue) {
  const persistVersion = usePersistVersion()
  
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

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(key)
      if (stored !== null) {
        const parsed = JSON.parse(stored)
        if (JSON.stringify(parsed) !== JSON.stringify(value)) {
          setValue(parsed)
        }
      }
    } catch {}
  }, [key, persistVersion])

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
