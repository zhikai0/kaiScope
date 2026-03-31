/**
 * getRosDataManager — returns the SAME RosDataManager singleton used by useRos.
 * This ensures TF subscriptions, channel registry, and data flow all share one connection.
 */
import { getSharedMgr } from '../ui/hooks/useRos'

export function getRosDataManager() {
  return getSharedMgr()
}
