import { IMPORTED_ASSET_TYPE } from './importedAssetDisplay'

export function renderImportedAssetParams({ d, PR, PNum, PSelect, PColor, onParamChange, onPickFile }) {
  if (d.id !== IMPORTED_ASSET_TYPE.id) return null

  const p = d.params || {}
  const setNum = (key, fallback = 0) => (e) => {
    const value = parseFloat(e.target.value)
    onParamChange(key, Number.isFinite(value) ? value : fallback)
  }

  const handleFileClick = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pcd,.ply,.stl,.obj'
    input.onchange = (e) => {
      const file = e.target.files?.[0]
      if (file) {
        onPickFile(file)
      }
      e.target.value = ''
    }
    input.click()
  }

  return (
    <>
      <div className="pr-row" style={{ paddingLeft: `calc(0.6rem + 1rem)` }}>
        <span className="pr-lbl">File</span>
        <div className="pr-ctrl">
          <div className="p-file-wrap">
            <div className="p-file-row">
              <input
                className="p-file-input"
                value={p.fileName || ''}
                placeholder="Select .pcd/.ply/.stl/.obj file"
                readOnly
              />
              <button className="p-file-btn" onClick={handleFileClick} title="Load file">···</button>
            </div>
          </div>
        </div>
      </div>
      <PR label="Type" indent={1}><span className="pr-txt">{p.assetType || '—'}</span></PR>
      <PR label="Axes" indent={1}>
        <span className={`di-chk-box ${p.showAxes ? 'chk-on' : ''}`}
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
            onParamChange('showAxes', !p.showAxes)
          }}
          onDoubleClick={e => {
            e.preventDefault()
            e.stopPropagation()
          }}>
          {p.showAxes ? '✔' : ''}
        </span>
      </PR>
      <PR label="Scale" indent={1}><PNum value={p.scale ?? 1} step={0.1} min={0.01} onChange={setNum('scale', 1)} /></PR>
      <PR label="Pos X" indent={1}><PNum value={p.x ?? 0} step={0.1} onChange={setNum('x', 0)} /></PR>
      <PR label="Pos Y" indent={1}><PNum value={p.y ?? 0} step={0.1} onChange={setNum('y', 0)} /></PR>
      <PR label="Pos Z" indent={1}><PNum value={p.z ?? 0} step={0.1} onChange={setNum('z', 0)} /></PR>
      <PR label="Rot X" indent={1}><PNum value={p.rx ?? 0} step={1} onChange={setNum('rx', 0)} /></PR>
      <PR label="Rot Y" indent={1}><PNum value={p.ry ?? 0} step={1} onChange={setNum('ry', 0)} /></PR>
      <PR label="Rot Z" indent={1}><PNum value={p.rz ?? 0} step={1} onChange={setNum('rz', 0)} /></PR>
      <PR label="Opacity" indent={1}><PNum value={p.opacity ?? 1} step={0.05} min={0} max={1} onChange={setNum('opacity', 1)} /></PR>
      <PR label="Color Mode" indent={1}>
        <PSelect value={p.colorMode || (p.embeddedColor ? 'embedded' : 'solid')} onChange={e => onParamChange('colorMode', e.target.value)}>
          <option value="embedded" disabled={!p.embeddedColor}>Embedded</option>
          <option value="solid">Solid</option>
        </PSelect>
      </PR>
      {p.colorMode === 'solid' && <PColor label="Color" indent={1} defaultHex={p.color || '#d7f0ff'} onChange={v => onParamChange('color', v)} />}
      {p.isPointCloud && <PR label="Point Size" indent={1}><PNum value={p.pointSize ?? 0.08} step={0.01} min={0.001} max={1.5} onChange={setNum('pointSize', 0.08)} /></PR>}
    </>
  )
}
