/**
 * Mission Control tasks service
 */

import {
  getTasks,
  getTask,
  getTaskCount,
  claimTask,
  unclaimTask,
  setTaskAssignee,
  completeTask,
  getTaskVariables,
  updateTaskVariables,
  getTaskForm,
} from '@shared/services/bpmn-engine-client.js'

export async function listTasks(engineId: string, params: any) {
  return getTasks<any[]>(engineId, params)
}

export async function getTaskCountByQuery(engineId: string, params: any) {
  return getTaskCount<any>(engineId, params)
}

export async function getTaskById(engineId: string, id: string) {
  return getTask<any>(engineId, id)
}

export async function getTaskVariablesById(engineId: string, id: string) {
  return getTaskVariables<any>(engineId, id)
}

export async function updateTaskVariablesById(engineId: string, id: string, body: any) {
  return updateTaskVariables<any>(engineId, id, body)
}

export async function getTaskFormById(engineId: string, id: string) {
  return getTaskForm<any>(engineId, id)
}

export async function claimTaskById(engineId: string, id: string, body: any) {
  return claimTask(engineId, id, body)
}

export async function unclaimTaskById(engineId: string, id: string) {
  return unclaimTask(engineId, id)
}

export async function setTaskAssigneeById(engineId: string, id: string, body: any) {
  return setTaskAssignee(engineId, id, body)
}

export async function completeTaskById(engineId: string, id: string, body: any) {
  return completeTask<any>(engineId, id, body)
}
