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

    const displayUid = node.displayUid || `layout-image-${node.panelId || 'new'}`
    let topicMap = nextTopics
    let topicChanged = changed
    if (!(displayUid in topicMap)) {
      topicMap = { ...topicMap, [displayUid]: '/camera/image_raw' }
      topicChanged = true
    }

    const newNode = node.displayUid === displayUid ? node : { ...node, displayUid }

    return { node: newNode, imageTopics: topicMap, changed: topicChanged }
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
    // 勾选框控制：只改 layout 中 panel 的显隐，不修改 imageTopics（保留配置）
    setLayout(prev => {
      if (visible) {
        if (hasImagePanel(prev, displayUid)) return prev
        return appendImagePanel(prev, { kind: 'leaf', ptype: 'image', displayUid, panelId: `image-${displayUid}` })
      } else {
        // 隐藏：直接移除 panel，不设置 closedImageUid（不删除标签）
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
