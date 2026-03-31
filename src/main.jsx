import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './robot_visualizer/RobotVisualizer.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
