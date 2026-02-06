/**
 * Mission Control modification service
 */

import { generateId } from '@shared/utils/id.js'
import { getDataSource } from '@shared/db/data-source.js'
import { Batch } from '@shared/db/entities/Batch.js'
import {
  postProcessInstanceModification,
  postProcessDefinitionModificationAsync,
  postProcessDefinitionRestartAsync,
} from '@shared/services/bpmn-engine-client.js'

async function insertLocalBatch(type: string, engineDto: any, payload: any, engineId: string) {
  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)
  const now = Date.now()
  const id = generateId()
  await batchRepo.insert({
    id,
    engineId,
    camundaBatchId: engineDto?.id ?? null,
    type,
    payload: JSON.stringify(payload ?? {}),
    totalJobs: typeof engineDto?.totalJobs === 'number' ? engineDto.totalJobs : null,
    jobsCreated: typeof engineDto?.jobsCreated === 'number' ? engineDto.jobsCreated : null,
    invocationsPerBatchJob: typeof engineDto?.invocationsPerBatchJob === 'number' ? engineDto.invocationsPerBatchJob : null,
    seedJobDefinitionId: engineDto?.seedJobDefinitionId || null,
    monitorJobDefinitionId: engineDto?.monitorJobDefinitionId || null,
    batchJobDefinitionId: engineDto?.batchJobDefinitionId || null,
    status: 'RUNNING',
    progress: 0,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    lastError: null,
  })
  return { id }
}

export async function modifyProcessInstance(engineId: string, id: string, body: any) {
  await postProcessInstanceModification(engineId, id, body)
}

export async function modifyProcessDefinitionAsync(engineId: string, id: string, body: any) {
  const engineDto: any = await postProcessDefinitionModificationAsync<any>(engineId, id, body)
  const { id: batchId } = await insertLocalBatch('MODIFY_INSTANCES', engineDto, body, engineId)
  return { batchId, camundaBatchId: engineDto?.id }
}

export async function restartProcessDefinitionAsync(engineId: string, id: string, body: any) {
  const engineDto: any = await postProcessDefinitionRestartAsync<any>(engineId, id, body)
  const { id: batchId } = await insertLocalBatch('RESTART_INSTANCES', engineDto, body, engineId)
  return { batchId, camundaBatchId: engineDto?.id }
}
