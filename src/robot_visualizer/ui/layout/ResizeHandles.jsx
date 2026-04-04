import { useDragResize } from './useDragResize'

export function HResizeHandle({ onDelta }) {
  const { onPointerDown, onTouchStart } = useDragResize('h', onDelta)
  return <div className="resize-h-wrap" onMouseDown={onPointerDown} onTouchStart={onTouchStart}><div className="resize-h" /></div>
}

export function VResizeHandle({ onDelta }) {
  const { onPointerDown, onTouchStart } = useDragResize('v', onDelta)
  return <div className="resize-v-wrap" onMouseDown={onPointerDown} onTouchStart={onTouchStart}><div className="resize-v" /></div>
}
