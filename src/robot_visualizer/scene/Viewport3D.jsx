import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CameraViews } from './views/CameraViews.js'
import { useSimStore } from '../ui/store/simStore'
import { useMapStore } from '../ui/store/mapStore'
import { SceneCommandBus } from '../manager/SceneCommandBus'
import { MarkerManager } from './markers'
import { createRosRoot } from './CoordSystem'
import { MapLayer } from './map/MapLayer'
import { getTfManager } from '../data/TfManager'
import { getTfDisplayManager } from '../manager/TfDisplayManager'
import './Viewport3D.css'

export default function Viewport3D() {
  const mountRef = useRef(null)
  const refs     = useRef({})

  const trajectory    = useSimStore(s => s.trajectory)
  const historyPath   = useSimStore(s => s.historyPath)
  const visualization = useSimStore(s => s.visualization)
  const mapEnabled    = useMapStore(s => s.mapEnabled)
  const mapOpacity    = useMapStore(s => s.mapOpacity)
  const longitude     = useMapStore(s => s.longitude)
  const latitude      = useMapStore(s => s.latitude)
  const zoom          = useMapStore(s => s.zoom)

  // ── Init scene ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current
    if (!el) return

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.setClearColor(0x303030)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.LinearToneMapping
    renderer.toneMappingExposure = 1.0
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x303030)

    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.05, 50000)
    camera.position.set(0, 18, 18)
    camera.lookAt(0, 0, 0)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 0.5
    controls.maxDistance = 5000      // 最远 5km
    controls.maxPolarAngle = Math.PI / 2 - 0.01  // 严格不低于 XY 平面
    controls.zoomSpeed = 1.2

    // Lights
    scene.add(new THREE.AmbientLight(0xdde8ff, 1.0))
    scene.add(new THREE.HemisphereLight(0xe8f0ff, 0xd0d8f0, 0.6))
    const sun = new THREE.DirectionalLight(0xffffff, 2.2)
    sun.position.set(12, 24, 10)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 0.5
    sun.shadow.camera.far = 100
    sun.shadow.camera.left = -22
    sun.shadow.camera.right = 22
    sun.shadow.camera.top = 22
    sun.shadow.camera.bottom = -22
    sun.shadow.radius = 4
    sun.shadow.bias = -0.0005
    scene.add(sun)
    const fillLight = new THREE.DirectionalLight(0xaac8ff, 0.5)
    fillLight.position.set(-8, 10, -10)
    scene.add(fillLight)

    // ── MapLayer 组件（9宫格地图贴图管理，替代旧 ground mesh） ────────
    const mapLayer = new MapLayer(scene)

    // ── Grid overlay (RViz style: single layer, grey, alpha 0.5) ──────────
    const GRID_COLOR = 0xa0a0a4  // 160:160:164
    const gridMaj = new THREE.GridHelper(10, 10, GRID_COLOR, GRID_COLOR)
    gridMaj.position.y = 0.01
    gridMaj.material.opacity = 0.5
    gridMaj.material.transparent = true
    scene.add(gridMaj)
    // THREE.AxesHelper 已由 AxesMarker 系统替代，此处不再添加

    // ── ROS 根节点（Z-up → Y-up 坐标系变换） ─────────────────────────
    const rosRoot = createRosRoot(scene)

    // 路径 / 历史轨迹 group（保留，用于 path display）
    const trajGroup = new THREE.Group()
    const histGroup = new THREE.Group()
    rosRoot.add(trajGroup, histGroup)

    // ── Marker 管理器（挂在 rosRoot 下，自动享受坐标系变换） ──────────
    const markerManager = new MarkerManager(rosRoot)

    // ── CameraViews ──────────────────────────────────────────────────
    const cameraViews = new CameraViews(camera, controls, scene)

    refs.current = { renderer, scene, camera, controls, trajGroup, histGroup, gridMaj, gridMin: null, markerManager, rosRoot, mapLayer, _gridCount: 10, _gridCellSize: 1, cameraViews }

    // ── Animation loop ───────────────────────────────────────────────────
    let animId
    const animate = () => {
      animId = requestAnimationFrame(animate)
      controls.update()
      refs.current.cameraViews?.update()
      // 9宫格地图：根据 rosRoot 的当前位置驱动瓦片滚动
      const rr = refs.current.rosRoot
      if (rr && refs.current.mapLayer) {
        const p = new THREE.Vector3()
        rr.getWorldPosition(p)
        refs.current.mapLayer.tick({ x: p.x, y: -p.z })  // Three.js Z-up→Y: rosRoot z=-y
      }
      // ── URDF 模型跟随 base_link TF 绝对位姿 ─────────────────────────
      // URDFModel._root 挂在 rosRoot 下，直接用 ROS 坐标值，rosRoot 负责坐标系变换
      const urdfModels = refs.current._urdfModels
      if (urdfModels && urdfModels.size > 0) {
        const tfMgr      = getTfManager()
        const fixedFrame = getTfDisplayManager().fixedFrame || 'map'
        urdfModels.forEach((model) => {
          if (!model.isLoaded) return
          const tf = tfMgr.lookupTransform(fixedFrame, 'base_link')
          if (!tf) return
          const { translation: t, rotation: q } = tf
          // 直接用 ROS 原始值（rosRoot 已做 Z-up→Y-up 变换）
          model._root.position.set(t.x, t.y, t.z)
          model._root.quaternion.set(q.x, q.y, q.z, q.w)
        })
      }
      renderer.render(scene, camera)
    }
    animate()

    // ── ResizeObserver for responsive canvas ─────────────────────────────
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      const h = el.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    ro.observe(el)

    // ── FPS display (optional) ───────────────────────────────────────────
    const fpsEl = document.createElement('div')
    fpsEl.style.cssText = 'position:absolute;top:10px;left:10px;color:#0f0;font-family:monospace;font-size:12px;pointer-events:none;z-index:100'
    el.appendChild(fpsEl)

    // ── Register SceneCommandBus handlers ────────────────────────────────
    const unregs = [
      SceneCommandBus.register('scene:background', ({ color }) => {
        const hex = new THREE.Color(color)
        scene.background.set(hex)
        if (scene.fog) { scene.fog.color.set(hex) }
        renderer.setClearColor(hex)
        refs.current._bgColor = color
      }),
      SceneCommandBus.register('scene:grid:color', ({ color }) => {
        const c = new THREE.Color(color)
        const g = refs.current.gridMaj
        if (g) { g.material.color.set(c); g.material.needsUpdate = true }
      }),
      SceneCommandBus.register('scene:grid:alpha', ({ alpha }) => {
        const g = refs.current.gridMaj
        if (g) { g.material.opacity = Math.max(0, Math.min(1, alpha)); g.material.needsUpdate = true }
      }),
      SceneCommandBus.register('scene:grid:count', ({ count }) => {
        const cur = refs.current.gridMaj
        const cellSize = refs.current._gridCellSize ?? 1
        const divisions = Math.max(1, Math.min(500, count))
        const totalSize = cellSize * divisions
        const opacity = cur?.material.opacity ?? 0.5
        const color   = cur?.material.color?.getHex() ?? 0xa0a0a4
        if (cur) scene.remove(cur)
        const newGrid = new THREE.GridHelper(totalSize, divisions, color, color)
        newGrid.position.y = 0.01
        newGrid.material.opacity = opacity
        newGrid.material.transparent = true
        scene.add(newGrid)
        refs.current.gridMaj = newGrid
        refs.current._gridCount = divisions
      }),
      SceneCommandBus.register('scene:grid:size', ({ size }) => {
        const cur = refs.current.gridMaj
        const s = Math.max(0.1, size)
        const divisions = refs.current._gridCount ?? 10
        const totalSize = s * divisions
        const opacity = cur?.material.opacity ?? 0.5
        const color   = cur?.material.color?.getHex() ?? 0xa0a0a4
        if (cur) scene.remove(cur)
        const newGrid = new THREE.GridHelper(totalSize, divisions, color, color)
        newGrid.position.y = 0.01
        newGrid.material.opacity = opacity
        newGrid.material.transparent = true
        scene.add(newGrid)
        refs.current.gridMaj = newGrid
        refs.current._gridCellSize = s
      }),
      SceneCommandBus.register('scene:grid:visible', ({ visible }) => {
        const g = refs.current.gridMaj
        if (g) g.visible = visible
      }),
      SceneCommandBus.register('scene:fps', ({ fps }) => {
        refs.current.targetFps = fps
      }),
      // Display toggle: show/hide named groups
      SceneCommandBus.register('scene:display:toggle', ({ uid, visible }) => {
        // uid format: 'grid-1', 'path-1', 'tf-1', etc.
        const id = uid.replace(/-\d+$/, '')
        const r  = refs.current
        if (id === 'grid')       { if (r.gridMaj) r.gridMaj.visible = visible }
        else if (id === 'path')  { if (r.trajGroup)  r.trajGroup.visible  = visible }
        else if (id === 'history'){ if (r.histGroup)  r.histGroup.visible  = visible }
        else if (id === 'robotmodel' || id === 'tf') {
          // robot model / tf: marker 可见性由 TfDisplayManager 管理
        }
        else if (id === 'axes')  {
          r.scene?.traverse(obj => { if (obj.isAxesHelper) obj.visible = visible })
        }
      }),

      // ── Path rendering（通过 MarkerManager 管理 PathMarker）────────
      SceneCommandBus.register('scene:path:update', ({ uid, points, color, alpha, lineStyle }) => {
        const r = refs.current
        if (!r.markerManager) return
        const key = uid ? `path_${uid}` : 'path_default'
        if (!points?.length) {
          r.markerManager.remove(key)
          return
        }
        // 确保 PathMarker 存在（选项变化时重建）
        if (!r.markerManager.get(key)) {
          r.markerManager.set(key, 'path', '__preprocessed__', {
            color: color || '#4fc3f7',
            alpha: alpha ?? 1,
            lineStyle: lineStyle || 'solid',
          })
        } else {
          // 更新样式
          r.markerManager.get(key)?.setStyle?.({ color, alpha, lineStyle })
        }
        r.markerManager.update(key, { points })
      }),

      SceneCommandBus.register('scene:path:color', ({ color, uid }) => {
        const key = uid ? `path_${uid}` : 'path_default'
        refs.current.markerManager?.get(key)?.setStyle?.({ color })
      }),
      SceneCommandBus.register('scene:path:alpha', ({ alpha, uid }) => {
        const key = uid ? `path_${uid}` : 'path_default'
        refs.current.markerManager?.get(key)?.setStyle?.({ alpha })
      }),

      // ── Marker 系统 ─────────────────────────────────────────────────
      SceneCommandBus.register('scene:reset', () => {
        console.log('[Viewport3D] scene:reset triggered')
        // 1. Clear all markers
        refs.current.markerManager?.dispose?.()
        
        // 2. Clear built-in groups
        if (refs.current.trajGroup) refs.current.trajGroup.clear()
        if (refs.current.histGroup) refs.current.histGroup.clear()

        // 3. Clear URDF models
        if (refs.current._urdfModels) {
          refs.current._urdfModels.forEach(m => m.dispose())
          refs.current._urdfModels.clear()
        }
        if (refs.current._urdfCache) refs.current._urdfCache.clear()

        // 4. Reset camera to default
        refs.current.cameraViews?.setMode('orbit')
      }),

      // 创建 Marker：{ type, key, rosMsgType, options }
      // 例：SceneCommandBus.dispatch({ type:'scene:marker:set', markerType:'axes',
      //       key:'robot_pose', rosMsgType:'geometry_msgs/msg/PoseStamped', options:{scale:0.5} })
      SceneCommandBus.register('scene:marker:set', ({ markerType, key, rosMsgType, options }) => {
        const mgr = refs.current.markerManager
        if (!mgr) return
        try {
          mgr.set(key, markerType, rosMsgType, options || {})
        } catch (e) {
          console.error('[scene:marker:set]', e.message)
        }
      }),

      // 更新 Marker 数据（传入 ROS 消息）：{ key, data }
      SceneCommandBus.register('scene:marker:update', ({ key, data }) => {
        refs.current.markerManager?.update(key, data)
      }),

      // 移除 Marker：{ key }
      SceneCommandBus.register('scene:marker:remove', ({ key }) => {
        refs.current.markerManager?.remove(key)
      }),

      // 显示/隐藏 Marker：{ key, visible }
      SceneCommandBus.register('scene:marker:visible', ({ key, visible }) => {
        refs.current.markerManager?.setVisible(key, visible)
      }),

      // 更新 Marker 样式：{ key, style }
      SceneCommandBus.register('scene:marker:style', ({ key, style }) => {
        const marker = refs.current.markerManager?.get(key)
        if (marker?.setStyle) marker.setStyle(style)
      }),

      // 控制 Marker 文字标签显隐：{ key, visible }
      SceneCommandBus.register('scene:marker:labelVisible', ({ key, visible }) => {
        const marker = refs.current.markerManager?.get(key)
        if (marker?.setLabelVisible) marker.setLabelVisible(visible)
      }),

      // 切换相机视角：{ mode: 'orbit'|'follow', options? }
      SceneCommandBus.register('scene:view', ({ mode, options }) => {
        refs.current.cameraViews?.setMode(mode, options || {})
      }),

      // ── URDF 模型加载/销毁 ────────────────────────────────────────
      SceneCommandBus.register('scene:urdf:load', async ({ uid, urdfText }) => {
        console.log(`[Viewport3D] scene:urdf:load uid=${uid}, urdfText length=${urdfText?.length}`)
        const { rosRoot } = refs.current
        if (!rosRoot) { console.error('[Viewport3D] rosRoot not available'); return }

        // 缓存检查：相同 urdfText 不重复加载
        if (!refs.current._urdfCache) refs.current._urdfCache = new Map()
        const cacheKey = `${urdfText?.length}:${urdfText?.slice(0, 100)}`
        if (refs.current._urdfCache.get(uid) === cacheKey && refs.current._urdfModels?.get(uid)?.isLoaded) {
          console.log(`[Viewport3D] URDF cache hit for uid=${uid}, skip reload`)
          return
        }

        const { URDFModel } = await import('./urdf_loader/index.js')
        if (!refs.current._urdfModels) refs.current._urdfModels = new Map()
        const existing = refs.current._urdfModels.get(uid)
        if (existing) { console.log('[Viewport3D] disposing existing URDFModel'); existing.dispose() }
        const model = new URDFModel(rosRoot)
        refs.current._urdfModels.set(uid, model)
        try {
          await model.loadFromString(urdfText)
          refs.current._urdfCache.set(uid, cacheKey)
          console.log(`[Viewport3D] URDF loaded for uid=${uid}`)
        } catch (e) {
          console.error('[Viewport3D] URDF load failed:', e)
        }
      }),

      SceneCommandBus.register('scene:urdf:dispose', ({ uid }) => {
        const model = refs.current._urdfModels?.get(uid)
        if (model) { model.dispose(); refs.current._urdfModels.delete(uid) }
      }),
    ]

    // 所有 handler 注册完毕，通知其他模块场景已就绪
    setTimeout(() => SceneCommandBus.dispatch({ type: 'scene:ready' }), 0)

    return () => {
      if (animId) cancelAnimationFrame(animId)
      ro.disconnect()
      if (el && fpsEl && el.contains(fpsEl)) el.removeChild(fpsEl)
      unregs.forEach(fn => fn())
      refs.current.markerManager?.dispose()
      refs.current.mapLayer?.dispose()
      renderer.dispose()
      if (el && renderer.domElement && el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
    }
  }, [])

  // ── Map texture control ──────────────────────────────────────────────
  useEffect(() => {
    const { mapLayer } = refs.current
    if (!mapLayer) return
    if (mapEnabled) {
      mapLayer.setVisible(true)
      mapLayer.loadTexture(longitude, latitude, zoom).then(() => {
        mapLayer.setOpacity(mapOpacity)
      })
    } else {
      mapLayer.setVisible(false)
    }
  }, [mapEnabled, longitude, latitude, zoom])

  // ── Map opacity control ───────────────────────────────────────────────
  useEffect(() => {
    const { mapLayer } = refs.current
    if (!mapLayer || !mapEnabled) return
    mapLayer.setOpacity(mapOpacity)
  }, [mapOpacity, mapEnabled])

  // ── Trajectory ────────────────────────────────────────────────────────
  useEffect(() => {
    const { trajGroup } = refs.current
    if (!trajGroup) return
    trajGroup.clear()
    if (!visualization.showPath || trajectory.length < 2) return
    // rosRoot Z-up：路径点在 Z=0.06（略高于地面）
    const pts = trajectory.map(p => new THREE.Vector3(p.x, p.y??0, 0.06))
    const geo = new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(pts).getPoints(pts.length * 4))
    trajGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x4fc3f7 })))
  }, [trajectory, visualization.showPath])

  // ── History ───────────────────────────────────────────────────────────
  useEffect(() => {
    const { histGroup } = refs.current
    if (!histGroup) return
    histGroup.clear()
    if (!visualization.showHistory || historyPath.length < 2) return
    const pts = historyPath.map(p => new THREE.Vector3(p.x, p.y??0, 0.04))
    histGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.65 })
    ))
  }, [historyPath, visualization.showHistory])

  return (
    <div className="vp-wrap">
      <div ref={mountRef} className="vp-canvas" />
    </div>
  )
}
