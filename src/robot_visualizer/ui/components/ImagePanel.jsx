/**
 * ImagePanel — 相机图像流面板
 * 参考 Foxglove Studio Image panel 风格
 * 接入 useRos 订阅图像 topic，显示实时帧
 */
import { useEffect, useRef, useState } from 'react'
import { useRos } from '../hooks/useRos'
import './ImagePanel.css'

export default function ImagePanel({ topic = '/camera/image_raw' }) {
  const canvasRef  = useRef(null)
  const [info, setInfo]   = useState(null)   // { width, height, encoding, stamp }
  const [fps,  setFps]    = useState(0)
  const [err,  setErr]    = useState(null)
  const fpsRef = useRef({ count: 0, last: Date.now() })

  const bumpFps = () => {
    const f = fpsRef.current
    f.count++
    const now = Date.now()
    if (now - f.last >= 1000) {
      setFps(f.count)
      f.count = 0
      f.last  = now
    }
  }

  const { status, subscribe } = useRos()
  const subscribeRef = useRef(subscribe)

  useEffect(() => {
    subscribeRef.current = subscribe
  }, [subscribe])

  useEffect(() => {
    if (status !== 'connected') { setErr('Waiting for Foxglove connection…'); return }
    setErr(null)

    const unsub = subscribeRef.current(topic, (msg) => {
      // msg may be raw bytes object if foxglove parser not installed
      // Try to render if it has width/height/data fields
      if (!msg || msg._raw) {
        setErr('Raw bytes received — install @foxglove/rosmsg2-serialization to decode')
        return
      }

      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')

      // sensor_msgs/CompressedImage
      if (msg.format && msg.data && !msg.width && !msg.height) {
        try {
          const bytes = msg.data instanceof Uint8Array ? msg.data : new Uint8Array(msg.data)
          const mime = (typeof msg.format === 'string' && msg.format.includes('png')) ? 'image/png' : 'image/jpeg'
          const blob = new Blob([bytes], { type: mime })
          const url = URL.createObjectURL(blob)
          const img = new Image()
          img.onload = () => {
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            ctx.drawImage(img, 0, 0)
            bumpFps()
            setInfo({ width: img.naturalWidth, height: img.naturalHeight, encoding: `compressed(${msg.format})` })
            URL.revokeObjectURL(url)
            setErr(null)
          }
          img.onerror = () => {
            URL.revokeObjectURL(url)
            setErr('Compressed image decode failed')
          }
          img.src = url
        } catch (e) {
          setErr(`Compressed image decode error: ${e.message}`)
        }
        return
      }

      const { width, height, encoding, data } = msg
      if (!width || !height || !data) { setErr('Invalid image message'); return }

      setInfo({ width, height, encoding })
      bumpFps()

      canvas.width  = width
      canvas.height = height

      // Convert raw bytes to ImageData
      try {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
        let imgData

        if (encoding === 'rgb8' || encoding === 'bgr8') {
          imgData = new ImageData(width, height)
          for (let i = 0, j = 0; i < bytes.length; i += 3, j += 4) {
            imgData.data[j]   = encoding === 'rgb8' ? bytes[i]   : bytes[i+2]
            imgData.data[j+1] = bytes[i+1]
            imgData.data[j+2] = encoding === 'rgb8' ? bytes[i+2] : bytes[i]
            imgData.data[j+3] = 255
          }
        } else if (encoding === 'rgba8') {
          imgData = new ImageData(new Uint8ClampedArray(bytes), width, height)
        } else if (encoding === 'mono8') {
          imgData = new ImageData(width, height)
          for (let i = 0, j = 0; i < bytes.length; i++, j += 4) {
            imgData.data[j] = imgData.data[j+1] = imgData.data[j+2] = bytes[i]
            imgData.data[j+3] = 255
          }
        } else if (encoding === 'mono16' || encoding === '16UC1') {
          imgData = new ImageData(width, height)
          for (let i = 0, j = 0; i + 1 < bytes.length && j < imgData.data.length; i += 2, j += 4) {
            const v16 = (bytes[i] | (bytes[i+1] << 8))
            const v8 = Math.max(0, Math.min(255, v16 >> 8))
            imgData.data[j] = imgData.data[j+1] = imgData.data[j+2] = v8
            imgData.data[j+3] = 255
          }
        } else if (encoding === '32FC1') {
          imgData = new ImageData(width, height)
          const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
          let min = Number.POSITIVE_INFINITY
          let max = 0
          const vals = new Float32Array(width * height)
          for (let p = 0; p < vals.length; p++) {
            const off = p * 4
            if (off + 3 >= bytes.byteLength) break
            const v = dv.getFloat32(off, true)
            vals[p] = Number.isFinite(v) && v > 0 ? v : 0
            if (vals[p] > 0) {
              if (vals[p] < min) min = vals[p]
              if (vals[p] > max) max = vals[p]
            }
          }
          const span = (max > min) ? (max - min) : 1
          for (let p = 0, j = 0; p < vals.length; p++, j += 4) {
            const norm = vals[p] > 0 ? (vals[p] - min) / span : 0
            const g = Math.max(0, Math.min(255, Math.round(norm * 255)))
            imgData.data[j] = imgData.data[j+1] = imgData.data[j+2] = g
            imgData.data[j+3] = 255
          }
        } else {
          setErr(`Unsupported encoding: ${encoding}`)
          return
        }
        ctx.putImageData(imgData, 0, 0)
        setErr(null)
      } catch (e) {
        setErr(`Render error: ${e.message}`)
      }
    })
    return () => { unsub && unsub() }
  }, [topic, status])

  return (
    <div className="img-panel">
      {/* HUD top-left */}
      <div className="img-hud-tl">
        <span className="img-topic">{topic}</span>
        {info && <span className="img-meta">{info.width}×{info.height} {info.encoding}</span>}
      </div>
      {/* FPS top-right */}
      {fps > 0 && <div className="img-hud-tr">{fps} fps</div>}

      {/* Canvas */}
      <canvas ref={canvasRef} className="img-canvas"/>

      {/* Error / placeholder overlay */}
      {(err || status !== 'connected') && (
        <div className="img-overlay">
          <div className="img-overlay-inner">
            <span className="img-overlay-icon">
              {status === 'connected' ? '⚠' : '🔌'}
            </span>
            <span className="img-overlay-msg">
              {status !== 'connected'
                ? `Foxglove ${status === 'connecting' ? 'connecting…' : 'disconnected'}`
                : err}
            </span>
            <span className="img-overlay-sub">{topic}</span>
          </div>
        </div>
      )}
    </div>
  )
}
