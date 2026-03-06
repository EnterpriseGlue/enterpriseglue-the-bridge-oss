import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { requireEngineReadOrWrite } from '@enterpriseglue/shared/middleware/engineAuth.js'
import { validateQuery } from '@enterpriseglue/shared/middleware/validate.js'
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js'
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/db/entities/EngineDeploymentArtifact.js'
import { EngineDeployment } from '@enterpriseglue/shared/db/entities/EngineDeployment.js'
import { File } from '@enterpriseglue/shared/db/entities/File.js'
import { FileCommitVersion } from '@enterpriseglue/shared/db/entities/FileCommitVersion.js'
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js'
import { EDIT_ROLES } from '@enterpriseglue/shared/constants/roles.js'
import {
  listProcessDefinitions,
  getProcessDefinition,
  getProcessDefinitionXml,
  getProcessDefinitionStatistics,
  startProcessInstance,
} from './service.js'

const r = Router()

const editTargetQuerySchema = z.object({
  engineId: z.string().min(1),
  key: z.string().min(1),
  version: z.coerce.number().int().positive(),
  processDefinitionId: z.string().min(1).optional(),
})

r.use(requireAuth)

// List process definitions
r.get('/mission-control-api/process-definitions', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const { key, nameLike, latest } = req.query as { key?: string; nameLike?: string; latest?: string }
  const engineId = (req as any).engineId as string
  const data = await listProcessDefinitions(engineId, {
    key,
    nameLike,
    latestVersion: latest === 'true' || latest === '1',
  })
  res.json(data)
}))

// Resolve Starbase edit target for a deployed process version
r.get('/mission-control-api/process-definitions/edit-target', validateQuery(editTargetQuerySchema), requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId
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

    const canRead = await projectMemberService.hasAccess(projectId, userId)
    if (!canRead) continue

    const canEdit = await projectMemberService.hasRole(projectId, userId, EDIT_ROLES)
    const commitId = row.fileGitCommitId ? String(row.fileGitCommitId) : null
    let fileVersionNumber: number | null = null
    let mappingSource: 'git-commit' | 'db-timestamp' | 'db-latest' | 'deployment-timestamp' = 'db-latest'

    const engineDeploymentId = String(row.engineDeploymentId || '')
    const deploymentRow = engineDeploymentId
      ? await deploymentRepo.findOne({ where: { id: engineDeploymentId }, select: ['deployedAt'] })
      : null
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
      artifactCreatedAt: Number(row.createdAt),
    })
  }

  // Fallback: no artifact mapping found — search File table by bpmnProcessId
  const fileRepo = dataSource.getRepository(File)
  const bpmnFiles = await fileRepo.find({
    where: { type: 'bpmn', bpmnProcessId: processKey },
    select: ['id', 'projectId', 'name'],
  })

  for (const f of bpmnFiles) {
    const projectId = String(f.projectId || '')
    if (!projectId) continue

    const canRead = await projectMemberService.hasAccess(projectId, userId)
    if (!canRead) continue

    const canEdit = await projectMemberService.hasRole(projectId, userId, EDIT_ROLES)

    let fileVersionNumber: number | null = null
    let fallbackCommitId: string | null = null
    const latestVersion = await fileCommitVersionRepo.createQueryBuilder('v')
      .select(['v.versionNumber AS "versionNumber"', 'v.commitId AS "commitId"'])
      .where('v.fileId = :fileId', { fileId: f.id })
      .orderBy('v.createdAt', 'DESC')
      .limit(1)
      .getRawOne<{ versionNumber?: number; commitId?: string }>()

    if (latestVersion && Number.isFinite(Number(latestVersion.versionNumber))) {
      fileVersionNumber = Number(latestVersion.versionNumber)
      fallbackCommitId = latestVersion.commitId ? String(latestVersion.commitId) : null
    }

    return res.json({
      canShowEditButton: true,
      canEdit,
      engineId,
      processKey,
      processVersion,
      projectId,
      fileId: f.id,
      engineDeploymentId: '',
      commitId: fallbackCommitId,
      fileVersionNumber,
      mappingSource: 'file-key-match' as const,
      artifactCreatedAt: 0,
    })
  }

  throw Errors.notFound('Deployed process mapping')
}))

// Get process definition by ID
r.get('/mission-control-api/process-definitions/:id', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const definitionId = String(req.params.id)
  const data = await getProcessDefinition(engineId, definitionId)
  res.json(data)
}))

// Get process definition XML
r.get('/mission-control-api/process-definitions/:id/xml', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const definitionId = String(req.params.id)
  const data = await getProcessDefinitionXml(engineId, definitionId)
  res.json(data)
}))

// Get process definition statistics (activity instance counts)
r.get('/mission-control-api/process-definitions/key/:key/statistics', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const definitionKey = String(req.params.key)
  const data = await getProcessDefinitionStatistics(engineId, definitionKey)
  res.json(data)
}))

// Start process instance
r.post('/mission-control-api/process-definitions/key/:key/start', requireEngineReadOrWrite({ engineIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const { variables, businessKey } = req.body || {}
  const engineId = (req as any).engineId as string
  const definitionKey = String(req.params.key)
  const data = await startProcessInstance(engineId, definitionKey, { variables, businessKey })
  res.json(data)
}))

export default r
