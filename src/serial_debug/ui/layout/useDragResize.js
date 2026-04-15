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
      if (!dragging.current) return
      onDelta(pos - start.current)
      start.current = pos
    }

    const onMouseMove = (e) => onMove(direction === 'h' ? e.clientX : e.clientY)
    const onPointerMove = (e) => onMove(direction === 'h' ? e.clientX : e.clientY)
    const onTouchMove = (e) => {
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
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopDrag)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', stopDrag)
    window.addEventListener('touchcancel', stopDrag)
    window.addEventListener('blur', stopDrag)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', stopDrag)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopDrag)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', stopDrag)
      window.removeEventListener('touchcancel', stopDrag)
      window.removeEventListener('blur', stopDrag)
    }
  }, [direction, onDelta])

  return { onPointerDown, onTouchStart }
}
