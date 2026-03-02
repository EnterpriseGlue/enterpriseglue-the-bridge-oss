/**
 * Instance Detail Module
 * 
 * Barrel export file for all instance detail components, hooks, types, and utilities.
 * This allows for cleaner imports throughout the codebase.
 */

// Table Components
export {
  LocalVariablesTable,
  GlobalVariablesTable,
  InputMappingsTable,
  OutputMappingsTable,
  DecisionInputsTable,
  DecisionOutputsTable,
} from './TableComponents'

// Icons
export { WrenchIcon } from './Icons'

// Components
export { InstanceHeader } from './InstanceHeader'
export { ActivityDetailPanel } from './ActivityDetailPanel'
export { ActivityHistoryPanel } from './ActivityHistoryPanel'
export { ActivityDetailsPanel } from './ActivityDetailsPanel'

// Utilities
export {
  SPLIT_PANE_STORAGE_KEY,
  SPLIT_PANE_VERTICAL_STORAGE_KEY,
  DEFAULT_SPLIT_SIZE,
  DEFAULT_VERTICAL_SPLIT_SIZE,
  calculateInstanceStatus,
} from './utils'
export { buildActivityGroups, buildHistoryContext } from './activityDetailUtils'

// Types
export type {
  DecisionIo,
  HistoricDecisionInstanceLite,
  ProcessDefinition,
  ActivityInstance,
  Variable,
  Incident,
  Job,
  ExternalTask,
  ModificationOperation,
} from './types'

// Hooks (for future use)
// export { useDiagramOverlays } from './hooks/useDiagramOverlays'
// export { useInstanceData } from './hooks/useInstanceData'
// export { useInstanceModification } from './hooks/useInstanceModification'
// export { useInstanceRetry } from './hooks/useInstanceRetry'
// export { useVariableEditor } from './hooks/useVariableEditor'
