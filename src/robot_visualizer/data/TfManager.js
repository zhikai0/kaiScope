/**
 * TfManager — 轻量级 TF 树管理器
 *
 * 功能:
 *  - 维护 static + dynamic TF 变换树
 *  - lookupTransform(target, source) 查询变换链
 *  - transformPoint(point, fromFrame, toFrame) 坐标变换
 *
 * 接口命名与 tf2 保持一致，不依赖外部 TF 库
 */

// ── Quaternion math ───────────────────────────────────────────────────────
function quatMul(a, b) {
  return {
    x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
    y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
    z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
    w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
  }
}
function quatConj(q) { return { x:-q.x, y:-q.y, z:-q.z, w:q.w } }
function quatRotVec(q, v) {
  const p  = { x:v.x, y:v.y, z:v.z, w:0 }
  const qc = quatConj(q)
  const r  = quatMul(quatMul(q, p), qc)
  return { x:r.x, y:r.y, z:r.z }
}
function composeTf(ab, bc) {
  const rot = quatRotVec(ab.rotation, bc.translation)
  return {
    translation: { x: ab.translation.x+rot.x, y: ab.translation.y+rot.y, z: ab.translation.z+rot.z },
    rotation:    quatMul(ab.rotation, bc.rotation),
  }
}
function invertTf(t) {
  const invRot   = quatConj(t.rotation)
  const invTrans = quatRotVec(invRot, { x:-t.translation.x, y:-t.translation.y, z:-t.translation.z })
  return { translation: invTrans, rotation: invRot }
}
const IDENTITY = { translation:{x:0,y:0,z:0}, rotation:{x:0,y:0,z:0,w:1} }

// ── TfManager ─────────────────────────────────────────────────────────────
export class TfManager extends EventTarget {
  constructor() {
    super()
    // childFrame -> { parentFrame, translation, rotation, stamp, isStatic }
    this._tf = new Map()
    this._staleMs = 5000
    this._timer = setInterval(() => this._cleanup(), 2000)
  }

  destroy() { clearInterval(this._timer) }

  clear() {
    this._tf.clear()
    this._emit('update', { frames: [] })
  }

  // ── Ingestion ─────────────────────────────────────────────────────────
  processTFMessage(tfMsg, isStatic = false) {
    const tfs = tfMsg?.transforms || []
    if (!tfs.length) return
    tfs.forEach(tf => {
      const child  = tf.child_frame_id
      const parent = tf.header?.frame_id || 'world'
      if (!child) return
      const stamp = tf.header?.stamp
        ? (tf.header.stamp.sec * 1000 + (tf.header.stamp.nanosec || 0) / 1e6)
        : Date.now()
      this._tf.set(child, {
        parentFrame: parent,
        translation: tf.transform?.translation || { x:0, y:0, z:0 },
        rotation:    tf.transform?.rotation    || { x:0, y:0, z:0, w:1 },
        stamp,
        isStatic,
      })
    })
    this._emit('update', { frames: this.getFrames() })
  }

  // ── Query ──────────────────────────────────────────────────────────────
  /**
   * Get all known frame IDs.
   * @returns {string[]}
   */
  getFrames() {
    const frames = new Set()
    this._tf.forEach((v, child) => { frames.add(child); frames.add(v.parentFrame) })
    return Array.from(frames)
  }

  /**
   * Look up the transform from `sourceFrame` to `targetFrame`.
   * Returns { translation, rotation } or null if path not found.
   * @param {string} targetFrame
   * @param {string} sourceFrame
   * @returns {{ translation, rotation } | null}
   */
  lookupTransform(targetFrame, sourceFrame) {
    if (targetFrame === sourceFrame) return { ...IDENTITY }

    // pathToRoot: 从 frame 往上走到根，返回沿途的 tf 列表
    // path[0] = frame 自身相对父帧的 tf，path[n-1] = 最接近根的 tf
    const pathToRoot = (frame) => {
      const path = []  // [{ childFrame, tf: {translation, rotation} }]
      let f = frame
      const visited = new Set()
      while (f && !visited.has(f)) {
        visited.add(f)
        const entry = this._tf.get(f)
        if (!entry) break
        path.push({ frame: f, parent: entry.parentFrame, translation: entry.translation, rotation: entry.rotation })
        f = entry.parentFrame
      }
      return path  // path[i].frame 是子帧，path[i].parent 是父帧
    }

    const srcPath = pathToRoot(sourceFrame)  // source → root
    const tgtPath = pathToRoot(targetFrame)  // target → root

    // 找 LCA（最近公共祖先）
    const srcAnc = new Set([sourceFrame, ...srcPath.map(p => p.parent)])
    let lca = null
    const tgtChain = [targetFrame, ...tgtPath.map(p => p.parent)]
    for (const f of tgtChain) {
      if (srcAnc.has(f)) { lca = f; break }
    }
    if (!lca) return null

    // source → LCA：沿 srcPath 向上走到 LCA，组合各段 tf
    // 每段 tf 表示：child 在 parent 坐标系里的位置
    // 从 source 到 LCA 需要把 source 的世界坐标转到 LCA 坐标系
    // 即：T(source→LCA) = 从 source 逐步往上组合
    //   先把自身 tf 转到父帧，再往上……
    // 用绝对位姿方式：T_world_source，T_world_lca，T_lca_source = inv(T_world_lca) * T_world_source

    // 计算 frame 相对根的绝对变换（T_world_frame）
    const getAbsTf = (path, stopAt) => {
      // path 是从 frame 到根的列表，stopAt 是终止祖先帧
      // 返回 frame 相对 stopAt 的变换
      let T = { ...IDENTITY }
      // path 从近到远（path[0] 是 frame 自身，path[n-1] 最接近根）
      // 从根往下组合（反序）
      const relevant = []
      for (const p of path) {
        if (p.frame === stopAt) break
        relevant.push(p)
        if (p.parent === stopAt) break
      }
      // relevant: [frame→parent, parent→grandparent, ..., child_of_lca→lca]
      // 从最远（靠近 LCA）往近（靠近 frame）依次组合
      for (let i = relevant.length - 1; i >= 0; i--) {
        const p = relevant[i]
        T = composeTf(T, { translation: p.translation, rotation: p.rotation })
      }
      return T
    }

    // T(source 相对 LCA)
    const T_lca_src = getAbsTf(srcPath, lca)
    // T(target 相对 LCA)
    const T_lca_tgt = getAbsTf(tgtPath, lca)

    // T(source 相对 target) = inv(T_lca_tgt) * T_lca_src
    const T_tgt_src = composeTf(invertTf(T_lca_tgt), T_lca_src)
    return T_tgt_src
  }

