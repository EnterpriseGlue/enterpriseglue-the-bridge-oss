/**
 * Mission Control decision service
 */

import {
  camundaPost,
  getDecisionDefinitions,
  getDecisionDefinition,
  getDecisionDefinitionXml,
  evaluateDecision,
} from '@shared/services/bpmn-engine-client.js'

export async function listDecisionDefinitions(engineId: string, params: any) {
  return getDecisionDefinitions<any[]>(engineId, params)
}

export async function fetchDecisionDefinition(engineId: string, id: string) {
  return getDecisionDefinition<any>(engineId, id)
}

export async function fetchDecisionDefinitionXml(engineId: string, id: string) {
  return getDecisionDefinitionXml<any>(engineId, id)
}

export async function evaluateDecisionById(engineId: string, id: string, body: any) {
  return evaluateDecision<any>(engineId, id, body)
}

export async function evaluateDecisionByKey(engineId: string, key: string, body: any) {
  return camundaPost<any>(engineId, `/decision-definition/key/${encodeURIComponent(key)}/evaluate`, body)
}
