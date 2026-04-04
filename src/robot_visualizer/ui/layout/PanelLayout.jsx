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

let nodeRootRef = { current: null }

function SplitNode({ node, path, totalPanels, onUpdate, panelTypes, renderPanel, onImagePanelClose }) {
  const wrapRef = useRef(null)

  if (isLeaf(node)) {
    const handleSplit = (dir) => {
      onUpdate(updateAtPath(nodeRootRef.current, path, (leaf) => ({
        kind: 'split',
        dir,
        ratio: 0.5,
        a: leaf,
        b: { kind: 'leaf', ptype: '3d', panelId: `panel-${Date.now()}` },
      })))
    }

    const handleClose = () => {
      if (totalPanels <= 1) return
      if (node.ptype === 'image' && node.displayUid) onImagePanelClose?.(node.displayUid)
      onUpdate(removeLeafAtPath(nodeRootRef.current, path))
    }

    const handleChangeType = (ptype) => {
      onUpdate(updateAtPath(nodeRootRef.current, path, (leaf) => ({ ...leaf, ptype })))
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

    onUpdate(updateAtPath(nodeRootRef.current, path, (cur) => ({
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
        />
      </div>
    </div>
  )
}

export function PanelLayout({ layout, onUpdate, panelTypes, renderPanel, onImagePanelClose }) {
  nodeRootRef.current = layout
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
      />
    </div>
  )
}
