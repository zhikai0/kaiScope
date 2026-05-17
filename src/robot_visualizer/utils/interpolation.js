/**
 * Interpolation utilities for smooth following
 * 通用平滑插值工具
 */

import * as THREE from 'three'

/**
 * 创建平滑跟随状态
 * @param {THREE.Vector3} initialPos - 初始位置
 * @param {THREE.Quaternion} initialQuat - 初始旋转
 * @returns {{ pos, quat, targetPos, targetQuat }}
 */
export function createSmoothFollowState(initialPos, initialQuat) {
  return {
    pos: initialPos?.clone() ?? new THREE.Vector3(),
    quat: initialQuat?.clone() ?? new THREE.Quaternion(),
    targetPos: new THREE.Vector3(),
    targetQuat: new THREE.Quaternion(),
  }
}

/**
 * 更新平滑跟随状态
 * @param {object} state - createSmoothFollowState 返回的状态
 * @param {object} target - { translation: {x,y,z}, rotation: {x,y,z,w} }
 * @param {number} alpha - 插值系数 (0-1)，越大跟随越快
 */
export function updateSmoothFollow(state, target, alpha) {
  const { translation: t, rotation: q } = target
  state.targetPos.set(t.x, t.y, t.z)
  state.targetQuat.set(q.x, q.y, q.z, q.w ?? 1)
  state.pos.lerp(state.targetPos, alpha)
  state.quat.slerp(state.targetQuat, alpha)
}

/**
 * 根据目标频率计算 alpha 系数
 * @param {number} targetHz - 目标平滑频率 (Hz)
 * @param {number} dt - 帧时间差 (秒)
 * @returns {number} alpha 系数
 */
export function calcAlpha(targetHz, dt) {
  return 1 - Math.exp(-targetHz * dt)
}

/**
 * 对连续值（如关节角度）进行平滑插值
 * @param {number} current - 当前值
 * @param {number} target - 目标值
 * @param {number} alpha - 插值系数
 * @returns {number} 插值后的值
 */
export function lerpAngle(current, target, alpha) {
  let diff = target - current
  // 归一化到 [-PI, PI]
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return current + diff * alpha
}
