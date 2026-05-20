import numpy as np
import mujoco

class MuJoCoBody:
    """多机器人状态数据模块 - 支持获取单个或多个机器人状态"""
    def __init__(self, model, data, robot_id=None):
        """
        Args:
            model: MuJoCo模型
            data: MuJoCo数据
            robot_id: 机器人ID（如 "robot1", "robot2"），如果为None则使用第一个机器人
        """
        self.model = model
        self.data = data
        self.robot_id = robot_id
        
        # 获取机器人body ID
        if robot_id is None:
            body_name = "robot1_root"
        else:
            body_name = f"{robot_id}_root"
        
        self.body_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, body_name)
        if self.body_id < 0:
            raise ValueError(f"找不到机器人body: {body_name}")
        
        # 通过body找到对应的joint（freejoint）
        # body_jntadr[body_id] 返回该body的第一个joint的索引
        self.joint_id = self.model.body_jntadr[self.body_id]
        if self.joint_id < 0 or self.joint_id >= self.model.njnt:
            raise ValueError(f"找不到机器人body对应的joint: {body_name}")
        
        # 获取该joint在qpos和qvel中的起始索引
        self.qpos_start = self.model.jnt_qposadr[self.joint_id]
        self.qvel_start = self.model.jnt_dofadr[self.joint_id]
            # 查找该机器人的执行器索引（用于控制）
        self.ctrl_start = self._find_ctrl_start()
    
    def _find_ctrl_start(self):
        """查找该机器人的第一个执行器在data.ctrl中的索引"""
        # 第一个执行器是 rear_left_wheel_joint
        act_name = f"{self.robot_id}_rear_left_wheel_joint"
        act_id = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_ACTUATOR, act_name)
        if act_id < 0:
            raise ValueError(f"找不到执行器: {act_name}")
        return act_id

    # === 位置和姿态 ===
    def get_position(self):
        """获取位置 [x, y, z]"""
        # 直接使用xpos获取body位置（最可靠的方法）
        return self.data.qpos[self.qpos_start:self.qpos_start+3].copy()
    
    def get_rotation(self):
        """获取旋转（四元数）[w, x, y, z]"""
        # 对于freejoint，qpos的格式是 [x, y, z, w, x, y, z]
        # 使用正确的索引
        return self.data.qpos[self.qpos_start+3:self.qpos_start+7].copy()
    
    def get_heading(self):
        """获取航向角（从四元数计算）"""
        rotation = self.get_rotation()
        if len(rotation) != 4:
            raise ValueError(f"四元数长度错误: {len(rotation)}, 期望4")
        w, x, y, z = rotation
        yaw = np.arctan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))
        return yaw
    
    # === 速度 ===
    def get_velocity(self):
        """获取线速度 [vx, vy, vz]"""
        # 对于freejoint，qvel的前3个元素是线速度
        return self.data.qvel[self.qvel_start:self.qvel_start+3].copy()
    
    def get_angular_velocity(self):
        """获取角速度 [ωx, ωy, ωz]"""
        # 对于freejoint，qvel的后3个元素是角速度
        return self.data.qvel[self.qvel_start+3:self.qvel_start+6].copy()
    
    def get_speed(self):
        """获取速度大小"""
        velocity = self.get_velocity()
        return np.linalg.norm(velocity)
    
    def get_angular_speed(self):
        """获取角速度大小"""
        angular_velocity = self.get_angular_velocity()
        return np.linalg.norm(angular_velocity)
    
    def ctrl(self,omega_rear_left, omega_rear_right, omega_front_left, omega_front_right,
                steering_left, steering_right):
        self.data.ctrl[self.ctrl_start:self.ctrl_start+6] = [omega_rear_left, omega_rear_right, omega_front_left, omega_front_right,
                                                         steering_left, steering_right]

    # === 完整状态 ===
    def get_body_state(self):
        """获取完整状态"""
        return {
            'position': self.get_position(),
            'rotation': self.get_rotation(),
            'linear_velocity': self.get_velocity(),
            'angular_velocity': self.get_angular_velocity(),
            'speed': self.get_speed(),
            'angular_speed': self.get_angular_speed(),
            'heading': self.get_heading()
        }


class MuJoCoMultiRobotManager:
    """多机器人管理器 - 统一管理所有机器人"""
    def __init__(self, model, data):
        self.model = model
        self.data = data
        self.robots = {}
        
        # 自动检测所有机器人
        self._detect_robots()
    
    def _detect_robots(self):
        """自动检测所有机器人"""
        for i in range(self.model.nbody):
            body_name = mujoco.mj_id2name(self.model, mujoco.mjtObj.mjOBJ_BODY, i)
            if body_name and body_name.endswith("_root") and body_name.startswith("robot"):
                robot_id = body_name.replace("_root", "")
                self.robots[robot_id] = MuJoCoBody(self.model, self.data, robot_id)
    
    def get_robot(self, robot_id):
        """获取指定机器人的状态对象"""
        if robot_id not in self.robots:
            raise ValueError(f"找不到机器人: {robot_id}")
        return self.robots[robot_id]
    
    def get_all_robots_state(self):
        """获取所有机器人的状态"""
        states = {}
        for robot_id, robot in self.robots.items():
            states[robot_id] = robot.get_body_state()
        return states
    
    def get_robot_count(self):
        """获取机器人数量"""
        return len(self.robots)
    
    def list_robots(self):
        """列出所有机器人ID"""
        return list(self.robots.keys())


# 使用示例
if __name__ == "__main__":
    import mujoco.viewer
    
    # 加载模型
    model = mujoco.MjModel.from_xml_path("output_multi.xml")
    data = mujoco.MjData(model)
    
    # 方式1: 创建单个机器人状态对象
    robot1 = MuJoCoBody(model, data, "robot1")
    print("机器人1位置:", robot1.get_position())
    print("机器人1状态:", robot1.get_body_state())
    
    robot2 = MuJoCoBody(model, data, "robot2")
    print("机器人2位置:", robot2.get_position())
    
    # 方式2: 使用管理器统一管理
    manager = MuJoCoMultiRobotManager(model, data)
    print(f"检测到 {manager.get_robot_count()} 个机器人")
    print("机器人列表:", manager.list_robots())
    
    # 获取所有机器人状态
    all_states = manager.get_all_robots_state()
    for robot_id, state in all_states.items():
        print(f"{robot_id} 位置: {state['position']}")
    
    # 在仿真循环中使用
    with mujoco.viewer.launch_passive(model, data) as viewer:
        while viewer.is_running():
            mujoco.mj_step(model, data)
            
            # 获取所有机器人状态
            for robot_id in manager.list_robots():
                robot = manager.get_robot("robot1")
                pos = robot.get_position()
                heading = robot.get_heading()
                speed = robot.get_speed()
                # 根据状态进行控制...
            
            viewer.sync()