import { useEffect, useRef, useState } from 'react'

export function PanelCell({
  ptype,
  panelNode,
  panelTypes,
  canClose,
  hideHeader,
  onSplitH,
  onSplitV,
  onClose,
  onChangeType,
  renderPanel,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef(null)
  const pt = panelTypes.find(x => x.id === ptype) || panelTypes[0]

  useEffect(() => {
    if (!menuOpen) return
    const onDocDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [menuOpen])

  return (
    <div className={`pcell ${ptype === '__empty__' ? 'pcell-empty' : ''}`} ref={wrapRef}>
      {!hideHeader && (
        <div className="pcell-hdr">
          <span className="pcell-title">{pt.icon} {pt.label}</span>
          <div className="pcell-actions">
            <button className="pcell-btn" title="Split right" onClick={onSplitH}>⊞</button>
            <button className="pcell-btn" title="Split down" onClick={onSplitV}>⊟</button>
            <button className="pcell-btn" title="Change type" onClick={() => setMenuOpen(v => !v)}>⋯</button>
            {canClose && <button className="pcell-btn close" title="Close" onClick={onClose}>✕</button>}
          </div>
          {menuOpen && (
            <div className="pcell-menu" onMouseDown={e => e.stopPropagation()}>
              {panelTypes.map(p => (
                <button
                  key={p.id}
                  className={`pcell-menu-item ${ptype === p.id ? 'active' : ''}`}
                  onClick={() => { onChangeType(p.id); setMenuOpen(false) }}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="pcell-body" onClick={menuOpen ? () => setMenuOpen(false) : undefined}>
        {renderPanel(ptype, pt, panelNode)}
      </div>
    </div>
  )
}
