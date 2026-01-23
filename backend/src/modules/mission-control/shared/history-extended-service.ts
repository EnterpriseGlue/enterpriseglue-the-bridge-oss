/**
 * Mission Control history (extended) service
 */

import {
  getHistoricTaskInstances,
  getHistoricVariableInstances,
  getHistoricDecisionInstances,
  getHistoricDecisionInstanceInputs,
  getHistoricDecisionInstanceOutputs,
  getUserOperationLog,
} from '@shared/services/bpmn-engine-client.js'

export async function listHistoricTasks(engineId: string, params: any) {
  return getHistoricTaskInstances<any[]>(engineId, params)
}

export async function listHistoricVariables(engineId: string, params: any) {
  return getHistoricVariableInstances<any[]>(engineId, params)
}

export async function listHistoricDecisions(engineId: string, params: any) {
  return getHistoricDecisionInstances<any[]>(engineId, params)
}

export async function listHistoricDecisionInputs(engineId: string, id: string) {
  return getHistoricDecisionInstanceInputs<any[]>(engineId, id)
}

export async function listHistoricDecisionOutputs(engineId: string, id: string) {
  return getHistoricDecisionInstanceOutputs<any[]>(engineId, id)
}

export async function listUserOperations(engineId: string, params: any) {
  return getUserOperationLog<any[]>(engineId, params)
}
