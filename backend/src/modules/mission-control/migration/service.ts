/**
 * Mission Control migration service
 * Encapsulates engine migration calls and local batch creation.
 */

import { randomUUID } from 'crypto'
import { getDataSource } from '@shared/db/data-source.js'
import { Batch } from '@shared/db/entities/Batch.js'
import {
  postMigrationGenerate,
  postMigrationValidate,
  postMigrationExecuteAsync,
  postMigrationExecute,
  getProcessInstanceActivityTree,
  getProcessInstanceCount,
} from '@shared/services/bpmn-engine-client.js'

export function toEnginePlan(body: any) {
  // Engine-like shape: normalize instructions and strip extras
  if (body?.sourceProcessDefinitionId && body?.targetProcessDefinitionId) {
    const instructions = Array.isArray(body.instructions)
      ? body.instructions.map((i: any) => ({
          sourceActivityIds: Array.isArray(i?.sourceActivityIds) ? i.sourceActivityIds : [],
          targetActivityIds: Array.isArray(i?.targetActivityIds)
            ? i.targetActivityIds
            : (i?.targetActivityId ? [i.targetActivityId] : []),
          updateEventTrigger: !!i?.updateEventTrigger,
        }))
      : []
    return {
      sourceProcessDefinitionId: body.sourceProcessDefinitionId,
      targetProcessDefinitionId: body.targetProcessDefinitionId,
      instructions,
      updateEventTriggers: !!body.updateEventTriggers,
    }
  }
  const src = body?.sourceDefinitionId
  const tgt = body?.targetDefinitionId
  const updateEventTriggers = !!body?.updateEventTriggers
  const overrides = Array.isArray(body?.overrides) ? body.overrides : []
  const instructions = overrides
    .map((o: any) => ({
      sourceActivityIds: Array.isArray(o?.sourceActivityIds)
        ? o.sourceActivityIds
        : (o?.sourceActivityId ? [o.sourceActivityId] : []),
      // Camunda accepts targetActivityId; some versions accept targetActivityIds
      targetActivityId:
        o?.targetActivityId ?? (Array.isArray(o?.targetActivityIds) ? o.targetActivityIds[0] : undefined),
      updateEventTrigger: o?.updateEventTrigger ?? undefined,
    }))
    .filter((i: any) => i.sourceActivityIds?.length && i.targetActivityId)
  return {
    sourceProcessDefinitionId: src,
    targetProcessDefinitionId: tgt,
    instructions: instructions.map((i: any) => ({
      sourceActivityIds: i.sourceActivityIds,
      targetActivityIds: i.targetActivityId ? [i.targetActivityId] : [],
      updateEventTrigger: !!i.updateEventTrigger,
    })),
    updateEventTriggers,
  }
}

