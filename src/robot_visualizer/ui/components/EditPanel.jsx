/**
 * EditPanel — 编辑模式面板（左侧）
 *
 * 插件化架构：每个编辑工具实现 editTool 接口，注册到 EDIT_TOOLS 数组
 * 接口：
 *   id, label, icon, description
 *   defaultState, renderPanel, onSceneClick, onSceneMove
 */
import { useState, useEffect, useRef } from 'react'
import { getRosDataManager } from '../../data/getRosDataManager'
import { SceneCommandBus } from '../../manager/SceneCommandBus'
import './EditPanel.css'

// ── 曲线生成算法 ─────────────────────────────────────────────────────────────

/** 直线：按指定间距等分插值 ─────────────────────────────────────────────
 *  spacing: 插值点间距(m)，默认 1m，最少 3 个点 */
function generateLine(p1, p2, spacing = 1.0) {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d < 0.001) return [{ x: p1.x, y: p1.y, z: p1.z ?? 0, yaw: Math.atan2(dy, dx) }]

  // 按间距等分，最少 3 个点
  const numPts = Math.max(3, Math.ceil(d / spacing))
  const pts = []
  const baseYaw = Math.atan2(dy, dx)

  for (let i = 0; i <= numPts; i++) {
    const t = i / numPts
    pts.push({
      x: p1.x + dx * t,
      y: p1.y + dy * t,
      z: p1.z ?? 0,
      yaw: baseYaw,
    })
  }
  return pts
}

/** 圆弧：从 p1 到 p2，curvature 控制圆弧弯曲程度
 *  curvature ∈ [-1, 1]，|curvature| 越大圆弧越弯曲
 *    |curvature| = 1   → 最大弯曲（半圆）
 *    |curvature| = 0.5 → 中等弯曲
 *    curvature = 0    → 直线
 *  正值 = 左侧，负值 = 右侧
 *  p1 和 p2 严格作为起点和终点
 *  spacing: 插值点间距(m)，默认 1m，最少 3 个点
 */
