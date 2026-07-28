import { raw, type Request, type RequestHandler, type Response, type Router } from 'express';
import { z } from 'zod';
import { configBundleLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { configBundleJsonPayloadLimit } from '@enterpriseglue/shared/middleware/requestSizeLimit.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { ConfigBundleApplyRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/ConfigBundleApplyRun.js';
import { configBundleArchiveService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleArchiveService.js';
import { configBundleRemoteSourceService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleRemoteSourceService.js';
import { configBundleApplyService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleApplyService.js';
import { configBundleDiffService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleDiffService.js';
import { configBundleExportService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleExportService.js';
import { configBundleIdentityReplayTaskService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleIdentityReplayTaskService.js';
import { configBundleRuntimeReconciliationTaskService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleRuntimeReconciliationTaskService.js';
import { configBundlePreviewService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js';
import { configBundleSecretPreflightService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleSecretPreflightService.js';
import { platformSettingsService } from '@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js';
import { ConfigBundleApplyRequestSchema, ConfigBundleRemoteImportRequestSchema, ConfigBundleRequestSchema } from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
import { OSS_DEFAULT_TENANT_ID } from '@enterpriseglue/shared/authz/tenant-scope.js';

// Configuration bundle routes are platform-admin APIs, so they are mounted
// outside the tenant-scoped router.  In OSS, their managed objects still
// belong to the default tenant rather than the legacy platform/null scope.
// Do this only in the data handlers: injecting request tenant context before
// authorization would incorrectly narrow platform-wide administrator grants.
function configBundleTenantId(req: Request): string {
  return req.tenant?.tenantId || OSS_DEFAULT_TENANT_ID;
}

function configBundleRunResponse(row: ConfigBundleApplyRun): Record<string, unknown> {
  let result: Record<string, unknown> = {};
  try { result = row.resultJson ? JSON.parse(row.resultJson) as Record<string, unknown> : {}; } catch { /* preserve run-history availability */ }
  return {
    id: row.id,
    bundleKey: row.bundleKey,
    bundleApiVersion: row.bundleApiVersion,
    canonicalHash: row.canonicalHash,
    idempotencyKey: row.idempotencyKey,
    actorId: row.actorId,
    status: row.status,
    errorMessage: row.errorMessage,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    ...result,
  };
}

export interface ConfigBundleRouteDependencies {
  requireConfigBundleAccess: (actionId: string) => RequestHandler;
  requireTargetTransferAccess: RequestHandler;
}

/**
 * Registers the config-bundle API as one route family while retaining the
 * parent authz router's authenticated actor and API-client middleware.
 */
export function registerConfigBundleRoutes(
  router: Router,
  { requireConfigBundleAccess, requireTargetTransferAccess }: ConfigBundleRouteDependencies,
): void {
  router.post('/api/authz/config-bundles/import-zip', configBundleLimiter, requireConfigBundleAccess('platform.config-bundles.preview'), raw({ type: ['application/zip', 'application/octet-stream'], limit: '1mb' }), asyncHandler(async (req: Request, res: Response) => {
    const payload = configBundleArchiveService.readZip(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    await logAudit({
      tenantId: configBundleTenantId(req),
      userId: req.apiClient?.createdById || req.apiClient?.id || req.user!.userId,
      action: 'authz.config_bundle.import_zip',
      resourceType: 'config_bundle',
      resourceId: String((payload.bundle as { metadata?: { key?: string } })?.metadata?.key || 'unknown'),
      details: { fileCount: Object.keys(payload.files).length, actorType: req.apiClient ? 'api_client' : 'user' },
    });
    res.json(payload);
  }));

  router.post('/api/authz/config-bundles/import-url', configBundleLimiter, requireConfigBundleAccess('platform.config-bundles.preview'), validateBody(ConfigBundleRemoteImportRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    const result = await configBundleRemoteSourceService.import(req.body.url);
    await logAudit({
      tenantId: configBundleTenantId(req),
      userId: req.apiClient?.createdById || req.apiClient?.id || req.user!.userId,
      action: 'authz.config_bundle.import_url',
      resourceType: 'config_bundle',
      resourceId: String((result.payload.bundle as { metadata?: { key?: string } })?.metadata?.key || 'unknown'),
      details: { sourceHost: result.sourceHost, sourceKind: result.sourceKind, actorType: req.apiClient ? 'api_client' : 'user' },
    });
    res.json(result.payload);
  }));

  router.post('/api/authz/config-bundles/preview', configBundleLimiter, requireConfigBundleAccess('platform.config-bundles.preview'), configBundleJsonPayloadLimit, validateBody(ConfigBundleRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    const settings = await platformSettingsService.get();
    const preview = configBundlePreviewService.preview(req.body, settings);
    res.status(preview.valid ? 200 : 422).json(preview);
  }));

  router.post('/api/authz/config-bundles/validate-secret-refs', configBundleLimiter, requireConfigBundleAccess('platform.config-bundles.preview'), configBundleJsonPayloadLimit, validateBody(ConfigBundleRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    const settings = await platformSettingsService.get();
    const preflight = configBundleSecretPreflightService.check(req.body, settings);
    await logAudit({
      tenantId: configBundleTenantId(req),
      userId: req.apiClient?.createdById || req.apiClient?.id || req.user!.userId,
      action: 'authz.config_bundle.secret_preflight',
      resourceType: 'config_bundle',
      resourceId: String((req.body.bundle as { metadata?: { key?: string } })?.metadata?.key || 'unknown'),
      details: {
        canonicalHash: preflight.canonicalHash || null,
        valid: preflight.valid,
        available: preflight.available,
        references: preflight.references.map(({ reference, available, reason }) => ({ reference, available, reason: reason || null })),
        actorType: req.apiClient ? 'api_client' : 'user',
      },
    });
    res.status(preflight.valid ? 200 : 422).json(preflight);
  }));

  router.post('/api/authz/config-bundles/diff', configBundleLimiter, requireConfigBundleAccess('platform.config-bundles.preview'), configBundleJsonPayloadLimit, validateBody(ConfigBundleRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    const settings = await platformSettingsService.get();
    const diff = await configBundleDiffService.diff(req.body, configBundleTenantId(req), {
      ...settings,
      tenantReferenceResolver: req.app.locals.engineTenantReferenceResolver || null,
      tenantReferencePrincipalType: req.apiClient ? 'api_client' : 'user',
      tenantReferencePrincipalId: req.apiClient?.id || req.user!.userId,
    });
    res.status(diff.valid ? 200 : 422).json(diff);
  }));

  router.post('/api/authz/config-bundles/apply', configBundleLimiter, requireConfigBundleAccess('platform.config-bundles.apply'), configBundleJsonPayloadLimit, validateBody(ConfigBundleApplyRequestSchema), requireTargetTransferAccess, asyncHandler(async (req: Request, res: Response) => {
    const actorId = req.apiClient?.createdById || req.apiClient?.id || req.user!.userId;
    const settings = await platformSettingsService.get();
    const result = await configBundleApplyService.apply({
      ...req.body,
      tenantId: configBundleTenantId(req),
      actorId,
    }, {
      ...settings,
      tenantReferenceResolver: req.app.locals.engineTenantReferenceResolver || null,
      tenantReferencePrincipalType: req.apiClient ? 'api_client' : 'user',
      tenantReferencePrincipalId: req.apiClient?.id || req.user!.userId,
    });
    await logAudit({
      tenantId: configBundleTenantId(req),
      userId: actorId,
      action: 'authz.config_bundle.apply',
      resourceType: 'config_bundle',
      resourceId: String((req.body.bundle as { metadata?: { key?: string } })?.metadata?.key || 'unknown'),
      details: {
        canonicalHash: result.canonicalHash,
        created: result.created,
        updated: result.updated,
        archived: result.archived,
        mode: (req.body.bundle as { mode?: string })?.mode || null,
        idempotencyKey: req.body.idempotencyKey || null,
        applyRunId: result.applyRunId || null,
        idempotent: result.idempotent === true,
        acknowledgements: req.body.acknowledgements || [],
        reconciliation: result.reconciliation,
        actorType: req.apiClient ? 'api_client' : 'user',
        apiClientId: req.apiClient?.id || null,
        ciProvenance: req.body.ciProvenance || null,
      },
    });
    const reconciliationQueued = result.reconciliation.identitySnapshot?.status === 'truncated'
      || result.reconciliation.runtimeReconciliation?.status === 'queued';
    res.status(reconciliationQueued ? 202 : 200).json(result);
  }));

  router.get('/api/authz/config-bundles/runs', configBundleLimiter, requireConfigBundleAccess('platform.config-bundles.view'), validateQuery(z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) })), asyncHandler(async (req: Request, res: Response) => {
    const tenantId = configBundleTenantId(req);
    const rows = await (await getDataSource()).getRepository(ConfigBundleApplyRun).find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: Number(req.query.limit || 25),
    });
    res.json(rows.map(configBundleRunResponse));
  }));

  router.get('/api/authz/config-bundles/runs/:id', configBundleLimiter, requireConfigBundleAccess('platform.config-bundles.view'), validateParams(z.object({ id: z.string().min(1).max(255) })), asyncHandler(async (req: Request, res: Response) => {
    const tenantId = configBundleTenantId(req);
    const runId = String(req.params.id);
    const row = await (await getDataSource()).getRepository(ConfigBundleApplyRun).findOne({
      where: { id: runId, tenantId },
    });
    if (!row) throw Errors.notFound('Configuration bundle apply run');
    res.json(configBundleRunResponse(row));
  }));

  router.get('/api/authz/config-bundles/runs/:id/identity-replay-tasks', configBundleLimiter, requireConfigBundleAccess('platform.config-bundles.view'), validateParams(z.object({ id: z.string().min(1).max(255) })), asyncHandler(async (req: Request, res: Response) => {
    const tenantId = configBundleTenantId(req);
    const runId = String(req.params.id);
    const row = await (await getDataSource()).getRepository(ConfigBundleApplyRun).findOne({
      where: { id: runId, tenantId },
    });
    if (!row) throw Errors.notFound('Configuration bundle apply run');
    const tasks = await configBundleIdentityReplayTaskService.listForApplyRun(runId, tenantId);
    res.json(tasks.map((task) => ({
      id: task.id,
      providerId: task.providerId,
      syncRunId: task.syncRunId,
      status: task.status,
      attempts: task.attempts,
      nextAttemptAt: task.nextAttemptAt,
      scanned: task.scanned,
      created: task.created,
      removed: task.removed,
      failed: task.failed,
      lastError: task.lastError,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })));
  }));

  router.get('/api/authz/config-bundles/runs/:id/runtime-reconciliation-tasks', configBundleLimiter, requireConfigBundleAccess('platform.config-bundles.view'), validateParams(z.object({ id: z.string().min(1).max(255) })), asyncHandler(async (req: Request, res: Response) => {
    const tenantId = configBundleTenantId(req);
    const runId = String(req.params.id);
    const row = await (await getDataSource()).getRepository(ConfigBundleApplyRun).findOne({
      where: { id: runId, tenantId },
    });
    if (!row) throw Errors.notFound('Configuration bundle apply run');
    const tasks = await configBundleRuntimeReconciliationTaskService.listForApplyRun(runId, tenantId);
    res.json(tasks.map((task) => ({
      id: task.id,
      status: task.status,
      attempts: task.attempts,
      nextAttemptAt: task.nextAttemptAt,
      engineSetIds: JSON.parse(task.engineSetIdsJson),
      runtimeResourceSetIds: JSON.parse(task.runtimeResourceSetIdsJson),
      engineIds: JSON.parse(task.engineIdsJson),
      lastError: task.lastError,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })));
  }));

  router.get('/api/authz/config-bundles/export', configBundleLimiter, requireConfigBundleAccess('platform.config-bundles.export'), validateQuery(z.object({ bundleKey: z.string().min(3).max(160), tenantKey: z.string().min(1).max(160).optional() })), asyncHandler(async (req: Request, res: Response) => {
    res.json(await configBundleExportService.exportBundle({ bundleKey: String(req.query.bundleKey), tenantKey: req.query.tenantKey ? String(req.query.tenantKey) : undefined, tenantId: configBundleTenantId(req) }));
  }));
}
