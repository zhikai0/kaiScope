import { useRef } from 'react'
import { PanelCell } from './PanelCell'
import { HResizeHandle, VResizeHandle } from './ResizeHandles'

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
const isLeaf = (node) => node?.kind === 'leaf'

const countLeaves = (node) => {
  if (!node) return 0
  if (isLeaf(node)) return 1
  return countLeaves(node.a) + countLeaves(node.b)
}

const updateAtPath = (node, path, updater) => {
  if (path.length === 0) return updater(node)
  const [head, ...rest] = path
  return {
    ...node,
    [head]: updateAtPath(node[head], rest, updater),
  }
}

const removeLeafAtPath = (node, path) => {
  if (path.length === 0) return node
  const [head, ...rest] = path

  if (rest.length === 0) {
    return head === 'a' ? node.b : node.a
  }

  return {
    ...node,
    [head]: removeLeafAtPath(node[head], rest),
  }
}

function SplitNode({ node, path, totalPanels, onUpdate, panelTypes, renderPanel, onImagePanelClose, setImageTopics, setClosedImageUid, onAddImageLabel, onMarkImageLabelInactive }) {
  const wrapRef = useRef(null)

  if (isLeaf(node)) {
    const handleSplit = (dir) => {
      onUpdate(prev => updateAtPath(prev, path, (leaf) => ({
        kind: 'split',
        dir,
        ratio: 0.5,
        a: leaf,
        b: { kind: 'leaf', ptype: '3d', panelId: `panel-${Date.now()}` },
      })))
    }

    const handleClose = () => {
      if (totalPanels <= 1) return
      // image panel 关闭时通知 RobotVisualizer 删除 panel 和 imageTopics，并设置 closedImageUid
      if (node.ptype === 'image' && node.displayUid) {
        onUpdate(prev => {
          const next = removeLeafAtPath(prev, path)
          return next || { kind: 'leaf', ptype: '3d' }
        })
        onImagePanelClose(node.displayUid)
        return
      }
      onUpdate(prev => removeLeafAtPath(prev, path))
    }

    const handleChangeType = (ptype) => {
      const isImage = node.ptype === 'image'
      const willBeImage = ptype === 'image'

      // 只有从非 image 类型切换到 image 类型时才添加标签
      if (willBeImage && !isImage) {
        // 切换到 image 类型：生成 displayUid 并添加 image 标签
        const displayUid = `layout-image-${Date.now()}`
        const panelId = `image-${displayUid}`
        onAddImageLabel?.(displayUid, '/camera/image_raw')
        // 同步 imageTopics
        setImageTopics(prev => ({
          ...prev,
          [displayUid]: '/camera/image_raw',
        }))
        onUpdate(prev => updateAtPath(prev, path, () => ({ kind: 'leaf', ptype, displayUid, panelId })))
      } else if (willBeImage && isImage) {
        // panel 已经是 image，切换到 image 无操作（保持现有状态）
        return
      } else {
        // 切换到其他类型：清理 image 状态（displayUid 和 panelId 都要清）
        if (node.displayUid && node.ptype === 'image') {
          // 清理 imageTopics 中对应的 topic
          setImageTopics(prev => {
            const next = { ...prev }
            delete next[node.displayUid]
            return next
          })
          // 标记标签为失效状态（不再关联到 image panel）
          onMarkImageLabelInactive?.(node.displayUid)
        }
        onUpdate(prev => updateAtPath(prev, path, () => ({ kind: 'leaf', ptype })))
      }
    }

    return (
      <PanelCell
        ptype={node.ptype}
        panelNode={node}
        panelTypes={panelTypes}
        canClose={totalPanels > 1}
        hideHeader={totalPanels === 1}
        onSplitH={() => handleSplit('h')}
        onSplitV={() => handleSplit('v')}
        onClose={handleClose}
        onChangeType={handleChangeType}
        renderPanel={(ptype, pt, panelNode) => renderPanel(ptype, pt, panelNode, node.panelId || path.join('-') || 'root')}
        onImagePanelClose={onImagePanelClose}
      />
    )
  }

  const ratio = clamp(node.ratio ?? 0.5, 0.1, 0.9)
  const dir = node.dir === 'v' ? 'v' : 'h'

  const onDelta = (delta) => {
    const el = wrapRef.current
    if (!el) return
    const size = dir === 'h' ? el.clientWidth : el.clientHeight
    if (!size) return
    const dr = delta / size

    onUpdate(prev => updateAtPath(prev, path, (cur) => ({
      ...cur,
      ratio: clamp((cur.ratio ?? 0.5) + dr, 0.1, 0.9),
    })))
  }

  return (
    <div
      ref={wrapRef}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: dir === 'h' ? 'row' : 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: ratio, minWidth: 0, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <SplitNode
          node={node.a}
          path={[...path, 'a']}
          totalPanels={totalPanels}
          onUpdate={onUpdate}
          panelTypes={panelTypes}
          renderPanel={renderPanel}
          onImagePanelClose={onImagePanelClose}
          setImageTopics={setImageTopics}
          setClosedImageUid={setClosedImageUid}
          onAddImageLabel={onAddImageLabel}
          onMarkImageLabelInactive={onMarkImageLabelInactive}
        />
      </div>

      {dir === 'h' ? <HResizeHandle onDelta={onDelta} /> : <VResizeHandle onDelta={onDelta} />}

      <div style={{ flex: 1 - ratio, minWidth: 0, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <SplitNode
          node={node.b}
          path={[...path, 'b']}
          totalPanels={totalPanels}
          onUpdate={onUpdate}
          panelTypes={panelTypes}
          renderPanel={renderPanel}
          onImagePanelClose={onImagePanelClose}
          setImageTopics={setImageTopics}
          setClosedImageUid={setClosedImageUid}
          onAddImageLabel={onAddImageLabel}
          onMarkImageLabelInactive={onMarkImageLabelInactive}
        />
      </div>
    </div>
  )
}

export function PanelLayout({ layout, onUpdate, panelTypes, renderPanel, onImagePanelClose, setImageTopics, setClosedImageUid, onAddImageLabel, onMarkImageLabelInactive }) {
  const totalPanels = countLeaves(layout)

  return (
    <div className="panel-layout">
      <SplitNode
        node={layout}
        path={[]}
        totalPanels={totalPanels}
        onUpdate={onUpdate}
        panelTypes={panelTypes}
        renderPanel={renderPanel}
        onImagePanelClose={onImagePanelClose}
        setImageTopics={setImageTopics}
        setClosedImageUid={setClosedImageUid}
        onAddImageLabel={onAddImageLabel}
        onMarkImageLabelInactive={onMarkImageLabelInactive}
      />
    </div>
  )
}
