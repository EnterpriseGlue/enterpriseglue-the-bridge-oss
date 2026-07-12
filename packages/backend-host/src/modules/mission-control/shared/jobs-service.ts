/**
 * Mission Control jobs service
 */

import {
  getJobs,
  getJob,
  executeJob,
  setJobRetries,
  setJobSuspensionState,
  getJobDefinitions,
  camundaGet,
  setJobDefinitionRetries,
  setJobDefinitionSuspensionState,
} from '@enterpriseglue/shared/services/bpmn-engine-client.js'

export async function listJobs(engineId: string, params: any) {
  return getJobs<any[]>(engineId, params)
}

/**
 * Jobs and job definitions inherit access from their referenced process
 * definition. Resolve only the distinct definition ids returned by the engine
 * and never return an item when its lineage cannot be resolved.
 */
export async function filterRuntimeItemsByProcessDefinitionKeys<T extends { processDefinitionId?: unknown }>(
  engineId: string,
  items: T[],
  authorizedDefinitionKeys?: string[],
): Promise<T[]> {
  if (!authorizedDefinitionKeys) return items

  const allowedKeys = new Set(authorizedDefinitionKeys)
  const definitionIds = [...new Set(items
    .map((item) => item.processDefinitionId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0))]
  const definitions = await Promise.all(definitionIds.map(async (id) => [
    id,
    await camundaGet<Record<string, unknown>>(engineId, `/process-definition/${encodeURIComponent(id)}`),
  ] as const))
  const keyByDefinitionId = new Map(definitions.map(([id, definition]) => [
    id,
    typeof definition.key === 'string' ? definition.key : '',
  ]))

  return items.filter((item) => {
    const definitionId = typeof item.processDefinitionId === 'string' ? item.processDefinitionId : ''
    return allowedKeys.has(keyByDefinitionId.get(definitionId) || '')
  })
}

export async function getJobById(engineId: string, id: string) {
  return getJob<any>(engineId, id)
}

export async function executeJobById(engineId: string, id: string) {
  return executeJob(engineId, id)
}

export async function setJobRetriesById(engineId: string, id: string, body: any) {
  return setJobRetries(engineId, id, body)
}

export async function setJobSuspensionStateById(engineId: string, id: string, body: any) {
  return setJobSuspensionState(engineId, id, body)
}

export async function listJobDefinitions(engineId: string, params: any) {
  return getJobDefinitions<any[]>(engineId, params)
}

export async function setJobDefinitionRetriesById(engineId: string, id: string, body: any) {
  return setJobDefinitionRetries(engineId, id, body)
}

export async function setJobDefinitionSuspensionStateById(engineId: string, id: string, body: any) {
  return setJobDefinitionSuspensionState(engineId, id, body)
}
