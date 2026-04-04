import { useCallback, useEffect, useRef } from 'react'

export function useDragResize(direction, onDelta) {
  const dragging = useRef(false)
  const start = useRef(0)

  const beginDrag = useCallback((pos) => {
    dragging.current = true
    start.current = pos
  }, [])

  const onPointerDown = useCallback((e) => {
    beginDrag(direction === 'h' ? e.clientX : e.clientY)
    e.preventDefault()
  }, [beginDrag, direction])

  const onTouchStart = useCallback((e) => {
    const touch = e.touches?.[0]
    if (!touch) return
    beginDrag(direction === 'h' ? touch.clientX : touch.clientY)
    e.preventDefault()
  }, [beginDrag, direction])

  useEffect(() => {
    const onMove = (pos) => {
      onDelta(pos - start.current)
      start.current = pos
    }

    const onMouseMove = (e) => {
      if (!dragging.current) return
      onMove(direction === 'h' ? e.clientX : e.clientY)
    }

    const onTouchMove = (e) => {
      if (!dragging.current) return
      const touch = e.touches?.[0]
      if (!touch) return
      onMove(direction === 'h' ? touch.clientX : touch.clientY)
      e.preventDefault()
    }

    const stopDrag = () => {
      dragging.current = false
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', stopDrag)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', stopDrag)
    window.addEventListener('touchcancel', stopDrag)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', stopDrag)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', stopDrag)
      window.removeEventListener('touchcancel', stopDrag)
    }
  }, [direction, onDelta])

  return { onPointerDown, onTouchStart }
}
