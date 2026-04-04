export const IMPORTED_ASSET_TYPE = {
  id: 'importedasset',
  icon: '📦',
  label: 'ImportedAsset',
  color: '#7dd3fc',
  status: 'ok',
  desc: 'External asset',
}

export function createImportedAssetDisplay(asset) {
  const uid = asset.uid
  const label = asset.name || asset.fileName || `ImportedAsset-${uid}`

  return {
    uid,
    id: IMPORTED_ASSET_TYPE.id,
    icon: IMPORTED_ASSET_TYPE.icon,
    label,
    color: IMPORTED_ASSET_TYPE.color,
    status: IMPORTED_ASSET_TYPE.status,
    checked: asset.checked ?? true,
    pendingFile: !asset.fileName,
    params: {
      fileName: asset.fileName || '',
      assetType: asset.assetType || '',
      embeddedColor: !!asset.embeddedColor,
      colorMode: asset.embeddedColor ? 'embedded' : 'solid',
      color: '#d7f0ff',
      opacity: 1,
      pointSize: asset.isPointCloud ? 0.08 : 1,
      pointCount: asset.pointCount ?? 0,
      showAxes: asset.params?.showAxes ?? true,
      scale: 1,
      x: 0,
      y: 0,
      z: 0,
      rx: 0,
      ry: 0,
      rz: 0,
      isPointCloud: !!asset.isPointCloud,
    },
  }
}
