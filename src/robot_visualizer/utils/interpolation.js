/**
 * Interpolation utilities
 */

/**
 * 根据目标频率计算 alpha 系数
 * @param {number} targetHz - 目标平滑频率 (Hz)
 * @param {number} dt - 帧时间差 (秒)
 * @returns {number} alpha 系数
 */
export function calcAlpha(targetHz, dt) {
  return 1 - Math.exp(-targetHz * dt)
}
