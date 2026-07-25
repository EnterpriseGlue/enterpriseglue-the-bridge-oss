import type { Request, RequestHandler, Response } from 'express';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { EnginePermissions, permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { piiRedactionService } from '@enterpriseglue/shared/services/pii/PiiRedactionService.js';
import type { PiiScope } from '@enterpriseglue/shared/services/pii/types.js';

type VariableRecord = Record<string, unknown>;

type VariableCollectionValueAccess =
  | { all: true }
  | { all: false; identities: Set<string> };

/**
 * Variable values can be authorized at a narrower scope than the surrounding
 * process instance. Do not leave either raw values or a redacted variant in a
 * browser/proxy cache that could outlive a permission or value change.
 */
export function preventVariableResponseCaching(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

function requestPermissionContext(req: Request) {
  const resource = req.authzResource;
  if (!req.user || !resource?.id) return null;
  return {
    userId: req.user.userId,
    tenantId: req.tenant?.tenantId || null,
    resourceType: resource.type,
    resourceId: resource.id,
  };
}

/**
 * The metadata route guard resolves the precise engine/runtime resource first.
 * This second check deliberately reuses that resolved target so a broad engine
 * value grant cannot accidentally replace a narrower runtime-resource grant.
 */
export async function canViewVariableValues(req: Request): Promise<boolean> {
  const context = requestPermissionContext(req);
  return context
    ? permissionService.hasPermission(EnginePermissions.VARIABLES_VALUE_VIEW, context)
    : false;
}

/** Require raw-value authority after the edit action has resolved its target. */
export const requireVariableValueAccess: RequestHandler = async (req, _res, next) => {
  try {
    if (!await canViewVariableValues(req)) {
      throw Errors.forbidden('Variable values cannot be changed without value access');
    }
    next();
  } catch (error) {
    next(error instanceof Error ? error : Errors.internal('Variable value authorization failed'));
  }
};

/**
 * A value filter is itself a disclosure channel: a caller could otherwise
 * determine whether a secret value exists from the returned metadata rows.
 * Scoped value grants are deliberately insufficient here because this is a
 * collection search, so the caller needs engine-wide value-read authority.
 */
export async function requireVariableValueFilterAccess(req: Request): Promise<void> {
  if (req.query.variableValue === undefined) return;
  const engineId = (req as Request & { engineId?: string }).engineId || req.authzResource?.id || null;
  if (!req.user || !engineId || !await permissionService.hasPermission(EnginePermissions.VARIABLES_VALUE_VIEW, {
    userId: req.user.userId,
    tenantId: req.tenant?.tenantId || null,
    resourceType: 'engine',
    resourceId: engineId,
  })) {
    throw Errors.forbidden('Filtering by variable value requires engine-wide variable value access');
  }
}

function metadataValue(input: unknown): VariableRecord {
  const value = input && typeof input === 'object' && !Array.isArray(input)
    ? input as VariableRecord
    : {};
  const result: VariableRecord = {
    type: typeof value.type === 'string' ? value.type : 'Unknown',
    value: null,
    valueRedacted: true,
  };
  for (const key of ['id', 'name', 'processInstanceId', 'executionId', 'activityInstanceId', 'taskId', 'createTime']) {
    if (value[key] !== undefined) result[key] = value[key];
  }
  return result;
}

function metadataHistoricVariable(input: unknown): VariableRecord {
  const value = input && typeof input === 'object' && !Array.isArray(input)
    ? input as VariableRecord
    : {};
  const result: VariableRecord = { value: null, valueRedacted: true };
  for (const key of [
    'id', 'name', 'type', 'processDefinitionKey', 'processDefinitionId',
    'processInstanceId', 'executionId', 'activityInstanceId', 'caseDefinitionKey',
    'caseDefinitionId', 'caseInstanceId', 'caseExecutionId', 'taskId', 'tenantId',
    'state', 'createTime', 'removalTime', 'rootProcessInstanceId',
  ]) {
    if (value[key] !== undefined) result[key] = value[key];
  }
  return result;
}

function metadataVariableHistory(input: unknown): VariableRecord {
  const value = input && typeof input === 'object' && !Array.isArray(input)
    ? input as VariableRecord
    : {};
  const result: VariableRecord = { value: null, valueRedacted: true };
  for (const key of ['id', 'variableInstanceId', 'variableName', 'type', 'time', 'activityInstanceId', 'executionId', 'taskId', 'revision', 'serializerName']) {
    if (value[key] !== undefined) result[key] = value[key];
  }
  return result;
}

export async function presentRuntimeVariables(
  req: Request,
  variables: Record<string, unknown>,
  piiScope: Extract<PiiScope, 'processDetails' | 'history'> = 'processDetails',
): Promise<Record<string, unknown>> {
  if (await canViewVariableValues(req)) {
    return piiRedactionService.redactPayload(req, variables, piiScope);
  }
  return Object.fromEntries(Object.entries(variables || {}).map(([name, value]) => [name, metadataValue(value)]));
}

export async function presentVariableHistory(
  req: Request,
  entries: unknown[],
): Promise<unknown[]> {
  if (await canViewVariableValues(req)) {
    return piiRedactionService.redactPayload(req, entries, 'history');
  }
  return (entries || []).map(metadataVariableHistory);
}

async function collectionValueAccess(req: Request): Promise<VariableCollectionValueAccess> {
  const engineId = (req as Request & { engineId?: string }).engineId || req.authzResource?.id || null;
  if (!req.user || !engineId) return { all: false, identities: new Set() };
  const tenantId = req.tenant?.tenantId || null;
  const broad = await permissionService.hasPermission(EnginePermissions.VARIABLES_VALUE_VIEW, {
    userId: req.user.userId,
    tenantId,
    resourceType: 'engine',
    resourceId: engineId,
  });
  if (broad) return { all: true };
  const visible = await permissionService.getVisibleRuntimeResources({
    userId: req.user.userId,
    tenantId,
    engineId,
    resourceKind: 'process_definition',
    permission: EnginePermissions.VARIABLES_VALUE_VIEW,
    limit: 5_000,
  });
  return {
    all: false,
    identities: new Set(visible.map((resource) => `${resource.resourceKey}\u0000${resource.runtimeTenantId || ''}`)),
  };
}

function valueVisibleForHistoricEntry(entry: unknown, access: VariableCollectionValueAccess): boolean {
  if (access.all) return true;
  const value = entry && typeof entry === 'object' && !Array.isArray(entry)
    ? entry as VariableRecord
    : {};
  const key = typeof value.processDefinitionKey === 'string' ? value.processDefinitionKey : '';
  const tenantId = typeof value.tenantId === 'string' ? value.tenantId : '';
  return Boolean(key) && access.identities.has(`${key}\u0000${tenantId}`);
}

export async function presentHistoricVariables(
  req: Request,
  entries: unknown[],
): Promise<unknown[]> {
  // Referenced routes already resolve one precise runtime resource. Preserve
  // that exact grant even when a historic adapter omits process-definition
  // lineage on an individual row.
  if (await canViewVariableValues(req)) {
    return piiRedactionService.redactPayload(req, entries || [], 'history');
  }
  const access = await collectionValueAccess(req);
  const allowedEntries = (entries || []).filter((entry) => valueVisibleForHistoricEntry(entry, access));
  const redactedAllowedEntries = await piiRedactionService.redactPayload(req, allowedEntries, 'history') as unknown[];
  const redactedById = new Map(redactedAllowedEntries.map((entry: any) => [entry?.id, entry]));
  return (entries || []).map((entry: any) => valueVisibleForHistoricEntry(entry, access)
    ? redactedById.get(entry?.id) || metadataHistoricVariable(entry)
    : metadataHistoricVariable(entry));
}
