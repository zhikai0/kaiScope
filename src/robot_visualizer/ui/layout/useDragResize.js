import { useCallback, useEffect, useRef } from 'react'

export function useDragResize(direction, onDelta) {
  const dragging = useRef(false)
  const start    = useRef(0)

  const onMouseDown = useCallback((e) => {
    dragging.current = true
    start.current = direction === 'h' ? e.clientX : e.clientY
    e.preventDefault()
  }, [direction])

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return
      const pos = direction === 'h' ? e.clientX : e.clientY
      onDelta(pos - start.current)
      start.current = pos
    }
    const onUp = () => { dragging.current = false }
    const onTouchMove = (e) => {
      if (!dragging.current) return
      const pos = direction === 'h' ? e.touches[0].clientX : e.touches[0].clientY
      onDelta(pos - start.current)
      start.current = pos
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onUp)

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [direction, onDelta])

  return onMouseDown
}
