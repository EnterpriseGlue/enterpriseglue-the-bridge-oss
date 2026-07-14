import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireRuntimeCollectionAction, requireRuntimeDefinitionAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeploymentArtifact.js';
import { EngineDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeployment.js';
import { FileCommitVersion } from '@enterpriseglue/shared/infrastructure/persistence/entities/FileCommitVersion.js';
import { ProjectPermissions, permissionService, type Permission } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import {
  listDecisionDefinitions,
  fetchDecisionDefinition,
  fetchDecisionDefinitionXml,
  evaluateDecisionById,
  evaluateDecisionByKey,
} from './service.js';
import {
  DecisionDefinitionQueryParams,
  EvaluateDecisionRequest,
} from '@enterpriseglue/shared/schemas/mission-control/decision.js';
import { getBoundedRuntimeResourceQuery } from '../shared/runtime-resource-filter.js';

const r = Router();

const editTargetQuerySchema = z.object({
  engineId: z.string().min(1),
  key: z.string().min(1),
  version: z.coerce.number().int().positive(),
  decisionDefinitionId: z.string().min(1).optional(),
});

function projectPermissionContext(req: Request, projectId: string) {
  return {
    userId: req.user!.userId,
    resourceType: 'project' as const,
    resourceId: projectId,
  };
}

function hasProjectPermission(req: Request, projectId: string, permission: Permission) {
  return permissionService.hasPermission(permission, projectPermissionContext(req, projectId));
}

async function canViewProjectFile(req: Request, projectId: string) {
  return hasProjectPermission(req, projectId, ProjectPermissions.FILES_VIEW);
}

async function canEditProjectFile(req: Request, projectId: string) {
  return hasProjectPermission(req, projectId, ProjectPermissions.FILES_EDIT);
}

r.use(requireAuth);

// Resolve Starbase edit target for a deployed decision version
r.get('/mission-control-api/decision-definitions/edit-target', validateQuery(editTargetQuerySchema), requireRuntimeDefinitionAction('engine.runtime.decisions.edit-target.read', {
  resourceKind: 'decision_definition',
  definitionPath: 'decision-definition',
  definitionLookup: 'key',
  definitionIdFrom: 'query',
  definitionIdKey: 'key',
}), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const decisionKey = String(req.query.key || '').trim();
  const decisionDefinitionId = req.query.decisionDefinitionId ? String(req.query.decisionDefinitionId) : null;
  const versionRaw = Number(req.query.version);

  const decisionVersion = Math.trunc(versionRaw);
  const dataSource = await getDataSource();
  const artifactRepo = dataSource.getRepository(EngineDeploymentArtifact);
  const deploymentRepo = dataSource.getRepository(EngineDeployment);
  const fileCommitVersionRepo = dataSource.getRepository(FileCommitVersion);

  const baseWhere: {
    engineId: string;
    artifactKind: 'decision';
    artifactKey: string;
    artifactVersion: number;
  } = {
    engineId,
    artifactKind: 'decision',
    artifactKey: decisionKey,
    artifactVersion: decisionVersion,
  };

  let candidates = await artifactRepo.find({
    where: decisionDefinitionId ? { ...baseWhere, artifactId: decisionDefinitionId } : baseWhere,
    order: { createdAt: 'DESC' },
    take: 100,
  });

  // Compatibility fallback: legacy rows may not have artifactId populated.
  if (decisionDefinitionId && candidates.length === 0) {
    candidates = await artifactRepo.find({
      where: baseWhere,
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  for (const row of candidates) {
    const projectId = String(row.projectId || '');
    const fileId = row.fileId ? String(row.fileId) : '';
    if (!projectId || !fileId) continue;

    const canRead = await canViewProjectFile(req, projectId);
    if (!canRead) continue;

    const canEdit = await canEditProjectFile(req, projectId);
    const commitId = row.fileGitCommitId ? String(row.fileGitCommitId) : null;
    let fileVersionNumber: number | null = null;
    let mappingSource: 'git-commit' | 'db-timestamp' | 'db-latest' | 'deployment-timestamp' = 'db-latest';

    const engineDeploymentId = String(row.engineDeploymentId || '');
    const deploymentRow = engineDeploymentId
      ? await deploymentRepo.findOne({ where: { id: engineDeploymentId }, select: ['deployedAt', 'lineageQuality'] })
      : null;
    const lineageQuality = deploymentRow?.lineageQuality || 'complete';
    if (!deploymentRow || !['complete', 'reported'].includes(lineageQuality)) continue;
    const deployedAt = deploymentRow?.deployedAt ? Number(deploymentRow.deployedAt) : null;
    const deploymentTimestamp = deployedAt ?? Number(row.createdAt);

    if (commitId) {
      const byCommit = await fileCommitVersionRepo.findOne({
        where: { fileId, commitId },
        select: ['versionNumber'],
      });
      if (byCommit && Number.isFinite(Number(byCommit.versionNumber))) {
        fileVersionNumber = Number(byCommit.versionNumber);
        mappingSource = 'git-commit';
      }
    }

    if (fileVersionNumber === null) {
      const byTimestamp = await fileCommitVersionRepo.createQueryBuilder('v')
        .select(['v.versionNumber AS "versionNumber"'])
        .where('v.fileId = :fileId', { fileId })
        .andWhere('v.createdAt <= :createdAt', { createdAt: deploymentTimestamp })
        .orderBy('v.createdAt', 'DESC')
        .limit(1)
        .getRawOne<{ versionNumber?: number }>();

      if (byTimestamp && Number.isFinite(Number(byTimestamp.versionNumber))) {
        fileVersionNumber = Number(byTimestamp.versionNumber);
        mappingSource = deployedAt ? 'deployment-timestamp' : 'db-timestamp';
      }
    }

    if (lineageQuality === 'reported' && fileVersionNumber === null) continue;

    if (fileVersionNumber === null) {
      const byLatest = await fileCommitVersionRepo.createQueryBuilder('v')
        .select(['v.versionNumber AS "versionNumber"'])
        .where('v.fileId = :fileId', { fileId })
        .orderBy('v.createdAt', 'DESC')
        .limit(1)
        .getRawOne<{ versionNumber?: number }>();

      if (byLatest && Number.isFinite(Number(byLatest.versionNumber))) {
        fileVersionNumber = Number(byLatest.versionNumber);
      }
    }

    return res.json({
      canShowEditButton: true,
      canEdit,
      engineId,
      decisionKey,
      decisionVersion,
      projectId,
      fileId,
      engineDeploymentId: String(row.engineDeploymentId || ''),
      commitId,
      fileVersionNumber,
      mappingSource,
      lineageQuality,
      artifactCreatedAt: Number(row.createdAt),
    });
  }

  throw Errors.notFound('Deployed decision mapping');
}));

// List decision definitions
r.get('/mission-control-api/decision-definitions', requireRuntimeCollectionAction('engine.runtime.decisions.read', { resourceKind: 'decision_definition' }), validateQuery(DecisionDefinitionQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const keys = req.authorizedRuntimeResourceKeys;
  if (!keys) {
    return res.json(await listDecisionDefinitions(engineId, req.query));
  }

  const requestedKey = typeof req.query.key === 'string' ? req.query.key : null;
  const visibleKeys = keys.filter((candidate) => !requestedKey || candidate === requestedKey);
  const query = getBoundedRuntimeResourceQuery(req.query);
  const collections = await Promise.all(visibleKeys.map(async (decisionDefinitionKey) => {
    const definitions = await listDecisionDefinitions(engineId, { ...query, key: decisionDefinitionKey });
    // Keep the local boundary authoritative if the engine ignores the query.
    return definitions.filter((definition: any) => String(definition?.key || '') === decisionDefinitionKey);
  }));
  res.json(collections.flat());
}));

// Get decision definition by ID
r.get('/mission-control-api/decision-definitions/:id', requireRuntimeDefinitionAction('engine.runtime.decisions.read', { resourceKind: 'decision_definition', definitionPath: 'decision-definition' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const definitionId = String(req.params.id);
  const data = await fetchDecisionDefinition(engineId, definitionId);
  res.json(data);
}));

// Get decision definition XML
r.get('/mission-control-api/decision-definitions/:id/xml', requireRuntimeDefinitionAction('engine.runtime.decisions.read', { resourceKind: 'decision_definition', definitionPath: 'decision-definition' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const definitionId = String(req.params.id);
  const data = await fetchDecisionDefinitionXml(engineId, definitionId);
  res.json(data);
}));

// Evaluate decision
r.post('/mission-control-api/decision-definitions/:id/evaluate', requireRuntimeDefinitionAction('engine.runtime.decisions.evaluate', { resourceKind: 'decision_definition', definitionPath: 'decision-definition', engineIdFrom: 'body' }), validateBody(EvaluateDecisionRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const definitionId = String(req.params.id);
  const data = await evaluateDecisionById(engineId, definitionId, req.body);
  res.json(data);
}));

// Evaluate decision by key
r.post('/mission-control-api/decision-definitions/key/:key/evaluate', requireRuntimeDefinitionAction('engine.runtime.decisions.evaluate', {
  resourceKind: 'decision_definition',
  definitionPath: 'decision-definition',
  definitionLookup: 'key',
  engineIdFrom: 'body',
}), validateBody(EvaluateDecisionRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const definitionKey = String(req.params.key);
  const data = await evaluateDecisionByKey(engineId, definitionKey, req.body);
  res.json(data);
}));

export default r;
