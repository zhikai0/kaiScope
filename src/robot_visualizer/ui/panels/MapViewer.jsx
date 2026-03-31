import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useMapStore } from '../store/mapStore'
import { useSimStore } from '../store/simStore'
import './MapViewer.css'

// Gaode (AMap) satellite tile URL template
const GAODE_SAT = 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}'
const GAODE_LABEL = 'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}'
const ARCGIS_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

function makeGaodeProvider(url) {
  return new Cesium.UrlTemplateImageryProvider({
    url: url.replace('{s}', '1'),
    subdomains: ['1', '2', '3', '4'],
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    maximumLevel: 20,
  })
}

export default function MapViewer() {
  const containerRef = useRef(null)
  const viewerRef = useRef(null)
  const entitiesRef = useRef({})
  const [ready, setReady] = useState(false)

  const mapLayer   = useMapStore(s => s.mapLayer)
  const mapOpacity = useMapStore(s => s.mapOpacity)
  const mapEnabled = useMapStore(s => s.mapEnabled)
  const markers    = useMapStore(s => s.markers)
  const longitude  = useMapStore(s => s.longitude)
  const latitude   = useMapStore(s => s.latitude)
  const height     = useMapStore(s => s.height)
  const setViewerRef = useMapStore(s => s.setViewerRef)

  const obstacles  = useSimStore(s => s.obstacles)
  const robot      = useSimStore(s => s.robot)
  const goals      = useSimStore(s => s.goals)
  const trajectory = useSimStore(s => s.trajectory)

  // Init Cesium viewer
  useEffect(() => {
    if (!containerRef.current) return

    // Disable Cesium ion (use custom imagery only)
    Cesium.Ion.defaultAccessToken = ''

    const viewer = new Cesium.Viewer(containerRef.current, {
      // No default imagery
      imageryProvider: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shadows: false,
      terrainShadows: Cesium.ShadowMode.DISABLED,
      skyBox: false,
      skyAtmosphere: false,
      scene3DOnly: true,
      orderIndependentTranslucency: true,
    })

    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#f2f4f8')
    viewer.scene.globe.show = true
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#e8edf5')
    viewer.scene.globe.enableLighting = false

    // Add default satellite imagery (Gaode)
    const satLayer = viewer.imageryLayers.addImageryProvider(
      makeGaodeProvider(GAODE_SAT)
    )
    satLayer.alpha = mapOpacity

    // Add label overlay
    viewer.imageryLayers.addImageryProvider(
      makeGaodeProvider(GAODE_LABEL)
    )

    // Fly to initial location
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
      duration: 0,
    })

    viewerRef.current = viewer
    setViewerRef(viewer)
    setReady(true)

    return () => {
      viewer.destroy()
      viewerRef.current = null
      setViewerRef(null)
    }
  }, [])

  // Fly to location when GNSS params change (from LeftPanel inputs)
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !ready) return
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
      duration: 1.2,
    })
  }, [longitude, latitude, height, ready])

  // Switch imagery layer
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !ready) return
    viewer.imageryLayers.removeAll()
    let provider
    if (mapLayer === 'satellite') {
      provider = makeGaodeProvider(GAODE_SAT)
    } else if (mapLayer === 'street') {
      provider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
        subdomains: ['1','2','3','4'],
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        maximumLevel: 20,
      })
    } else {
      provider = new Cesium.UrlTemplateImageryProvider({
        url: ARCGIS_SAT,
        maximumLevel: 19,
      })
    }
    const layer = viewer.imageryLayers.addImageryProvider(provider)
    layer.alpha = mapOpacity
    // Label overlay for satellite
    if (mapLayer === 'satellite') {
      viewer.imageryLayers.addImageryProvider(makeGaodeProvider(GAODE_LABEL))
    }
  }, [mapLayer, ready])

  // Update opacity
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !ready) return
    if (viewer.imageryLayers.length > 0) {
      viewer.imageryLayers.get(0).alpha = mapOpacity
    }
  }, [mapOpacity, ready])

  // Show/hide map
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !ready) return
    viewer.scene.globe.show = mapEnabled
  }, [mapEnabled, ready])

  // Sync robot entity
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !ready) return
    const baseLng = longitude
    const baseLat = latitude
    const scale = 0.00001  // sim units to degrees
    const robLng = baseLng + robot.x * scale
    const robLat = baseLat + robot.y * scale

    if (entitiesRef.current.robot) {
      viewer.entities.remove(entitiesRef.current.robot)
    }
    entitiesRef.current.robot = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(robLng, robLat, 2),
      box: {
        dimensions: new Cesium.Cartesian3(8, 10, 4),
        material: Cesium.Color.fromCssColorString('#0078d4').withAlpha(0.85),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#00bfff'),
      },
      label: {
        text: 'Robot',
        font: '12px Roboto',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -20),
      }
    })
  }, [robot, ready, longitude, latitude])

  // Sync obstacles
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !ready) return
    const scale = 0.00001
    ;(entitiesRef.current.obstacles || []).forEach(e => viewer.entities.remove(e))
    entitiesRef.current.obstacles = obstacles.map(obs =>
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          longitude + obs.x * scale,
          latitude  + obs.z * scale,
          5
        ),
        box: {
          dimensions: new Cesium.Cartesian3(
            (obs.w || obs.r*2 || 1) * 10,
            (obs.d || obs.r*2 || 1) * 10,
            (obs.h || 1) * 10
          ),
          material: Cesium.Color.fromCssColorString('#2a2f3e').withAlpha(0.8),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#4e5f80'),
        }
      })
    )
  }, [obstacles, ready, longitude, latitude])

  // Sync goals
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !ready) return
    const scale = 0.00001
    ;(entitiesRef.current.goals || []).forEach(e => viewer.entities.remove(e))
    entitiesRef.current.goals = goals.map(g =>
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          longitude + g.x * scale,
          latitude  + g.z * scale,
          3
        ),
        point: {
          pixelSize: 14,
          color: Cesium.Color.fromCssColorString('#f59e42'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
        },
        label: {
          text: `Goal ${g.id}`,
          font: '11px Roboto',
          fillColor: Cesium.Color.fromCssColorString('#f59e42'),
          pixelOffset: new Cesium.Cartesian2(0, -18),
        }
      })
    )
  }, [goals, ready, longitude, latitude])

  // Sync trajectory
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !ready || trajectory.length < 2) return
    const scale = 0.00001
    if (entitiesRef.current.traj) viewer.entities.remove(entitiesRef.current.traj)
    const positions = trajectory.map(p =>
      Cesium.Cartesian3.fromDegrees(longitude + p.x * scale, latitude + p.y * scale, 1)
    )
    entitiesRef.current.traj = viewer.entities.add({
      polyline: {
        positions,
        width: 3,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: Cesium.Color.fromCssColorString('#00bfff'),
        }),
        clampToGround: true,
      }
    })
  }, [trajectory, ready, longitude, latitude])

  // Sync markers
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !ready) return
    ;(entitiesRef.current.markers || []).forEach(e => viewer.entities.remove(e))
    entitiesRef.current.markers = markers.map(m =>
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(m.lng, m.lat, 5),
        billboard: {
          image: 'data:image/svg+xml,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="#f59e42"/><circle cx="12" cy="12" r="5" fill="white"/></svg>'
          ),
          width: 24, height: 32,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        },
        label: { text: m.label || '', font: '12px Roboto', fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -36) }
      })
    )
  }, [markers, ready])

  return (
    <div className="map-viewer-wrap">
      <div ref={containerRef} className="cesium-container" />
      {!ready && <div className="map-loading">Loading satellite map...</div>}
      <div className="map-badge">
        <span>Satellite View</span>
        <span className="map-coord">{latitude.toFixed(4)}°N, {longitude.toFixed(4)}°E</span>
      </div>
    </div>
  )
}
