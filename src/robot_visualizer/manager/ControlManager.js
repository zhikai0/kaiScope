/**
 * ControlManager — 摇杆控制器（带加速度平滑）
 *
 * 摇杆映射：
 *  左摇杆 Y轴 → linear.x  （前进/后退）
 *  右摇杆 X轴 → angular.z （转向）
 *
 * 加速度平滑：
 *  目标速度 = 摇杆归一化值 × 最大速度
 *  实际速度以配置的加速度/减速度步进逼近目标值
 *  步进周期 = 1 / publishHz
 */
import { getRosDataManager } from '../data/getRosDataManager'

export class ControlManager {
  constructor() {
    // ── 可配置参数 ──────────────────────────────────────────
    this.maxLinear      = 3.0    // m/s
    this.maxAngular     = 0.5   // rad/s
    this.linearAccel    = 1.0   // m/s²  (加速)
    this.linearDecel    = 1.0   // m/s²  (减速/松杆)
    this.angularAccel   = 0.5   // rad/s²
    this.angularDecel   = 0.5   // rad/s²
    // ── 内部状态 ─────────────────────────────────────────────
    this._publishHz     = 20
    this._timer         = null
    // 目标值（摇杆输入，归一化 -1~1）
    this._targetLeftY   = 0
    this._targetRightX  = 0
    // 当前实际速度（已乘以最大速度，单位 m/s 或 rad/s）
    this._curLinear     = 0
    this._curAngular    = 0
    // 摇杆是否激活
    this._leftActive    = false
    this._rightActive   = false
  }

  // ── 配置 ────────────────────────────────────────────────────
  setConfig({ maxLinear, maxAngular, linearAccel, linearDecel, angularAccel, angularDecel } = {}) {
    if (maxLinear    != null) this.maxLinear    = maxLinear
    if (maxAngular   != null) this.maxAngular   = maxAngular

    // 统一加/减速度：内部始终使用同一个加速度值
    if (linearAccel  != null) {
      this.linearAccel = linearAccel
      this.linearDecel = linearAccel
    } else if (linearDecel != null) {
      this.linearAccel = linearDecel
      this.linearDecel = linearDecel
    }

    if (angularAccel != null) {
      this.angularAccel = angularAccel
      this.angularDecel = angularAccel
    } else if (angularDecel != null) {
      this.angularAccel = angularDecel
      this.angularDecel = angularDecel
    }
  }

  getConfig() {
    return {
      maxLinear:    this.maxLinear,
      maxAngular:   this.maxAngular,
      linearAccel:  this.linearAccel,
      linearDecel:  this.linearDecel,
      angularAccel: this.angularAccel,
      angularDecel: this.angularDecel,
    }
  }

  // ── 摇杆输入 ─────────────────────────────────────────────────

  /** 左摇杆 Y 轴激活（归一化 -1~1） */
  setLeftY(v) {
    this._targetLeftY  = Math.max(-1, Math.min(1, v))
    this._leftActive   = true
    console.log(`[ControlManager] setLeftY=${v.toFixed(3)} target=${this._targetLeftY.toFixed(3)}`)
    this._ensureTimer()
  }

  /** 左摇杆释放 */
  releaseLeft() {
    console.log('[ControlManager] releaseLeft')
    this._targetLeftY = 0
    this._leftActive  = false
    this._ensureTimer()
  }

  /** 右摇杆 X 轴激活（归一化 -1~1） */
  setRightX(v) {
    this._targetRightX = Math.max(-1, Math.min(1, v))
    this._rightActive  = true
    console.log(`[ControlManager] setRightX=${v.toFixed(3)} target=${this._targetRightX.toFixed(3)}`)
    this._ensureTimer()
  }

  /** 右摇杆释放 */
  releaseRight() {
    console.log('[ControlManager] releaseRight')
    this._targetRightX = 0
    this._rightActive  = false
    this._ensureTimer()
  }

  /** 紧急停止（直接清零，不走加速度） */
  stop() {
    this._targetLeftY   = 0
    this._targetRightX  = 0
    this._leftActive    = false
    this._rightActive   = false
    this._curLinear     = 0
    this._curAngular    = 0
    this._clearTimer()
    this._publish()
  }

  // ── 内部 ─────────────────────────────────────────────────────

  _ensureTimer() {
    if (this._timer) return
    this._timer = setInterval(() => this._tick(), 1000 / this._publishHz)
  }

  _clearTimer() {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
  }

  _tick() {
    const dt = 1 / this._publishHz

    // ── 线速度平滑 ──────────────────────────────────────
    const targetLinear = this._targetLeftY * this.maxLinear
    const diffL = targetLinear - this._curLinear
    if (Math.abs(diffL) < 0.001) {
      this._curLinear = targetLinear
    } else {
      // 统一加减速度
      const step = this.linearAccel * dt
      this._curLinear += diffL > 0 ? Math.min(step, diffL) : Math.max(-step, diffL)
    }

    // ── 角速度平滑 ──────────────────────────────────────
    const targetAngular = -this._targetRightX * this.maxAngular
    const diffA = targetAngular - this._curAngular
    if (Math.abs(diffA) < 0.001) {
      this._curAngular = targetAngular
    } else {
      const step = this.angularAccel * dt
      this._curAngular += diffA > 0 ? Math.min(step, diffA) : Math.max(-step, diffA)
    }

    this._publish()

    // 速度已归零且没有输入 → 停止定时器
    if (!this._leftActive && !this._rightActive
        && Math.abs(this._curLinear) < 0.001
        && Math.abs(this._curAngular) < 0.001) {
      this._curLinear  = 0
      this._curAngular = 0
      this._publish()  // 确保发一帧零速
      this._clearTimer()
    }
  }

  _publish() {
    const mgr = getRosDataManager()
    if (!mgr) { console.warn('[ControlManager] no RosDataManager'); return }
    const lin = +this._curLinear.toFixed(4)
    const ang = +this._curAngular.toFixed(4)
    console.log(`[ControlManager] publish linear=${lin} angular=${ang} wsState=${mgr.conn?.ws?.readyState}`)
    mgr.publishCmdVel(
      { x: this._curLinear,  y: 0, z: 0 },
      { x: 0, y: 0, z: this._curAngular }
    )
  }

  destroy() { this._clearTimer() }
}

let _instance = null
export function getControlManager() {
  if (!_instance) _instance = new ControlManager()
  return _instance
}
