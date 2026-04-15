from launch import LaunchDescription
from launch_ros.actions import Node
from launch.actions import DeclareLaunchArgument, ExecuteProcess, TimerAction, IncludeLaunchDescription
from launch.conditions import IfCondition, UnlessCondition
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.substitutions import FindPackageShare
from launch.launch_description_sources import PythonLaunchDescriptionSource

def generate_launch_description():
    # 声明参数
    output_arg = DeclareLaunchArgument(
        'output',
        default_value='screen',
        description='output mode: [screen,log,both]',
        choices=['screen', 'log', 'both']

    )
    return LaunchDescription([
        output_arg,
        # 启动foxglove_bridge
        Node(
            package='foxglove_bridge',
            executable='foxglove_bridge',
            output=LaunchConfiguration('output'),
            parameters=[{'port': 8765,}],
        ),
        TimerAction(
            period=3.0,
            actions=[
                ExecuteProcess(
                    cmd=['pnpm', 'run', 'dev','--host'],
                    output=LaunchConfiguration('output'),
                    additional_env={'PYTHONUNBUFFERED': '1', 'PYTHONIOENCODING': 'utf-8'},
                ),
            ]
        ),
    ])