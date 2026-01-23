/**
 * Mission Control external tasks service
 */

import {
  fetchAndLockExternalTasks,
  getExternalTasks,
  completeExternalTask,
  handleExternalTaskFailure,
  handleExternalTaskBpmnError,
  extendExternalTaskLock,
  unlockExternalTask,
} from '@shared/services/bpmn-engine-client.js'

export async function fetchAndLockTasks(engineId: string, body: any) {
  return fetchAndLockExternalTasks<any[]>(engineId, body)
}

export async function listExternalTasks(engineId: string, params: any) {
  return getExternalTasks<any[]>(engineId, params)
}

export async function completeTask(engineId: string, id: string, body: any) {
  return completeExternalTask(engineId, id, body)
}

export async function failTask(engineId: string, id: string, body: any) {
  return handleExternalTaskFailure(engineId, id, body)
}

export async function bpmnErrorTask(engineId: string, id: string, body: any) {
  return handleExternalTaskBpmnError(engineId, id, body)
}

export async function extendTaskLock(engineId: string, id: string, body: any) {
  return extendExternalTaskLock(engineId, id, body)
}

export async function unlockTask(engineId: string, id: string) {
  return unlockExternalTask(engineId, id)
}
