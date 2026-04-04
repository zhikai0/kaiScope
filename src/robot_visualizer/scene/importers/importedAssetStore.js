import { SceneCommandBus } from '../../manager/SceneCommandBus'

const defaultParamsForAsset = (asset = {}) => ({
  scale: 1,
  x: 0,
  y: 0,
  z: 0,
  rx: 0,
  ry: 0,
  rz: 0,
  opacity: 1,
  colorMode: asset.embeddedColor ? 'embedded' : 'solid',
  color: '#d7f0ff',
  pointSize: asset.isPointCloud ? 0.08 : 1,
  showAxes: true,
})

const defaultCheckedForAsset = (asset = {}) => asset.visible ?? true

class ImportedAssetStore extends EventTarget {
  constructor() {
    super()
    this._assets = new Map()
  }

  _emit() {
    const assets = Array.from(this._assets.values())
    this.dispatchEvent(new CustomEvent('change', { detail: assets }))
  }

  onChange(fn) {
    const handler = (event) => fn(event.detail)
    this.addEventListener('change', handler)
    return () => this.removeEventListener('change', handler)
  }

  getAssets() {
    return Array.from(this._assets.values())
  }

  getAsset(uid) {
    return this._assets.get(uid) || null
  }

  upsertAsset(asset) {
    const prev = this._assets.get(asset.uid)
    const nextVersion = (prev?.version || 0) + 1
    const next = {
      ...prev,
      ...asset,
      version: asset.version ?? nextVersion,
      params: {
        ...defaultParamsForAsset(asset),
        ...(prev?.params || {}),
        ...(asset.params || {}),
      },
      visible: asset.visible ?? prev?.visible ?? true,
      checked: asset.checked ?? prev?.checked ?? defaultCheckedForAsset(asset),
    }
    this._assets.set(asset.uid, next)
    this._emit()
    return next
  }

  updateParams(uid, patch) {
    const prev = this._assets.get(uid)
    if (!prev) return null
    const next = {
      ...prev,
      params: { ...prev.params, ...patch },
    }
    this._assets.set(uid, next)
    this._emit()
    return next
  }

  updateVisible(uid, visible) {
    const prev = this._assets.get(uid)
    if (!prev) return null
    const next = { ...prev, visible }
    this._assets.set(uid, next)
    this._emit()
    return next
  }

  removeAsset(uid) {
    if (!this._assets.has(uid)) return
    this._assets.delete(uid)
    this._emit()
  }
}

const store = new ImportedAssetStore()

SceneCommandBus.on('scene:importedasset:remove', (event) => {
  store.removeAsset(event.detail?.uid)
})

export function getImportedAssetStore() {
  return store
}

export function upsertImportedAsset(asset) {
  return store.upsertAsset(asset)
}

export function updateImportedAssetParams(uid, patch) {
  return store.updateParams(uid, patch)
}

export function setImportedAssetVisible(uid, visible) {
  return store.updateVisible(uid, visible)
}

export function setImportedAssetChecked(uid, checked) {
  const prev = store.getAsset(uid)
  if (!prev) return null
  return store.upsertAsset({ uid, checked, visible: checked })
}

export function removeImportedAsset(uid) {
  return store.removeAsset(uid)
}
