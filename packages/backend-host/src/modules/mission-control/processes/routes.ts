import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { requireRuntimeCollectionAction, requireRuntimeDefinitionAction } from '@enterpriseglue/shared/middleware/requireAction.js'
import { validateQuery } from '@enterpriseglue/shared/middleware/validate.js'
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js'
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeploymentArtifact.js'
import { EngineDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeployment.js'
import { FileCommitVersion } from '@enterpriseglue/shared/infrastructure/persistence/entities/FileCommitVersion.js'
import { ProjectPermissions, permissionService, type Permission } from '@enterpriseglue/shared/services/platform-admin/permissions.js'
import {
  listProcessDefinitions,
  getProcessDefinition,
  getProcessDefinitionXml,
  getProcessDefinitionStatistics,
  startProcessInstance,
} from './service.js'
import { getBoundedRuntimeResourceQuery } from '../shared/runtime-resource-filter.js'

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

function projectPermissionContext(req: Request, projectId: string) {
  return {
    userId: req.user!.userId,
    resourceType: 'project' as const,
    resourceId: projectId,
  }
}

function hasProjectPermission(req: Request, projectId: string, permission: Permission) {
  return permissionService.hasPermission(permission, projectPermissionContext(req, projectId))
}

async function canViewProjectFile(req: Request, projectId: string) {
  return hasProjectPermission(req, projectId, ProjectPermissions.FILES_VIEW)
}

async function canEditProjectFile(req: Request, projectId: string) {
  return hasProjectPermission(req, projectId, ProjectPermissions.FILES_EDIT)
}

r.use(requireAuth)

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
r.get('/mission-control-api/process-definitions', requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' }), validateQuery(processDefinitionListQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  const { key, nameLike, latest, maxResults } = req.query as { key?: string; nameLike?: string; latest?: string; maxResults?: number }
  const engineId = (req as any).engineId as string
  const baseQuery = {
    key,
    nameLike,
    latestVersion: latest === 'true' || latest === '1',
    maxResults,
  }
  const keys = req.authorizedRuntimeResourceKeys
  const data = await listProcessDefinitions(engineId, keys ? getBoundedRuntimeResourceQuery(baseQuery) : baseQuery)
  res.json(keys ? data.filter((definition: any) => keys.includes(String(definition?.key || ''))) : data)
}))

