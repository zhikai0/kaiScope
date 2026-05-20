#!/usr/bin/env python3
"""
将单机器人MuJoCo XML转换为多机器人版本
自动识别机器人body、actuator、sensor，并为每个机器人生成唯一前缀
"""
import xml.etree.ElementTree as ET
import sys
from pathlib import Path

def copy_and_rename_elements(source, target, prefix):
    """递归复制XML元素并添加前缀到name、joint、actuator、objname、site等属性"""
    for child in source:
        new_child = ET.Element(child.tag)
        
        # 复制所有属性并添加前缀
        for attr_name, attr_value in child.attrib.items():
            if attr_name == 'name':
                # 为name属性添加前缀
                new_child.set(attr_name, f"{prefix}_{attr_value}")
            elif attr_name in ['joint', 'actuator', 'objname', 'site']:
                # 为引用属性添加前缀
                new_child.set(attr_name, f"{prefix}_{attr_value}")
            else:
                # 其他属性直接复制
                new_child.set(attr_name, attr_value)
        
        # 递归处理子元素
        copy_and_rename_elements(child, new_child, prefix)
        target.append(new_child)

def generate_multi_robot_xml(
    input_file="output.xml",
    output_file="output_multi.xml",
    num_robots=5,
    robot_positions=None,  # 改为接受位置列表
    robot_body_name="root"  # 机器人body的名称
):
    """
    将单机器人XML转换为多机器人版本
    
    Args:
        input_file: 输入的单机器人XML文件
        output_file: 输出的多机器人XML文件
        num_robots: 机器人数量
        robot_positions: 机器人位置列表，格式 [(x1, y1, z1), (x2, y2, z2), ...]
                        如果为None，则使用默认位置 [(0,0,0), (10,0,0), (20,0,0), ...]
        robot_body_name: 机器人body的名称（用于识别）
    """
    
    # 读取输入文件
    tree = ET.parse(input_file)
    root = tree.getroot()
    
    # 找到worldbody
    worldbody = root.find('worldbody')
    if worldbody is None:
        print("错误：找不到worldbody元素")
        return
    
    # 找到机器人的body（name="root"的那个）
    robot_body_template = None
    for body in worldbody.findall('body'):
        if body.get('name') == robot_body_name:
            robot_body_template = body
            break
    
    if robot_body_template is None:
        print(f"错误：找不到名为 '{robot_body_name}' 的机器人body")
        return
    
    # 从worldbody中移除原始机器人body（保留场景元素）
    worldbody.remove(robot_body_template)
    
    # 找到actuator和sensor部分
    actuator_section = root.find('actuator')
    sensor_section = root.find('sensor')
    
    if actuator_section is None:
        print("错误：找不到actuator部分")
        return
    
    # 保存原始的actuator和sensor（作为模板）
    actuator_templates = list(actuator_section)
    sensor_templates = list(sensor_section) if sensor_section is not None else []
    
    # 清空actuator和sensor部分，准备重新填充
    actuator_section.clear()
    if sensor_section is not None:
        sensor_section.clear()
    else:
        sensor_section = ET.SubElement(root, 'sensor')
    
    # 如果没有提供位置列表，使用默认位置（间距10米）
    if robot_positions is None:
        robot_positions = [(i * 10.0, 0.0, 0.0) for i in range(num_robots)]
    
    # 确保位置数量与机器人数量一致
    if len(robot_positions) < num_robots:
        print(f"警告：位置数量({len(robot_positions)})少于机器人数量({num_robots})，使用默认位置填充")
        default_positions = [(i * 10.0, 0.0, 0.0) for i in range(len(robot_positions), num_robots)]
        robot_positions.extend(default_positions)
    
    # 为每个机器人生成body、actuator、sensor
    for i in range(1, num_robots + 1):
        robot_id = f"robot{i}"
        pos = robot_positions[i - 1]  # 使用指定的位置
        pos_x, pos_y, pos_z = pos
        
        # 创建机器人body
        robot_body_new = ET.Element('body', name=f"{robot_id}_root", pos=f"{pos_x} {pos_y} {pos_z}")
        copy_and_rename_elements(robot_body_template, robot_body_new, robot_id)
        worldbody.append(robot_body_new)
        
        # 创建执行器
        for act_template in actuator_templates:
            attrs = {}
            for key, value in act_template.attrib.items():
                if key in ['name', 'joint']:
                    attrs[key] = f"{robot_id}_{value}"
                else:
                    attrs[key] = value
            ET.SubElement(actuator_section, act_template.tag, **attrs)
        
        # 创建传感器（如果有）
        for sens_template in sensor_templates:
            attrs = {}
            for key, value in sens_template.attrib.items():
                if key in ['name', 'actuator', 'objname', 'site']:
                    attrs[key] = f"{robot_id}_{value}"
                else:
                    attrs[key] = value
            ET.SubElement(sensor_section, sens_template.tag, **attrs)
    
    # 格式化XML输出
    def indent(elem, level=0):
        """美化XML输出，添加缩进"""
        i = "\n" + level * "  "
        if len(elem):
            if not elem.text or not elem.text.strip():
                elem.text = i + "  "
            if not elem.tail or not elem.tail.strip():
                elem.tail = i
            for child in elem:
                indent(child, level+1)
            if not child.tail or not child.tail.strip():
                child.tail = i
        else:
            if level and (not elem.tail or not elem.tail.strip()):
                elem.tail = i
    
    indent(root)
    
    # 保存文件
    tree = ET.ElementTree(root)
    tree.write(output_file, encoding='utf-8', xml_declaration=True)
    print(f"✓ 成功生成 {num_robots} 个机器人的XML文件: {output_file}")
    print(f"  - 机器人位置:")
    for i, pos in enumerate(robot_positions[:num_robots], 1):
        print(f"    robot{i}: ({pos[0]:.2f}, {pos[1]:.2f}, {pos[2]:.2f})")

