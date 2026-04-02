import { useEffect, useRef, useState } from 'react'
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
import { getRosDataManager } from '../data/getRosDataManager'
import { getTfDisplayManager } from '../manager/TfDisplayManager'
import './Viewport3D.css'

let PERSISTED_CAMERA_POS = null
let PERSISTED_CAMERA_TARGET = null
let PERSISTED_VIEW_MODE = 'orbit'
let PERSISTED_AT = 0

export default function Viewport3D({ goalPoseMode = false, onGoalPoseComplete }) {
  const mountRef = useRef(null)
  const refs     = useRef({})
  const [viewMode, setViewMode] = useState(PERSISTED_VIEW_MODE)

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
    camera.position.set(0, 18, 0)
    camera.lookAt(0, 0, 0)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    controls.dampingFactor = 0.03
    controls.minDistance = 0.5
    controls.maxDistance = 5000      // 最远 5km
    controls.maxPolarAngle = Math.PI / 2 - 0.01  // 严格不低于 XY 平面
    controls.zoomSpeed = 1.0
    controls.rotateSpeed = 0.7
    controls.panSpeed = 0.7

    const now = Date.now()
    const persistedFresh = now - PERSISTED_AT < 10_000
    if (persistedFresh && PERSISTED_CAMERA_POS && PERSISTED_CAMERA_TARGET) {
      camera.position.copy(PERSISTED_CAMERA_POS)
      controls.target.copy(PERSISTED_CAMERA_TARGET)
      controls.update()
    }

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
    const viewTargetProxy = new THREE.Object3D()
    rosRoot.add(viewTargetProxy)
    const viewFollowHz = 18

    const getPrimaryRobotRoot = () => {
      const models = refs.current._urdfModels
      if (!models || models.size === 0) return null
      for (const m of models.values()) {
        if (m?.isLoaded && m?._root) return m._root
      }
      return null
    }

    refs.current = { renderer, scene, camera, controls, trajGroup, histGroup, gridMaj, gridMin: null, markerManager, rosRoot, mapLayer, _gridCount: 10, _gridCellSize: 1, cameraViews, _viewMode: 'orbit', _viewTargetLink: 'base_link', _viewTargetProxy: viewTargetProxy, getPrimaryRobotRoot }

    // ── Animation loop ───────────────────────────────────────────────────
    const clock = new THREE.Clock()
    let animId
    const animate = () => {
      animId = requestAnimationFrame(animate)
      const dt = Math.min(clock.getDelta(), 0.1)
      const baseFollowAlpha = 1 - Math.exp(-viewFollowHz * dt)
      const mode = refs.current.cameraViews?.mode
      const followAlpha = mode === 'thirdpersonfollower' ? 1.0 : baseFollowAlpha
      const tfMgr = getTfManager()
      const fixedFrame = getTfDisplayManager().fixedFrame || 'map'
      const viewTargetLink = refs.current._viewTargetLink || 'base_link'
      const viewTargetProxy = refs.current._viewTargetProxy
      if (viewTargetProxy) {
        const tf = tfMgr.lookupTransform(fixedFrame, viewTargetLink)
        if (tf) {
          const { translation: t, rotation: q } = tf
          const targetPos = new THREE.Vector3(t.x, t.y, t.z)
          const targetQuat = new THREE.Quaternion(q.x, q.y, q.z, q.w)
          if (!refs.current._viewTargetInit) {
            viewTargetProxy.position.copy(targetPos)
            viewTargetProxy.quaternion.copy(targetQuat)
            refs.current._viewTargetInit = true
          } else {
            viewTargetProxy.position.lerp(targetPos, followAlpha)
            viewTargetProxy.quaternion.slerp(targetQuat, followAlpha)
          }
          refs.current.cameraViews?.setFollowTarget(viewTargetProxy)
        }
      }
      refs.current.cameraViews?.update()
      if (refs.current.cameraViews?.mode === 'orbit' && controls.enabled) {
        controls.update()
      }
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
        if (refs.current._urdfInflight) refs.current._urdfInflight.clear()
        if (refs.current._urdfLoadSeq) refs.current._urdfLoadSeq.clear()

        // 4. Reset camera to default
        refs.current.cameraViews?.setMode('orbit')
        refs.current._viewMode = 'orbit'
        setViewMode('orbit')
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
        if (!refs.current._urdfInflight) refs.current._urdfInflight = new Map()
        if (!refs.current._urdfLoadSeq) refs.current._urdfLoadSeq = new Map()

        const cacheKey = `${urdfText?.length}:${urdfText?.slice(0, 100)}`
        if (refs.current._urdfCache.get(uid) === cacheKey && refs.current._urdfModels?.get(uid)?.isLoaded) {
          console.log(`[Viewport3D] URDF cache hit for uid=${uid}, skip reload`)
          return
        }

        const inflight = refs.current._urdfInflight.get(uid)
        if (inflight?.cacheKey === cacheKey) {
          console.log(`[Viewport3D] URDF load in-flight for uid=${uid}, skip duplicate request`)
          return
        }

        const nextSeq = (refs.current._urdfLoadSeq.get(uid) || 0) + 1
        refs.current._urdfLoadSeq.set(uid, nextSeq)
        refs.current._urdfInflight.set(uid, { cacheKey, seq: nextSeq })

        const { URDFModel } = await import('./urdf_loader/index.js')
        if (!refs.current._urdfModels) refs.current._urdfModels = new Map()
        const existing = refs.current._urdfModels.get(uid)
        if (existing) { console.log('[Viewport3D] disposing existing URDFModel'); existing.dispose() }

        const model = new URDFModel(rosRoot)
        refs.current._urdfModels.set(uid, model)

        try {
          await model.loadFromString(urdfText)

          const latestSeq = refs.current._urdfLoadSeq.get(uid)
          if (latestSeq !== nextSeq) {
            console.log(`[Viewport3D] stale URDF load result discarded uid=${uid}, seq=${nextSeq}, latest=${latestSeq}`)
            model.dispose()
            if (refs.current._urdfModels.get(uid) === model) refs.current._urdfModels.delete(uid)
            return
          }

          refs.current._urdfCache.set(uid, cacheKey)
          console.log(`[Viewport3D] URDF loaded for uid=${uid}`)
        } catch (e) {
          console.error('[Viewport3D] URDF load failed:', e)
          if (refs.current._urdfModels.get(uid) === model) refs.current._urdfModels.delete(uid)
        } finally {
          const pending = refs.current._urdfInflight.get(uid)
          if (pending?.seq === nextSeq) refs.current._urdfInflight.delete(uid)
        }
      }),

      SceneCommandBus.register('scene:urdf:dispose', ({ uid }) => {
        const model = refs.current._urdfModels?.get(uid)
        if (model) { model.dispose(); refs.current._urdfModels.delete(uid) }
        refs.current._urdfInflight?.delete(uid)
        refs.current._urdfLoadSeq?.delete(uid)
      }),
    ]

    // 所有 handler 注册完毕，通知其他模块场景已就绪
    setTimeout(() => SceneCommandBus.dispatch({ type: 'scene:ready' }), 0)

    return () => {
      PERSISTED_CAMERA_POS = refs.current.camera?.position?.clone?.() || null
      PERSISTED_CAMERA_TARGET = refs.current.controls?.target?.clone?.() || null
      PERSISTED_AT = Date.now()
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

  // ── Camera view mode ───────────────────────────────────────────────
  useEffect(() => {
    PERSISTED_VIEW_MODE = viewMode
  }, [viewMode])

  useEffect(() => {
    const { cameraViews } = refs.current
    if (!cameraViews) return

    refs.current._viewMode = viewMode
    refs.current._viewTargetLink = 'base_link'
    refs.current._viewTargetInit = false

    if (viewMode === 'follower') {
      cameraViews.setMode('thirdpersonfollower', {
        targetFrame: 'base_link',
        smooth: 0.2,
        allowControl: true,
        useTargetOrientation: true,
      })
    } else if (viewMode === 'topdown') {
      cameraViews.setMode('topdown', {
        targetFrame: 'base_link',
        offset: { x: 0, y: 0, z: 50 },
      })
    } else {
      cameraViews.setMode('orbit', {
        targetFrame: 'base_link',
        offset: { x: -30, y: 0, z: 30 },
        smooth: 0.2,
      })
    }
  }, [viewMode])

  // ── 2D Goal Pose interaction ────────────────────────────────────────
  useEffect(() => {
    const { renderer, camera, rosRoot, controls } = refs.current
    if (!renderer || !camera || !rosRoot || !controls) return

    const dom = renderer.domElement
    const raycaster = new THREE.Raycaster()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const mouse = new THREE.Vector2()

    let dragging = false
    let startRos = null
    const prevControlsEnabled = controls.enabled

    const toRosGround = (ev) => {
      const rect = dom.getBoundingClientRect()
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const hit = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(plane, hit)) return null
      return rosRoot.worldToLocal(hit.clone())
    }

    const updateDragPreview = (fromRos, toRos) => {
      const dir = toRos.clone().sub(fromRos)
      if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0)
      dir.normalize()

      // 固定尺寸：箭身 2m + 箭头 0.5m
      const fixedShaftLength = 2.0
      const fixedHeadLength = 0.5
      const fixedTip = fromRos.clone().add(dir.multiplyScalar(fixedShaftLength + fixedHeadLength))

      // 可独立调节：箭身半径 / 箭头半径 / 箭头长度
      const shaftRadius = 0.1
      const headRadius = 0.2

      SceneCommandBus.dispatch({
        type: 'scene:marker:set',
        markerType: 'arrow',
        key: '__goal_pose_preview__',
        rosMsgType: '__arrow__',
        options: {
          scale: 1.0,
          shaftColor: '#19ff00',
          headColor: '#19ff00',
          opacity: 1.0,
          fixedShaftLength,
          fixedHeadLength,
          shaftRadius,
          headRadius,
          headLength: fixedHeadLength,
        },
      })
      SceneCommandBus.dispatch({
        type: 'scene:marker:update',
        key: '__goal_pose_preview__',
        data: {
          childPos: { x: fromRos.x, y: fromRos.y, z: 0.02 },
          parentPos: { x: fixedTip.x, y: fixedTip.y, z: 0.02 },
        },
      })
    }

    const cleanupPreview = () => {
      SceneCommandBus.dispatch({ type: 'scene:marker:remove', key: '__goal_pose_preview__' })
    }

    const onDown = (ev) => {
      if (!goalPoseMode) return
      ev.preventDefault()
      ev.stopPropagation()
      const p = toRosGround(ev)
      if (!p) return
      dragging = true
      startRos = p
      updateDragPreview(startRos, startRos.clone().add(new THREE.Vector3(0.001, 0, 0)))
    }

    const onMove = (ev) => {
      if (!goalPoseMode) return
      ev.preventDefault()
      const p = toRosGround(ev)
      if (!p) return

      if (dragging && startRos) {
        updateDragPreview(startRos, p)
      }
    }

    const onUp = (ev) => {
      if (!goalPoseMode || !dragging || !startRos) return
      ev.preventDefault()
      ev.stopPropagation()
      const end = toRosGround(ev) || startRos
      const dx = end.x - startRos.x
      const dy = end.y - startRos.y
      const yaw = Math.atan2(dy, dx)

      getRosDataManager()?.publishGoalPose?.({
        x: startRos.x,
        y: startRos.y,
        yaw,
        frameId: getTfDisplayManager().fixedFrame || 'map',
      })

      SceneCommandBus.dispatch({
        type: 'scene:goalpose:commit',
        pose: { x: startRos.x, y: startRos.y, yaw },
      })

      dragging = false
      startRos = null
      SceneCommandBus.dispatch({ type: 'scene:marker:remove', key: '__goal_pose_preview__' })
      controls.enabled = prevControlsEnabled
      dom.style.cursor = ''
      onGoalPoseComplete?.()
    }

    if (goalPoseMode) {
      controls.enabled = false
      dom.style.cursor = 'crosshair'
      dom.addEventListener('pointerdown', onDown)
      dom.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    } else {
      controls.enabled = prevControlsEnabled
      dom.style.cursor = ''
      cleanupPreview()
    }

    return () => {
      controls.enabled = prevControlsEnabled
      dom.style.cursor = ''
      dom.removeEventListener('pointerdown', onDown)
      dom.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      cleanupPreview()
    }
  }, [goalPoseMode, onGoalPoseComplete])

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
      <div className="vp-view-select-wrap">
        <select className="vp-view-select" value={viewMode} onChange={e => setViewMode(e.target.value)}>
          <option value="orbit">Orbit</option>
          <option value="topdown">TopDownView</option>
          <option value="follower">ThirdPersonFollower</option>
        </select>
      </div>
    </div>
  )
}
