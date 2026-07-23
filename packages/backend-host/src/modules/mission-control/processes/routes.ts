import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { requireRuntimeCollectionAction, requireRuntimeDefinitionAction } from '@enterpriseglue/shared/middleware/requireAction.js'
import { validateQuery } from '@enterpriseglue/shared/middleware/validate.js'
import {
  listProcessDefinitions,
  getProcessDefinition,
  getProcessDefinitionXml,
  getProcessDefinitionStatistics,
  startProcessInstance,
} from './service.js'
import {
  filterRuntimeItemsByResourceKey,
  getAuthorizedRuntimeTenantIdForKey,
  getBoundedRuntimeResourceQuery,
  withAuthorizedRuntimeTenantQuery,
} from '../shared/runtime-resource-filter.js'
import { resolveDeployedEditTarget } from '../shared/edit-target-resolution.js'
import {
  ActivityCountByActivityIdSchema,
  ProcessDefinitionSchema,
  ProcessDefXmlSchema,
  ProcessInstanceStartResponseSchema,
} from '@enterpriseglue/shared/schemas/mission-control/process.js'
import { ProcessEditTargetSchema } from '@enterpriseglue/shared/schemas/mission-control/edit-target.js'

const r = Router()

const editTargetQuerySchema = z.object({
  engineId: z.string().min(1),
  key: z.string().min(1),
  version: z.coerce.number().int().positive(),
  processDefinitionId: z.string().min(1).optional(),
})
const processDefinitionListQuerySchema = z.object({
  key: z.string().min(1).optional(),
  nameLike: z.string().min(1).optional(),
  latest: z.enum(['true', 'false', '1', '0']).optional(),
  maxResults: z.coerce.number().int().positive().optional(),
})

const requireProcessDefinitionAction = (actionId: string, engineIdFrom: 'query' | 'body' = 'query') => requireRuntimeDefinitionAction(actionId, {
  resourceKind: 'process_definition',
  definitionPath: 'process-definition',
  engineIdFrom,
})

const requireProcessDefinitionKeyAction = (actionId: string, engineIdFrom: 'query' | 'body' = 'query') => requireRuntimeDefinitionAction(actionId, {
  resourceKind: 'process_definition',
  definitionPath: 'process-definition',
  definitionLookup: 'key',
  definitionIdKey: 'key',
  engineIdFrom,
})

// List process definitions
r.get('/mission-control-api/process-definitions', requireAuth, requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' }), validateQuery(processDefinitionListQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  const { key, nameLike, latest, maxResults } = req.query as { key?: string; nameLike?: string; latest?: string; maxResults?: number }
  const engineId = (req as any).engineId as string
  const baseQuery = {
    key,
    nameLike,
    latestVersion: latest === 'true' || latest === '1',
    maxResults,
  }
  const keys = req.authorizedRuntimeResourceKeys
  const scopes = req.authorizedRuntimeResourceScopes
  if (!keys) {
    return res.json(z.array(ProcessDefinitionSchema).parse(await listProcessDefinitions(engineId, baseQuery)))
  }

  const visibleKeys = keys.filter((candidate) => !key || candidate === key)
  const query = getBoundedRuntimeResourceQuery(baseQuery)
  const collections = await Promise.all(visibleKeys.map(async (processDefinitionKey) => {
    const definitions = await listProcessDefinitions(engineId, { ...withAuthorizedRuntimeTenantQuery(query, scopes, processDefinitionKey), key: processDefinitionKey })
    // Do not trust an upstream key filter to be enforced consistently.
    return filterRuntimeItemsByResourceKey(definitions, [processDefinitionKey], 'key', scopes)
  }))
  res.json(z.array(ProcessDefinitionSchema).parse(collections.flat()))
}))

// Resolve Starbase edit target for a deployed process version
r.get('/mission-control-api/process-definitions/edit-target', requireAuth, validateQuery(editTargetQuerySchema), requireRuntimeDefinitionAction('engine.runtime.process-definitions.edit-target.read', {
  resourceKind: 'process_definition',
  definitionPath: 'process-definition',
  definitionLookup: 'key',
  definitionIdFrom: 'query',
  definitionIdKey: 'key',
}), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const processKey = String(req.query.key || '').trim()
  const processDefinitionId = req.query.processDefinitionId ? String(req.query.processDefinitionId) : null
  const processVersion = Math.trunc(Number(req.query.version))
  const target = await resolveDeployedEditTarget({
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    engineId,
    artifactKind: 'process',
    artifactKey: processKey,
    artifactVersion: processVersion,
    artifactId: processDefinitionId,
  })
  if (!target) throw Errors.notFound('Deployed process mapping')

  res.json(ProcessEditTargetSchema.parse({
    ...target,
    processKey,
    processVersion,
  }))
}))

// Get process definition by ID
r.get('/mission-control-api/process-definitions/:id', requireAuth, requireProcessDefinitionAction('engine.runtime.process-definitions.read'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const definitionId = String(req.params.id)
  const data = await getProcessDefinition(engineId, definitionId)
  res.json(ProcessDefinitionSchema.parse(data))
}))

// Get process definition XML
r.get('/mission-control-api/process-definitions/:id/xml', requireAuth, requireProcessDefinitionAction('engine.runtime.process-definitions.read'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const definitionId = String(req.params.id)
  const data = await getProcessDefinitionXml(engineId, definitionId)
  res.json(ProcessDefXmlSchema.parse(data))
}))

// Get process definition statistics (activity instance counts)
r.get('/mission-control-api/process-definitions/key/:key/statistics', requireAuth, requireProcessDefinitionKeyAction('engine.runtime.process-definitions.read'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const definitionKey = String(req.params.key)
  const runtimeTenantId = getAuthorizedRuntimeTenantIdForKey(req.authorizedRuntimeResourceScopes, definitionKey)
  const data = runtimeTenantId === undefined
    ? await getProcessDefinitionStatistics(engineId, definitionKey)
    : await getProcessDefinitionStatistics(engineId, definitionKey, runtimeTenantId)
  res.json(ActivityCountByActivityIdSchema.parse(data))
}))

// Start process instance
r.post('/mission-control-api/process-definitions/key/:key/start', requireAuth, requireProcessDefinitionKeyAction('engine.runtime.process-definitions.start', 'body'), asyncHandler(async (req: Request, res: Response) => {
  const { variables, businessKey } = req.body || {}
  const engineId = (req as any).engineId as string
  const definitionKey = String(req.params.key)
  const runtimeTenantId = getAuthorizedRuntimeTenantIdForKey(req.authorizedRuntimeResourceScopes, definitionKey)
  const data = runtimeTenantId === undefined
    ? await startProcessInstance(engineId, definitionKey, { variables, businessKey })
    : await startProcessInstance(engineId, definitionKey, { variables, businessKey }, runtimeTenantId)
  res.json(ProcessInstanceStartResponseSchema.parse(data))
}))

export default r
