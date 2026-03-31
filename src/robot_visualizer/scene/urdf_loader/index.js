/**
 * urdf_loader — URDF 模型加载系统
 *
 * 架构：
 *   URDFParser  → 解析 URDF XML，提取 links/joints/geometries
 *   MeshLoader  → 加载 .dae/.stl 网格，通过后端代理获取本地文件
 *   URDFModel   → Three.js 场景对象，管理 link 树和关节变换
 *
 * 后端代理接口（需在后端实现，见 README 说明）：
 *   GET /api/urdf/file?path=/abs/path/to/file.dae   → 返回文件内容
 *   GET /api/urdf/package?pkg=ackbot&path=robots/x.dae → 返回 ROS package 内文件
 *
 * 典型用法：
 *   import { URDFModel } from './urdf_loader'
 *
 *   // 在 Viewport3D 的 scene:ready 事件后：
 *   const model = new URDFModel(rosRoot)
 *   model.loadFromTopic('/robot_description', rosDataManager)
 *
 *   // 通过 JointState topic 驱动关节：
 *   rosDataManager.subscribe('/joint_states', (msg) => {
 *     msg.name.forEach((name, i) => {
 *       model.setJointAngle(name, msg.position[i])
 *     })
 *   })
 */
export { URDFParser } from './URDFParser.js'
export { MeshLoader }  from './MeshLoader.js'
export { URDFModel }   from './URDFModel.js'