async function insertLocalBatch(type: string, camundaBatchId: string, payload: any, engineDto: any, engineId: string) {
  const dataSource = await getDataSource()
  const batchRepo = dataSource.getRepository(Batch)
  const now = Date.now()
  const id = randomUUID()
  const totalJobs = typeof engineDto?.totalJobs === 'number' ? engineDto.totalJobs : null
  const jobsCreated = typeof engineDto?.jobsCreated === 'number' ? engineDto.jobsCreated : null
  const invocationsPerBatchJob = typeof engineDto?.invocationsPerBatchJob === 'number' ? engineDto.invocationsPerBatchJob : null
  const seedJobDefinitionId = engineDto?.seedJobDefinitionId || null
  const monitorJobDefinitionId = engineDto?.monitorJobDefinitionId || null
  const batchJobDefinitionId = engineDto?.batchJobDefinitionId || null
  await batchRepo.insert({
    id,
    engineId,
    camundaBatchId,
    type,
    payload: JSON.stringify(payload ?? {}),
    totalJobs,
    jobsCreated,
    invocationsPerBatchJob,
    seedJobDefinitionId,
    monitorJobDefinitionId,
    batchJobDefinitionId,
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

export async function previewMigrationCount(engineId: string, plan: any, processInstanceIds?: string[]) {
  if (Array.isArray(processInstanceIds) && processInstanceIds.length > 0) {
    return processInstanceIds.length
  }
  const enginePlan = toEnginePlan(plan)
  const srcDefId = enginePlan?.sourceProcessDefinitionId
  if (!srcDefId) throw new Error('sourceProcessDefinitionId required')
  const dto: any = await getProcessInstanceCount<any>(engineId, { processDefinitionId: srcDefId })
  return typeof dto?.count === 'number' ? dto.count : 0
}

export async function generateMigrationPlan(engineId: string, planBody: any) {
  const plan = toEnginePlan(planBody)
  return postMigrationGenerate<any>(engineId, plan)
}

export async function validateMigrationPlan(engineId: string, body: any) {
  const incoming = body?.plan ?? body
  const plan = toEnginePlan(incoming)
  return postMigrationValidate<any>(engineId, plan)
}

export async function executeMigrationAsync(engineId: string, body: any) {
  const { plan, processInstanceIds, skipCustomListeners, skipIoMappings, variables } = body || {}
  const enginePlan = toEnginePlan(plan)
  const engineReq: any = { migrationPlan: enginePlan }
  if (Array.isArray(processInstanceIds) && processInstanceIds.length > 0) {
    engineReq.processInstanceIds = processInstanceIds
  }
  if ((!Array.isArray(processInstanceIds) || processInstanceIds.length === 0) && enginePlan?.sourceProcessDefinitionId) {
    engineReq.processInstanceQuery = { processDefinitionId: enginePlan.sourceProcessDefinitionId }
  }
  if (typeof skipCustomListeners === 'boolean') engineReq.skipCustomListeners = skipCustomListeners
  if (typeof skipIoMappings === 'boolean') engineReq.skipIoMappings = skipIoMappings
  if (variables && typeof variables === 'object') engineReq.variables = variables
  const engineDto: any = await postMigrationExecuteAsync<any>(engineId, engineReq)
  const { id } = await insertLocalBatch('MIGRATE_INSTANCES', engineDto?.id, body, engineDto, engineId)
  return { id, camundaBatchId: engineDto?.id, type: 'MIGRATE_INSTANCES' }
}

export async function executeMigrationDirect(engineId: string, body: any) {
  const { plan, processInstanceIds, skipCustomListeners, skipIoMappings, variables } = body || {}
  const enginePlan = toEnginePlan(plan)
  const engineReq: any = { migrationPlan: enginePlan }
  if (Array.isArray(processInstanceIds) && processInstanceIds.length > 0) {
    engineReq.processInstanceIds = processInstanceIds
  }
  if ((!Array.isArray(processInstanceIds) || processInstanceIds.length === 0) && enginePlan?.sourceProcessDefinitionId) {
    engineReq.processInstanceQuery = { processDefinitionId: enginePlan.sourceProcessDefinitionId }
  }
  if (typeof skipCustomListeners === 'boolean') engineReq.skipCustomListeners = skipCustomListeners
  if (typeof skipIoMappings === 'boolean') engineReq.skipIoMappings = skipIoMappings
  if (variables && typeof variables === 'object') engineReq.variables = variables
  await postMigrationExecute<any>(engineId, engineReq)
}

export async function aggregateActiveSources(engineId: string, processInstanceIds: string[]) {
  if (!Array.isArray(processInstanceIds) || processInstanceIds.length === 0) {
    throw new Error('processInstanceIds required')
  }
  const counts: Record<string, number> = {}
  for (const pid of processInstanceIds) {
    const root: any = await getProcessInstanceActivityTree<any>(engineId, pid)
    const stack: any[] = root ? [root] : []
    while (stack.length) {
      const node = stack.pop()
      if (!node) continue
      const childA = Array.isArray(node.childActivityInstances) ? node.childActivityInstances : []
      const childT = Array.isArray(node.childTransitionInstances) ? node.childTransitionInstances : []
      if (childA.length === 0 && childT.length === 0) {
        const aid = node.activityId
        if (aid) counts[aid] = (counts[aid] || 0) + 1
      } else {
        for (const c of childA) stack.push(c)
        // Transition instances do not represent mappable activities; skip counting them.
      }
    }
  }
  return counts
}
