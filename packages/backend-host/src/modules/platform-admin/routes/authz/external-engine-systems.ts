import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { IsNull } from 'typeorm';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { ExternalEngineSystem } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineSystem.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { slugifyIdentifier } from '@enterpriseglue/shared/utils/identifier-slug.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { normalizeTenantIdForPersistence, OSS_DEFAULT_TENANT_ID } from '@enterpriseglue/shared/authz/tenant-scope.js';
import {
  adminConfigObjectOwnershipService,
  adminConfigOwnershipFields,
} from '@enterpriseglue/shared/services/platform-admin/AdminConfigObjectOwnershipService.js';
import {
  externalEngineFieldOwnershipToJson,
  parseExternalEngineFieldOwnership,
} from './external-engine-ownership.js';
import {
  EngineFieldOwnershipSchema,
  EngineManagementModeSchema,
  ExternalEngineSystemCreateSchema,
  ExternalEngineSystemUpdateSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

const resourceIdParamSchema = z.object({ id: z.string().min(1) });
/** Direct compatibility accepts legacy manual defaults while shared OpenAPI keeps new systems external-only. */
const externalEngineSystemCreateSchema = ExternalEngineSystemCreateSchema.extend({
  key: z.string().min(1).max(255).regex(/^[a-z0-9][a-z0-9._-]*$/).optional(),
  defaultManagementMode: EngineManagementModeSchema.optional(),
  defaultFieldOwnership: EngineFieldOwnershipSchema.optional(),
});
const externalEngineSystemUpdateSchema = ExternalEngineSystemUpdateSchema.extend({
  defaultManagementMode: EngineManagementModeSchema.optional(),
  defaultFieldOwnership: EngineFieldOwnershipSchema.optional(),
});

export interface ExternalEngineSystemRouteDependencies {
  requirePlatformAction: (actionId: string) => RequestHandler;
}

function normalizeExternalSystemKey(name: string): string {
  return slugifyIdentifier(name, {
    preserve: '._-',
    maxLength: 255,
    fallback: 'external-engine-system',
  });
}

function serializeExternalEngineSystem(
  system: ExternalEngineSystem,
  ownership?: Parameters<typeof adminConfigOwnershipFields>[0],
) {
  return {
    id: system.id,
    tenantId: system.tenantId,
    key: system.key,
    name: system.name,
    description: system.description,
    defaultManagementMode: system.defaultManagementMode === 'hybrid' ? 'hybrid' : 'external_managed',
    defaultFieldOwnership: parseExternalEngineFieldOwnership(system.defaultFieldOwnershipJson),
    isActive: system.isActive,
    createdById: system.createdById,
    createdAt: Number(system.createdAt),
    updatedAt: Number(system.updatedAt),
    ...adminConfigOwnershipFields(ownership),
  };
}

export function registerExternalEngineSystemRoutes(router: Router, { requirePlatformAction }: ExternalEngineSystemRouteDependencies): void {
  router.get('/api/authz/external-engine-systems', apiLimiter, requireAuth, requirePlatformAction('platform.external-engine-systems.read'), asyncHandler(async (req: Request, res: Response) => {
    try {
      const dataSource = await getDataSource();
      const tenantId = normalizeTenantIdForPersistence(req.tenant?.tenantId) || OSS_DEFAULT_TENANT_ID;
      const tenantWhere = tenantId === null ? IsNull() : tenantId;
      const [systems, ownershipRows] = await Promise.all([
        dataSource.getRepository(ExternalEngineSystem).find({
          where: [{ tenantId: tenantWhere }, { tenantId: IsNull() }],
          order: { isActive: 'DESC', name: 'ASC' },
        }),
        adminConfigObjectOwnershipService.listForObjectType(dataSource, 'external_engine_system'),
      ]);
      const ownershipById = new Map(ownershipRows.map((row) => [row.objectId, row]));
      res.json(systems.map((system) => serializeExternalEngineSystem(system, ownershipById.get(system.id))));
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('List external engine systems error:', error);
      throw Errors.internal('Failed to list external engine systems');
    }
  }));

  router.post('/api/authz/external-engine-systems', apiLimiter, requireAuth, requirePlatformAction('platform.external-engine-systems.manage'), validateBody(externalEngineSystemCreateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const repo = (await getDataSource()).getRepository(ExternalEngineSystem);
      const tenantId = normalizeTenantIdForPersistence(req.tenant?.tenantId) || OSS_DEFAULT_TENANT_ID;
      const now = Date.now();
      const key = req.body.key?.trim() || normalizeExternalSystemKey(req.body.name);
      const existing = await repo.findOne({ where: { tenantId: tenantId === null ? IsNull() : tenantId, key } });
      if (existing) throw Errors.conflict('External engine system key already exists');
      const payload = {
        id: generateId(), tenantId, key, name: req.body.name, description: req.body.description ?? null,
        defaultManagementMode: req.body.defaultManagementMode || 'external_managed',
        defaultFieldOwnershipJson: externalEngineFieldOwnershipToJson(req.body.defaultFieldOwnership),
        isActive: true, createdById: req.user!.userId, createdAt: now, updatedAt: now,
      };
      await repo.insert(payload);
      await logAudit({
        tenantId: tenantId || undefined, userId: req.user!.userId, action: 'external_engine_system.create',
        resourceType: 'external_engine_system', resourceId: payload.id,
        details: { key, defaultManagementMode: payload.defaultManagementMode, defaultFieldOwnership: parseExternalEngineFieldOwnership(payload.defaultFieldOwnershipJson) },
      });
      res.status(201).json(serializeExternalEngineSystem(payload as ExternalEngineSystem));
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Create external engine system error:', error);
      throw Errors.badRequest(error.message || 'Failed to create external engine system');
    }
  }));

  router.put('/api/authz/external-engine-systems/:id', apiLimiter, requireAuth, requirePlatformAction('platform.external-engine-systems.manage'), validateParams(resourceIdParamSchema), validateBody(externalEngineSystemUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const dataSource = await getDataSource();
      const tenantId = normalizeTenantIdForPersistence(req.tenant?.tenantId) || OSS_DEFAULT_TENANT_ID;
      const tenantWhere = tenantId === null ? IsNull() : tenantId;
      const updates = {
        name: req.body.name,
        description: req.body.description === undefined ? undefined : req.body.description ?? null,
        defaultManagementMode: req.body.defaultManagementMode,
        defaultFieldOwnershipJson: req.body.defaultFieldOwnership === undefined ? undefined : externalEngineFieldOwnershipToJson(req.body.defaultFieldOwnership),
        isActive: req.body.isActive,
        updatedAt: Date.now(),
      };
      const updated = await dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(ExternalEngineSystem);
        const system = await repo.findOne({ where: [{ id: String(req.params.id), tenantId: tenantWhere }, { id: String(req.params.id), tenantId: IsNull() }] });
        if (!system) throw Errors.notFound('External engine system');
        await adminConfigObjectOwnershipService.claimManualMutation(manager, 'external_engine_system', system.id);
        await repo.update({ id: system.id }, updates);
        const persisted = await repo.findOneBy({ id: system.id });
        if (!persisted) throw Errors.notFound('External engine system');
        return persisted;
      });
      await logAudit({
        tenantId: tenantId || undefined, userId: req.user!.userId, action: 'external_engine_system.update',
        resourceType: 'external_engine_system', resourceId: updated.id,
        details: { changedFields: Object.entries(updates).filter(([, value]) => value !== undefined).map(([key]) => key) },
      });
      const ownership = await adminConfigObjectOwnershipService.findForObject(dataSource, 'external_engine_system', updated.id);
      res.json(serializeExternalEngineSystem(updated, ownership));
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Update external engine system error:', error);
      throw Errors.badRequest(error.message || 'Failed to update external engine system');
    }
  }));

  router.delete('/api/authz/external-engine-systems/:id', apiLimiter, requireAuth, requirePlatformAction('platform.external-engine-systems.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const dataSource = await getDataSource();
      const tenantId = normalizeTenantIdForPersistence(req.tenant?.tenantId) || OSS_DEFAULT_TENANT_ID;
      const tenantWhere = tenantId === null ? IsNull() : tenantId;
      const system = await dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(ExternalEngineSystem);
        const persisted = await repo.findOne({ where: [{ id: String(req.params.id), tenantId: tenantWhere }, { id: String(req.params.id), tenantId: IsNull() }] });
        if (!persisted) throw Errors.notFound('External engine system');
        await adminConfigObjectOwnershipService.claimManualMutation(manager, 'external_engine_system', persisted.id);
        await repo.update({ id: persisted.id }, { isActive: false, updatedAt: Date.now() });
        return persisted;
      });
      await logAudit({
        tenantId: tenantId || undefined, userId: req.user!.userId, action: 'external_engine_system.archive',
        resourceType: 'external_engine_system', resourceId: system.id, details: { key: system.key },
      });
      res.status(204).send();
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Archive external engine system error:', error);
      throw Errors.badRequest(error.message || 'Failed to archive external engine system');
    }
  }));
}