# 使用示例
if __name__ == "__main__":
    
    # 默认参数
    input_file = "output.xml"
    output_file = "output_multi.xml"
    num_robots = 2
    
    # 指定每个机器人的具体初始位置
    robot_positions = [
        (0.0, 0.0, 0.1),    # robot1的位置
        (10.0, 10.0, 0.1),   # robot2的位置
        # (20.0, 5.0, 0.0),   # robot3的位置（如果有更多机器人）
        # (30.0, -5.0, 0.0),  # robot4的位置
    ]
    
    # 从命令行参数读取（可选）
    if len(sys.argv) > 1:
        num_robots = int(sys.argv[1])
    if len(sys.argv) > 2:
        output_file = sys.argv[2]
    
    generate_multi_robot_xml(
        input_file=input_file,
        output_file=output_file,
        num_robots=num_robots,
        robot_positions=robot_positions,  # 使用具体位置列表
        robot_body_name="root"
    )
    
    import mujoco.viewer
    from body import MuJoCoBody, MuJoCoMultiRobotManager
    import time
    
    # 加载模型
    print("正在加载模型...")
    model = mujoco.MjModel.from_xml_path("output_multi.xml")
    data = mujoco.MjData(model)
    
    # 使用管理器统一管理
    manager = MuJoCoMultiRobotManager(model, data)
    print(f"✓ 检测到 {manager.get_robot_count()} 个机器人")
    print(f"✓ 机器人列表: {manager.list_robots()}")
    print()
    
    # 打印初始状态
    print("=" * 60)
    print("初始状态:")
    print("=" * 60)
    for robot_id in manager.list_robots():
        robot = manager.get_robot(robot_id)
        pos = robot.get_position()
        print(f"{robot_id}: 位置 = [{pos[0]:.2f}, {pos[1]:.2f}, {pos[2]:.2f}]")
    print()
    
    # 测试控制功能 - 打印执行器索引
    print("=" * 60)
    print("执行器索引测试:")
    print("=" * 60)
    for robot_id in manager.list_robots():
        robot = manager.get_robot(robot_id)
        print(f"{robot_id}: ctrl_start = {robot.ctrl_start}")
    print()
    
    # 测试控制命令
    print("=" * 60)
    print("测试控制命令:")
    print("=" * 60)
    print("robot1: 前进 (所有轮子速度=10.0, 转向角=0.0)")
    print("robot2: 转向 (所有轮子速度=5.0, 转向角=0.3)")
    print()
    
    # 启动仿真
    print("=" * 60)
    print("启动仿真 (按ESC退出)...")
    print("=" * 60)
    
    step_count = 0
    with mujoco.viewer.launch_passive(model, data) as viewer:
        while viewer.is_running():
            mujoco.mj_step(model, data)
            
            # 控制机器人
            if step_count < 5000:
                # 前500步：robot1前进，robot2转向
                manager.get_robot("robot1").ctrl(50.0, 50.0, 50.0, 50.0, 0.0, 0.0)
                manager.get_robot("robot2").ctrl(5.0, 5.0, 5.0, 5.0, 0.0, 0.0)
            elif step_count < 8000:
                # 500-1000步：robot1停止，robot2继续
                manager.get_robot("robot1").ctrl(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
                manager.get_robot("robot2").ctrl(50.0, 50.0, 50.0, 50.0, -0.0, -0.0)
            else:
                # 1000步后：所有机器人停止
                for robot_id in manager.list_robots():
                    manager.get_robot(robot_id).ctrl(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
            
            # 每100步打印一次状态
            if step_count % 100 == 0:
                print(f"\n步骤 {step_count}:")
                for robot_id in manager.list_robots():
                    robot = manager.get_robot(robot_id)
                    pos = robot.get_position()
                    speed = robot.get_speed()
                    heading = robot.get_heading()
                    print(f"  {robot_id}: 位置=[{pos[0]:.2f}, {pos[1]:.2f}, {pos[2]:.2f}], "
                          f"速度={speed:.2f} m/s, 航向={heading:.2f} rad")
            
            step_count += 1
            viewer.sync()
    
    # 打印最终状态
    print("\n" + "=" * 60)
    print("最终状态:")
    print("=" * 60)
    for robot_id in manager.list_robots():
        robot = manager.get_robot(robot_id)
        pos = robot.get_position()
        speed = robot.get_speed()
        print(f"{robot_id}: 位置 = [{pos[0]:.2f}, {pos[1]:.2f}, {pos[2]:.2f}], "
              f"速度 = {speed:.2f} m/s")
    print("\n仿真结束!")