// Resolve Starbase edit target for a deployed process version
r.get('/mission-control-api/process-definitions/edit-target', validateQuery(editTargetQuerySchema), requireRuntimeDefinitionAction('engine.runtime.process-definitions.edit-target.read', {
  resourceKind: 'process_definition',
  definitionPath: 'process-definition',
  definitionLookup: 'key',
  definitionIdFrom: 'query',
  definitionIdKey: 'key',
}), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const processKey = String(req.query.key || '').trim()
  const processDefinitionId = req.query.processDefinitionId ? String(req.query.processDefinitionId) : null
  const versionRaw = Number(req.query.version)

  const processVersion = Math.trunc(versionRaw)
  const dataSource = await getDataSource()
  const artifactRepo = dataSource.getRepository(EngineDeploymentArtifact)
  const deploymentRepo = dataSource.getRepository(EngineDeployment)
  const fileCommitVersionRepo = dataSource.getRepository(FileCommitVersion)

  const baseWhere: {
    engineId: string
    artifactKind: 'process'
    artifactKey: string
    artifactVersion: number
  } = {
    engineId,
    artifactKind: 'process',
    artifactKey: processKey,
    artifactVersion: processVersion,
  }

  let candidates = await artifactRepo.find({
    where: processDefinitionId ? { ...baseWhere, artifactId: processDefinitionId } : baseWhere,
    order: { createdAt: 'DESC' },
    take: 100,
  })

  // Compatibility fallback: legacy rows may not have artifactId populated.
  if (processDefinitionId && candidates.length === 0) {
    candidates = await artifactRepo.find({
      where: baseWhere,
      order: { createdAt: 'DESC' },
      take: 100,
    })
  }

  for (const row of candidates) {
    const projectId = String(row.projectId || '')
    const fileId = row.fileId ? String(row.fileId) : ''
    if (!projectId || !fileId) continue

    const canRead = await canViewProjectFile(req, projectId)
    if (!canRead) continue

    const canEdit = await canEditProjectFile(req, projectId)
    const commitId = row.fileGitCommitId ? String(row.fileGitCommitId) : null
    let fileVersionNumber: number | null = null
    let mappingSource: 'git-commit' | 'db-timestamp' | 'db-latest' | 'deployment-timestamp' = 'db-latest'

    const engineDeploymentId = String(row.engineDeploymentId || '')
    const deploymentRow = engineDeploymentId
      ? await deploymentRepo.findOne({ where: { id: engineDeploymentId }, select: ['deployedAt', 'lineageQuality'] })
      : null
    const lineageQuality = deploymentRow?.lineageQuality || 'complete'
    if (!deploymentRow || !['complete', 'reported'].includes(lineageQuality)) continue
    const deployedAt = deploymentRow?.deployedAt ? Number(deploymentRow.deployedAt) : null
    const deploymentTimestamp = deployedAt ?? Number(row.createdAt)

    if (commitId) {
      const byCommit = await fileCommitVersionRepo.findOne({
        where: { fileId, commitId },
        select: ['versionNumber'],
      })
      if (byCommit && Number.isFinite(Number(byCommit.versionNumber))) {
        fileVersionNumber = Number(byCommit.versionNumber)
        mappingSource = 'git-commit'
      }
    }

    if (fileVersionNumber === null) {
      const byTimestamp = await fileCommitVersionRepo.createQueryBuilder('v')
        .select(['v.versionNumber AS "versionNumber"'])
        .where('v.fileId = :fileId', { fileId })
        .andWhere('v.createdAt <= :createdAt', { createdAt: deploymentTimestamp })
        .orderBy('v.createdAt', 'DESC')
        .limit(1)
        .getRawOne<{ versionNumber?: number }>()

      if (byTimestamp && Number.isFinite(Number(byTimestamp.versionNumber))) {
        fileVersionNumber = Number(byTimestamp.versionNumber)
        mappingSource = deployedAt ? 'deployment-timestamp' : 'db-timestamp'
      }
    }

    if (fileVersionNumber === null) {
      const byLatest = await fileCommitVersionRepo.createQueryBuilder('v')
        .select(['v.versionNumber AS "versionNumber"'])
        .where('v.fileId = :fileId', { fileId })
        .orderBy('v.createdAt', 'DESC')
        .limit(1)
        .getRawOne<{ versionNumber?: number }>()

      if (byLatest && Number.isFinite(Number(byLatest.versionNumber))) {
        fileVersionNumber = Number(byLatest.versionNumber)
      }
    }

    // Reported pipeline lineage must still resolve to a versioned project file.
    if (lineageQuality === 'reported' && fileVersionNumber === null) continue

    return res.json({
      canShowEditButton: true,
      canEdit,
      engineId,
      processKey,
      processVersion,
      projectId,
      fileId,
      engineDeploymentId: String(row.engineDeploymentId || ''),
      commitId,
      fileVersionNumber,
      mappingSource,
      lineageQuality,
      artifactCreatedAt: Number(row.createdAt),
    })
  }

  throw Errors.notFound('Deployed process mapping')
}))

// Get process definition by ID
r.get('/mission-control-api/process-definitions/:id', requireProcessDefinitionAction('engine.runtime.process-definitions.read'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const definitionId = String(req.params.id)
  const data = await getProcessDefinition(engineId, definitionId)
  res.json(data)
}))

// Get process definition XML
r.get('/mission-control-api/process-definitions/:id/xml', requireProcessDefinitionAction('engine.runtime.process-definitions.read'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const definitionId = String(req.params.id)
  const data = await getProcessDefinitionXml(engineId, definitionId)
  res.json(data)
}))

// Get process definition statistics (activity instance counts)
r.get('/mission-control-api/process-definitions/key/:key/statistics', requireProcessDefinitionKeyAction('engine.runtime.process-definitions.read'), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const definitionKey = String(req.params.key)
  const data = await getProcessDefinitionStatistics(engineId, definitionKey)
  res.json(data)
}))

// Start process instance
r.post('/mission-control-api/process-definitions/key/:key/start', requireProcessDefinitionKeyAction('engine.runtime.process-definitions.start', 'body'), asyncHandler(async (req: Request, res: Response) => {
  const { variables, businessKey } = req.body || {}
  const engineId = (req as any).engineId as string
  const definitionKey = String(req.params.key)
  const data = await startProcessInstance(engineId, definitionKey, { variables, businessKey })
  res.json(data)
}))

export default r
