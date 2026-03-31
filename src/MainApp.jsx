import React, { useState } from 'react'
import RobotVisualizer from './robot_visualizer'
import './MainApp.css'

// SVG 图标组件
const RobotIcon = () => (
  <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="12" y="8" width="24" height="16" rx="2" />
    <circle cx="18" cy="14" r="2" />
    <circle cx="30" cy="14" r="2" />
    <rect x="14" y="24" width="4" height="12" rx="1" />
    <rect x="30" y="24" width="4" height="12" rx="1" />
    <rect x="10" y="20" width="28" height="3" rx="1" />
  </svg>
)

const PathIcon = () => (
  <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M 8 40 Q 24 8 40 24" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="8" cy="40" r="2.5" fill="currentColor" />
    <circle cx="40" cy="24" r="2.5" fill="currentColor" />
    <path d="M 20 20 L 28 16 L 26 24 Z" fill="currentColor" />
  </svg>
)

const SerialDebugIcon = () => (
  <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="8" y="10" width="32" height="28" rx="2" />
    <line x1="12" y1="16" x2="36" y2="16" />
    <line x1="12" y1="22" x2="36" y2="22" />
    <line x1="12" y1="28" x2="28" y2="28" />
    <circle cx="14" cy="36" r="1.5" fill="currentColor" />
    <circle cx="22" cy="36" r="1.5" fill="currentColor" />
    <circle cx="30" cy="36" r="1.5" fill="currentColor" />
  </svg>
)

const MODULES = [
  { id: 'robot-visualizer', label: 'Robot Visualizer', icon: RobotIcon, desc: '3D机器人可视化与控制' },
  { id: 'serial-debug', label: 'Serial Debug', icon: SerialDebugIcon, desc: '串口调试工具' },
]

export default function MainApp() {
  const [selectedModule, setSelectedModule] = useState(null)

  return (
    <>
      {/* RobotVisualizer 始终挂载，用 display 控制显隐，保持场景状态 */}
      <div style={selectedModule === 'robot-visualizer' ? undefined : {display:'none'}} >
        <RobotVisualizer onBack={() => setSelectedModule(null)} />
      </div>

      {selectedModule !== 'robot-visualizer' && (
        <div className="main-menu">
          <div className="menu-container">
            <div className="menu-header">
              <h1>KaiScope</h1>
              <p>Visualize and Tune Your Robot</p>
            </div>
            <div className="modules-grid">
              {MODULES.map(mod => {
                const IconComponent = mod.icon
                return (
                  <button
                    key={mod.id}
                    className="module-card"
                    onClick={() => setSelectedModule(mod.id)}
                  >
                    <div className="module-icon">
                      <IconComponent />
                    </div>
                    <div className="module-label">{mod.label}</div>
                    <div className="module-desc">{mod.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
