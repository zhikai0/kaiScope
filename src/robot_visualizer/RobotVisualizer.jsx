/**
 * RobotVisualizer.jsx — Robot Visualizer 主组件
 */
import { useCallback, useState } from 'react'
import TopNav from './ui/panels/TopNav'
import LeftPanel from './ui/panels/LeftPanel'
import Viewport3D from './scene/Viewport3D'
import ImagePanel from './ui/components/ImagePanel'
import VirtualJoystick from './ui/components/VirtualJoystick'
import { getTfDisplayManager } from './manager/TfDisplayManager'
import { PanelLayout } from './ui/layout/PanelLayout'
import { PANEL_TYPES } from './ui/layout/panelTypes'
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

const removeImageLeafByUid = (node, uid) => {
  if (!node) return node
  if (node.kind === 'leaf') {
    return node.ptype === 'image' && node.displayUid === uid ? null : node
  }

  const nextA = removeImageLeafByUid(node.a, uid)
  const nextB = removeImageLeafByUid(node.b, uid)

  if (!nextA && !nextB) return null
  if (!nextA) return nextB
  if (!nextB) return nextA
  return { ...node, a: nextA, b: nextB }
}

export default function RobotVisualizer({ onBack }) {
  const [layout, setLayout] = useState({ kind: 'leaf', ptype: '3d' })
  const [imageTopics, setImageTopics] = useState({})
  const [displaysVisible, setDisplaysVisible] = useState(true)
  const [controlMode, setControlMode] = useState(false)
  const [goalPoseMode, setGoalPoseMode] = useState(false)
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
      b: { kind: 'leaf', ptype: '3d' },
    }))
  }

  const splitImage = useCallback((displayUid, topic = '/camera/image_raw') => {
    setImageTopics(prev => ({ ...prev, [displayUid]: topic }))
    setLayout(prev => {
      if (countLeafType(prev, 'image') >= 4) return prev
      return appendImagePanel(prev, { kind: 'leaf', ptype: 'image', displayUid })
    })
  }, [])

  const removeImage = useCallback((displayUid) => {
    setImageTopics(prev => {
      const next = { ...prev }
      delete next[displayUid]
      return next
    })
    setLayout(prev => {
      const next = removeImageLeafByUid(prev, displayUid)
      return next || { kind: 'leaf', ptype: '3d' }
    })
  }, [])

  const handleImageTopicChange = useCallback((displayUid, topic) => {
    setImageTopics(prev => ({ ...prev, [displayUid]: topic || '/camera/image_raw' }))
  }, [])

  const renderPanel = (ptype, pt, panelNode) => {
    if (ptype === '3d') {
      return <Viewport3D goalPoseMode={goalPoseMode} onGoalPoseComplete={() => setGoalPoseMode(false)} />
    }
    if (ptype === 'image') {
      const topic = panelNode?.displayUid ? (imageTopics[panelNode.displayUid] || '/camera/image_raw') : '/camera/image_raw'
      return <ImagePanel topic={topic} />
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
      <PanelLayout layout={layout} onUpdate={setLayout} panelTypes={PANEL_TYPES} renderPanel={renderPanel} />

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
