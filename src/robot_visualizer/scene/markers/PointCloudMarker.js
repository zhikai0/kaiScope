import * as THREE from 'three'
import { BaseMarker } from './BaseMarker'

export class PointCloudMarker extends BaseMarker {
  static get TYPE() { return 'pointcloud' }

  static get ROS_MSG_TYPES() {
    return [
      'sensor_msgs/msg/PointCloud2',
      'sensor_msgs/PointCloud2',
      '__preprocessed__',
    ]
  }

  _build() {
    this._geometry = new THREE.BufferGeometry()
    this._material = new THREE.PointsMaterial({
      color: this.options.color || '#66ccff',
      size: this.options.size ?? 0.04,
      sizeAttenuation: true,
      transparent: true,
      opacity: this.options.alpha ?? 1,
      depthWrite: true,
    })
    this._points = new THREE.Points(this._geometry, this._material)
    this.root.add(this._points)
  }

  update(data) {
    const points = this._extractPoints(data)
    if (!points || points.length === 0) {
      this._geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
      return
    }

    const arr = new Float32Array(points.length * 3)
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      arr[i * 3] = p.x ?? 0
      arr[i * 3 + 1] = p.y ?? 0
      arr[i * 3 + 2] = p.z ?? 0
    }

    this._geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    this._geometry.computeBoundingSphere()
  }

  _extractPoints(data) {
    if (!data) return null
    if (Array.isArray(data.points)) return data.points

    const fields = data.fields || []
    const pointStep = data.point_step || data.pointStep
    const width = data.width || 0
    const height = data.height || 1
    const raw = data.data

    if (!fields.length || !pointStep || !raw) return null

    const xField = fields.find(f => f.name === 'x')
    const yField = fields.find(f => f.name === 'y')
    const zField = fields.find(f => f.name === 'z')
    if (!xField || !yField || !zField) return null

    let bytes
    if (typeof raw === 'string') {
      const bin = atob(raw)
      bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    } else if (raw instanceof Uint8Array) {
      bytes = raw
    } else if (Array.isArray(raw)) {
      bytes = new Uint8Array(raw)
    } else {
      return null
    }

    const littleEndian = !(data.is_bigendian || data.isBigEndian)
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const count = Math.floor((width * height) || (bytes.byteLength / pointStep))

    const points = []
    for (let i = 0; i < count; i++) {
      const base = i * pointStep
      if (base + Math.max(xField.offset, yField.offset, zField.offset) + 4 > bytes.byteLength) break

      const x = dv.getFloat32(base + xField.offset, littleEndian)
      const y = dv.getFloat32(base + yField.offset, littleEndian)
      const z = dv.getFloat32(base + zField.offset, littleEndian)
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        points.push({ x, y, z })
      }
    }

    return points
  }

  setStyle({ color, size, alpha } = {}) {
    if (color !== undefined) this._material.color.set(color)
    if (size !== undefined) this._material.size = size
    if (alpha !== undefined) {
      this._material.opacity = alpha
      this._material.transparent = alpha < 1
    }
    this._material.needsUpdate = true
  }

  dispose() {
    this._geometry?.dispose()
    this._material?.dispose()
    super.dispose()
  }
}
