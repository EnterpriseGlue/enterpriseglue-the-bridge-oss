import { apiClient } from '../../../../shared/api/client'
export { fetchProcessDefinitionXml } from '../../shared/api/definitions'

// Types
export type MigrationPlan = {
  sourceProcessDefinitionId: string
  targetProcessDefinitionId: string
  instructions: MigrationInstruction[]
}

export type MigrationInstruction = {
  sourceActivityIds: string[]
  targetActivityIds: string[]
  updateEventTrigger?: boolean
}

export type MigrationValidationReport = {
  instructionReports: InstructionReport[]
}

export type InstructionReport = {
  instruction: MigrationInstruction
  failures: string[]
}

export type MigrationExecution = {
  migrationPlan: MigrationPlan
  processInstanceIds?: string[]
  processInstanceQuery?: Record<string, unknown>
  skipCustomListeners?: boolean
  skipIoMappings?: boolean
}

// API Functions
export async function generateMigrationPlan(
  sourceDefinitionId: string,
  targetDefinitionId: string
): Promise<MigrationPlan> {
  return apiClient.post<MigrationPlan>('/mission-control-api/migration/generate', {
    sourceProcessDefinitionId: sourceDefinitionId,
    targetProcessDefinitionId: targetDefinitionId,
  }, { credentials: 'include' })
}

export async function validateMigrationPlan(
  plan: MigrationPlan,
  processInstanceIds?: string[]
): Promise<MigrationValidationReport> {
  return apiClient.post<MigrationValidationReport>('/mission-control-api/migration/validate', {
    migrationPlan: plan,
    processInstanceIds,
  }, { credentials: 'include' })
}

export async function executeMigration(execution: MigrationExecution): Promise<void> {
  await apiClient.post<void>('/mission-control-api/migration/execute', execution, { credentials: 'include' })
}

export async function executeMigrationAsync(execution: MigrationExecution): Promise<{ id: string }> {
  return apiClient.post<{ id: string }>('/mission-control-api/migration/executeAsync', execution, { credentials: 'include' })
}
