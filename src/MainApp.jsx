import React, { useState } from 'react'
import RobotVisualizer from './robot_visualizer'
import SerialDebugApp from './serial_debug'
import { useLocalPersist } from './robot_visualizer/ui/hooks/useLocalPersist'
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
  const [selectedModule, setSelectedModule] = useLocalPersist('kaiscope-module', null)
  const [hasOpenedRobot, setHasOpenedRobot] = useLocalPersist('kaiscope-opened-robot', false)
  const [hasOpenedSerial, setHasOpenedSerial] = useLocalPersist('kaiscope-opened-serial', false)

  return (
    <>
      {/* 首次进入 RobotVisualizer 时才挂载；之后保持挂载，用 display 控制显隐 */}
      {hasOpenedRobot && (
        <div style={selectedModule === 'robot-visualizer' ? undefined : { display: 'none' }}>
          <RobotVisualizer onBack={() => setSelectedModule(null)} />
        </div>
      )}

      {hasOpenedSerial && (
        <div style={selectedModule === 'serial-debug' ? undefined : { display: 'none' }}>
          <SerialDebugApp onBack={() => setSelectedModule(null)} />
        </div>
      )}

      {selectedModule !== 'robot-visualizer' && selectedModule !== 'serial-debug' && (
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
                    onClick={() => {
                      if (mod.id === 'robot-visualizer') setHasOpenedRobot(true)
                      if (mod.id === 'serial-debug') setHasOpenedSerial(true)
                      setSelectedModule(mod.id)
                    }}
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
