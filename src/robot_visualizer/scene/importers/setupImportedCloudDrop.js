import { loadImportedCloud } from './loadImportedCloud.js'
import { upsertImportedAsset } from './importedAssetStore.js'

const createImportedAssetUid = () => `importedasset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export async function importLocalAssetFile(file, uid = createImportedAssetUid(), options = {}) {
  if (!file) return null
  const object = await loadImportedCloud(file)
  if (!object) return null

  object.userData.importedAsset = {
    ...(object.userData.importedAsset || {}),
    uid,
  }

  upsertImportedAsset({
    uid,
    name: object.name,
    fileName: object.userData.importedAsset.fileName,
    assetType: object.userData.importedAsset.assetType,
    embeddedColor: object.userData.importedAsset.embeddedColor,
    isPointCloud: object.userData.importedAsset.isPointCloud,
    pointCount: object.userData.importedAsset.pointCount,
    visible: options.visible,
    sourceObject: object,
    params: options.params,
  })

  return { uid, object }
}

export function setupImportedCloudDrop({ element, onImportFile }) {
  if (!element || !onImportFile) return () => {}

  const importFile = async (file) => {
    try {
      await onImportFile(file)
    } catch (error) {
      console.error(`[Viewport3D] failed to import ${file?.name || 'file'}:`, error)
    }
  }

  const handleDragOver = (event) => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    element.classList.add('vp-drop-active')
  }

  const handleDragLeave = (event) => {
    if (!element.contains(event.relatedTarget)) element.classList.remove('vp-drop-active')
  }

  const handleDrop = async (event) => {
    event.preventDefault()
    element.classList.remove('vp-drop-active')
    const files = Array.from(event.dataTransfer?.files || [])
    for (const file of files) {
      await importFile(file)
    }
  }

  element.addEventListener('dragover', handleDragOver)
  element.addEventListener('dragleave', handleDragLeave)
  element.addEventListener('drop', handleDrop)

  return () => {
    element.classList.remove('vp-drop-active')
    element.removeEventListener('dragover', handleDragOver)
    element.removeEventListener('dragleave', handleDragLeave)
    element.removeEventListener('drop', handleDrop)
  }
}
