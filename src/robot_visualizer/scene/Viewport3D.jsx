import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CameraViews } from './views/CameraViews.js'
import { setupImportedCloudDrop, getImportedAssetStore, importLocalAssetFile } from './importers'
import { useSimStore } from '../ui/store/simStore'
import { useMapStore } from '../ui/store/mapStore'
import { SceneCommandBus } from '../manager/SceneCommandBus'
import { MarkerManager } from './markers'
import { createRosRoot } from './CoordSystem'
import { MapLayer } from './map/MapLayer'
import { getTfManager } from '../data/TfManager'
import { getRosDataManager } from '../data/getRosDataManager'
import { getTfDisplayManager } from '../manager/TfDisplayManager'
import { createSmoothFollowState, updateSmoothFollow, calcAlpha } from '../utils/interpolation.js'
import './Viewport3D.css'

const VIEWPORT_KEY_PREFIX = 'kaiscope-viewport-'

const DEFAULT_VIEWPORT_STATE = {
  cameraPos: null,
  cameraTarget: null,
  viewMode: 'orbit',
  at: 0,
}

function loadViewportState(panelId) {
  try {
    const raw = localStorage.getItem(VIEWPORT_KEY_PREFIX + panelId)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { ...DEFAULT_VIEWPORT_STATE }
}

function saveViewportState(panelId, state) {
  try {
    localStorage.setItem(VIEWPORT_KEY_PREFIX + panelId, JSON.stringify(state))
  } catch {}
}

export default function Viewport3D({ panelId = 'main-3d', editorMode = false, onEditorComplete, goalposeMode = false, onGoalposeComplete }) {
  const wrapRef = useRef(null)
  const mountRef = useRef(null)
  const refs     = useRef({})
  const persistedState = useRef(loadViewportState(panelId))
  const [viewMode, setViewMode] = useState(persistedState.current.viewMode || 'orbit')
  const prevEditorModeRef = useRef(false)
  const prevViewModeRef   = useRef('orbit')

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
    const mount = mountRef.current
    const wrap = wrapRef.current
    if (!mount || !wrap) return

    const el = mount
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.setClearColor(0x202025)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.BasicShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
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

    controls.addEventListener('change', () => {
      persistedState.current.cameraPos = camera.position.clone()
      persistedState.current.cameraTarget = controls.target.clone()
      saveViewportState(panelId, persistedState.current)
    })

    if (persistedState.current.cameraPos && persistedState.current.cameraTarget) {
      camera.position.copy(persistedState.current.cameraPos)
      controls.target.copy(persistedState.current.cameraTarget)
      controls.update()
    }

    // Lights — Rviz 风格科技感
    scene.add(new THREE.AmbientLight(0x333333, 1.0))
    scene.add(new THREE.HemisphereLight(0xd0d8e8, 0x404040, 0.3))
    // 主光源 - 较强，产生清晰光影
    const sun = new THREE.DirectionalLight(0xffffff, 1.8)
    sun.position.set(8, 20, 12)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.near = 0.5
    sun.shadow.camera.far = 100
    sun.shadow.camera.left = -22
    sun.shadow.camera.right = 22
    sun.shadow.camera.top = 22
    sun.shadow.camera.bottom = -22
    sun.shadow.radius = 0
    sun.shadow.bias = -0.0005
    scene.add(sun)
    // 补光 - 冷色调，增加科技感
    const fillLight = new THREE.DirectionalLight(0xa0c0ff, 0.4)
    fillLight.position.set(-10, 15, -8)
    scene.add(fillLight)

    // ── MapLayer 组件（9宫格地图贴图管理，替代旧 ground mesh） ────────
    const mapLayer = new MapLayer(scene)

    // ── Unlit grid helper ────────────────────────────────────────────────────
    // GridHelper 默认是 MeshPhongMaterial（受光照影响，0.5 alpha 会比 RViz 亮）
    // 用 MeshBasicMaterial 替代，使其完全不受光照，alpha 0.5 与 RViz 视觉一致
    const makeUnlitGridHelper = (size, divisions, color) => {
      const grid = new THREE.GridHelper(size, divisions, color, color)
      grid.position.y = 0.01
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      })
      grid.material = mat
      return grid
    }
    const GRID_COLOR = 0xa0a0a4
    const gridMaj = makeUnlitGridHelper(10, 10, GRID_COLOR)
    scene.add(gridMaj)
    // THREE.AxesHelper 已由 AxesMarker 系统替代，此处不再添加

    // ── ROS 根节点（Z-up → Y-up 坐标系变换） ─────────────────────────
    const rosRoot = createRosRoot(scene)

    // 路径 / 历史轨迹 / 编辑路径 group
    const trajGroup = new THREE.Group()
    const histGroup = new THREE.Group()
    const editPathGroup = new THREE.Group()
    const importedGroup = new THREE.Group()
    importedGroup.name = 'importers'
    rosRoot.add(trajGroup, histGroup, editPathGroup, importedGroup)

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

    const applyImportedAssetState = (child, asset) => {
      if (!child || !asset) return
      const params = asset.params || {}
      const scale = Math.max(0.001, params.scale ?? 1)
      const autoScale = child.userData?.importedAsset?.autoScale ?? 1
      child.scale.setScalar(autoScale * scale)

      const basePosition = child.userData?.importedAsset?.basePosition || new THREE.Vector3()
      const pose = {
        position: {
          x: basePosition.x + (params.x ?? 0),
          y: basePosition.y + (params.y ?? 0),
          z: basePosition.z + (params.z ?? 0),
        },
        orientation: new THREE.Quaternion().setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(params.rx ?? 0),
          THREE.MathUtils.degToRad(params.ry ?? 0),
          THREE.MathUtils.degToRad(params.rz ?? 0),
          'XYZ'
        )),
      }

      child.position.set(pose.position.x, pose.position.y, pose.position.z)
      child.quaternion.copy(pose.orientation)
      child.visible = asset.visible ?? true

      const importedAxesKey = `importedasset_axes_${asset.uid}`
      if (params.showAxes) {
        const markerManager = refs.current.markerManager
        if (markerManager && !markerManager.get(importedAxesKey)) {
          markerManager.set(importedAxesKey, 'axes', 'geometry_msgs/msg/Pose', {
            scale: 0.6,
            showLabel: false,
          })
        }
        markerManager?.setVisible(importedAxesKey, child.visible)
        markerManager?.update(importedAxesKey, {
          position: pose.position,
          orientation: {
            x: pose.orientation.x,
            y: pose.orientation.y,
            z: pose.orientation.z,
            w: pose.orientation.w,
          },
        })
      } else {
        refs.current.markerManager?.remove(importedAxesKey)
      }

      child.traverse((node) => {
        if (!node.material) return
        const materials = Array.isArray(node.material) ? node.material : [node.material]
        materials.forEach((material) => {
          material.transparent = (params.opacity ?? 1) < 1
          material.opacity = params.opacity ?? 1
          if ('size' in material && params.pointSize !== undefined) {
            const pointCount = child.userData?.importedAsset?.pointCount ?? asset.pointCount ?? 0
            const requestedSize = Math.max(0.001, params.pointSize)
            const sizeCap = pointCount > 500000 ? 0.12 : pointCount > 200000 ? 0.2 : 1.5
            material.size = Math.min(requestedSize, sizeCap)
            material.sizeAttenuation = requestedSize <= 0.2
          }
          if (material.color) {
            const canUseEmbedded = !!node.userData?._embeddedVertexColors
            if ((params.colorMode || 'embedded') === 'solid' || !canUseEmbedded) {
              material.vertexColors = false
              material.color.set(params.color || '#d7f0ff')
            } else {
              material.vertexColors = true
              material.color.set('#ffffff')
            }
          }
          material.needsUpdate = true
        })
      })

      refs.current.renderer?.render?.(refs.current.scene, refs.current.camera)
    }

    const cloneImportedAsset = (asset) => {
      const sourceObject = asset?.sourceObject
      if (!sourceObject) return null
      const clone = sourceObject.clone(true)
      clone.userData = {
        ...clone.userData,
        importedAsset: {
          ...(sourceObject.userData?.importedAsset || {}),
          ...(clone.userData?.importedAsset || {}),
          uid: asset.uid,
          version: asset.version,
        },
      }
      clone.traverse((node) => {
        node.userData = {
          ...node.userData,
          ...(node.userData || {}),
        }
      })
      applyImportedAssetState(clone, asset)
      return clone
    }

    const syncImportedAssets = (assets) => {
      const group = refs.current.importedGroup
      if (!group) return

      const incoming = new Map((assets || []).map(asset => [asset.uid, asset]))

      group.children.slice().forEach((child) => {
        const uid = child.userData?.importedAsset?.uid
        if (!incoming.has(uid)) {
          refs.current.markerManager?.remove(`importedasset_axes_${uid}`)
          group.remove(child)
          child.traverse?.((node) => {
            if (node.geometry?.dispose) node.geometry.dispose()
            if (node.material) {
              const materials = Array.isArray(node.material) ? node.material : [node.material]
              materials.forEach(material => material?.dispose?.())
            }
          })
        }
      })

      incoming.forEach((asset, uid) => {
        let child = group.children.find(item => item.userData?.importedAsset?.uid === uid)
        const childVersion = child?.userData?.importedAsset?.version ?? null
        const assetVersion = asset?.version ?? null

        if (child && childVersion !== assetVersion) {
          refs.current.markerManager?.remove(`importedasset_axes_${uid}`)
          group.remove(child)
          child.traverse?.((node) => {
            if (node.geometry?.dispose) node.geometry.dispose()
            if (node.material) {
              const materials = Array.isArray(node.material) ? node.material : [node.material]
              materials.forEach(material => material?.dispose?.())
            }
          })
          child = null
        }

        if (!child) {
          child = cloneImportedAsset(asset)
          if (!child) return
          group.add(child)
        }
        applyImportedAssetState(child, asset)
      })
    }

    refs.current = { renderer, scene, camera, controls, trajGroup, histGroup, editPathGroup, importedGroup, gridMaj, gridMin: null, markerManager, rosRoot, mapLayer, _gridCount: 10, _gridCellSize: 1, cameraViews, _viewMode: 'orbit', _viewTargetLink: 'base_link', _viewTargetProxy: viewTargetProxy, getPrimaryRobotRoot, _tfSmoothFollow: new Map(), _jointSmooth: new Map() }
    const importedAssetStore = getImportedAssetStore()
    syncImportedAssets(importedAssetStore.getAssets())
    const unsubscribeImportedAssets = importedAssetStore.onChange(syncImportedAssets)

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
      // ── URDF 模型 + TF Marker 同步跟随 ───────────────────────────
      // URDF 模型直接跟随
      const urdfModels = refs.current._urdfModels
      if (urdfModels && urdfModels.size > 0) {
        urdfModels.forEach((model) => {
          if (!model.isLoaded) return
          const tf = tfMgr.lookupTransform(fixedFrame, 'base_link')
          if (!tf) return
          model._root.position.set(tf.translation.x, tf.translation.y, tf.translation.z)
          model._root.quaternion.set(tf.rotation.x, tf.rotation.y, tf.rotation.z, tf.rotation.w ?? 1)
        })
      }

      // TF Marker 平滑插值（唯一用 lerp 的地方）
      const tfSmoothFollow = refs.current._tfSmoothFollow
      if (tfSmoothFollow && tfSmoothFollow.size > 0) {
        const alpha = calcAlpha(60, dt)
        tfSmoothFollow.forEach((state, key) => {
          const frameName = key.replace(/^tf_(axes|arrow|text)_/, '')
          const tf = tfMgr.lookupTransform(fixedFrame, frameName)
          if (!tf) return
          state.targetPos.set(tf.translation.x, tf.translation.y, tf.translation.z)
          state.targetQuat.set(tf.rotation.x, tf.rotation.y, tf.rotation.z, tf.rotation.w ?? 1)
          state.pos.lerp(state.targetPos, alpha)
          state.quat.slerp(state.targetQuat, alpha)
          const marker = refs.current.markerManager?.get(key)
          if (marker?.root) {
            marker.root.position.copy(state.pos)
            marker.root.quaternion.copy(state.quat)
          }
        })
      }

      // ── 关节角度平滑插值 ─────────────────────────────────────────
      const jointSmooth = refs.current._jointSmooth
      if (jointSmooth && jointSmooth.size > 0) {
        const urdfModels = refs.current._urdfModels
        const alpha = calcAlpha(60, dt)
        jointSmooth.forEach((state, jointKey) => {
          let diff = state.target - state.current
          while (diff > Math.PI) diff -= Math.PI * 2
          while (diff < -Math.PI) diff += Math.PI * 2
          state.current += diff * alpha
          urdfModels?.forEach((model) => {
            model.setJointAngle(jointKey, state.current)
          })
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

    const cleanupImportedCloudDrop = setupImportedCloudDrop({
      element: wrap,
      onImportFile: (file) => importLocalAssetFile(file),
    })

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
        const newGrid = makeUnlitGridHelper(totalSize, divisions, color)
        newGrid.material.opacity = opacity
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
        const newGrid = makeUnlitGridHelper(totalSize, divisions, color)
        newGrid.material.opacity = opacity
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
        else if (id === 'path')  { r.markerManager?.get('trajectory')?.setVisible?.(visible) }
        else if (id === 'history'){ r.markerManager?.get('history')?.setVisible?.(visible) }
        else if (id === 'robotmodel') {
          r._urdfModels?.forEach(model => {
            if (model._root) model._root.visible = visible
          })
        }
        else if (id === 'tf') {
          // tf: marker 可见性由 TfDisplayManager 管理
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

      // ── 编辑路径实时预览 — 通过 PathMarker (lineStyle='pointlines') 渲染 ─────
      SceneCommandBus.register('scene:editpath:update', ({ points = [], previewPts = [], p1, p2 }) => {
        const { markerManager, editPathGroup } = refs.current
        if (!markerManager || !editPathGroup) return

        const PREVIEW_KEY  = 'editpath_preview'
        const ACCUM_KEY    = 'editpath_accum'

        const Z = 0.05

        // ── 端点 p1/p2：亮红小球（marker 系统管不了这种独立小球，直接加 mesh）──
        editPathGroup.traverse(obj => {
          if (obj.userData?.isEditEndpoint) {
            obj.geometry?.dispose()
            obj.material?.dispose()
          }
        })
        editPathGroup.clear()
        const endSphereGeo = new THREE.SphereGeometry(0.12, 8, 6)
        const endSphereMat = new THREE.MeshBasicMaterial({ color: 0xff2222 })
        const mkEndpoint = (x, y) => {
          const m = new THREE.Mesh(endSphereGeo, endSphereMat)
          m.position.set(x, y, Z)
          m.userData.isEditEndpoint = true
          editPathGroup.add(m)
        }
        if (p1) mkEndpoint(p1.x, p1.y)
        if (p2) mkEndpoint(p2.x, p2.y)

        // ── 已完成路径：绿色粗线 ────────────────────────────────────────────────
        if (points.length >= 1) {
          const pts = points.map(p => ({ x: p.x, y: p.y, z: 0 }))
          if (!markerManager.get(ACCUM_KEY)) {
            markerManager.set(ACCUM_KEY, 'path', '__preprocessed__', {
              color:     '#19ff00',
              alpha:     1.0,
              lineStyle: 'pointlines',
              lineWidth: 2,
            })
          }
          markerManager.update(ACCUM_KEY, { points: pts })
        } else {
          markerManager.remove(ACCUM_KEY)
        }

        // ── 预览曲线：青色粗线 ──────────────────────────────────────────────────
        if (previewPts.length >= 2) {
          const pts = previewPts.map(p => ({ x: p.x, y: p.y, z: 0 }))
          if (!markerManager.get(PREVIEW_KEY)) {
            markerManager.set(PREVIEW_KEY, 'path', '__preprocessed__', {
              color:     '#00ffff',
              alpha:     1.0,
              lineStyle: 'pointlines',
              lineWidth: 2,
            })
          }
          markerManager.update(PREVIEW_KEY, { points: pts })
        } else {
          markerManager.remove(PREVIEW_KEY)
        }
      }),

      // ── Marker 系统 ─────────────────────────────────────────────────
      SceneCommandBus.register('scene:reset', () => {
        // 1. Clear non-TF markers
        refs.current.markerManager?.dispose?.((key) => !String(key).startsWith('tf_'))

        // 2. Clear ALL TF markers（会通过 TfManager 'update' 事件自动重建）
        // 获取 markerManager 中所有 TF markers 的 key
        const mgr = refs.current.markerManager
        if (mgr?._markers) {
          for (const key of mgr._markers.keys()) {
            if (String(key).startsWith('tf_')) {
              mgr.remove(key)
            }
          }
        }
        refs.current._tfSmoothFollow?.clear()

        // 3. Clear built-in groups
        if (refs.current.trajGroup) refs.current.trajGroup.clear()
        if (refs.current.histGroup) refs.current.histGroup.clear()
        if (refs.current.editPathGroup) refs.current.editPathGroup.clear()

        // 4. Clear URDF models
        if (refs.current._urdfModels) {
          refs.current._urdfModels.forEach(m => m.dispose())
          refs.current._urdfModels.clear()
        }
        if (refs.current._urdfCache) refs.current._urdfCache.clear()
        if (refs.current._urdfInflight) refs.current._urdfInflight.clear()
        if (refs.current._urdfLoadSeq) refs.current._urdfLoadSeq.clear()

        // 5. Keep current camera/view mode
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

      // 注册 TF marker 进行平滑跟随：{ key, frameName }
      SceneCommandBus.register('scene:tfMarker:register', ({ key, frameName }) => {
        if (!refs.current._tfSmoothFollow) refs.current._tfSmoothFollow = new Map()
        const marker = refs.current.markerManager?.get(key)
        if (marker?.root) {
          // 初始化位置到当前 TF 位置
          const tfMgr      = getTfManager()
          const fixedFrame = getTfDisplayManager().fixedFrame || 'map'
          const tf = tfMgr.lookupTransform(fixedFrame, frameName)
          if (tf) {
            marker.root.position.set(tf.translation.x, tf.translation.y, tf.translation.z)
            marker.root.quaternion.set(tf.rotation.x, tf.rotation.y, tf.rotation.z, tf.rotation.w ?? 1)
          }
          refs.current._tfSmoothFollow.set(key, createSmoothFollowState(marker.root.position, marker.root.quaternion))
        }
      }),

      // 移除 TF marker：{ key }
      SceneCommandBus.register('scene:marker:remove', ({ key }) => {
        refs.current.markerManager?.remove(key)
        refs.current._tfSmoothFollow?.delete(key)
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

      SceneCommandBus.register('scene:importedasset:visible', ({ uid, visible }) => {
        const child = refs.current.importedGroup?.children?.find(item => item.userData?.importedAsset?.uid === uid)
        if (child) child.visible = visible
        refs.current.markerManager?.setVisible(`importedasset_axes_${uid}`, visible)
      }),

      SceneCommandBus.register('scene:importedasset:remove', ({ uid }) => {
        const importedGroup = refs.current.importedGroup
        refs.current.markerManager?.remove(`importedasset_axes_${uid}`)
        if (!importedGroup) return
        const child = importedGroup.children.find(item => item.userData?.importedAsset?.uid === uid)
        if (!child) return
        importedGroup.remove(child)
        child.traverse?.((node) => {
          if (node.geometry?.dispose) node.geometry.dispose()
          if (node.material) {
            const materials = Array.isArray(node.material) ? node.material : [node.material]
            materials.forEach(material => material?.dispose?.())
          }
        })
        refs.current.renderer?.render?.(refs.current.scene, refs.current.camera)
      }),

      SceneCommandBus.register('scene:importedasset:update', ({ uid, params }) => {
        const child = refs.current.importedGroup?.children?.find(item => item.userData?.importedAsset?.uid === uid)
        if (!child) return
        const importedAssetStore = getImportedAssetStore()
        const asset = importedAssetStore.getAsset(uid)
        if (!asset) return
        applyImportedAssetState(child, { ...asset, params })
      }),

      // ── URDF 模型加载/销毁 ────────────────────────────────────────
      SceneCommandBus.register('scene:urdf:load', async ({ uid, urdfText }) => {
        const { rosRoot } = refs.current
        if (!rosRoot) return

        // 缓存检查：相同 urdfText 不重复加载
        if (!refs.current._urdfCache) refs.current._urdfCache = new Map()
        if (!refs.current._urdfInflight) refs.current._urdfInflight = new Map()
        if (!refs.current._urdfLoadSeq) refs.current._urdfLoadSeq = new Map()

        const cacheKey = `${urdfText?.length}:${urdfText?.slice(0, 100)}`
        if (refs.current._urdfCache.get(uid) === cacheKey && refs.current._urdfModels?.get(uid)?.isLoaded) {
          return
        }

        const inflight = refs.current._urdfInflight.get(uid)
        if (inflight?.cacheKey === cacheKey) {
          return
        }

        const nextSeq = (refs.current._urdfLoadSeq.get(uid) || 0) + 1
        refs.current._urdfLoadSeq.set(uid, nextSeq)
        refs.current._urdfInflight.set(uid, { cacheKey, seq: nextSeq })

        const { URDFModel } = await import('./urdf_loader/index.js')
        if (!refs.current._urdfModels) refs.current._urdfModels = new Map()
        const existing = refs.current._urdfModels.get(uid)
        if (existing) existing.dispose()

        const model = new URDFModel(rosRoot)
        refs.current._urdfModels.set(uid, model)

        try {
          await model.loadFromString(urdfText)

          const latestSeq = refs.current._urdfLoadSeq.get(uid)
          if (latestSeq !== nextSeq) {
            model.dispose()
            if (refs.current._urdfModels.get(uid) === model) refs.current._urdfModels.delete(uid)
            return
          }

          refs.current._urdfCache.set(uid, cacheKey)

          // ── 订阅 /joint_states 驱动车轮 ──────────────────────────────
          // 在 scene:ready 之后才能拿到 RosDataManager，所以用 setTimeout 延迟订阅
          setTimeout(() => {
            const rdm = getRosDataManager()
            if (!rdm) return
            rdm.subscribe('/joint_states', (msg) => {
              if (!msg?.name || !msg?.position) return
              // 设置目标角度，由动画循环进行平滑插值
              msg.name.forEach((jointName, i) => {
                if (!refs.current._jointSmooth) refs.current._jointSmooth = new Map()
                let state = refs.current._jointSmooth.get(jointName)
                if (!state) {
                  state = { current: msg.position[i], target: msg.position[i] }
                  refs.current._jointSmooth.set(jointName, state)
                }
                state.target = msg.position[i]
              })
            })
          }, 100)
        } catch (e) {
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
      persistedState.current.cameraPos = refs.current.camera?.position?.clone?.() || null
      persistedState.current.cameraTarget = refs.current.controls?.target?.clone?.() || null
      persistedState.current.viewMode = refs.current._viewMode || viewMode
      persistedState.current.at = Date.now()
      saveViewportState(panelId, persistedState.current)
      unsubscribeImportedAssets()
      if (animId) cancelAnimationFrame(animId)
      ro.disconnect()
      cleanupImportedCloudDrop()
      refs.current.editPathGroup?.clear()
      unregs.forEach(fn => fn())
      refs.current.markerManager?.dispose()
      refs.current.mapLayer?.dispose()
      renderer.dispose()
      if (el && renderer.domElement && el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
    }
  }, [panelId])

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
    persistedState.current.viewMode = viewMode
    saveViewportState(panelId, persistedState.current)
  }, [persistedState, viewMode, panelId])

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

  // ── Edit mode: top-down + restore on exit ─────────────────────────────
  useEffect(() => {
    const wasEditing = prevEditorModeRef.current
    prevEditorModeRef.current = editorMode

    if (editorMode && !wasEditing) {
      prevViewModeRef.current = viewMode
      setViewMode('topdown')
    } else if (!editorMode && wasEditing) {
      setViewMode(prevViewModeRef.current)
    }
  }, [editorMode])

  // ── 2D Goal Pose interaction ────────────────────────────────────────
  // 所有状态通过 window.__tp_goalposeMode / __ep_editMode 同步，
  // effect 只注册一次（空依赖），handlers 永远读最新值。
  // controls/cursor 由 onGoalposeChange 统一管理。
  useEffect(() => {
    const { renderer, camera, rosRoot, controls } = refs.current
    if (!renderer || !camera || !rosRoot || !controls) return

    const dom = renderer.domElement
    const raycaster = new THREE.Raycaster()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const mouse = new THREE.Vector2()

    // 模块级变量，不被闭包捕获
    let dragging = false
    let startRos = null
    let prevControlsEnabled = true

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
      const fixedShaftLength = 2.0
      const fixedHeadLength = 0.5
      const fixedTip = fromRos.clone().add(dir.multiplyScalar(fixedShaftLength + fixedHeadLength))
      SceneCommandBus.dispatch({ type: 'scene:marker:set', markerType: 'arrow', key: '__goal_pose_preview__', rosMsgType: '__arrow__', options: { scale: 1.0, shaftColor: '#19ff00', headColor: '#19ff00', opacity: 1.0, fixedShaftLength, fixedHeadLength, shaftRadius: 0.1, headRadius: 0.2, headLength: fixedHeadLength } })
      SceneCommandBus.dispatch({ type: 'scene:marker:update', key: '__goal_pose_preview__', data: { childPos: { x: fromRos.x, y: fromRos.y, z: 0.02 }, parentPos: { x: fixedTip.x, y: fixedTip.y, z: 0.02 } } })
    }

    const cleanupPreview = () => {
      dragging = false
      startRos = null
      SceneCommandBus.dispatch({ type: 'scene:marker:remove', key: '__goal_pose_preview__' })
    }

    const onDown = (ev) => {
      if (!window.__tp_goalposeMode || window.__ep_editMode) return
      ev.preventDefault()
      ev.stopPropagation()
      const p = toRosGround(ev)
      if (!p) return
      dragging = true
      startRos = p
      prevControlsEnabled = controls.enabled
      controls.enabled = false
      updateDragPreview(startRos, startRos.clone().add(new THREE.Vector3(0.001, 0, 0)))
    }

    const onMove = (ev) => {
      if (!dragging || !startRos) return
      ev.preventDefault()
      ev.stopPropagation()
      const p = toRosGround(ev)
      if (!p) return
      updateDragPreview(startRos, p)
    }

    const onUp = (ev) => {
      if (!dragging || !startRos) return
      ev.preventDefault()
      ev.stopPropagation()
      const end = toRosGround(ev) || startRos
      const dx = end.x - startRos.x
      const dy = end.y - startRos.y
      const yaw = Math.atan2(dy, dx)
      getRosDataManager()?.publishGoalPose?.({ x: startRos.x, y: startRos.y, yaw, frameId: getTfDisplayManager().fixedFrame || 'map' })
      SceneCommandBus.dispatch({ type: 'scene:goalpose:commit', pose: { x: startRos.x, y: startRos.y, yaw } })
      cleanupPreview()
      controls.enabled = prevControlsEnabled
      dom.style.cursor = ''
      window.__tp_goalposeMode = false
      window.dispatchEvent(new CustomEvent('toolpanel:goalposemodechange'))
      // 触发 React state 重置，打破 ToolPanel useEffect 的循环
      onGoalposeComplete?.()
    }

    // controls/cursor 由事件驱动，不依赖 effect 重跑
    const onGoalposeChange = () => {
      if (window.__tp_goalposeMode && !window.__ep_editMode) {
        controls.enabled = false
        dom.style.cursor = 'crosshair'
      } else {
        cleanupPreview()
        controls.enabled = true
        dom.style.cursor = ''
      }
    }

    window.addEventListener('toolpanel:goalposemodechange', onGoalposeChange)
    window.addEventListener('toolpanel:editmodechange', onGoalposeChange)

    // 交互监听器始终注册，handlers 内部控制是否处理
    dom.addEventListener('pointerdown', onDown)
    dom.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)

    // 初始化一次状态
    onGoalposeChange()

    return () => {
      cleanupPreview()
      dom.style.cursor = ''
      controls.enabled = true
      dom.removeEventListener('pointerdown', onDown)
      dom.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('toolpanel:goalposemodechange', onGoalposeChange)
      window.removeEventListener('toolpanel:editmodechange', onGoalposeChange)
    }
  }, [])

  // ── Placing mode: crosshair cursor + click to place ──────────────────
  useEffect(() => {
    const { renderer, rosRoot, camera, controls } = refs.current
    if (!renderer) return
    const dom = renderer.domElement

    const raycaster = new THREE.Raycaster()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const mouse = new THREE.Vector2()

    const screenToRos = (clientX, clientY) => {
      const rect = dom.getBoundingClientRect()
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const hit = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(plane, hit)) return null
      return rosRoot ? rosRoot.worldToLocal(hit.clone()) : hit
    }

    // Grid snap helper — 使用场景网格实际 cell size 吸附
    const snapToGrid = (v) => {
      const cell = refs.current._gridCellSize ?? 1
      return Math.round(v / cell) * cell
    }

    const onDown = (e) => {
      if (e.button !== 0) return

      // ── 放置模式（优先级最高，独立于 editorMode）──────────────────────
      if (window.__tp_placingMode) {
        window.dispatchEvent(new CustomEvent('toolpanel:placementclick', {
          detail: { screenX: e.clientX, screenY: e.clientY },
        }))
        return
      }
      // 单次点击：让相机控制（OrbitControls）正常处理，不拦截
    }

    // ── 编辑模式：双击追加点 ────────────────────────────────────────
    const onDblClick = (e) => {
      if (!window.__ep_editMode) return
      const ros = screenToRos(e.clientX, e.clientY)
      if (ros) {
        window.dispatchEvent(new CustomEvent('toolpanel:editdblclick', {
          detail: {
            rosX: snapToGrid(ros.x), rosY: snapToGrid(ros.y), rosZ: ros.z,
          },
        }))
      }
    }

    const onPlacingChange = () => {
      const placingActive = window.__tp_placingMode
      const editingActive = window.__ep_editMode

      if (placingActive) {
        dom.style.cursor = 'crosshair'
      } else if (editingActive) {
        dom.style.cursor = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23ff9f0a\' stroke-width=\'2\'%3E%3Cline x1=\'12\' y1=\'4\' x2=\'12\' y2=\'20\'/%3E%3Cline x1=\'4\' y1=\'12\' x2=\'20\' y2=\'12\'/%3E%3Ccircle cx=\'12\' cy=\'12\' r=\'2\' fill=\'%23ff9f0a\'/%3E%3C/svg%3E") 12 12, crosshair'
      } else {
        dom.style.cursor = ''
      }

      if (controls) {
        // 编辑模式下保持相机控制可用（旋转/缩放/平移），仅放置模式和 goalpose 模式禁用相机
        controls.enabled = !placingActive && !window.__tp_goalposeMode
      }
    }

    window.addEventListener('toolpanel:placingchange', onPlacingChange)
    window.addEventListener('toolpanel:editmodechange', onPlacingChange)
    dom.addEventListener('pointerdown', onDown)
    dom.addEventListener('dblclick', onDblClick)
    return () => {
      dom.style.cursor = ''
      if (controls) controls.enabled = true
      dom.removeEventListener('pointerdown', onDown)
      dom.removeEventListener('dblclick', onDblClick)
      window.removeEventListener('toolpanel:placingchange', onPlacingChange)
      window.removeEventListener('toolpanel:editmodechange', onPlacingChange)
    }
  }, [])

  // ── Trajectory — 通过 MarkerManager 使用 PathMarker ──────────────────────
  useEffect(() => {
    const { markerManager } = refs.current
    if (!markerManager) return
    if (!visualization.showPath || trajectory.length < 2) {
      markerManager.remove('trajectory')
      return
    }
    const pts = trajectory.map(p => ({ x: p.x, y: p.y ?? 0, z: 0.06 }))
    if (!markerManager.get('trajectory')) {
      markerManager.set('trajectory', 'path', '__preprocessed__', {
        color:     '#4fc3f7',
        alpha:     1.0,
        lineStyle: 'lines',
        lineWidth: 0.025,
      })
    }
    markerManager.update('trajectory', { points: pts })
    // trajGroup 保留作为 display:toggle 的引用层，PathMarker 已挂在其下
    if (refs.current.trajGroup) refs.current.trajGroup.visible = true
  }, [trajectory, visualization.showPath])

  // ── History — 通过 MarkerManager 使用 PathMarker ──────────────────────────
  useEffect(() => {
    const { markerManager } = refs.current
    if (!markerManager) return
    if (!visualization.showHistory || historyPath.length < 2) {
      markerManager.remove('history')
      return
    }
    const pts = historyPath.map(p => ({ x: p.x, y: p.y ?? 0, z: 0.04 }))
    if (!markerManager.get('history')) {
      markerManager.set('history', 'path', '__preprocessed__', {
        color:     '#4ade80',
        alpha:     0.65,
        lineStyle: 'lines',
        lineWidth: 0.025,
      })
    }
    markerManager.update('history', { points: pts })
    if (refs.current.histGroup) refs.current.histGroup.visible = true
  }, [historyPath, visualization.showHistory])

  return (
    <div className="vp-wrap" ref={wrapRef}>
      <div className="vp-canvas" ref={mountRef} />
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
