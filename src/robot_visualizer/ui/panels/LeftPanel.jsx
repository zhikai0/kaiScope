import { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from 'react'
import { useSimStore } from '../store/simStore'
import { useMapStore } from '../store/mapStore'
import { useRos } from '../hooks/useRos'
import { useLocalPersist } from '../hooks/useLocalPersist'
import { getTfManager } from '../../data/TfManager'
import { SceneCommandBus } from '../../manager/SceneCommandBus'
import { getDisplayManager } from '../../manager/DisplayManager'
import { getTfDisplayManager } from '../../manager/TfDisplayManager'
import { getImportedAssetStore, importLocalAssetFile, updateImportedAssetParams, setImportedAssetChecked } from '../../scene/importers'
import { IMPORTED_ASSET_TYPE, createImportedAssetDisplay, renderImportedAssetParams } from './imported_asset'
import './LeftPanel.css'

const DISPLAY_SCHEMA_FILTER = {
  path:       ['nav_msgs/msg/Path','nav_msgs/Path'],
  map:        ['nav_msgs/msg/OccupancyGrid','nav_msgs/OccupancyGrid'],
  laserscan:  ['sensor_msgs/msg/LaserScan','sensor_msgs/LaserScan'],
  tf:         ['tf2_msgs/msg/TFMessage','tf2_msgs/TFMessage'],
  robotmodel: ['std_msgs/msg/String','std_msgs/String'],
  pointcloud: ['sensor_msgs/msg/PointCloud2','sensor_msgs/PointCloud2'],
  image:      ['sensor_msgs/msg/Image','sensor_msgs/Image','sensor_msgs/msg/CompressedImage','sensor_msgs/CompressedImage'],
  marker:     ['visualization_msgs/msg/Marker','visualization_msgs/Marker','visualization_msgs/msg/MarkerArray','visualization_msgs/MarkerArray'],
}

// ════════════════════════════════════════════════════════════════════════
// ── ATOM COMPONENTS (single source of truth for each control type) ─────
// ════════════════════════════════════════════════════════════════════════

// ── PR: key-value param row  (2:5 ratio, flush left) ────────────────────
function PR({ label, children, indent=0 }) {
  return (
    <div className="pr-row" style={indent>0 ? {paddingLeft:`calc(0.6rem + ${indent}*1rem)`} : {}}>
      <span className="pr-lbl">{label}</span>
      <div className="pr-ctrl">{children}</div>
    </div>
  )
}

// ── PSelect: unified dropdown (ALL selects use this) ─────────────────────
function PSelect({ value, onChange, children, ...rest }) {
  return (
    <select className="p-select" value={value} onChange={onChange} {...rest}>
      {children}
    </select>
  )
}

// ── PNum: unified number input — 允许中间态，失焦时验证回退 ─────────────
function PNum({ defaultValue, value: valueProp, onChange, onBlur, step=1, min, max, ...rest }) {
  // 用内部 string state 允许用户输入过程中的空/负/小数中间态
  const [raw, setRaw] = useState(() => String(valueProp ?? defaultValue ?? ''))
  // 同步外部 value 变化（受控模式）
  useEffect(() => {
    if (valueProp !== undefined) setRaw(String(valueProp))
  }, [valueProp])

  const commit = (str) => {
    const num = parseFloat(str)
    if (isNaN(num) || str.trim() === '') {
      // 回退默认值
      const def = defaultValue ?? min ?? 0
      setRaw(String(def))
      onChange?.({ target: { value: String(def) } })
      return
    }
    // 范围修正
    let clamped = num
    if (min !== undefined && clamped < min) clamped = min
    if (max !== undefined && clamped > max) clamped = max
    setRaw(String(clamped))
    onChange?.({ target: { value: String(clamped) } })
    onBlur?.()
  }

  return (
    <input className="p-num" type="number"
      value={raw}
      onChange={e => setRaw(e.target.value)}
      onBlur={e => commit(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') commit(e.target.value) }}
      step={step} min={min} max={max} {...rest}/>
  )
}

// ── PColor: unified color swatch + RGB input ──────────────────────────────
function PColor({ label, defaultHex='#ffffff', indent=0, onChange }) {
  const h2r = (hex) => {
    const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16)
    return `${r}:${g}:${b}`
  }
  const r2h = (str) => {
    const p = str.split(':').map(s => { const v=parseInt(s); return isNaN(v)?0:Math.max(0,Math.min(255,v)) })
    return p.length===3 ? '#'+p.map(v=>v.toString(16).padStart(2,'0')).join('') : null
  }
  const [hex, setHex] = useState(defaultHex)
  const [rgb, setRgb] = useState(() => h2r(defaultHex))
  const apply = (h) => { setHex(h); setRgb(h2r(h)); onChange&&onChange(h) }
  return (
    <PR label={label} indent={indent}>
      <label className="p-swatch-wrap">
        <input type="color" value={hex} className="p-swatch-input" onChange={e => apply(e.target.value)}/>
        <span className="p-swatch-box" style={{background:hex}}/>
      </label>
      <input className="p-rgb" value={rgb}
        onChange={e => { setRgb(e.target.value); const h=r2h(e.target.value); if(h) apply(h) }}
        placeholder="R:G:B"/>
    </PR>
  )
}

// ── TopicSelect: combobox with type-filtered dropdown ─────────────────────
function TopicSelect({ value, onChange, liveTopics, allowedDisplayType }) {
  const topics = useMemo(() => {
    if (!liveTopics || liveTopics.length === 0) return []

    if (allowedDisplayType && DISPLAY_SCHEMA_FILTER[allowedDisplayType]) {
      const allowed = DISPLAY_SCHEMA_FILTER[allowedDisplayType]
      return liveTopics
        .filter(c => allowed.includes(c.schemaName))
        .map(c => c.topic)
    }

    return liveTopics.map(c => c.topic)
  }, [liveTopics, allowedDisplayType])

  const [input, setInput] = useState(value || '')
  const [open, setOpen] = useState(false)
  const [filtered, setFiltered] = useState(topics)
  const wrapRef = useRef(null)
  const warn = input.length > 0 && !topics.includes(input)

  useEffect(() => {
    setInput(prev => prev === (value || '') ? prev : (value || ''))
  }, [value])

  useEffect(() => {
    setFiltered(prev => {
      if (prev.length === topics.length && prev.every((item, idx) => item === topics[idx])) return prev
      return topics
    })
  }, [topics])

  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const select = (t) => {
    setInput(t)
    setFiltered(topics)
    onChange && onChange(t)
    setOpen(false)
  }

  const handleInputChange = (next) => {
    setInput(next)
    setOpen(true)
    const q = next.trim().toLowerCase()
    if (!q) {
      setFiltered(topics)
    } else {
      const matches = topics.filter(t => t.toLowerCase().includes(q))
      setFiltered(matches.length > 0 ? matches : topics)
    }
    onChange && onChange(next)
  }

  const handleOpen = () => {
    setOpen(true)
    setFiltered(topics)
  }

  return (
    <div className="p-topic-wrap" ref={wrapRef}>
      <div className={`p-topic-row ${warn?'warn':''}`}>
        <input className="p-topic-input" value={input} placeholder="/topic"
          onChange={e => handleInputChange(e.target.value)}
          onFocus={handleOpen}/>
        {warn && <span className="p-topic-warn" title="未找到该 Topic">⚠</span>}
        <button className="p-topic-arrow" onClick={handleOpen} tabIndex={-1}>▾</button>
      </div>
      {open && (
        <div className="p-topic-dropdown">
          {filtered.length>0
            ? filtered.map(t=><div key={t} className={`p-topic-opt ${t===input?'active':''}`} onMouseDown={()=>select(t)}>{t}</div>)
            : <div className="p-topic-empty">No matching topics</div>}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// ── DISPLAY NODE (list item with collapsible params) ───────────────────
// ════════════════════════════════════════════════════════════════════════
const TYPE_ICONS = {
  grid:'⊞', robotmodel:'🤖', path:'〰️', map:'🗺️', tf:'📐',
  pointcloud:'⛅', laserscan:'📡', marker:'📍', axes:'🔀', image:'🖼️', importedasset:'📦',
  global:'⚙️', default:'📦',
}

function DNode({ label, checked, onChange, selected, onSelect, typeId, children, noChk }) {
  const [open, setOpen] = useState(false)
  const has = Boolean(children)

  return (
    <div className="di-wrap">
      <div className={`di-row ${open?'exp':''} ${selected?'sel':''}`}
        onClick={() => onSelect()}
        onDoubleClick={() => { if(has) setOpen(v=>!v) }}>
        <span className={`di-arr ${has?'':'inv'}`}>{open?'▾':'▸'}</span>
        <span className="di-type-icon">{TYPE_ICONS[typeId]||TYPE_ICONS.default}</span>
        <span className="di-lbl">{label}</span>
        {!noChk && <span className={`di-chk-box ${checked?'chk-on':''}`}
          onClick={e=>{e.stopPropagation();onChange&&onChange(!checked)}}
          onDoubleClick={e=>e.stopPropagation()}>{checked?'✔':''}</span>}
      </div>
      {open&&has&&<div className="di-children">{children}</div>}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// ── DISPLAY TYPES & TOPIC MAP ──────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
const DISPLAY_TYPES = [
  { id:'grid',       icon:'⊞',  label:'Grid',        color:'#4fc3f7', status:'ok',   desc:'3D grid reference plane' },
  { id:'robotmodel', icon:'🤖', label:'RobotModel',  color:'#0a84ff', status:'ok',   desc:'URDF robot model' },
  { id:'path',       icon:'〰', label:'Path',         color:'#4fc3f7', status:'ok',   desc:'Planned path trajectory' },
  { id:'map',        icon:'🗺', label:'SatelliteMap', color:'#34c759', status:'ok',   desc:'Satellite map layer' },
  { id:'tf',         icon:'📐', label:'TF',           color:'#ff9f0a', status:'ok',   desc:'TF coordinate transforms' },
  { id:'pointcloud', icon:'⛅', label:'PointCloud2',  color:'#b0bec5', status:'warn', desc:'Point cloud data' },
  { id:'laserscan',  icon:'📡', label:'LaserScan',    color:'#ef5350', status:'warn', desc:'Laser scan data' },
  { id:'marker',     icon:'📍', label:'Marker',       color:'#ff9f0a', status:'ok',   desc:'Visualization markers' },
  { id:'image',      icon:'🖼️', label:'Image',        color:'#af52de', status:'warn', desc:'Camera image stream' },
  IMPORTED_ASSET_TYPE,
]

const TOPIC_TYPE_MAP = {
  'nav_msgs/msg/Path':'path','nav_msgs/Path':'path',
  'nav_msgs/msg/OccupancyGrid':'map','nav_msgs/OccupancyGrid':'map',
  'sensor_msgs/msg/LaserScan':'laserscan','sensor_msgs/LaserScan':'laserscan',
  'tf2_msgs/msg/TFMessage':'tf','tf2_msgs/TFMessage':'tf',
  'std_msgs/msg/String':'robotmodel',
  'sensor_msgs/msg/PointCloud2':'pointcloud','sensor_msgs/PointCloud2':'pointcloud',
  'sensor_msgs/msg/Image':'image','sensor_msgs/Image':'image',
  'sensor_msgs/msg/CompressedImage':'image',
  'visualization_msgs/msg/Marker':'marker','visualization_msgs/msg/MarkerArray':'marker',
}

// ── TF Frame tree ────────────────────────────────────────────────────────

/**
 * Build a tree structure from TfManager.getTfTree() result.
 * Returns array of root nodes, each with { name, status, children[] }
 */
function buildTfTreeNodes(tfTree) {
  // tfTree: Map<string, { frame, parentFrame, relTranslation, relRotation, absTranslation, absRotation }>
  const nodeMap = {}  // name -> { name, status, data, children }
  tfTree.forEach((data, name) => {
    nodeMap[name] = { name, status: 'ok', data, children: [] }
  })
  const roots = []
  tfTree.forEach((data, name) => {
    if (data.parentFrame && nodeMap[data.parentFrame]) {
      nodeMap[data.parentFrame].children.push(nodeMap[name])
    } else {
      roots.push(nodeMap[name])
    }
  })
  // Sort children alphabetically for consistency
  const sortChildren = (node) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name))
    node.children.forEach(sortChildren)
  }
  roots.sort((a, b) => a.name.localeCompare(b.name))
  roots.forEach(sortChildren)
  return roots
}

/**
 * BFS traversal of tree nodes — gives the display order for Fixed Frame dropdown.
 */
function bfsOrder(roots) {
  const result = []
  const queue = [...roots]
  while (queue.length) {
    const node = queue.shift()
    result.push(node.name)
    queue.push(...node.children)
  }
  return result
}

function TfTreeNode({ node, depth, selected, onSelect }) {
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = node.children && node.children.length > 0
  const isSelected  = selected === node.name
  return (
    <div className="di-wrap">
      <div className={`di-row ${open?'exp':''} ${isSelected?'sel':''}`}
        style={{paddingLeft:`${0.6+depth*1.0}rem`}}
        onClick={()=>onSelect&&onSelect(node.name)}
        onDoubleClick={()=>{if(hasChildren)setOpen(v=>!v)}}>
        <span className={`di-arr ${hasChildren?'':'inv'}`}>{open?'▾':'▸'}</span>
        <span className="di-lbl">{node.name}</span>
      </div>
      {open && hasChildren && (
        <>
          {node.children.map(ch => (
            <TfTreeNode key={ch.name} node={ch} depth={depth+1}
              selected={selected} onSelect={onSelect}/>
          ))}
        </>
      )}
    </div>
  )
}

/** SettingsItem: uses PR row for consistent key-value alignment */
function TfSettingsItem({ label, children }) {
  return (
    <PR label={label} indent={1}>
      {children}
    </PR>
  )
}

/** Collapsible group header — sub-level, uses text-2 color like other sub-params */
function TfGroupNode({ label, defaultOpen=true, indent=0, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <div className={`di-row ${open?'exp':''}`}
        style={indent>0 ? {paddingLeft:`calc(0.6rem + ${indent}*1rem)`} : {}}
        onDoubleClick={()=>setOpen(v=>!v)}>
        <span className={`di-arr ${open?'':'collapsed'}`}>{open?'▾':'▸'}</span>
        <span className="di-lbl">{label}</span>
      </div>
      {open && <div className="di-children">{children}</div>}
    </div>
  )
}

/** Flat frame node under Frames group */
function TfFrameItem({ node, hidden, onToggle, indent=0 }) {
  const [open, setOpen] = useState(false)
  const isVisible = !hidden.has(node.name)
  const fv = (v) => v ? `${+v.x.toFixed(3)}; ${+v.y.toFixed(3)}; ${+v.z.toFixed(3)}` : '—'
  const fq = (q) => q ? `${+q.x.toFixed(3)}; ${+q.y.toFixed(3)}; ${+q.z.toFixed(3)}; ${+q.w.toFixed(3)}` : '—'
  return (
    <div>
      <div className={`di-row ${open?'exp':''}`}
        style={indent>0 ? {paddingLeft:`calc(0.6rem + ${indent}*1rem)`} : {}}
        onDoubleClick={()=>setOpen(v=>!v)}>
        <span className={`di-arr ${open?'':'collapsed'}`}>{open?'▾':'▸'}</span>
        <span className="di-lbl">{node.name}</span>
        <span className={`di-chk-box ${isVisible?'chk-on':''}`}
          onClick={e=>{e.stopPropagation();e.preventDefault();onToggle&&onToggle(node.name,!isVisible)}}
          onDoubleClick={e=>{e.stopPropagation();e.preventDefault()}}>
          {isVisible?'✔':''}</span>
      </div>
      {open && node.data && (
        <>
          {node.data.parentFrame && <PR label="Parent" indent={indent+1}><span className="pr-txt">{node.data.parentFrame}</span></PR>}
          <PR label="Position" indent={indent+1}><span className="pr-txt">{fv(node.data.absTranslation)}</span></PR>
          <PR label="Orientation" indent={indent+1}><span className="pr-txt">{fq(node.data.absRotation)}</span></PR>
          <PR label="Rel. Position" indent={indent+1}><span className="pr-txt">{fv(node.data.relTranslation)}</span></PR>
          <PR label="Rel. Orient." indent={indent+1}><span className="pr-txt">{fq(node.data.relRotation)}</span></PR>
        </>
      )}
    </div>
  )
}

function TfFrameTree() {
  const tfDisp = getTfDisplayManager()
  const [roots,    setRoots]    = useState([])
  const [hidden,   setHidden]   = useState(() => new Set(tfDisp.hiddenFrames))
  const [selected, setSelected] = useState(null)
  const [settings, setSettings] = useState(() => ({ ...tfDisp.settings }))
  const set = (k,v) => {
    const next = { ...settings, [k]: v }
    setSettings(next)

    if (k === 'allEnabled') {
      const allFrameNames = bfsOrder(roots).filter(Boolean)
      const nextHidden = v ? new Set() : new Set(allFrameNames)
      setHidden(nextHidden)
      allFrameNames.forEach(name => tfDisp.setFrameVisible(name, v))
      tfDisp.updateSettings({ allEnabled: v })
      return
    }

    // 通知 TfDisplayManager 设置变化
    if (k === 'markerScale') {
      tfDisp._rebuildScale(v)
    } else {
      tfDisp.updateSettings({ [k]: v })
    }
  }
  const toggleVis = (name, vis) => {
    setHidden(prev => {
      const n = new Set(prev)
      if (vis) n.delete(name)
      else n.add(name)
      return n
    })
    tfDisp.setFrameVisible(name, vis)
  }

  const [_localFF, setLocalFixedFrame] = useState('')
  void _localFF  // 仅用于触发重渲染，实际值从 getTfDisplayManager().fixedFrame 读取

  useEffect(() => {
    const mgr    = getTfManager()
    const tfDisp = getTfDisplayManager()

    // 重建树节点，并根据当前 fixedFrame 重算相对位姿
    const rebuild = () => {
      const tree   = mgr.getTfTree()
      const curFF  = tfDisp.fixedFrame

      // 构建显示用的副本 Map，不污染 TfManager 原始数据
      const displayTree = new Map()
      tree.forEach((node, name) => {
        let absTranslation = node.absTranslation
        let absRotation    = node.absRotation

        if (name === curFF) {
          absTranslation = { x:0, y:0, z:0 }
          absRotation    = { x:0, y:0, z:0, w:1 }
        } else {
          const fixedNode = tree.get(curFF)
          const isRoot    = !fixedNode || fixedNode.parentFrame === null
          if (!isRoot) {
            const tf = mgr.lookupTransform(curFF, name)
            if (tf) {
              absTranslation = tf.translation
              absRotation    = tf.rotation
            }
          }
        }

        // 创建副本，不修改原始 node
        displayTree.set(name, {
          ...node,
          absTranslation,
          absRotation,
        })
      })

      setRoots(buildTfTreeNodes(displayTree))
      setHidden(new Set(tfDisp.hiddenFrames))
      setSettings({ ...tfDisp.settings })
    }

    mgr.on('update', rebuild)
    rebuild()

    // 订阅 fixedFrame 变化
    const unsubFF = tfDisp.onFixedFrameChange((frame) => {
      setLocalFixedFrame(frame)
      rebuild()
    })

    // 初始同步 settings
    tfDisp.updateSettings(settings)

    return () => { mgr.off('update', rebuild); unsubFF() }
  }, [])

  // Flat BFS-ordered list of all frames for Frames group
  const flatFrames = bfsOrder(roots).map(name => {
    const find = (nodes) => { for(const n of nodes){ if(n.name===name) return n; const f=find(n.children); if(f) return f; } return null }
    return find(roots)
  }).filter(Boolean)

  return (
    <div>
      <TfSettingsItem label="Show Names">
        <span className={`di-chk-box ${settings.showNames?'chk-on':''}`} style={{marginLeft:'auto'}}
          onMouseDown={e=>{e.preventDefault();set('showNames',!settings.showNames)}}>{settings.showNames?'✔':''}</span>
      </TfSettingsItem>
      <TfSettingsItem label="Show Axes">
        <span className={`di-chk-box ${settings.showAxes?'chk-on':''}`} style={{marginLeft:'auto'}}
          onMouseDown={e=>{e.preventDefault();set('showAxes',!settings.showAxes)}}>{settings.showAxes?'✔':''}</span>
      </TfSettingsItem>
      <TfSettingsItem label="Show Arrows">
        <span className={`di-chk-box ${settings.showArrows?'chk-on':''}`} style={{marginLeft:'auto'}}
          onMouseDown={e=>{e.preventDefault();set('showArrows',!settings.showArrows)}}>{settings.showArrows?'✔':''}</span>
      </TfSettingsItem>
      <TfSettingsItem label="Marker Scale">
        <PNum defaultValue={settings.markerScale} step={0.1} min={0.1}
          onChange={e=>set('markerScale',parseFloat(e.target.value)||1)}/>
      </TfSettingsItem>
      <TfGroupNode label="Frames">
        <PR label="All Enabled" indent={1}>
          <span className={`di-chk-box ${settings.allEnabled?'chk-on':''}`} style={{marginLeft:'auto'}}
            onMouseDown={e=>{e.preventDefault();set('allEnabled',!settings.allEnabled)}}>{settings.allEnabled?'✔':''}</span>
        </PR>
        {flatFrames.map(node=>(
          <TfFrameItem key={node.name} node={node} hidden={hidden} onToggle={toggleVis}/>
        ))}
      </TfGroupNode>
      <TfGroupNode label="Tree">
        {!roots.length
          ? <div className="lp-empty">No TF frames — connect Foxglove bridge.</div>
          : roots.map(r=><TfTreeNode key={r.name} node={r} depth={0}
              selected={selected} onSelect={setSelected}/>)}
      </TfGroupNode>
    </div>
  )
}

// ── Add Modal ────────────────────────────────────────────────────────────
function AddModal({ onAdd, onClose, liveChannels }) {
  const [tab, setTab] = useState('type')
  const topics = liveChannels && liveChannels.length > 0 ? liveChannels : []
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal-box" onClick={e=>e.stopPropagation()}>
        <div className="modal-hdr"><span className="modal-title">Add Display</span><button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="modal-tabs">
          <button className={`modal-tab ${tab==='type'?'on':''}`} onClick={()=>setTab('type')}>By Display Type</button>
          <button className={`modal-tab ${tab==='topic'?'on':''}`} onClick={()=>setTab('topic')}>By Topic {liveChannels&&liveChannels.length>0&&<span className="modal-live-badge">●LIVE</span>}</button>
        </div>
        <div className="modal-body">
          {tab==='type' && DISPLAY_TYPES.map(d=>(
            <div key={d.id} className="modal-item" onClick={()=>{onAdd(d);onClose()}}><span className="modal-icon">{d.icon}</span><div><div className="modal-name">{d.label}</div><div className="modal-desc">{d.desc}</div></div></div>
          ))}
          {tab==='topic' && topics
            .filter(ch => ch.topic !== '/tf' && ch.topic !== '/tf_static')
            .map(ch => {
              const tid = TOPIC_TYPE_MAP[ch.schemaName]
              if (!tid) return null
              const dt = DISPLAY_TYPES.find(d => d.id === tid)
              if (!dt) return null
              return (
                <div key={ch.topic} className="modal-item" onClick={()=>{onAdd({...dt, topicOverride:ch.topic});onClose()}}>
                  <span className="modal-icon">{dt.icon}</span>
                  <div>
                    <div className="modal-name">{ch.topic}</div>
                    <div className="modal-desc">{ch.schemaName||''}</div>
                  </div>
                </div>
              )
            })
            .filter(Boolean)}
          {tab==='topic'&&topics.length===0&&<div className="modal-empty">No live topics — connect WebSocket backend.</div>}
        </div>
      </div>
    </div>
  )
}

// ── Main LeftPanel ───────────────────────────────────────────────────────
const DEFAULT_DISPLAYS = [
  { uid:'global-1',  id:'global',     label:'Global Options',color:'#8e8e93', status:'ok',   checked:true,  icon:'⚙️', noChk:true, noDel:true },
  { uid:'grid-1',    id:'grid',       label:'Grid',          color:'#4fc3f7', status:'ok',   checked:true,  icon:'⊞' },
  { uid:'robot-1',   id:'robotmodel', label:'RobotModel',    color:'#0a84ff', status:'ok',   checked:true,  icon:'🤖', topic:'/robot_description', params:{ topic:'/robot_description' }},
  { uid:'tf-1',      id:'tf',         label:'TF',            color:'#ff9f0a', status:'ok',   checked:true,  icon:'📐' },
  { uid:'map-1',     id:'map',        label:'SatelliteMap',  color:'#34c759', status:'ok',   checked:false, icon:'🗺' },
  { uid:'path-1',    id:'path',       label:'Path',          color:'#4fc3f7', status:'ok',   checked:true,  icon:'〰' },
]

const createLayoutImageDisplay = (displayUid) => ({
  uid: displayUid,
  id: 'image',
  label: 'Image',
  color: '#af52de',
  status: 'warn',
  checked: true,
  icon: '🖼️',
  params: { topic: '/camera/image_raw' },
})

export default function LeftPanel({ visible: visibleProp, onVisibleChange, onImageAdd, onImageRemove = () => {}, onImageTopicChange, onImageVisibleChange, closedImageUid, onClosedImageUidHandled = () => {}, layoutImageDisplays = [], onAddImageLabel, addImageLabelRef, removeImageLabelRef }) {
  const [_vis, _setVis]       = useState(true)
  const visible    = visibleProp!==undefined ? visibleProp : _vis
  const setVisible = (v) => { _setVis(v); onVisibleChange&&onVisibleChange(v) }
  const [showModal,   setShowModal]   = useState(false)
  const [displays,    setDisplays]    = useLocalPersist('kaiscope-displays', DEFAULT_DISPLAYS)
  const fileInputRef = useRef(null)
  const pendingImportUidRef = useRef(null)
  const [selectedUid, setSelectedUid] = useState(null)
  const [fixedFrame,  setFixedFrame]  = useState('')
  const [renaming,    setRenaming]    = useState(false)
  const [renameVal,   setRenameVal]   = useState('')

  // 订阅 TfDisplayManager 的 fixedFrame 变化（启动时自动同步根帧）
  useEffect(() => {
    const unsub = getTfDisplayManager().onFixedFrameChange((frame) => {
      setFixedFrame(frame)
    })
    return unsub
  }, [])

  // fixedFrame 下拉手动切换时通知 TfDisplayManager
  const handleFixedFrameChange = useCallback((frame) => {
    setFixedFrame(frame)
    getTfDisplayManager().setFixedFrame(frame)
  }, [])
  const [fps,         setFps]         = useState(60)
  const [tfFrames,    setTfFrames]    = useState([])
  const removedByLayoutRef = useRef(new Set())  // 标记由 layout 关闭触发的删除，避免重复处理

  useEffect(() => {
    const mgr = getTfManager()
    const onUpdate = () => {
      const tree = mgr.getTfTree()
      const roots = buildTfTreeNodes(tree)
      setTfFrames(bfsOrder(roots).filter(Boolean))
    }
    mgr.on('update', onUpdate)
    onUpdate()
    return () => mgr.off('update', onUpdate)
  }, [])

  const { channels: liveChannels, mgr: rosMgr } = useRos()

  useEffect(() => {
    const tfEnabled = displays.some(item => item.id === 'tf' && item.checked)
    rosMgr?.setAutoSubscribeTF?.(tfEnabled)
  }, [displays, rosMgr])

  // 初始化 & displays 变化时：同步所有 display 状态到 DisplayManager
  // 确保状态驱动：勾选状态、topic 等变更都能自动同步
  useEffect(() => {
    const dm = getDisplayManager()
    if (rosMgr) dm.setDataManager(rosMgr)

    // 收集当前 DM 中存在的 uid
    const dmUids = new Set(dm._displays.keys())
    const panelUids = new Set(displays.map(d => d.uid))

    // 1. 删除 DM 中有但面板已删除的 display
    dmUids.forEach(uid => {
      if (!panelUids.has(uid)) {
        // robotmodel 删除时清理缓存
        const disp = dm._displays.get(uid)
        if (disp?.id === 'robotmodel') {
          dm._lastRobotModel?.delete(uid)
        }
        dm.removeDisplay(uid)
      }
    })

    // 2. 添加/更新面板中的 display
    displays.forEach(disp => {
      const existing = dm._displays.get(disp.uid)
      if (!existing) {
        // 新增：只对勾选且有 topic 的进行订阅（robotmodel 单独处理）
        dm.addDisplay(disp)
        // Map/TF 需要额外启用全局管理器
        if (disp.id === 'map' && disp.checked) setMapEnabled(true)
        if (disp.id === 'tf' && disp.checked) {
          getTfDisplayManager().setEnabled(true)
          rosMgr?.setAutoSubscribeTF?.(true)
        }
        // 新增也要同步 topic（可能在 params.topic 中）
        const dispTopic = disp.topic || disp.params?.topic
        if (dispTopic) {
          dm.updateParam(disp.uid, 'topic', dispTopic)
        }
        return
      }

      // 已存在：同步 checked 状态
      if (existing.checked !== disp.checked) {
        dm.toggleDisplay(disp.uid, disp.checked)

        // ── 特殊类型显示控制 ─────────────────────────────
        if (disp.id === 'grid') {
          SceneCommandBus.dispatch({ type: 'scene:grid:visible', visible: disp.checked })
        } else if (disp.id === 'map') {
          setMapEnabled(disp.checked)
        }
        // tf 的显示由 TfDisplayManager 控制（toggleDisplay 已处理）
      }

      // 同步 topic（disp.topic 或 disp.params.topic）
      const dispTopic = disp.topic || disp.params?.topic
      const existingTopic = existing.topic || existing.params?.topic
      if (dispTopic && existingTopic !== dispTopic) {
        dm.updateParam(disp.uid, 'topic', dispTopic)
      }
    })
  }, [displays, rosMgr])
  // 自动绑定 RobotModel 话题：优先当前值；若默认值不存在则回退到首个可用 String topic
  useEffect(() => {
    const robotTopics = (liveChannels || [])
      .filter(c => DISPLAY_SCHEMA_FILTER.robotmodel.includes(c.schemaName))
      .map(c => c.topic)
    if (robotTopics.length === 0) return

    const robotDisp = displays.find(d => d.id === 'robotmodel')
    if (!robotDisp || !robotDisp.checked) return

    const curTopic = robotDisp.params?.topic || robotDisp.topic || ''
    const nextTopic = robotTopics.includes(curTopic) ? curTopic : robotTopics[0]
    const dm = getDisplayManager()

    if (curTopic !== nextTopic) {
      dm.updateParam(robotDisp.uid, 'topic', nextTopic)
      setDisplays(prev => prev.map(d => d.uid === robotDisp.uid
        ? { ...d, topic: nextTopic, params: { ...d.params, topic: nextTopic } }
        : d
      ))
      return
    }

    dm._ensureSubscribed(nextTopic, robotDisp.uid)
  }, [liveChannels, displays])

  // layout 切换时同步 displays：
  // - 有 image 面板时补全 display 条目
  // - 没有 image 面板时清理所有 layout-image-* display
  // 同步 displays 到 DisplayManager（订阅/取消/加载/销毁）
  // 注意：image panel 由 normalizeLayoutImages 根据 imageTopics 自动管理，此处不操作 layout
  useEffect(() => {
    const dm = getDisplayManager()
    if (rosMgr) dm.setDataManager(rosMgr)

    // 收集当前 DM 中存在的 uid
    const dmUids = new Set(dm._displays.keys())
    const panelUids = new Set(displays.map(d => d.uid))

    // 1. 删除 DM 中有但面板已删除的 display
    dmUids.forEach(uid => {
      if (!panelUids.has(uid)) {
        const disp = dm._displays.get(uid)
        if (disp?.id === 'robotmodel') {
          dm._lastRobotModel?.delete(uid)
        }
        dm.removeDisplay(uid)
      }
    })

    // 2. 添加/更新面板中的 display
    displays.forEach(disp => {
      const existing = dm._displays.get(disp.uid)
      if (!existing) {
        dm.addDisplay(disp)
        return
      }
      if (existing.checked !== disp.checked) {
        dm.toggleDisplay(disp.uid, disp.checked)
      }
      if (disp.topic && existing.topic !== disp.topic) {
        dm.updateParam(disp.uid, 'topic', disp.topic)
      }
    })
  }, [displays, rosMgr])

  // 选中项悬空时自动切换到列表第一个（放在单独的 effect 里，避免在 setDisplays updater 里调用 setState）
  useEffect(() => {
    if (selectedUid && !displays.some(d => d.uid === selectedUid)) {
      setSelectedUid(displays.length > 0 ? displays[0].uid : null)
    }
  }, [displays, selectedUid])

  const resetScene    = useSimStore(s => s.resetScene)
  const mapOpacity    = useMapStore(s => s.mapOpacity)
  const setMapOpacity = useMapStore(s => s.setMapOpacity)
  const setMapEnabled = useMapStore(s => s.setMapEnabled)
  const mapZoom       = useMapStore(s => s.zoom)
  const setMapZoom    = useMapStore(s => s.setZoom)
  const longitude     = useMapStore(s => s.longitude)
  const setLongitude  = useMapStore(s => s.setLongitude)
  const latitude      = useMapStore(s => s.latitude)
  const setLatitude   = useMapStore(s => s.setLatitude)

  const handleReset = useCallback(() => {
    resetScene()
    // 通知 3D 场景清理资源，但保持当前 view mode
    SceneCommandBus.dispatch({ type: 'scene:reset' })
  }, [resetScene])

  useEffect(() => {
    if (!closedImageUid) return
    // 只有 layout-image-* uid 才删除标签（panel close 触发的）
    // 其他 image uid（如勾选变化触发的）不受影响
    if (String(closedImageUid).startsWith('layout-image-')) {
      setDisplays(prev => prev.filter(d => !(d.id === 'image' && d.uid === closedImageUid)))
    }
    onImageRemove?.(closedImageUid)
    onClosedImageUidHandled?.()
  }, [closedImageUid, onImageRemove, onClosedImageUidHandled])

  // layoutImageDisplays 变化时：删除不在 layout 中的 layout-image-* 标签
  // 注意：只有当 closedImageUid 被设置时（即点击了 Delete 按钮）才删除标签
  // 取消勾选只是隐藏 panel，不删除标签
  useEffect(() => {
    // 只有 closedImageUid 被设置时才执行删除（区分隐藏和删除）
    if (!closedImageUid) return
    
    const layoutUids = new Set(layoutImageDisplays.map(d => d.displayUid))
    setDisplays(prev => prev.filter(d => {
      // 非 image 类型保留
      if (d.id !== 'image') return true
      // 手动添加的 image（非 layout-image-* 前缀）保留
      if (!String(d.uid).startsWith('layout-image-')) return true
      // 只有 closedImageUid 对应的标签才删除
      if (d.uid === closedImageUid) return false
      // 其他 layout-image-* 标签保留（可能在其他 panel 中）
      return true
    }))
  }, [layoutImageDisplays, closedImageUid])

  // 注册添加标签的回调，让 RobotVisualizer 的 handleAddImageLabel 能够调用
  useEffect(() => {
    // 如果传入了 addImageLabelRef，设置它；否则通过 onAddImageLabel 传递
    if (addImageLabelRef) {
      addImageLabelRef.current = (displayUid, topic) => {
        if (!displayUid) return
        const newDisp = {
          uid: displayUid,
          id: 'image',
          label: 'Image',
          color: '#af52de',
          status: 'warn',
          checked: true,
          icon: '🖼️',
          params: { topic: topic || '/camera/image_raw' },
        }
        setDisplays(prev => [...prev, newDisp])
      }
    } else if (onAddImageLabel) {
      onAddImageLabel((displayUid, topic) => {
        if (!displayUid) return
        const newDisp = {
          uid: displayUid,
          id: 'image',
          label: 'Image',
          color: '#af52de',
          status: 'warn',
          checked: true,
          icon: '🖼️',
          params: { topic: topic || '/camera/image_raw' },
        }
        setDisplays(prev => [...prev, newDisp])
      })
    }
  }, [onAddImageLabel, addImageLabelRef])

  // 注册删除标签的回调，当 layout panel 从 image 切换走时调用（直接删除标签）
  useEffect(() => {
    if (removeImageLabelRef) {
      removeImageLabelRef.current = (displayUid) => {
        setDisplays(prev => prev.filter(d => d.uid !== displayUid))
      }
    }
  }, [removeImageLabelRef])
  useEffect(() => {
    const syncImportedAssets = (assets) => {
      setDisplays(prev => {
        const importedUids = new Set(assets.map(asset => asset.uid))
        const preserved = prev.filter(d => d.id !== 'importedasset' || importedUids.has(d.uid))
        const byUid = new Map(preserved.map(d => [d.uid, d]))

        assets.forEach((asset) => {
          const existing = byUid.get(asset.uid)
          if (existing) {
            byUid.set(asset.uid, {
              ...existing,
              checked: asset.checked ?? existing.checked ?? true,
              label: asset.name || existing.label,
              params: {
                ...existing.params,
                fileName: asset.fileName || existing.params?.fileName,
                assetType: asset.assetType || existing.params?.assetType,
                embeddedColor: !!asset.embeddedColor,
                isPointCloud: !!asset.isPointCloud,
                pointCount: asset.pointCount ?? existing.params?.pointCount,
                showAxes: asset.params?.showAxes ?? existing.params?.showAxes ?? true,
                color: asset.embeddedColor ? '#d7f0ff' : (existing.params?.color || '#d7f0ff'),
                colorMode: asset.embeddedColor ? 'embedded' : 'solid',
              },
            })
          } else {
            byUid.set(asset.uid, createImportedAssetDisplay(asset))
          }
        })

        return Array.from(byUid.values())
      })
    }

    syncImportedAssets(getImportedAssetStore().getAssets())
    return getImportedAssetStore().onChange(syncImportedAssets)
  }, [])

  const handleAdd    = useCallback((dt) => {
    const uid = dt.id === 'image'
      ? `layout-image-${Date.now()}`
      : `${dt.id}-${Date.now()}`
    const initTopic = dt.topicOverride || ''
    const initParams = initTopic ? { topic: initTopic } : {}
    const newDisp = dt.id === 'importedasset'
      ? createImportedAssetDisplay({ uid })
      : {uid,...dt,checked:true,params:initParams}
    setDisplays(prev => [...prev, newDisp])

    if (dt.id === 'importedasset') {
      pendingImportUidRef.current = uid
      setSelectedUid(uid)
      setTimeout(() => fileInputRef.current?.click(), 0)
      return
    }

    // 1. 通知 DisplayManager 新增 display
    getDisplayManager().addDisplay(newDisp)

    // 2. 如果是 TF 或 Map，确保其对应的全局管理器/Store 被启用
    if (dt.id === 'tf') {
      getTfDisplayManager().setEnabled(true)
      rosMgr?.setAutoSubscribeTF?.(true)
    }
    if (dt.id === 'map') setMapEnabled(true)

    // 3. 如果有 topicOverride，立即通知 DisplayManager 订阅
    if (initTopic) getDisplayManager().updateParam(uid, 'topic', initTopic)
    if (dt.id==='image') {
      // 手动添加 image 时同时创建 panel
      onImageAdd?.(uid, initTopic)
      onImageTopicChange?.(uid, initTopic)
    }
  }, [onImageAdd, onImageTopicChange, rosMgr, setMapEnabled])
  const handleImportedAssetFilePick = useCallback(async (uid, file) => {
    if (!uid || !file) return

    try {
      const existing = displays.find(d => d.uid === uid)
      const visible = existing?.checked ?? true
      const result = await importLocalAssetFile(file, uid, {
        visible,
        params: existing?.params,
      })
      if (!result) return
      setDisplays(prev => prev.map(d => d.uid === uid
        ? {
            ...d,
            checked: visible,
            label: result.object?.name || file.name,
            pendingFile: false,
            params: {
              ...d.params,
              fileName: result.object?.userData?.importedAsset?.fileName || file.name,
              assetType: result.object?.userData?.importedAsset?.assetType || (file.name.toLowerCase().endsWith('.pcd') ? 'pcd' : 'ply'),
              embeddedColor: !!result.object?.userData?.importedAsset?.embeddedColor,
              isPointCloud: !!result.object?.userData?.importedAsset?.isPointCloud,
              pointCount: result.object?.userData?.importedAsset?.pointCount ?? d.params?.pointCount,
              showAxes: d.params?.showAxes ?? true,
              color: result.object?.userData?.importedAsset?.embeddedColor ? '#d7f0ff' : (d.params?.color || '#d7f0ff'),
              colorMode: result.object?.userData?.importedAsset?.embeddedColor ? 'embedded' : 'solid',
            },
          }
        : d
      ))
    } catch (error) {
      console.error('[LeftPanel] failed to import local asset:', error)
      setDisplays(prev => prev.filter(d => d.uid !== uid))
    }
  }, [])

  const handleDelete = useCallback(() => {
    if (!selectedUid) return
    const d = displays.find(x => x.uid === selectedUid)
    if (d&&d.noDel) return

    // 如果是 image 类型，通知 layout 关闭对应的 image panel
    if (d?.id === 'image') {
      onImageRemove?.(selectedUid)
    }

    // 只更新 displays 状态，effect 会自动同步到 DisplayManager/layout
    setDisplays(prev => prev.filter(item => item.uid !== selectedUid))
    setSelectedUid(null)
  }, [selectedUid, onImageRemove])
  const handleRename = useCallback(() => {
    if (!selectedUid) return
    const d = displays.find(x => x.uid === selectedUid)
    if (!d) return
    setRenameVal(d.label)
    setRenaming(true)
  }, [selectedUid, displays])
  const handleRenameCommit = useCallback(() => {
    if (renameVal.trim()) setDisplays(prev => prev.map(d => d.uid===selectedUid ? {...d,label:renameVal.trim()} : d))
    setRenaming(false)
  }, [selectedUid, renameVal])
  const toggleCheck  = useCallback((uid,val) => {
    const disp = displays.find(d => d.uid === uid)
    if (!disp) return

    // 统一更新 checked 状态
    setDisplays(prev => prev.map(d => d.uid===uid?{...d,checked:val}:d))

    // 通知 DisplayManager 当前勾选状态（由 DM 判断是否需要渲染）
    if (disp.id === 'image') {
      // image：传入勾选状态，由 DisplayManager 判断 panel 显隐
      onImageVisibleChange?.(uid, val)
    }
    // 非 image 类型：effect 会自动同步到 DisplayManager
  }, [displays, onImageVisibleChange])


  const renderParams = (d) => {
    if (d.id === 'importedasset') {
      return renderImportedAssetParams({
        d,
        PR,
        PNum,
        PSelect,
        PColor,
        onPickFile: () => {
          pendingImportUidRef.current = d.uid
          fileInputRef.current?.click()
        },
        onParamChange: (key, value) => {
          setDisplays(prev => prev.map(x => x.uid === d.uid ? { ...x, params: { ...x.params, [key]: value } } : x))
          const nextParams = { ...(d.params || {}), [key]: value }
          updateImportedAssetParams(d.uid, { [key]: value })
          SceneCommandBus.dispatch({ type: 'scene:importedasset:update', uid: d.uid, params: nextParams })
        },
      })
    }
    if (d.id==='global') return (
      <>
        <PR label="Fixed Frame" indent={1}><PSelect value={fixedFrame} onChange={e=>handleFixedFrameChange(e.target.value)}>
          {tfFrames.map(f=><option key={f} value={f}>{f}</option>)}
        </PSelect></PR>
        <PColor label="Background" defaultHex="#303030" indent={1} onChange={hex=>SceneCommandBus.dispatch({ type:'scene:background', color:hex })}/>
        <PR label="Frame Rate" indent={1}><PSelect value={fps} onChange={e=>setFps(+e.target.value)}><option value={15}>15 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option></PSelect></PR>
      </>
    )
    if (d.id==='map') return (
      <>
        <PR label="Alpha" indent={1}><input type="range" min={0} max={1} step={0.05} value={mapOpacity} onChange={e=>setMapOpacity(parseFloat(e.target.value))} style={{flex:1}}/><span className="pr-txt">{Math.round(mapOpacity*100)}%</span></PR>
        <PR label="Zoom" indent={1}><PNum value={mapZoom} step={1} min={1} max={20} onChange={e=>{const v=parseInt(e.target.value);if(!isNaN(v))setMapZoom(v)}}/></PR>
        <PR label="Longitude" indent={1}><PNum value={longitude} step={0.0001} onChange={e=>{const v=parseFloat(e.target.value);if(!isNaN(v))setLongitude(v)}}/></PR>
        <PR label="Latitude" indent={1}><PNum value={latitude} step={0.0001} onChange={e=>{const v=parseFloat(e.target.value);if(!isNaN(v))setLatitude(v)}}/></PR>
      </>
    )
    if (d.id==='grid') return (
      <>
        <PColor label="Color" defaultHex="#a0a0a4" indent={1} onChange={hex=>SceneCommandBus.dispatch({ type:'scene:grid:color', color:hex })}/>
        <PR label="Alpha" indent={1}><PNum defaultValue={0.5} step={0.05} min={0} max={1} onChange={e=>SceneCommandBus.dispatch({ type:'scene:grid:alpha', alpha:parseFloat(e.target.value)||0.5 })}/></PR>
        <PR label="Cell Count" indent={1}><PNum defaultValue={10} step={1} min={1} max={200} onChange={e=>SceneCommandBus.dispatch({ type:'scene:grid:count', count:parseInt(e.target.value)||10 })}/></PR>
        <PR label="Cell Size" indent={1}><PNum defaultValue={1} step={0.5} min={0.1} onChange={e=>SceneCommandBus.dispatch({ type:'scene:grid:size', size:parseFloat(e.target.value)||1 })}/></PR>
      </>
    )
    if (d.id==='path') return (
      <>
        <PR label="Topic" indent={1}><TopicSelect
          value={d.params?.topic||''}
          liveTopics={liveChannels}
          allowedDisplayType="path"
          onChange={v => {
            getDisplayManager().updateParam(d.uid, 'topic', v)
            setDisplays(prev => prev.map(x => x.uid===d.uid ? {...x, params:{...x.params, topic:v}} : x))
          }}
        /></PR>
        <PColor label="Color" indent={1} defaultHex={d.params?.color||'#19ff00'} onChange={v => getDisplayManager().updateParam(d.uid,'color',v)}/>
        <PR label="Alpha" indent={1}><PNum defaultValue={d.params?.alpha??1} step={0.05} min={0} max={1} onChange={e => getDisplayManager().updateParam(d.uid,'alpha',parseFloat(e.target.value)||1)}/></PR>
        <PR label="Line Style" indent={1}><PSelect value={d.params?.lineStyle||'lines'} onChange={e => getDisplayManager().updateParam(d.uid,'lineStyle',e.target.value)}><option value="lines">Lines</option><option value="billboard">Billboard</option></PSelect></PR>
      </>
    )
    if (d.id==='robotmodel') return <PR label="Topic" indent={1}><TopicSelect
      value={d.params?.topic || d.topic || '/robot_description'}
      liveTopics={liveChannels}
      allowedDisplayType="robotmodel"
      onChange={v => {
        getDisplayManager().updateParam(d.uid, 'topic', v)
        setDisplays(prev => prev.map(x => x.uid===d.uid ? {...x, topic:v, params:{...x.params, topic:v}} : x))
      }}
    /></PR>
    if (d.id==='tf') return <TfFrameTree/>
    if (d.id==='laserscan') return <PR label="Topic" indent={1}><TopicSelect value="/scan" liveTopics={liveChannels} allowedDisplayType="laserscan"/></PR>
    if (d.id==='pointcloud') return (
      <>
        <PR label="Topic" indent={1}><TopicSelect
          value={d.params?.topic||''}
          liveTopics={liveChannels}
          allowedDisplayType="pointcloud"
          onChange={v => {
            getDisplayManager().updateParam(d.uid, 'topic', v)
            setDisplays(prev => prev.map(x => x.uid===d.uid ? {...x, params:{...x.params, topic:v}} : x))
          }}
        /></PR>
        <PColor label="Color" indent={1} defaultHex={d.params?.color||'#66ccff'} onChange={v => getDisplayManager().updateParam(d.uid,'color',v)}/>
        <PR label="Alpha" indent={1}><PNum defaultValue={d.params?.alpha??1} step={0.05} min={0} max={1} onChange={e => getDisplayManager().updateParam(d.uid,'alpha',parseFloat(e.target.value)||1)}/></PR>
        <PR label="Point Size" indent={1}><PNum defaultValue={d.params?.pointSize??0.04} step={0.01} min={0.005} onChange={e => getDisplayManager().updateParam(d.uid,'pointSize',parseFloat(e.target.value)||0.04)}/></PR>
      </>
    )
    if (d.id==='image') return (
      <>
        <PR label="Topic" indent={1}>
          <TopicSelect
            value={d.params?.topic || ''}
            liveTopics={liveChannels}
            allowedDisplayType="image"
            onChange={v => {
              getDisplayManager().updateParam(d.uid, 'topic', v)
              setDisplays(prev => prev.map(x => x.uid===d.uid ? {...x, params:{...x.params, topic:v}} : x))
              onImageTopicChange?.(d.uid, v)
            }}
          />
        </PR>
      </>
    )
    if (d.id==='marker') return <PR label="Topic" indent={1}><TopicSelect value="/visualization_marker" liveTopics={liveChannels} allowedDisplayType="marker"/></PR>
    return null
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pcd,.ply"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0]
          const uid = pendingImportUidRef.current
          pendingImportUidRef.current = null
          e.target.value = ''
          if (!file || !uid) return
          await handleImportedAssetFilePick(uid, file)
        }}
      />
      <button className={`lp-show ${visible?'hidden':''}`} onClick={()=>setVisible(true)}>▶</button>
      <div className={`left-panel ${visible?'open':'closed'}`}>
        <div className="lp-hdr">
          <span className="lp-title">Displays</span>
          <button className="lp-hbtn" onClick={()=>setVisible(false)}>◀</button>
        </div>
        <div className="lp-body">
          {displays.map(d => (
            <DNode key={d.uid} label={d.label} checked={d.checked}
              onChange={v => toggleCheck(d.uid, v)}
              status={d.status} typeId={d.id}
              selected={selectedUid===d.uid}
              onSelect={()=>setSelectedUid(uid=>uid===d.uid?null:d.uid)}
              noChk={d.noChk}
            >
              {renderParams(d)}
            </DNode>
          ))}
          {displays.length===0 && <div className="lp-empty">No displays.<br/>Click Add to get started.</div>}
        </div>
        <div className="lp-actions">
          {renaming
            ? <>
                <input className="p-rgb" style={{flex:1,minWidth:0}} value={renameVal}
                  onChange={e=>setRenameVal(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter')handleRenameCommit();if(e.key==='Escape')setRenaming(false)}}
                  autoFocus/>
                <button className="lp-act-btn" onClick={handleRenameCommit}>✔</button>
                <button className="lp-act-btn" onClick={()=>setRenaming(false)}>✕</button>
              </>
            : <>
                <button className="lp-act-btn add" onClick={()=>setShowModal(true)}>Add</button>
                <button className="lp-act-btn" onClick={handleRename} disabled={!selectedUid}>Rename</button>
                <button className="lp-act-btn" onClick={handleReset}>Reset</button>
                <button className={`lp-act-btn del ${selectedUid&&!displays.find(x=>x.uid===selectedUid)?.noDel?'enabled':''}`} onClick={handleDelete} disabled={!selectedUid||!!displays.find(x=>x.uid===selectedUid)?.noDel}>Delete</button>
              </>
          }
        </div>
      </div>
      {showModal && <AddModal onAdd={handleAdd} onClose={()=>setShowModal(false)} liveChannels={liveChannels}/>}
    </>
  )
}  