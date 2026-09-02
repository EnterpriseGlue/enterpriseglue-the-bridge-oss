import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireRuntimeCollectionAction, requireRuntimeDefinitionAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import {
  listDecisionDefinitions,
  fetchDecisionDefinition,
  fetchDecisionDefinitionXml,
  evaluateDecisionById,
  evaluateDecisionByKey,
} from './service.js';
import {
  DecisionDefinitionXmlSchema,
  DecisionDefinitionListSchema,
  DecisionDefinitionQueryParams,
  DecisionDefinitionSchema,
  DecisionEvaluationResultSchema,
  EvaluateDecisionRequest,
} from '@enterpriseglue/shared/schemas/mission-control/decision.js';
import { DecisionEditTargetSchema } from '@enterpriseglue/shared/schemas/mission-control/edit-target.js';
import {
  filterRuntimeItemsByResourceKey,
  getAuthorizedRuntimeTenantIdForKey,
  getBoundedRuntimeResourceQuery,
  withAuthorizedRuntimeTenantQuery,
} from '../shared/runtime-resource-filter.js';
import { resolveDeployedEditTarget } from '../shared/edit-target-resolution.js';

const r = Router();

const editTargetQuerySchema = z.object({
  engineId: z.string().min(1),
  key: z.string().min(1),
  version: z.coerce.number().int().positive(),
  decisionDefinitionId: z.string().min(1).optional(),
});

// Resolve Starbase edit target for a deployed decision version
r.get('/mission-control-api/decision-definitions/edit-target', requireAuth, validateQuery(editTargetQuerySchema), requireRuntimeDefinitionAction('engine.runtime.decisions.edit-target.read', {
  resourceKind: 'decision_definition',
  definitionPath: 'decision-definition',
  definitionLookup: 'key',
  definitionIdFrom: 'query',
  definitionIdKey: 'key',
}), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const decisionKey = String(req.query.key || '').trim();
  const decisionDefinitionId = req.query.decisionDefinitionId ? String(req.query.decisionDefinitionId) : null;
  const decisionVersion = Math.trunc(Number(req.query.version));
  const target = await resolveDeployedEditTarget({
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    engineId,
    artifactKind: 'decision',
    artifactKey: decisionKey,
    artifactVersion: decisionVersion,
    artifactId: decisionDefinitionId,
  });
  if (!target) {
    return res.json(DecisionEditTargetSchema.parse({
      canShowEditButton: false,
      canEdit: false,
      engineId,
      projectId: '',
      fileId: '',
      decisionKey,
      decisionVersion,
    }));
  }

  res.json(DecisionEditTargetSchema.parse({
    ...target,
    decisionKey,
    decisionVersion,
  }));
}));

// List decision definitions
r.get('/mission-control-api/decision-definitions', requireAuth, requireRuntimeCollectionAction('engine.runtime.decisions.read', { resourceKind: 'decision_definition' }), validateQuery(DecisionDefinitionQueryParams.partial()), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const keys = req.authorizedRuntimeResourceKeys;
  const scopes = req.authorizedRuntimeResourceScopes;
  if (!keys) {
    return res.json(DecisionDefinitionListSchema.parse(await listDecisionDefinitions(engineId, req.query)));
  }

  const requestedKey = typeof req.query.key === 'string' ? req.query.key : null;
  const visibleKeys = keys.filter((candidate) => !requestedKey || candidate === requestedKey);
  const query = getBoundedRuntimeResourceQuery(req.query);
  const collections = await Promise.all(visibleKeys.map(async (decisionDefinitionKey) => {
    const definitions = await listDecisionDefinitions(engineId, { ...withAuthorizedRuntimeTenantQuery(query, scopes, decisionDefinitionKey), key: decisionDefinitionKey });
    // Keep the local boundary authoritative if the engine ignores the query.
    return filterRuntimeItemsByResourceKey(definitions, [decisionDefinitionKey], 'key', scopes);
  }));
  res.json(DecisionDefinitionListSchema.parse(collections.flat()));
}));

// Get decision definition by ID
r.get('/mission-control-api/decision-definitions/:id', requireAuth, requireRuntimeDefinitionAction('engine.runtime.decisions.read', { resourceKind: 'decision_definition', definitionPath: 'decision-definition' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const definitionId = String(req.params.id);
  const data = await fetchDecisionDefinition(engineId, definitionId);
  res.json(DecisionDefinitionSchema.parse(data));
}));

// Get decision definition XML
r.get('/mission-control-api/decision-definitions/:id/xml', requireAuth, requireRuntimeDefinitionAction('engine.runtime.decisions.read', { resourceKind: 'decision_definition', definitionPath: 'decision-definition' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const definitionId = String(req.params.id);
  const data = await fetchDecisionDefinitionXml(engineId, definitionId);
  res.json(DecisionDefinitionXmlSchema.parse(data));
}));

// Evaluate decision
r.post('/mission-control-api/decision-definitions/:id/evaluate', requireAuth, requireRuntimeDefinitionAction('engine.runtime.decisions.evaluate', { resourceKind: 'decision_definition', definitionPath: 'decision-definition', engineIdFrom: 'body' }), validateBody(EvaluateDecisionRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const definitionId = String(req.params.id);
  const data = await evaluateDecisionById(engineId, definitionId, req.body);
  res.json(DecisionEvaluationResultSchema.parse(data));
}));

// Evaluate decision by key
r.post('/mission-control-api/decision-definitions/key/:key/evaluate', requireAuth, requireRuntimeDefinitionAction('engine.runtime.decisions.evaluate', {
  resourceKind: 'decision_definition',
  definitionPath: 'decision-definition',
  definitionLookup: 'key',
  engineIdFrom: 'body',
}), validateBody(EvaluateDecisionRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const definitionKey = String(req.params.key);
  const runtimeTenantId = getAuthorizedRuntimeTenantIdForKey(req.authorizedRuntimeResourceScopes, definitionKey);
  const data = runtimeTenantId === undefined
    ? await evaluateDecisionByKey(engineId, definitionKey, req.body)
    : await evaluateDecisionByKey(engineId, definitionKey, req.body, runtimeTenantId);
  res.json(DecisionEvaluationResultSchema.parse(data));
}));

export default r;
