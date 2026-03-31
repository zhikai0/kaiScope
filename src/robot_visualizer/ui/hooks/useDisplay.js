/**
 * useDisplay — React hook bridging LeftPanel UI ↔ DisplayManager ↔ RosDataManager
 *
 * Usage in LeftPanel (display list management):
 *   const { displays, addDisplay, removeDisplay, toggleDisplay, updateParam, globalCommand } = useDisplay()
 *
 * Usage in a render panel (data consumer):
 *   const { onData } = useDisplay()
 *   useEffect(() => onData(uid, (msg, topic) => { ... }), [uid])
 *
 * Usage in Viewport3D (scene command handler):
 *   const { registerSceneHandler } = useDisplay()
 *   useEffect(() => registerSceneHandler('scene:background', ({color}) => scene.background.set(color)), [])
 */
import { useState, useEffect, useCallback } from 'react'
import { getDisplayManager } from '../../manager/DisplayManager'
import { getSharedMgr } from './useRos'
import { SceneCommandBus, routeParam } from '../../manager/SceneCommandBus'

let _initialized = false

function ensureInit() {
  if (_initialized) return
  _initialized = true
  // Wire DisplayManager to the SAME RosDataManager singleton used by useRos
  // getSharedMgr() may return null if useRos hasn't been called yet;
  // in that case DisplayManager.setDataManager will be called later when useDisplay mounts
  const mgr = getSharedMgr()
  if (mgr) getDisplayManager().setDataManager(mgr)
}

export function useDisplay() {
  const dm = getDisplayManager()

  // Wire DisplayManager to shared mgr on first mount
  // (by this point useRos has already run and created the singleton)
  useEffect(() => {
    const mgr = getSharedMgr()
    if (mgr) dm.setDataManager(mgr)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [displays, setDisplays] = useState(() => dm.getDisplays())

  useEffect(() => {
    const onDisp = (e) => setDisplays([...e.detail.displays])
    dm.on('displays', onDisp)
    return () => dm.off('displays', onDisp)
  }, [dm])

  const addDisplay = useCallback((dtype) => {
    dm.addDisplay(dtype)
  }, [dm])

  const removeDisplay = useCallback((uid) => {
    dm.removeDisplay(uid)
  }, [dm])

  const toggleDisplay = useCallback((uid, checked) => {
    dm.toggleDisplay(uid, checked)
  }, [dm])

  /**
   * Update a display param — automatically routes to scene/data.
   * @param {string} uid
   * @param {string} key
   * @param {*} value
   */
  const updateParam = useCallback((uid, key, value) => {
    dm.updateParam(uid, key, value)
  }, [dm])

  /**
   * Send a global (non-display-specific) scene command.
   * e.g. globalCommand('global:background', '#303030')
   * @param {string} paramKey  matches PARAM_ROUTES keys like 'global:background'
   * @param {*} value
   */
  const globalCommand = useCallback((paramKey, value) => {
    routeParam('global', paramKey.replace('global:', ''), value)
  }, [])

  /**
   * Register a scene command handler in a render component.
   * Returns cleanup fn for useEffect.
   * @param {string} cmdType  e.g. 'scene:background'
   * @param {function} fn     fn(cmd)
   */
  const registerSceneHandler = useCallback((cmdType, fn) => {
    return SceneCommandBus.register(cmdType, fn)
  }, [])

  /**
   * Register a data callback for a display.
   * Returns cleanup fn.
   */
  const onData = useCallback((uid, fn) => {
    return dm.onData(uid, fn)
  }, [dm])

  return {
    displays,
    addDisplay,
    removeDisplay,
    toggleDisplay,
    updateParam,
    globalCommand,
    registerSceneHandler,
    onData,
  }
}
