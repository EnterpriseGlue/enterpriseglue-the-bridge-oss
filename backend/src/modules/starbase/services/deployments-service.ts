/**
 * Starbase deployments service
 */

import {
  getDeployments,
  getDeployment,
  deleteDeployment,
  getProcessDefinitionDiagram,
} from '@shared/services/bpmn-engine-client.js'

export async function listDeployments(engineId: string, params: any) {
  return getDeployments<any[]>(engineId, params)
}

export async function fetchDeploymentById(engineId: string, id: string) {
  return getDeployment<any>(engineId, id)
}

export async function removeDeployment(engineId: string, id: string, cascade: boolean) {
  return deleteDeployment(engineId, id, cascade)
}

export async function fetchProcessDefinitionDiagram(engineId: string, id: string) {
  return getProcessDefinitionDiagram<any>(engineId, id)
}
