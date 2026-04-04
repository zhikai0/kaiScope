import { IMPORTED_ASSET_TYPE } from './importedAssetDisplay'

const formatImportedAssetFileName = (name = '') => {
  if (!name) return 'Choose local file'
  if (name.length <= 17) return name
  return `${name.slice(0, 7)}...${name.slice(-7)}`
}

export function renderImportedAssetParams({ d, PR, PNum, PSelect, PColor, onParamChange, onPickFile }) {
  if (d.id !== IMPORTED_ASSET_TYPE.id) return null

  const p = d.params || {}
  const setNum = (key, fallback = 0) => (e) => {
    const value = parseFloat(e.target.value)
    onParamChange(key, Number.isFinite(value) ? value : fallback)
  }

  return (
    <>
      <PR label="File" indent={1}>
        <button className="lp-act-btn lp-file-btn" type="button" onClick={onPickFile} title={p.fileName || 'Choose local file'}>{formatImportedAssetFileName(p.fileName)}</button>
      </PR>
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
