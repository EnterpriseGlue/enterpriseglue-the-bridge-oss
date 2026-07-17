import { apiClient } from '../../../../shared/api/client'
import type {
  MigrationAsyncExecuteResponse,
  MigrationDirectExecuteResponse,
  MigrationExecuteRequest,
  MigrationInstruction,
  MigrationPlan,
  MigrationValidationResult,
} from '@enterpriseglue/shared/schemas/mission-control/migration.js'
export { fetchProcessDefinitionXml } from '../../shared/api/definitions'

// Types
export type { MigrationInstruction, MigrationPlan }

export type MigrationValidationReport = MigrationValidationResult

export type MigrationExecution = Omit<MigrationExecuteRequest, 'plan'> & {
  migrationPlan: MigrationPlan
}

// API Functions
export async function generateMigrationPlan(
  sourceDefinitionId: string,
  targetDefinitionId: string,
  engineId?: string
): Promise<MigrationPlan> {
  return apiClient.post<MigrationPlan>('/mission-control-api/migration/generate', {
    ...(engineId ? { engineId } : {}),
    sourceProcessDefinitionId: sourceDefinitionId,
    targetProcessDefinitionId: targetDefinitionId,
  }, { credentials: 'include' })
}

export async function validateMigrationPlan(
  plan: MigrationPlan,
  processInstanceIds?: string[],
  engineId?: string
): Promise<MigrationValidationResult> {
  return apiClient.post<MigrationValidationResult>('/mission-control-api/migration/plan/validate', {
    ...(engineId ? { engineId } : {}),
    plan,
    processInstanceIds,
  }, { credentials: 'include' })
}

export async function executeMigration(execution: MigrationExecution): Promise<MigrationDirectExecuteResponse> {
  const { migrationPlan, ...rest } = execution
  return apiClient.post<MigrationDirectExecuteResponse>('/mission-control-api/migration/execute-direct', { ...rest, plan: migrationPlan }, { credentials: 'include' })
}

export async function executeMigrationAsync(execution: MigrationExecution): Promise<MigrationAsyncExecuteResponse> {
  const { migrationPlan, ...rest } = execution
  return apiClient.post<MigrationAsyncExecuteResponse>('/mission-control-api/migration/execute-async', { ...rest, plan: migrationPlan }, { credentials: 'include' })
}