  /**
   * Transform a 3D point from one frame to another.
   * @param {{ x, y, z }} point
   * @param {string} fromFrame
   * @param {string} toFrame
   * @returns {{ x, y, z } | null}
   */
  transformPoint(point, fromFrame, toFrame) {
    const tf = this.lookupTransform(toFrame, fromFrame)
    if (!tf) return null
    const rotated = quatRotVec(tf.rotation, point)
    return {
      x: tf.translation.x + rotated.x,
      y: tf.translation.y + rotated.y,
      z: tf.translation.z + rotated.z,
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────
  _cleanup() {
    const now = Date.now()
    let changed = false
    this._tf.forEach((v, child) => {
      if (!v.isStatic && now - v.stamp > this._staleMs) {
        this._tf.delete(child)
        changed = true
      }
    })
    if (changed) this._emit('update', { frames: this.getFrames() })
  }

  /**
   * Get the full TF tree as a Map of TfNodeData.
   * Each node has:
   *   frame          {string}  — this frame's name
   *   parentFrame    {string|null} — parent frame name (null for root)
   *   relTranslation {x,y,z}  — translation relative to parent
   *   relRotation    {x,y,z,w}— rotation (quaternion) relative to parent
   *   absTranslation {x,y,z}  — translation relative to root frame
   *   absRotation    {x,y,z,w}— rotation (quaternion) relative to root frame
   * @returns {Map<string, TfNodeData>}
   */
  getTfTree() {
    const result = new Map()
    // Collect all known frames (children + their parents)
    const allFrames = new Set()
    this._tf.forEach((v, child) => { allFrames.add(child); allFrames.add(v.parentFrame) })

    // Find root frames (frames that appear as parents but not as children)
    const childFrames = new Set(this._tf.keys())
    const rootFrames  = [...allFrames].filter(f => !childFrames.has(f))

    // For each child frame, compute absolute transform by walking up to root
    const getAbs = (frame) => {
      const path = []
      let f = frame
      const visited = new Set()
      while (f && !visited.has(f) && this._tf.has(f)) {
        visited.add(f)
        const entry = this._tf.get(f)
        path.push(entry)
        f = entry.parentFrame
      }
      // Compose from root down to frame
      let T = { translation:{x:0,y:0,z:0}, rotation:{x:0,y:0,z:0,w:1} }
      for (let i = path.length - 1; i >= 0; i--) {
        T = composeTf(T, { translation: path[i].translation, rotation: path[i].rotation })
      }
      return T
    }

    // Add root frames (no parent entry in _tf)
    rootFrames.forEach(frame => {
      result.set(frame, {
        frame,
        parentFrame:    null,
        relTranslation: { x:0, y:0, z:0 },
        relRotation:    { x:0, y:0, z:0, w:1 },
        absTranslation: { x:0, y:0, z:0 },
        absRotation:    { x:0, y:0, z:0, w:1 },
      })
    })

    // Add child frames
    this._tf.forEach((entry, frame) => {
      const abs = getAbs(frame)
      result.set(frame, {
        frame,
        parentFrame:    entry.parentFrame,
        relTranslation: entry.translation,
        relRotation:    entry.rotation,
        absTranslation: abs.translation,
        absRotation:    abs.rotation,
      })
    })

    return result
  }

  _emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })) }
  on(type, fn)  { this.addEventListener(type, fn) }
  off(type, fn) { this.removeEventListener(type, fn) }
}

// Singleton
let _instance = null
export function getTfManager() {
  if (!_instance) _instance = new TfManager()
  return _instance
}

// ── Mock TF data (dev only) ───────────────────────────────────────────────
/**
 * Inject a fake robot TF tree for UI development.
 * Tree: map <- odom <- base_link <- base_laser
 *                                  <- base_camera <- camera_optical
 *                                  <- imu_link
 */
export function injectMockTfTree(mgr) {
  const fakeTfMsg = {
    transforms: [
      {
        header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
        child_frame_id: 'odom',
        transform: {
          translation: { x: 0.0,  y: 0.5,  z: 0.0 },
          rotation:    { x: 0.0,  y: 0.0,  z: 0.087,  w: 0.996 },
        },
      },
      {
        header: { frame_id: 'odom', stamp: { sec: 0, nanosec: 0 } },
        child_frame_id: 'base_link',
        transform: {
          translation: { x: 1.2,  y: 0.5,  z: 0.0 },
          rotation:    { x: 0.0,  y: 0.0,  z: 0.087, w: 0.996 }, // ~10deg yaw
        },
      },

    ],
  }
  mgr.processTFMessage(fakeTfMsg, true) // isStatic=true so it won't expire
}