function generateArc(p1, p2, curvature, spacing = 1.0) {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d < 0.001) return [{ x: p1.x, y: p1.y, z: p1.z ?? 0, yaw: 0 }]

  // 曲率为0 → 直线
  if (Math.abs(curvature) < 1e-6) return generateLine(p1, p2, spacing)

  const sign = Math.sign(curvature)  // +1 = 左侧，-1 = 右侧
  const kappa = Math.abs(curvature)

  // 弦的中点和角度
  const midX = (p1.x + p2.x) / 2
  const midY = (p1.y + p2.y) / 2
  const chordAngle = Math.atan2(dy, dx)

  // sagitta 控制弯曲程度
  const sagitta = kappa * d

  // 半径由几何关系决定：r² = (d/2)² + sagitta²
  const r = Math.sqrt((d / 2) * (d / 2) + sagitta * sagitta)

  // 圆心在垂直平分线上
  // sign=+1：左侧，sign=-1：右侧
  const perpAngle = chordAngle + sign * Math.PI / 2
  const cx = midX + sagitta * Math.cos(perpAngle)
  const cy = midY + sagitta * Math.sin(perpAngle)

  // p1 和 p2 到圆心的角度
  const startAngle = Math.atan2(p1.y - cy, p1.x - cx)
  const endAngle   = Math.atan2(p2.y - cy, p2.x - cx)

  // 计算圆心角（弧长）
  let deltaAngle = endAngle - startAngle
  // 规范化到 [-π, π]
  while (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI
  while (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI

  // 确保走正确的方向
  if (sign > 0 && deltaAngle < 0) deltaAngle += 2 * Math.PI
  if (sign < 0 && deltaAngle > 0) deltaAngle -= 2 * Math.PI

  const arcLength = r * Math.abs(deltaAngle)

  // 插值点按 spacing 间距等分，最少 3 个点
  const numPts = Math.max(3, Math.ceil(arcLength / spacing))

  const pts = []
  for (let i = 0; i <= numPts; i++) {
    const t = i / numPts
    const a = startAngle + deltaAngle * t
    const localYaw = a + sign * Math.PI / 2
    pts.push({
      x: cx + r * Math.cos(a),
      y: cy + r * Math.sin(a),
      z: p1.z ?? 0,
      yaw: localYaw,
    })
  }

  // 强制首尾点严格等于 p1/p2
  pts[0] = { x: p1.x, y: p1.y, z: p1.z ?? 0, yaw: pts[0].yaw }
  pts[pts.length - 1] = { x: p2.x, y: p2.y, z: p2.z ?? 0, yaw: pts[pts.length - 1].yaw }

  return pts
}

// ── 路径工具面板 ─────────────────────────────────────────────────────────────

const PATH_SCHEMA = `std_msgs/Header header
geometry_msgs/PoseStamped[] poses
================================================================================
MSG: std_msgs/Header
builtin_interfaces/Time stamp
string frame_id
================================================================================
MSG: builtin_interfaces/Time
int32 sec
uint32 nanosec
================================================================================
MSG: geometry_msgs/PoseStamped
std_msgs/Header header
geometry_msgs/Pose pose
================================================================================
MSG: geometry_msgs/Pose
geometry_msgs/Point position
geometry_msgs/Quaternion orientation
================================================================================
MSG: geometry_msgs/Point
float64 x
float64 y
float64 z
================================================================================
MSG: geometry_msgs/Quaternion
float64 x
float64 y
float64 z
float64 w
`

// ── 路径工具状态管理 ──────────────────────────────────────────────────────────

/** 生成一个段落对象 */
function createSegment(curveType, startPt, endPt, curvature, spacing) {
  const pts = curveType === 'line'
    ? generateLine({ ...startPt, z: 0 }, { ...endPt, z: 0 }, spacing)
    : generateArc({ ...startPt, z: 0 }, { ...endPt, z: 0 }, curvature, spacing)
  return {
    id: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    curveType,
    startPt: { x: startPt.x, y: startPt.y, z: startPt.z ?? 0 },
    endPt: { x: endPt.x, y: endPt.y, z: endPt.z ?? 0 },
    curvature,
    spacing,
    points: pts,
  }
}

/** 根据段落参数重新生成点 */
function regenerateSegmentPoints(seg) {
  const pts = seg.curveType === 'line'
    ? generateLine({ ...seg.startPt, z: 0 }, { ...seg.endPt, z: 0 }, seg.spacing)
    : generateArc({ ...seg.startPt, z: 0 }, { ...seg.endPt, z: 0 }, seg.curvature, seg.spacing)
  return { ...seg, points: pts }
}

// ── PathTool hooks ────────────────────────────────────────────────────────────
function usePathTool(editorMode, state, setState) {
  const mgrRef = useRef(null)
  const intervalRef = useRef(null)
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  })

  // 外部可调用：开始/停止发布
  const startPublish = () => {
    if (intervalRef.current) return
    const mgr = getRosDataManager()
    if (!mgr) return
    mgrRef.current = mgr
    intervalRef.current = setInterval(() => {
      const cur = stateRef.current
      const allPts = (cur.segments || []).flatMap((seg, idx) => idx === 0 ? seg.points : seg.points.slice(1))
      if (allPts.length === 0) return
      const nowMs = Date.now()
      const sec = Math.floor(nowMs / 1000)
      const nanosec = Math.floor((nowMs % 1000) * 1e6)
      const poses = allPts.map(p => {
        const half = (p.yaw || 0) * 0.5
        return {
          header: { stamp: { sec, nanosec }, frame_id: cur.frameId },
          pose: {
            position: { x: p.x, y: p.y, z: p.z || 0 },
            orientation: { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) },
          },
        }
      })
      mgrRef.current.publishGenericCdr(cur.topic, 'nav_msgs/msg/Path', PATH_SCHEMA, {
        header: { stamp: { sec, nanosec }, frame_id: cur.frameId },
        poses,
      })
    }, 1000)
    setState(prev => ({ ...prev, publishing: true }))
  }

  const stopPublish = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (mgrRef.current) {
      mgrRef.current.releaseGenericPublisher(stateRef.current.topic)
      mgrRef.current = null
    }
    setState(prev => ({ ...prev, publishing: false }))
  }

  const {
    segments = [],
    editingSegmentId = [],
  } = state || {}

  // 当前正在编辑的段落预览
  const { p1 = null, p2 = null, curveType = 'arc', curvature = 0, spacing = 1.0 } = state || {}
  // 实际起点：编辑中时用 state.p1，否则用最后一个段落的终点
  const selected = Array.isArray(editingSegmentId) ? editingSegmentId : []
  const actualP1 = selected.length > 0 ? p1 : (segments.length > 0 ? segments[segments.length - 1].endPt : p1)
  // 选中轨迹时不显示青色预览（previewPts 为空），用户直接在红色选中轨迹上操作，点击重新生成才生效
  const previewPts = (() => {
    if (selected.length > 0) return []
    if (!actualP1 || !p2) return []
    if (curveType === 'line') {
      return generateLine({ ...actualP1, z: 0 }, { ...p2, z: 0 }, spacing)
    } else {
      return generateArc({ ...actualP1, z: 0 }, { ...p2, z: 0 }, curvature, spacing)
    }
  })()

  // 选中轨迹时的实时预览：为每个选中的段落生成独立的预览点
  const livePreviewPtsMap = (() => {
    if (selected.length === 0) return new Map()
    const map = new Map()
    selected.forEach(segId => {
      const seg = segments.find(s => s.id === segId)
      if (!seg) return
      // 单选时用面板参数实时调节；多选时曲线类型/曲率/端点用各段的原始值，间距统一用面板
      const curveType_i  = selected.length === 1 ? curveType  : seg.curveType
      const curvature_i  = selected.length === 1 ? curvature  : seg.curvature
      const startPt_i    = (selected.length === 1 && p1) ? p1 : seg.startPt
      const endPt_i      = (selected.length === 1 && p2) ? p2 : seg.endPt
      const pts = curveType_i === 'line'
        ? generateLine({ ...startPt_i, z: 0 }, { ...endPt_i, z: 0 }, spacing)
        : generateArc({ ...startPt_i, z: 0 }, { ...endPt_i, z: 0 }, curvature_i, spacing)
      map.set(segId, pts)
    })
    return map
  })()

  // 计算所有段落的连续点（从第一个段落的起点开始）
  // 选中的段落用 livePreviewPtsMap（实时预览），其他段落用原有轨迹
  const allPoints = (() => {
    if (selected.length > 0 && livePreviewPtsMap.size > 0) {
      const result = []
      for (let idx = 0; idx < segments.length; idx++) {
        const seg = segments[idx]
        const previewPts = livePreviewPtsMap.get(seg.id)
        if (previewPts) {
          // 选中的段落用实时预览点（第一个段落用全部点，后续段落跳过第一个点避免重复）
          result.push(...(idx === 0 ? previewPts : previewPts.slice(1)))
        } else {
          result.push(...(idx === 0 ? seg.points : seg.points.slice(1)))
        }
      }
      return result
    }
    // 无选中或无预览点时用原始点
    const result = []
    for (let idx = 0; idx < segments.length; idx++) {
      const seg = segments[idx]
      result.push(...(idx === 0 ? seg.points : seg.points.slice(1)))
    }
    return result
  })()

  // 实时预览分发（仅在编辑模式下派发）
    useEffect(() => {
    if (!editorMode) {
      // 编辑模式退出时清除预览
      SceneCommandBus.dispatch({
        type: 'scene:editpath:update',
        points: [],
        previewPts: [],
        livePreviewPtsMap: new Map(),
        segments: [],
        editingSegmentId: [],
      })
      return
    }
    SceneCommandBus.dispatch({
      type: 'scene:editpath:update',
      points: allPoints,
      previewPts,
      livePreviewPtsMap,
      p1: actualP1,
      p2,
      segments,
      editingSegmentId,
    })
  }, [editorMode, allPoints, previewPts, livePreviewPtsMap, actualP1, p2, segments, editingSegmentId])

  // 场景左键双击 → 设置面板起点：选中轨迹时设置面板 p1，无选中时新增轨迹起点
  useEffect(() => {
    const handler = (e) => {
      const detail = e.detail
      const rosX = detail.rosX ?? detail.x
      const rosY = detail.rosY ?? detail.y
      const rosZ = detail.rosZ ?? detail.z
      if (rosX == null && rosY == null) return
      const pt = { x: rosX, y: rosY, z: rosZ || 0 }

      setState(prev => {
        // 选中单个轨迹段时：只设置面板 p1（不修改轨迹段，用户需点击重新生成）
        if (prev.editingSegmentId?.length === 1) {
          return { ...prev, p1: pt }
        }

        // 无选中轨迹段：新增轨迹模式
        if (prev.segments && prev.segments.length > 0) {
          // 已有轨迹：直接设终点（追加模式）
          return { ...prev, p2: pt }
        } else if (!prev._clickedOnce) {
          // 无轨迹：第一次点击设起点
          return { ...prev, p1: pt, p2: null, _clickedOnce: true }
        } else {
          // 无轨迹：第二次点击设终点
          return { ...prev, p2: pt, _clickedOnce: false }
        }
      })
    }
    window.addEventListener('toolpanel:editdblclick', handler)
    return () => window.removeEventListener('toolpanel:editdblclick', handler)
  }, [])

  // 场景右键双击 → 设置面板终点（仅在选中单个轨迹段时生效）
  useEffect(() => {
    const handler = (e) => {
      const detail = e.detail
      const rosX = detail.rosX ?? detail.x
      const rosY = detail.rosY ?? detail.y
      const rosZ = detail.rosZ ?? detail.z
      if (rosX == null && rosY == null) return
      const pt = { x: rosX, y: rosY, z: rosZ || 0 }

      setState(prev => {
        // 选中单个轨迹段时：只设置面板 p2（不修改轨迹段，用户需点击重新生成）
        if (prev.editingSegmentId?.length === 1) {
          return { ...prev, p2: pt }
        }
        return prev
      })
    }
    window.addEventListener('toolpanel:editdblclick:end', handler)
    return () => window.removeEventListener('toolpanel:editdblclick:end', handler)
  }, [])

  // Esc 键：取消选中轨迹，还原到"添加新轨迹"状态
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setState(prev => {
          const lastSeg = prev.segments && prev.segments.length > 0
            ? prev.segments[prev.segments.length - 1]
            : null
          return {
            ...prev,
            editingSegmentId: [],
            p1: lastSeg ? lastSeg.endPt : null,
            p2: null,
            _clickedOnce: false,
          }
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // 路径拖拽：G 键按下开始拖拽，释放时应用偏移
  useEffect(() => {
    // 当选中轨迹改变时，更新全局变量供 Viewport3D 使用
    if (state.editingSegmentId?.length) {
      const selectedSegs = state.segments.filter(s => state.editingSegmentId.includes(s.id))
      window.__ep_dragSegs = selectedSegs
      window.__ep_dragState = { segments: state.segments, editingSegmentId: state.editingSegmentId }
    } else {
      window.__ep_dragSegs = null
      window.__ep_dragState = null
    }
  }, [state.editingSegmentId, state.segments])

  useEffect(() => {
    const onDragEnd = (e) => {
      if (!state.editingSegmentId?.length) return
      const { endPos } = e.detail || {}
      if (!endPos) return

      // endPos 是用户点击释放的位置（新的起点位置）
      // 计算相对于原始起点的偏移
      const selectedSeg = state.segments.find(s => state.editingSegmentId.includes(s.id))
      if (!selectedSeg) return

      const dx = endPos.x - selectedSeg.startPt.x
      const dy = endPos.y - selectedSeg.startPt.y

      // 应用偏移到所有选中的段落，并同步面板 p1/p2
      setState(prev => {
        const selected = Array.isArray(prev.editingSegmentId) ? prev.editingSegmentId : []
        let newP1 = prev.p1
        let newP2 = prev.p2
        return {
          ...prev,
          segments: prev.segments.map(seg => {
            if (selected.includes(seg.id)) {
              if (newP1 && seg.startPt) {
                newP1 = { x: seg.startPt.x + dx, y: seg.startPt.y + dy, z: 0 }
              }
              if (newP2 && seg.endPt) {
                newP2 = { x: seg.endPt.x + dx, y: seg.endPt.y + dy, z: 0 }
              }
              return {
                ...seg,
                points: seg.points.map(p => ({ x: p.x + dx, y: p.y + dy, z: p.z || 0 })),
                startPt: { x: seg.startPt.x + dx, y: seg.startPt.y + dy, z: 0 },
                endPt:   { x: seg.endPt.x + dx,   y: seg.endPt.y + dy,   z: 0 },
              }
            }
            return seg
          }),
          p1: newP1,
          p2: newP2,
        }
      })
    }

    window.addEventListener('scene:editpath:dragend', onDragEnd)

    return () => {
      window.removeEventListener('scene:editpath:dragend', onDragEnd)
    }
  }, [state.editingSegmentId, state.segments, setState])

  return { startPublish, stopPublish, allPoints }
}

function generatePointsStatic(curveType, p1, p2, curvature, spacing) {
  if (curveType === 'line') {
    return generateLine({ ...p1, z: 0 }, { ...p2, z: 0 }, spacing)
  } else {
    return generateArc({ ...p1, z: 0 }, { ...p2, z: 0 }, curvature, spacing)
  }
}

// ── PathTool UI ────────────────────────────────────────────────────────────────
function PathToolUI({ state, setState, startPublish, stopPublish }) {
  const {
    segments = [],
    topic = '/edited_path',
    frameId = 'map',
    curveType = 'arc',
    p1 = null,
    p2 = null,
    curvature = 0,
    spacing = 1.0,
    publishing = false,
    editingSegmentId = [],
  } = state || {}

  // 安全处理 editingSegmentId（兼容旧数据）
  const selected = Array.isArray(editingSegmentId) ? editingSegmentId : []

  // 所有段落合并后的路径点
  const allPoints = segments.flatMap((seg, idx) => {
    if (idx === 0) return seg.points
    return seg.points.slice(1)
  })

  // 实际起点：编辑中时用 state.p1，否则用最后一个段落的终点
  const actualP1 = selected.length > 0 ? p1 : (segments.length > 0 ? segments[segments.length - 1].endPt : p1)

  const set = updater => setState(updater)

  // 添加新段落
  const applyCurve = () => setState(prev => {
    const startPt = segments.length > 0 ? segments[segments.length - 1].endPt : prev.p1
    if (!startPt || !prev.p2) return prev
    const newSeg = createSegment(prev.curveType, startPt, prev.p2, prev.curvature, prev.spacing ?? 1.0)
    return { ...prev, segments: [...(prev.segments || []), newSeg] }
  })

  // 删除段落
  const removeSegment = segId => set(prev => ({
    ...prev,
    segments: prev.segments.filter(s => s.id !== segId),
    editingSegmentId: (prev.editingSegmentId || []).filter(id => id !== segId),
  }))

  // 清空所有段落
  const clearPoints = () => {
    if (publishing) stopPublish()
    setState(prev => ({ ...prev, segments: [], p1: null, p2: null, _clickedOnce: false, editingSegmentId: [] }))
  }

  // 检查段落是否被选中
  const isSelected = segId => (state.editingSegmentId || []).includes(segId)

  // 选择/取消选择段落进行编辑（支持多选）
  const selectSegment = segId => set(prev => {
    const current = prev.editingSegmentId || []
    const isCurrentlySelected = current.includes(segId)
    
    if (isCurrentlySelected) {
      // 取消选中：只有取消后没有选中项时才还原状态
      const newSelected = current.filter(id => id !== segId)
      if (newSelected.length === 0) {
        // 没有选中了，还原到添加新轨迹状态
        // 使用最后一个段落的参数作为新建轨迹的默认值
        const lastSeg = prev.segments.length > 0 ? prev.segments[prev.segments.length - 1] : null
        return {
          ...prev,
          editingSegmentId: [],
          p1: lastSeg ? lastSeg.endPt : null,
          p2: null,
          curveType: lastSeg?.curveType ?? prev.curveType,
          curvature: lastSeg?.curvature ?? prev.curvature,
          spacing: lastSeg?.spacing ?? prev.spacing,
        }
      }
      // 取消选中后仍有选中项：更新面板为剩余选中段的参数
      const remainingSeg = prev.segments.find(s => s.id === newSelected[newSelected.length - 1])
      return {
        ...prev,
        editingSegmentId: newSelected,
        curveType: remainingSeg?.curveType ?? prev.curveType,
        curvature: remainingSeg?.curvature ?? prev.curvature,
        spacing: remainingSeg?.spacing ?? prev.spacing,
        p1: remainingSeg?.startPt ?? prev.p1,
        p2: remainingSeg?.endPt ?? prev.p2,
      }
    }
    
    // 新增选中：加载该段落的参数到编辑区
    const seg = prev.segments.find(s => s.id === segId)
    return {
      ...prev,
      editingSegmentId: [...current, segId],
      curveType: seg?.curveType ?? prev.curveType,
      curvature: seg?.curvature ?? prev.curvature,
      spacing: seg?.spacing ?? prev.spacing,
      p1: seg?.startPt ?? prev.p1,
      p2: seg?.endPt ?? prev.p2,
    }
  })

  // 重新生成所有选中段落的点（选中单个段时用面板 p1/p2 作为端点）
  const regenerateEditingSegment = () => set(prev => {
    const selected = prev.editingSegmentId || []
    if (selected.length === 0) return prev
    const lastSeg = prev.segments.length > 0 ? prev.segments[prev.segments.length - 1] : null
    return {
      ...prev,
      editingSegmentId: [],
      segments: prev.segments.map(seg => {
        if (!selected.includes(seg.id)) return seg
        // 单选时用面板 p1/p2 作为端点，多选时用各段自己的端点
        const startPt = selected.length === 1 && prev.p1 ? prev.p1 : seg.startPt
        const endPt   = selected.length === 1 && prev.p2 ? prev.p2 : seg.endPt
        const curveType_i = selected.length === 1 ? prev.curveType : seg.curveType
        const curvature_i = selected.length === 1 ? prev.curvature : seg.curvature
        const regenerated = {
          ...seg,
          curveType: curveType_i,
          curvature: curvature_i,
          spacing:   prev.spacing,
          startPt:   { ...startPt },
          endPt:     { ...endPt },
        }
        return regenerateSegmentPoints(regenerated)
      }),
      // 还原到添加新轨迹状态
      p1: lastSeg ? lastSeg.endPt : null,
      p2: null,
    }
  })

  const togglePublish = () => {
    if (publishing) {
      stopPublish()
    } else {
      startPublish()
    }
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ topic, frameId, segments, points: allPoints }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `path_${Date.now()}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        setState(prev => ({
          ...prev,
          topic: data.topic ?? prev.topic,
          frameId: data.frameId ?? prev.frameId,
          segments: data.segments ?? [],
        }))
      } catch {}
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const totalPoints = allPoints.length

  return (
    <div className="ep-tool-content">
      {/* Topic / Frame */}
      <div className="ep-field-row">
        <span className="ep-label">Topic</span>
        <input className="ep-input" value={topic} onChange={e => set(s => ({ ...s, topic: e.target.value }))}/>
      </div>
      <div className="ep-field-row">
        <span className="ep-label">Frame</span>
        <input className="ep-input" value={frameId} onChange={e => set(s => ({ ...s, frameId: e.target.value }))}/>
      </div>

      {/* 曲线类型：单选时可切换，多选时禁用 */}
      <div className="ep-curve-type-row">
        {['line', 'arc'].map(t => (
          <button
            key={t}
            className={`ep-curve-btn ${curveType === t ? 'active' : ''}`}
            onClick={() => set(s => ({ ...s, curveType: t }))}
            disabled={selected.length > 1}
          >
            {t === 'line' ? '直线' : '圆弧'}
          </button>
        ))}
      </div>

      {/* P1 / P2 坐标：单选时可编辑，多选时禁用 */}
      <div className="ep-two-pt-row">
        <div className="ep-pt-group">
          <div className="ep-pt-label">起点</div>
          <div className="ep-pt-fields">
            <label>X<input type="number" value={actualP1?.x ?? ''} step={0.5}
              onChange={e => set(s => ({ ...s, p1: { ...s.p1, x: +e.target.value } }))}
              disabled={selected.length !== 1}/></label>
            <label>Y<input type="number" value={actualP1?.y ?? ''} step={0.5}
              onChange={e => set(s => ({ ...s, p1: { ...s.p1, y: +e.target.value } }))}
              disabled={selected.length !== 1}/></label>
          </div>
        </div>
        <div className="ep-pt-group">
          <div className="ep-pt-label">终点</div>
          <div className="ep-pt-fields">
            <label>X<input type="number" value={p2?.x ?? ''} step={0.5}
              onChange={e => set(s => ({ ...s, p2: { ...s.p2, x: +e.target.value } }))}
              disabled={selected.length !== 1}/></label>
            <label>Y<input type="number" value={p2?.y ?? ''} step={0.5}
              onChange={e => set(s => ({ ...s, p2: { ...s.p2, y: +e.target.value } }))}
              disabled={selected.length !== 1}/></label>
          </div>
        </div>
      </div>

      {/* 曲率：单选时可调，多选时禁用 */}
      <div className="ep-field-row">
        <span className="ep-label">曲率 κ</span>
        <input type="range" className="ep-range"
          min={-1} max={1} step={0.05}
          value={curvature}
          disabled={selected.length > 1}
          onChange={e => set(s => ({ ...s, curvature: +e.target.value }))}/>
        <span className="ep-range-val">{curvature.toFixed(2)}</span>
      </div>

      {/* 插值间距 */}
      <div className="ep-field-row">
        <span className="ep-label">间距 m</span>
        <input type="range" className="ep-range"
          min={0.2} max={3} step={0.1}
          value={spacing}
          onChange={e => set(s => ({ ...s, spacing: +e.target.value }))}/>
        <span className="ep-range-val">{spacing.toFixed(1)}</span>
      </div>

      <div className="ep-field-row ep-add-row">
        {selected.length > 0 ? (
          <button className="ep-btn ep-btn-secondary" onClick={regenerateEditingSegment}>
            ✓ 重新生成 ({selected.length})
          </button>
        ) : (
          <button
            className="ep-btn ep-btn-secondary"
            disabled={!actualP1 || !p2}
            onClick={applyCurve}
          >
            + 添加轨迹
          </button>
        )}
      </div>

      {/* 已添加轨迹列表 */}
      <div className="ep-points-header">
        <span>轨迹 <span className="ep-badge">{segments.length}</span></span>
        <span className="ep-total-points">{totalPoints} 点</span>
        <button className="ep-btn-ghost ep-btn-sm" onClick={clearPoints} disabled={segments.length === 0}>清除</button>
      </div>
      <div className="ep-points-list">
        {segments.length === 0 && <div className="ep-empty-hint">双击场景放置起点和终点，生成轨迹</div>}
        {segments.map((seg, idx) => {
          const isEditing = selected.includes(seg.id)
          return (
            <div key={seg.id} className={`ep-segment-item ${isEditing ? 'editing' : ''}`}>
              <div className="ep-segment-header" onClick={() => selectSegment(seg.id)}>
                <span className="ep-segment-label">轨迹 {idx + 1}</span>
                <span className="ep-segment-type">{seg.curveType === 'line' ? '直线' : '圆弧'}</span>
                <span className="ep-segment-points">{seg.points.length} 点</span>
                <span className="ep-segment-coords">
                  ({seg.startPt.x.toFixed(1)}, {seg.startPt.y.toFixed(1)}) → ({seg.endPt.x.toFixed(1)}, {seg.endPt.y.toFixed(1)})
                </span>
                <button className="ep-segment-del" onClick={e => { e.stopPropagation(); removeSegment(seg.id) }}>✕</button>
              </div>
            </div>
          )
        })}
      </div>

      {/* 发布 / 导入导出 */}
      <div className="ep-actions">
        <button
          className={`ep-btn ${publishing ? 'ep-btn-danger' : 'ep-btn-primary'}`}
          onClick={togglePublish}
          disabled={segments.length === 0}
        >
          {publishing ? '停止发布' : '开始发布'}
        </button>
      </div>
      <div className="ep-import-export">
        <label className="ep-btn ep-btn-ghost ep-btn-sm ep-file-label">
          导入 JSON
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport}/>
        </label>
        <button className="ep-btn ep-btn-ghost ep-btn-sm" onClick={handleExport} disabled={segments.length === 0}>导出 JSON</button>
      </div>
    </div>
  )
}

// ── Edit tools registry ──────────────────────────────────────────────────────
const EDIT_TOOLS = [
  {
    id: 'path',
    label: '路径',
    icon: '🛤️',
    description: '生成和编辑导航路径',
    defaultState: {
      segments: [],
      topic: '/edited_path',
      frameId: 'map',
      curveType: 'line',
      p1: null,
      p2: null,
      curvature: 0,
      spacing: 1.0,
      _clickedOnce: false,
      editingSegmentId: [],
    },
    renderPanel: PathToolUI,
  },
]

export { EDIT_TOOLS }

// ── Main EditPanel component ──────────────────────────────────────────────────
const STORAGE_KEY = 'kaiScope_editPath'

function loadPersistedState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return null
}

function savePersistedState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

export default function EditPanel({ editorMode, onClose }) {
  const [activeTool, setActiveTool] = useState('path')
  const persisted = loadPersistedState()

  const [toolStates, setToolStates] = useState(() => {
    const defaults = Object.fromEntries(EDIT_TOOLS.map(t => [t.id, { ...t.defaultState }]))
    if (persisted) {
      // 恢复持久化状态，但 publishing 永远重置为 false（publisher 刷新后不存在了）
      const restored = { ...defaults, ...persisted }
      for (const key of Object.keys(restored)) {
        if (restored[key] && typeof restored[key] === 'object' && 'publishing' in restored[key]) {
          restored[key] = { ...restored[key], publishing: false }
        }
      }
      return restored
    }
    return defaults
  })

  // setState 可在 useState 后立即定义，不依赖条件渲染
  const setState = (updater) => {
    if (typeof updater === 'function') {
      setToolStates(prev => {
        const next = { ...prev, [activeTool]: updater(prev[activeTool]) }
        savePersistedState(next)
        return next
      })
    } else {
      setToolStates(prev => {
        const next = { ...prev, [activeTool]: updater }
        savePersistedState(next)
        return next
      })
    }
  }

  // usePathTool 必须在所有 useState/useEffect 之后、if(!editorMode) 之前无条件调用，
  // 否则 editorMode 切换时 Hook 顺序会变，触发 React 崩溃
  const tool = EDIT_TOOLS.find(t => t.id === activeTool)
  const state = tool ? toolStates[activeTool] : null
  const { startPublish, stopPublish } = usePathTool(editorMode, state, setState)

  // ── 同步编辑模式状态到 window ─────────────────────────────────
  useEffect(() => {
    window.__ep_editMode = editorMode
    window.dispatchEvent(new CustomEvent('toolpanel:editmodechange'))
    if (!editorMode) {
      SceneCommandBus.dispatch({ type: 'scene:editpath:update', points: [], previewPts: [], segments: [] })
    } else {
      const { segments = [] } = state || {}
      const allPoints = segments.flatMap((seg, idx) => idx === 0 ? seg.points : seg.points.slice(1))
      SceneCommandBus.dispatch({ type: 'scene:editpath:update', points: allPoints, previewPts: [], segments })
    }
  }, [editorMode])

  if (!editorMode) return null

  return (
    <div className="ep-panel">
      <div className="ep-header">
        <span className="ep-title">路径编辑器</span>
        <button className="ep-close" onClick={onClose}>✕</button>
      </div>

      <div className="ep-tool-tabs">
        {EDIT_TOOLS.map(t => (
          <button
            key={t.id}
            className={`ep-tool-tab ${activeTool === t.id ? 'active' : ''}`}
            onClick={() => setActiveTool(t.id)}
            title={t.description}
          >
            <span className="ep-tool-tab-icon">{t.icon}</span>
            <span className="ep-tool-tab-label">{t.label}</span>
          </button>
        ))}
      </div>

      {tool && (
        <div className="ep-tool-body">
          {tool.renderPanel({ state, setState, startPublish, stopPublish })}
        </div>
      )}

      <div className="ep-footer-hint">双击场景添加点 · Esc 退出编辑</div>
    </div>
  )
}
