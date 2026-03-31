import * as THREE from 'three'

/**
 * CoordSystem — 坐标系约定工具
 *
 * 问题背景：
 *   ROS 使用右手 Z-up 坐标系（REP-103）：X 前、Y 左、Z 上
 *   Three.js 使用右手 Y-up 坐标系：       X 右、Y 上、Z 前（朝屏幕外）
 *
 * 解决方案：
 *   在场景中创建一个 "ROS 根节点"（rosRoot），对其做一次坐标轴变换：
 *   绕 X 轴旋转 -90°，把 Z-up 变成 Y-up。
 *   所有 ROS 数据对象（marker、robot、path 等）挂在 rosRoot 下，
 *   输入 ROS 坐标系的值即可，无需手动转换。
 *
 *   Three.js 原生对象（ground、grid、灯光、相机）直接挂 scene，不受影响。
 *
 * 使用方式：
 *   import { createRosRoot, rosVec, rosQuat } from './CoordSystem'
 *
 *   const rosRoot = createRosRoot(scene)   // 一次性初始化
 *
 *   // 之后所有 ROS 物体直接 add 到 rosRoot：
 *   rosRoot.add(myRobotGroup)
 *   rosRoot.add(myMarker.root)
 *
 *   // 设置 ROS 坐标时直接传 ROS 值（无需手动换轴）：
 *   myObject.position.copy(rosVec(ros_x, ros_y, ros_z))
 *   myObject.quaternion.copy(rosQuat(ros_qx, ros_qy, ros_qz, ros_qw))
 */

// ROS Z-up → Three.js Y-up 的旋转矩阵：绕 X 轴 -90°
const ROS_TO_THREEJS = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, 0)
)

/**
 * 创建 ROS 根节点并挂到场景。
 * 所有 ROS 坐标系下的物体都应 add 到这个节点，而不是直接 add 到 scene。
 *
 * @param {THREE.Scene} scene
 * @returns {THREE.Group} rosRoot
 */
export function createRosRoot(scene) {
  const rosRoot = new THREE.Group()
  rosRoot.name = 'ros_root'
  // 绕 X 轴旋转 -90°：ROS Z → Three.js Y，ROS Y → Three.js -Z
  rosRoot.quaternion.copy(ROS_TO_THREEJS)
  scene.add(rosRoot)
  return rosRoot
}

/**
 * 将 ROS 坐标（Z-up）转换为 Three.js Vector3（Y-up）。
 * 适用于直接操作不在 rosRoot 下的对象。
 *
 * 映射关系：
 *   ROS X → Three.js X
 *   ROS Y → Three.js -Z
 *   ROS Z → Three.js Y
 *
 * @param {number} x ROS X
 * @param {number} y ROS Y
 * @param {number} z ROS Z
 * @returns {THREE.Vector3}
 */
export function rosVec(x, y, z) {
  return new THREE.Vector3(x, z, -y)
}

/**
 * 将 ROS 四元数（Z-up）转换为 Three.js Quaternion（Y-up）。
 * 适用于直接操作不在 rosRoot 下的对象。
 *
 * @param {number} qx
 * @param {number} qy
 * @param {number} qz
 * @param {number} qw
 * @returns {THREE.Quaternion}
 */
export function rosQuat(qx, qy, qz, qw) {
  // ROS 四元数变换到 Three.js：与坐标轴变换一致
  return new THREE.Quaternion(qx, qz, -qy, qw)
}

/**
 * 相机推荐初始位置（Z-up 视角：从斜上方俯视 XY 平面）。
 * 在 Z-up 场景里，"上方" 是 ROS Z 轴，对应 Three.js Y 轴。
 * 相机放在 Y 正方向（高处）+ Z 正方向（稍微靠前），向原点看。
 *
 * @returns {{ position: THREE.Vector3, target: THREE.Vector3 }}
 */
export function recommendedCamera() {
  return {
    position: new THREE.Vector3(0, 18, 18),  // 斜上方，等效于 ROS 视角
    target:   new THREE.Vector3(0, 0, 0),
  }
}
