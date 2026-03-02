/**
 * Storage keys for split pane sizes
 */
export const SPLIT_PANE_STORAGE_KEY = 'instance-detail-split-pane-size'
export const SPLIT_PANE_VERTICAL_STORAGE_KEY = 'instance-detail-split-pane-vertical-size'
export const DEFAULT_SPLIT_SIZE = '60%'
export const DEFAULT_VERTICAL_SPLIT_SIZE = '30%'

/**
 * Calculate status from runtime and history data
 */
export function calculateInstanceStatus(
  histData: any,
  runtimeData: any
): 'ACTIVE' | 'SUSPENDED' | 'CANCELED' | 'COMPLETED' | 'EXTERNALLY_TERMINATED' | 'INTERNALLY_TERMINATED' {
  if (histData?.endTime) {
    return histData?.deleteReason ? 'CANCELED' : 'COMPLETED'
  }
  if (runtimeData?.suspended) return 'SUSPENDED'
  return 'ACTIVE'
}
