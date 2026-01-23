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
  setJobDefinitionRetries,
  setJobDefinitionSuspensionState,
} from '@shared/services/bpmn-engine-client.js'

export async function listJobs(engineId: string, params: any) {
  return getJobs<any[]>(engineId, params)
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
