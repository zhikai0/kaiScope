import { create } from 'zustand'

/**
 * mapStore — 地图参数管理
 * 职责：管理地图显示参数（启用/禁用、透明度、GNSS 坐标、缩放）
 * 注意：地图贴图加载由 MapLayer 组件负责
 */
export const useMapStore = create((set) => ({
  // Map display control
  mapEnabled: false,
  mapOpacity: 1.0,

  // GNSS location & zoom
  longitude: 119.04855,
  latitude:   37.1624,
  zoom:       17,

  // ── Actions ────────────────────────────────────────────────────────────
  setMapEnabled:  (v) => set({ mapEnabled: v }),
  setMapOpacity:  (v) => set({ mapOpacity: Math.max(0, Math.min(1, v)) }),
  setZoom:        (z) => set({ zoom: Math.max(1, Math.min(20, z)) }),
  setLongitude:   (lng) => set({ longitude: lng }),
  setLatitude:    (lat) => set({ latitude: lat }),
}))

