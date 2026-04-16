/**
 * RobotVisualizer.jsx — Robot Visualizer 主组件
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import TopNav from './ui/panels/TopNav'
import LeftPanel from './ui/panels/LeftPanel'
import Viewport3D from './scene/Viewport3D'
import ImagePanel from './ui/components/ImagePanel'
import LogPanel from './ui/components/LogPanel'
import VirtualJoystick from './ui/components/VirtualJoystick'
import { getTfDisplayManager } from './manager/TfDisplayManager'
import { PanelLayout } from './ui/layout/PanelLayout'
import { PANEL_TYPES } from './ui/layout/panelTypes'
import { useLocalPersist } from './ui/hooks/useLocalPersist'
import './RobotVisualizer.css'

getTfDisplayManager()

const countLeafType = (node, ptype) => {
  if (!node) return 0
  if (node.kind === 'leaf') return node.ptype === ptype ? 1 : 0
  return countLeafType(node.a, ptype) + countLeafType(node.b, ptype)
}

const countLeaves = (node) => {
  if (!node) return 0
  if (node.kind === 'leaf') return 1
  return countLeaves(node.a) + countLeaves(node.b)
}

const appendRight = (node, leaf) => {
  if (!node) return leaf
  if (node.kind === 'split' && node.dir === 'h') {
    return { ...node, b: appendRight(node.b, leaf) }
  }
  return {
    kind: 'split',
    dir: 'h',
    ratio: 0.7,
    a: node,
    b: leaf,
  }
}

const isImageBranch = (node) => {
  if (!node) return false
  if (node.kind === 'leaf') return node.ptype === 'image'
  return isImageBranch(node.a) && isImageBranch(node.b)
}

const appendImageInColumn = (node, imageLeaf) => {
  if (!node) return imageLeaf

  if (node.kind === 'split' && node.dir === 'v' && isImageBranch(node.b)) {
    return { ...node, b: appendImageInColumn(node.b, imageLeaf) }
  }

  if (isImageBranch(node)) {
    return {
      kind: 'split',
      dir: 'v',
      ratio: 0.5,
      a: node,
      b: imageLeaf,
    }
  }

  return appendRight(node, imageLeaf)
}

const appendImagePanel = (node, imageLeaf) => {
  if (!node) return imageLeaf
  if (node.kind === 'split' && node.dir === 'h') {
    return { ...node, b: appendImageInColumn(node.b, imageLeaf) }
  }
  return {
    kind: 'split',
    dir: 'h',
    ratio: 0.72,
    a: node,
    b: imageLeaf,
  }
}

function hasImagePanel(node, displayUid) {
  if (!node) return false
  if (node.kind === 'leaf') {
    return node.ptype === 'image' && node.displayUid === displayUid
  }
  return hasImagePanel(node.a, displayUid) || hasImagePanel(node.b, displayUid)
}

const removeLeafByPanelId = (node, panelId) => {
  if (!node) return node
  if (node.kind === 'leaf') {
    return node.panelId === panelId ? null : node
  }

  const nextA = removeLeafByPanelId(node.a, panelId)
  const nextB = removeLeafByPanelId(node.b, panelId)

  if (!nextA && !nextB) return null
  if (!nextA) return nextB
  if (!nextB) return nextA
  return { ...node, a: nextA, b: nextB }
}

const normalizeLayoutImages = (node, imageTopics, nextTopics = imageTopics, changed = false) => {
  if (!node) return { node, imageTopics: nextTopics, changed }

  if (node.kind === 'leaf') {
    if (node.ptype !== 'image') return { node, imageTopics: nextTopics, changed }

    // 只有有有效 displayUid 的 image panel 才同步标签（不自动生成）
    const displayUid = node.displayUid
    if (!displayUid || typeof displayUid !== 'string' || !displayUid.startsWith('layout-image-')) {
      // 无效 uid 的 image panel（由普通 panel 临时切换来但还未完成初始化）忽略
      return { node, imageTopics: nextTopics, changed }
    }
    let topicMap = nextTopics
    let topicChanged = changed
    if (!(displayUid in topicMap)) {
      topicMap = { ...topicMap, [displayUid]: '/camera/image_raw' }
      topicChanged = true
    }

    return { node, imageTopics: topicMap, changed: topicChanged }
  }

  const left = normalizeLayoutImages(node.a, imageTopics, nextTopics, changed)
  const right = normalizeLayoutImages(node.b, imageTopics, left.imageTopics, left.changed)

  if (!right.changed && left.node === node.a && right.node === node.b) {
    return { node, imageTopics: right.imageTopics, changed: false }
  }

  // 只有子节点真正变了才创建新 split 节点（避免引用变化触发无限 setLayout）
  const newA = left.node !== node.a ? left.node : node.a
  const newB = right.node !== node.b ? right.node : node.b
  const newNode = (left.node !== node.a || right.node !== node.b)
    ? { ...node, a: newA, b: newB }
    : node

  return { node: newNode, imageTopics: right.imageTopics, changed: right.changed || left.changed }
}

const collectLayoutImageDisplays = (node, acc = []) => {
  if (!node) return acc
  if (node.kind === 'leaf') {
    if (node.ptype === 'image' && node.displayUid) acc.push({ displayUid: node.displayUid, panelId: node.panelId })
    return acc
  }
  collectLayoutImageDisplays(node.a, acc)
  collectLayoutImageDisplays(node.b, acc)
  return acc
}

export default function RobotVisualizer({ onBack }) {
  const [layout, setLayout] = useLocalPersist('kaiscope-layout', { kind: 'leaf', ptype: '3d' })
  const [imageTopics, setImageTopics] = useLocalPersist('kaiscope-image-topics', {})
  const [closedImageUid, setClosedImageUid] = useState(null)
  const [displaysVisible, setDisplaysVisible] = useState(true)
  const [controlMode, setControlMode] = useLocalPersist('kaiscope-ctrl-mode', false)
  const [goalPoseMode, setGoalPoseMode] = useLocalPersist('kaiscope-goal-pose', false)
  const [showJoystickConfig, setShowJoystickConfig] = useState(false)

  // 用于让 LeftPanel 注册添加标签的回调（标签添加到 LeftPanel 的 displays 中）
  const addImageLabelCallbackRef = useRef(null)
  // 用于让 LeftPanel 注册删除标签的回调（layout panel 从 image 切换走时调用）
  const removeImageLabelRef = useRef(null)

  const handleToggleControl = () => {
    setControlMode(v => {
      const next = !v
      if (next) setShowJoystickConfig(true)
      else setShowJoystickConfig(false)
      return next
    })
  }

  const isSingle = countLeaves(layout) === 1

  const splitDown = () => {
    setLayout(prev => ({
      kind: 'split',
      dir: 'v',
      ratio: 0.5,
      a: prev,
      b: { kind: 'leaf', ptype: '3d', panelId: `panel-${Date.now()}` },
    }))
  }

  const splitImage = useCallback((displayUid, topic = '') => {
    setImageTopics(prev => ({ ...prev, [displayUid]: topic }))
    setLayout(prev => {
      if (countLeafType(prev, 'image') >= 4) return prev
      return appendImagePanel(prev, { kind: 'leaf', ptype: 'image', displayUid, panelId: `image-${displayUid}` })
    })
  }, [])

  const handleAddImageLabel = useCallback((displayUid, topic = '') => {
    // 1. 设置 imageTopics（panel 渲染需要）
    setImageTopics(prev => ({ ...prev, [displayUid]: topic || '/camera/image_raw' }))
    // 2. 调用 LeftPanel 注册的回调，添加标签到 displays
    addImageLabelCallbackRef.current?.(displayUid, topic || '/camera/image_raw')
  }, [])

  const removeImage = useCallback((displayUid) => {
    setImageTopics(prev => {
      const next = { ...prev }
      delete next[displayUid]
      return next
    })
    setLayout(prev => {
      const next = removeLeafByPanelId(prev, `image-${displayUid}`)
      return next || { kind: 'leaf', ptype: '3d' }
    })
    // Delete 按钮删除标签
    setClosedImageUid(displayUid)
  }, [])

  const setImageVisible = useCallback((displayUid, visible) => {
    // 由标签 checked 状态驱动：
    // - visible=true（勾选）：标签存在则添加/显示 panel
    // - visible=false（取消勾选）：隐藏 panel，不删除标签（标签本身还在）
    setLayout(prev => {
      if (visible) {
        if (hasImagePanel(prev, displayUid)) return prev
        return appendImagePanel(prev, { kind: 'leaf', ptype: 'image', displayUid, panelId: `image-${displayUid}` })
      } else {
        const next = removeLeafByPanelId(prev, `image-${displayUid}`)
        return next || { kind: 'leaf', ptype: '3d' }
      }
    })
  }, [])

  const handleImagePanelClose = useCallback((displayUid) => {
    // 清理 topic，normalizeLayoutImages 会自动移除 panel
    setImageTopics(prev => {
      const next = { ...prev }
      delete next[displayUid]
      return next
    })
    // 触发 closedImageUid effect 删除标签
    setClosedImageUid(displayUid)
  }, [])

  const handleImageTopicChange = useCallback((displayUid, topic) => {
    setImageTopics(prev => ({ ...prev, [displayUid]: topic || '/camera/image_raw' }))
  }, [])

  // 标记 image 标签为失效状态（layout panel 从 image 切换走了）
  // 直接删除标签，避免残留标签无法操作的问题
  const handleMarkImageLabelInactive = useCallback((displayUid) => {
    // 通过 ref 调用 LeftPanel 的删除标签回调
    removeImageLabelRef.current?.(displayUid)
  }, [])

  useEffect(() => {
    const normalized = normalizeLayoutImages(layout, imageTopics)
    if (normalized.changed && normalized.node !== layout) {
      setLayout(normalized.node)
      return
    }

    if (normalized.imageTopics !== imageTopics) {
      setImageTopics(normalized.imageTopics)
    }
  }, [layout, imageTopics])

  const layoutImageDisplays = collectLayoutImageDisplays(layout)

  const renderPanel = (ptype, pt, panelNode, panelKey) => {
    if (ptype === '3d') {
      return <Viewport3D key={panelKey || 'main-3d'} panelId={panelKey || 'main-3d'} goalPoseMode={goalPoseMode} onGoalPoseComplete={() => setGoalPoseMode(false)} />
    }
    if (ptype === 'image') {
      const topic = panelNode?.displayUid ? (imageTopics[panelNode.displayUid] || '') : ''
      return <ImagePanel topic={topic || '/camera/image_raw'} />
    }
    if (ptype === 'log') {
      return <LogPanel />
    }
    return (
      <div className="pcell-placeholder">
        <span className="pp-icon">{pt.icon}</span>
        <p className="pp-label">{pt.label}</p>
        <span className="pp-sub">Connect ROS/WebSocket to stream data</span>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <PanelLayout
        layout={layout}
        onUpdate={setLayout}
        panelTypes={PANEL_TYPES}
        renderPanel={renderPanel}
        onImagePanelClose={handleImagePanelClose}
        setImageTopics={setImageTopics}
        setClosedImageUid={setClosedImageUid}
        onAddImageLabel={handleAddImageLabel}
        onMarkImageLabelInactive={handleMarkImageLabelInactive}
      />

      <VirtualJoystick
        visible={controlMode}
        showConfig={showJoystickConfig}
        onConfigClose={() => setShowJoystickConfig(false)}
      />

      <TopNav
        goalPoseMode={goalPoseMode}
        onToggleGoalPose={() => setGoalPoseMode(v => !v)}
        controlMode={controlMode}
        onToggleControl={handleToggleControl}
        onOpenControlConfig={() => {
          setControlMode(true)
          setShowJoystickConfig(true)
        }}
        onBack={onBack}
      />

      <LeftPanel
        visible={displaysVisible}
        onVisibleChange={setDisplaysVisible}
        onImageAdd={splitImage}
        onImageRemove={removeImage}
        onImageTopicChange={handleImageTopicChange}
        onImageVisibleChange={setImageVisible}
        closedImageUid={closedImageUid}
        onClosedImageUidHandled={() => setClosedImageUid(null)}
        layoutImageDisplays={layoutImageDisplays}
        onAddImageLabel={handleAddImageLabel}
        addImageLabelRef={addImageLabelCallbackRef}
        removeImageLabelRef={removeImageLabelRef}
      />

      {isSingle && (
        <div className="view-sw">
          <button className="vsw on">3D</button>
          <div className="vsw-split-wrap">
            <button className="vsw" onClick={splitDown} title="Split view">⊟</button>
          </div>
        </div>
      )}
    </div>
  )
}
