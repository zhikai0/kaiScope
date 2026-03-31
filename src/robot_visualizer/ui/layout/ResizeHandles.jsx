import { useDragResize } from './useDragResize'

export function HResizeHandle({ onDelta }) {
  const onDown = useDragResize('h', onDelta)
  return <div className="resize-h" onMouseDown={onDown} onTouchStart={onDown} />
}

export function VResizeHandle({ onDelta }) {
  const onDown = useDragResize('v', onDelta)
  return <div className="resize-v" onMouseDown={onDown} onTouchStart={onDown} />
}
