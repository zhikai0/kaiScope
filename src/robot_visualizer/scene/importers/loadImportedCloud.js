import * as THREE from 'three'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { PCDLoader } from 'three/examples/jsm/loaders/PCDLoader.js'

function hasVertexColors(object) {
  const colorAttr = object?.geometry?.getAttribute?.('color')
  return !!colorAttr && colorAttr.count > 0
}

function getPointCount(object) {
  return object?.geometry?.getAttribute?.('position')?.count || 0
}

function sanitizeGeometryPositions(geometry) {
  const position = geometry?.getAttribute?.('position')
  if (!position) return { validCount: 0, invalidCount: 0 }

  let validCount = 0
  let invalidCount = 0

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      validCount += 1
      continue
    }
    position.setXYZ(i, 0, 0, 0)
    invalidCount += 1
  }

  if (invalidCount > 0) position.needsUpdate = true
  return { validCount, invalidCount }
}

function updateGeometryBounds(geometry) {
  const position = geometry?.getAttribute?.('position')
  if (!position || position.count === 0) {
    geometry.boundingBox = null
    geometry.boundingSphere = null
    return { validCount: 0 }
  }

  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  let validCount = 0

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    min.x = Math.min(min.x, x)
    min.y = Math.min(min.y, y)
    min.z = Math.min(min.z, z)
    max.x = Math.max(max.x, x)
    max.y = Math.max(max.y, y)
    max.z = Math.max(max.z, z)
    validCount += 1
  }

  if (validCount === 0) {
    geometry.boundingBox = null
    geometry.boundingSphere = null
    return { validCount: 0 }
  }

  geometry.boundingBox = new THREE.Box3(min.clone(), max.clone())
  const center = min.clone().add(max).multiplyScalar(0.5)
  let radiusSq = 0
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    const dx = x - center.x
    const dy = y - center.y
    const dz = z - center.z
    radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz)
  }
  geometry.boundingSphere = new THREE.Sphere(center, Math.sqrt(radiusSq))
  return { validCount }
}

function sanitizeImportedObject(object) {
  let validCount = 0
  let invalidCount = 0

  object?.traverse?.((node) => {
    if (!node.geometry) return
    const stats = sanitizeGeometryPositions(node.geometry)
    invalidCount += stats.invalidCount
    validCount += updateGeometryBounds(node.geometry).validCount
  })

  if (invalidCount > 0) {
    console.warn(`[loadImportedCloud] sanitized ${invalidCount} invalid position values`)
  }

  if (validCount === 0) {
    throw new Error('Imported file has no finite vertex positions')
  }
}

function fitImportedObjectToUnitFootprint(object) {
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return 1
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6)
  const autoScale = maxDim > 10 ? 10 / maxDim : 1
  if (autoScale !== 1) object.scale.multiplyScalar(autoScale)
  return autoScale
}

const getImportedCloudMaterial = (isPoints = true) => {
  if (isPoints) {
    return new THREE.PointsMaterial({
      size: 0.08,
      sizeAttenuation: true,
      color: 0xd7f0ff,
      vertexColors: true,
    })
  }

  return new THREE.MeshStandardMaterial({
    color: 0xcfe8ff,
    metalness: 0.05,
    roughness: 0.85,
    vertexColors: true,
  })
}

const centerImportedObject = (object) => {
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return

  const center = box.getCenter(new THREE.Vector3())
  object.position.sub(center)

  const shiftedBox = new THREE.Box3().setFromObject(object)
  const minY = shiftedBox.min.y
  if (Number.isFinite(minY)) object.position.y -= minY
}

export async function loadImportedCloud(file) {
  const name = file?.name || ''
  const lower = name.toLowerCase()
  if (!lower.endsWith('.ply') && !lower.endsWith('.pcd')) return null

  const buffer = await file.arrayBuffer()
  let object = null

  if (lower.endsWith('.ply')) {
    const geometry = new PLYLoader().parse(buffer)
    sanitizeGeometryPositions(geometry)
    updateGeometryBounds(geometry)
    if (!geometry.getAttribute('normal') && geometry.index) geometry.computeVertexNormals?.()
    const hasFaces = !!geometry.index || geometry.getAttribute('normal')?.count > 0
    object = hasFaces
      ? new THREE.Mesh(geometry, getImportedCloudMaterial(false))
      : new THREE.Points(geometry, getImportedCloudMaterial(true))
  } else {
    object = new PCDLoader().parse(buffer)
    if (object.material) {
      object.material.size = 0.08
      object.material.sizeAttenuation = true
    }
  }

  if (!object) return null

  sanitizeImportedObject(object)

  object.traverse?.((node) => {
    if (node.material && !Array.isArray(node.material)) {
      node.userData._embeddedVertexColors = !!node.material.vertexColors
    }
  })

  object.name = name
  fitImportedObjectToUnitFootprint(object)
  centerImportedObject(object)
  object.userData.importedAsset = {
    fileName: name,
    assetType: lower.endsWith('.pcd') ? 'pcd' : 'ply',
    embeddedColor: hasVertexColors(object),
    isPointCloud: !!object.isPoints,
    pointCount: getPointCount(object),
    basePosition: object.position.clone(),
    autoScale: object.scale.x,
  }
  return object
}
