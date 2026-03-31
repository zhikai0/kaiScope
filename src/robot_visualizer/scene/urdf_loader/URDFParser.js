/**
 * URDFParser — 解析 URDF XML 字符串
 *
 * 输出结构：
 * {
 *   name: string,
 *   links: Map<name, { name, visuals: [{origin, geometry, material}] }>,
 *   joints: Map<name, { name, type, parent, child, origin, axis, limit }>,
 * }
 */
export class URDFParser {
  /**
   * 解析 URDF XML 字符串
   * @param {string} urdfText  URDF XML 文本
   * @returns {{ name, links, joints }}
   */
  static parse(urdfText) {
    const parser = new DOMParser()
    const doc    = parser.parseFromString(urdfText, 'text/xml')
    const robot  = doc.querySelector('robot')
    if (!robot) throw new Error('[URDFParser] No <robot> element found')

    const name   = robot.getAttribute('name') || 'robot'
    const links  = new Map()
    const joints = new Map()

    // ── Links — 只取 robot 直接子元素 ─────────────────────────────────
    Array.from(robot.children).filter(el => el.tagName === 'link').forEach(el => {
      const linkName = el.getAttribute('name')
      const visuals  = []

      el.querySelectorAll('visual').forEach(vis => {
        const origin   = URDFParser._parseOrigin(vis.querySelector('origin'))
        const geomEl   = vis.querySelector('geometry')
        const geometry = URDFParser._parseGeometry(geomEl)
        const matEl    = vis.querySelector('material')
        const material = matEl ? {
          name:    matEl.getAttribute('name') || '',
          texture: matEl.querySelector('texture')?.getAttribute('filename') || null,
          color:   URDFParser._parseColor(matEl.querySelector('color')),
        } : null

        if (geometry) visuals.push({ origin, geometry, material })
      })

      links.set(linkName, { name: linkName, visuals })
    })

    // ── Joints — 只取 robot 直接子元素，避免 <gazebo> 内重复 joint ────
    Array.from(robot.children).filter(el => el.tagName === 'joint').forEach(el => {
      const jointName = el.getAttribute('name')
      const type      = el.getAttribute('type') || 'fixed'
      const parent    = el.querySelector('parent')?.getAttribute('link') || ''
      const child     = el.querySelector('child')?.getAttribute('link')  || ''
      const origin    = URDFParser._parseOrigin(el.querySelector('origin'))
      const axisEl    = el.querySelector('axis')
      const axis      = axisEl ? URDFParser._parseXYZ(axisEl.getAttribute('xyz')) : { x:0, y:0, z:1 }
      const limitEl   = el.querySelector('limit')
      const limit     = limitEl ? {
        lower:    parseFloat(limitEl.getAttribute('lower') ?? '-Infinity'),
        upper:    parseFloat(limitEl.getAttribute('upper') ?? 'Infinity'),
        effort:   parseFloat(limitEl.getAttribute('effort') ?? '0'),
        velocity: parseFloat(limitEl.getAttribute('velocity') ?? '0'),
      } : null

      joints.set(jointName, { name: jointName, type, parent, child, origin, axis, limit })
    })

    return { name, links, joints }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  static _parseOrigin(el) {
    if (!el) return { xyz: {x:0,y:0,z:0}, rpy: {r:0,p:0,y:0} }
    const xyz = URDFParser._parseXYZ(el.getAttribute('xyz'))
    const rpy = URDFParser._parseRPY(el.getAttribute('rpy'))
    return { xyz, rpy }
  }

  static _parseXYZ(str) {
    if (!str) return { x:0, y:0, z:0 }
    const [x=0, y=0, z=0] = str.trim().split(/\s+/).map(Number)
    return { x, y, z }
  }

  static _parseRPY(str) {
    if (!str) return { r:0, p:0, y:0 }
    const [r=0, p=0, y=0] = str.trim().split(/\s+/).map(Number)
    return { r, p, y }
  }

  static _parseColor(el) {
    if (!el) return null
    const rgba = el.getAttribute('rgba')
    if (!rgba) return null
    const [r=1,g=1,b=1,a=1] = rgba.trim().split(/\s+/).map(Number)
    return { r, g, b, a }
  }

  static _parseGeometry(el) {
    if (!el) return null
    const mesh = el.querySelector('mesh')
    if (mesh) return { type: 'mesh', filename: mesh.getAttribute('filename') || '', scale: URDFParser._parseXYZ(mesh.getAttribute('scale')) }
    const box = el.querySelector('box')
    if (box) {
      const s = URDFParser._parseXYZ(box.getAttribute('size'))
      return { type: 'box', size: s }
    }
    const cyl = el.querySelector('cylinder')
    if (cyl) return { type: 'cylinder', radius: parseFloat(cyl.getAttribute('radius')||0), length: parseFloat(cyl.getAttribute('length')||0) }
    const sph = el.querySelector('sphere')
    if (sph) return { type: 'sphere', radius: parseFloat(sph.getAttribute('radius')||0) }
    return null
  }
}
