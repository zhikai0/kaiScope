import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useSimStore = create(
  persist(
    (set, get) => ({
      // Connection — 运行时状态，不持久化
      backendConnected: false,
      isRunning: false,
      isPaused: false,

      // Active tool
      activeTool: 'OBSTACLES',

      // Planner
      plannerMode: 'DWA-ONLINE',
      plannerModes: ['DWA-ONLINE', 'DWA', 'DOR', 'TMPC'],

      // Camera
      cameraMode: 'FREE',
      cameraModes: ['BIRD', 'FPV', 'CHASE', 'FREE'],

      // Scene
      scenePreset: 'DEFAULT',
      scenePresets: ['DEFAULT', 'EMPTY', 'SPARSE'],

      // Params
      params: {
        predictTime: 3.0,
        dt: 0.1,
        vReso: 0.01,
        wReso: 0.01,
        replanInterval: 0.5,
        lookaheadDist: 2.0,
        pathSpeed: 1.0,
        wGoal: 1.0,
        wObs: 1.0,
        wSpeed: 0.5,
        esdfResolution: 0.1,
        esdfWidth: 20.0,
        esdfHeight: 20.0,
        esdfMaxDistance: 3.0,
      },

      // Visualization
      visualization: {
        showPath: true,
        showHistory: true,
        showCandidates: false,
        showBest: true,
      },

      // Scene objects
      obstacles: [
        { id: 1, type: 'box',      x: -3,  z:  2,  w: 1,   h: 1, d: 1   },
        { id: 2, type: 'box',      x:  3,  z: -1,  w: 1,   h: 1, d: 1   },
        { id: 3, type: 'cylinder', x: -1,  z: -3,  r: 0.5, h: 1         },
        { id: 4, type: 'box',      x:  4,  z:  3,  w: 0.8, h: 1, d: 0.8 },
        { id: 5, type: 'cylinder', x:  2,  z:  2,  r: 0.4, h: 1         },
      ],
      goals: [
        { id: 1, x: -4, z: -3 },
        { id: 2, x:  4, z:  1 },
      ],

      // 运行时状态，不持久化
      robot: { x: 0, y: 0, theta: 0, vx: 0, vy: 0, w: 0 },
      trajectory: [],
      historyPath: [],

      // Actions
      setIsRunning:   (v) => set({ isRunning: v }),
      setIsPaused:    (v) => set({ isPaused: v }),
      setActiveTool:  (v) => set({ activeTool: v }),
      setPlannerMode: (v) => set({ plannerMode: v }),
      setCameraMode:  (v) => set({ cameraMode: v }),
      setScenePreset: (v) => set({ scenePreset: v }),

      setParam: (key, value) => set(s => ({ params: { ...s.params, [key]: value } })),
      setVisualization: (key, value) => set(s => ({ visualization: { ...s.visualization, [key]: value } })),

      // Scene rendering commands (used by SceneCommandBus → Viewport3D)
      sceneCommands: null,  // ref to THREE scene objects — set by Viewport3D
      setSceneRef: (ref) => set({ sceneCommands: ref }),

      resetScene: () => set({
        isRunning: false, isPaused: false,
        robot: { x: 0, y: 0, theta: 0, vx: 0, vy: 0, w: 0 },
        trajectory: [], historyPath: [],
      }),

      randomizeObstacles: () => {
        const obs = []
        for (let i = 0; i < 6; i++) {
          const type = Math.random() > 0.5 ? 'box' : 'cylinder'
          obs.push({
            id: i + 1, type,
            x: (Math.random() - 0.5) * 14,
            z: (Math.random() - 0.5) * 14,
            w: 0.6 + Math.random() * 0.8, h: 1,
            d: 0.6 + Math.random() * 0.8,
            r: 0.3 + Math.random() * 0.4,
          })
        }
        set({ obstacles: obs })
      },

      updateRobot:    (robot) => set({ robot }),
      setTrajectory:  (trajectory) => set({ trajectory }),
      appendHistory:  (point) => set(s => ({ historyPath: [...s.historyPath.slice(-200), point] })),
    }),
    {
      name: 'kaiscope-sim-store',
      // 只持久化配置和场景物体，不持久化运行时状态
      partialize: (state) => ({
        activeTool:   state.activeTool,
        plannerMode:  state.plannerMode,
        cameraMode:   state.cameraMode,
        scenePreset:  state.scenePreset,
        params:       state.params,
        visualization: state.visualization,
        obstacles:    state.obstacles,
        goals:        state.goals,
      }),
    }
  )
)
