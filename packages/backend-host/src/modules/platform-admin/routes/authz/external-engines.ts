import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { In, IsNull, Not } from 'typeorm';
import { apiLimiter, reconciliationLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSetMaterialization.js';
import { ExternalEngineRegistration } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineRegistration.js';
import { ExternalEngineSystem } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineSystem.js';
import { engineSetService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { getExternalEngineCapabilityDiagnostics, getExternalEngineMaterializationDiagnostics, parseExternalEngineCapabilities } from './external-engine-diagnostics.js';
import { parseExternalEngineFieldOwnership } from './external-engine-ownership.js';
import { parseExternalEngineJson, parseExternalEngineLabels, redactExternalEngineAuditDetails } from './external-engine-serialization.js';
import { isExternalEngineTenantVisible } from './external-engine-tenant.js';
import { ExternalEngineRegistrationAuditQuerySchema } from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

const resourceIdParamSchema = z.object({ id: z.string().min(1) });
const externalEngineAuditActions = ExternalEngineRegistrationAuditQuerySchema.shape.action.unwrap().exclude(['all']).options;
const externalEngineLifecycleBodySchema = z.object({ reason: z.string().trim().max(500).optional() });

export interface ExternalEngineRouteDependencies {
  requirePlatformAction: (actionId: string) => RequestHandler;
}

function isExternallyRegistered(engine: Engine): boolean {
  return engine.registrationSource === 'external_api' || Boolean(engine.externalId);
}

export function registerExternalEngineRoutes(router: Router, { requirePlatformAction }: ExternalEngineRouteDependencies): void {
  router.get('/api/authz/external-engines', apiLimiter, requireAuth, requirePlatformAction('platform.external-engines.read'), asyncHandler(async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenant?.tenantId || null;
      const dataSource = await getDataSource();
      const engineRepo = dataSource.getRepository(Engine);
      const registrationRepo = dataSource.getRepository(ExternalEngineRegistration);
      const systemRepo = dataSource.getRepository(ExternalEngineSystem);
      const registrations = await registrationRepo.find({ order: { lastRegisteredAt: 'DESC', updatedAt: 'DESC' } });
      if (registrations.length > 0) {
        const systemIds = Array.from(new Set(registrations.map((registration) => registration.externalSystemId).filter((id): id is string => Boolean(id))));
        const systems = systemIds.length > 0 ? await systemRepo.find({ where: { id: In(systemIds) } }) : [];
        const systemsById = new Map(systems.map((system) => [system.id, system]));
        const engines = await engineRepo.find({ where: { id: In(registrations.map((registration) => registration.engineId)) } });
        const enginesById = new Map(engines
          .filter((engine) => isExternalEngineTenantVisible(engine.tenantId, tenantId))
          .map((engine) => [engine.id, engine]));
        res.json(registrations.map((registration) => {
          const engine = enginesById.get(registration.engineId);
          if (!engine) return null;
          const capabilities = parseExternalEngineCapabilities(registration.capabilitiesJson || engine.capabilitiesJson);
          const capabilityDiagnostics = getExternalEngineCapabilityDiagnostics(engine.type, capabilities);
          return {
            id: engine.id, registrationId: registration.id, name: engine.name, baseUrl: engine.baseUrl, type: engine.type,
            connectionMode: engine.connectionMode === 'customer_sidecar' ? 'customer_sidecar' : 'direct',
            externalId: registration.externalId, labels: parseExternalEngineLabels(registration.labelsJson),
            registrationSource: registration.registrationSource, apiClientId: registration.apiClientId,
            externalSystemId: registration.externalSystemId,
            externalSystemName: registration.externalSystemId ? systemsById.get(registration.externalSystemId)?.name || null : null,
            managementMode: registration.managementMode || engine.managementMode || (registration.registrationSource === 'external_api' ? 'external_managed' : 'manual'),
            fieldOwnership: parseExternalEngineFieldOwnership(registration.fieldOwnershipJson || engine.fieldOwnershipJson),
            driftStatus: registration.driftStatus || engine.driftStatus,
            lifecycleStatus: registration.lifecycleStatus || engine.lifecycleStatus || 'active',
            lastExternalSyncAt: registration.lastExternalSyncAt || engine.lastExternalSyncAt || registration.lastRegisteredAt || engine.externalUpdatedAt || null,
            capabilities, capabilityStatus: registration.capabilityStatus || engine.capabilityStatus || capabilityDiagnostics.status,
            capabilityDiagnostics, externalUpdatedAt: registration.lastRegisteredAt, createdAt: engine.createdAt, updatedAt: engine.updatedAt,
          };
        }).filter(Boolean));
        return;
      }
      const engines = (await engineRepo.find({
        where: [{ externalId: Not(IsNull()) }, { registrationSource: 'external_api' }], order: { updatedAt: 'DESC' },
      })).filter((engine) => isExternalEngineTenantVisible(engine.tenantId, tenantId));
      const systemIds = Array.from(new Set(engines.map((engine) => engine.externalSystemId).filter((id): id is string => Boolean(id))));
      const systems = systemIds.length > 0 ? await systemRepo.find({ where: { id: In(systemIds) } }) : [];
      const systemsById = new Map(systems.map((system) => [system.id, system]));
      res.json(engines.map((engine) => {
        const capabilities = parseExternalEngineCapabilities(engine.capabilitiesJson);
        const capabilityDiagnostics = getExternalEngineCapabilityDiagnostics(engine.type, capabilities);
        return {
          id: engine.id, name: engine.name, baseUrl: engine.baseUrl, type: engine.type, externalId: engine.externalId,
          connectionMode: engine.connectionMode === 'customer_sidecar' ? 'customer_sidecar' : 'direct',
          labels: parseExternalEngineLabels(engine.labelsJson), registrationSource: engine.registrationSource, apiClientId: null,
          externalSystemId: engine.externalSystemId,
          externalSystemName: engine.externalSystemId ? systemsById.get(engine.externalSystemId)?.name || null : null,
          managementMode: engine.managementMode || (engine.registrationSource === 'external_api' ? 'external_managed' : 'manual'),
          fieldOwnership: parseExternalEngineFieldOwnership(engine.fieldOwnershipJson), driftStatus: engine.driftStatus,
          lifecycleStatus: engine.lifecycleStatus || 'active', lastExternalSyncAt: engine.lastExternalSyncAt || engine.externalUpdatedAt || null,
          capabilities, capabilityStatus: engine.capabilityStatus || capabilityDiagnostics.status, capabilityDiagnostics,
          externalUpdatedAt: engine.externalUpdatedAt, createdAt: engine.createdAt, updatedAt: engine.updatedAt,
        };
      }));
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('List external engines error:', error);
      throw Errors.internal('Failed to list external engines');
    }
  }));

  router.get('/api/authz/external-engines/:id/audit', apiLimiter, requireAuth, requireAction('platform.external-engines.audit.read', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id' }), validateParams(resourceIdParamSchema), validateQuery(ExternalEngineRegistrationAuditQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const action = req.query.action === 'all' ? undefined : req.query.action;
      const entries = await (await getDataSource()).getRepository(AuditLog).find({
        where: { tenantId: req.tenant?.tenantId || IsNull(), resourceType: 'engine', resourceId: String(req.params.id), action: typeof action === 'string' ? action : In([...externalEngineAuditActions]) },
        order: { createdAt: 'DESC' }, take: typeof req.query.limit === 'number' ? req.query.limit : 50,
      });
      res.json(entries.map((entry) => ({
        id: entry.id, userId: entry.userId, action: entry.action, resourceType: entry.resourceType, resourceId: entry.resourceId,
        ipAddress: entry.ipAddress, userAgent: entry.userAgent, details: redactExternalEngineAuditDetails(parseExternalEngineJson(entry.details)), createdAt: entry.createdAt,
      })));
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Get external engine audit error:', error);
      throw Errors.internal('Failed to get external engine audit');
    }
  }));

  router.post('/api/authz/external-engines/:id/decommission', apiLimiter, requireAuth, requireAction('platform.external-engines.lifecycle.manage', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id' }), validateParams(resourceIdParamSchema), validateBody(externalEngineLifecycleBodySchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const dataSource = await getDataSource();
      const engineRepo = dataSource.getRepository(Engine);
      const registrationRepo = dataSource.getRepository(ExternalEngineRegistration);
      const engine = await engineRepo.findOneBy({ id: String(req.params.id) });
      if (!engine || !isExternalEngineTenantVisible(engine.tenantId, req.tenant?.tenantId || null)) throw Errors.notFound('Engine');
      if (!isExternallyRegistered(engine)) throw Errors.validation('Only externally registered engines can be decommissioned');
      const registration = await registrationRepo.findOne({ where: { engineId: engine.id } });
      const now = Date.now();
      const previousLifecycleStatus = registration?.lifecycleStatus || engine.lifecycleStatus || 'active';
      await engineRepo.update({ id: engine.id }, { lifecycleStatus: 'decommissioned', driftStatus: 'decommissioned', updatedAt: now });
      if (registration) await registrationRepo.update({ id: registration.id }, { lifecycleStatus: 'decommissioned', driftStatus: 'decommissioned', updatedAt: now });
      await dataSource.getRepository(EngineSetMaterialization).delete({ engineId: engine.id });
      await logAudit({
        tenantId: req.tenant?.tenantId || undefined, userId: req.user!.userId, action: 'engine.external_registration.decommission', resourceType: 'engine', resourceId: engine.id,
        details: { source: 'platform_admin', externalId: registration?.externalId || engine.externalId || null, externalSystemId: registration?.externalSystemId || engine.externalSystemId || null, previousLifecycleStatus, lifecycleStatus: 'decommissioned', reason: req.body.reason || null },
      });
      res.json({ decommissioned: true, engineId: engine.id, externalId: registration?.externalId || engine.externalId || null, lifecycleStatus: 'decommissioned' });
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Decommission external engine error:', error);
      throw Errors.internal('Failed to decommission external engine');
    }
  }));

  router.post('/api/authz/external-engines/:id/reactivate', apiLimiter, requireAuth, requireAction('platform.external-engines.lifecycle.manage', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id' }), validateParams(resourceIdParamSchema), validateBody(externalEngineLifecycleBodySchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const dataSource = await getDataSource();
      const engineRepo = dataSource.getRepository(Engine);
      const registrationRepo = dataSource.getRepository(ExternalEngineRegistration);
      const engine = await engineRepo.findOneBy({ id: String(req.params.id) });
      if (!engine || !isExternalEngineTenantVisible(engine.tenantId, req.tenant?.tenantId || null)) throw Errors.notFound('Engine');
      if (!isExternallyRegistered(engine)) throw Errors.validation('Only externally registered engines can be reactivated');
      const registration = await registrationRepo.findOne({ where: { engineId: engine.id } });
      const now = Date.now();
      const previousLifecycleStatus = registration?.lifecycleStatus || engine.lifecycleStatus || 'active';
      const driftStatus = (registration?.driftStatus || engine.driftStatus) === 'decommissioned' ? 'in_sync' : registration?.driftStatus || engine.driftStatus || 'in_sync';
      await engineRepo.update({ id: engine.id }, { lifecycleStatus: 'active', driftStatus, updatedAt: now });
      if (registration) await registrationRepo.update({ id: registration.id }, { lifecycleStatus: 'active', driftStatus, updatedAt: now });
      const materializationResults = await engineSetService.materializeEngineSetsForEngine(engine.id, req.tenant?.tenantId || engine.tenantId || null);
      const materializationDiagnostics = getExternalEngineMaterializationDiagnostics(materializationResults as Array<Record<string, unknown>>);
      await logAudit({
        tenantId: req.tenant?.tenantId || undefined, userId: req.user!.userId, action: 'engine.external_registration.reactivate', resourceType: 'engine', resourceId: engine.id,
        details: { source: 'platform_admin', externalId: registration?.externalId || engine.externalId || null, externalSystemId: registration?.externalSystemId || engine.externalSystemId || null, previousLifecycleStatus, lifecycleStatus: 'active', driftStatus, materializationResults, materializationDiagnostics, reason: req.body.reason || null },
      });
      res.json({ reactivated: true, engineId: engine.id, externalId: registration?.externalId || engine.externalId || null, lifecycleStatus: 'active', driftStatus, materializationResults, materializationDiagnostics });
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Reactivate external engine error:', error);
      throw Errors.internal('Failed to reactivate external engine');
    }
  }));

  router.post('/api/authz/external-engines/:id/reconcile', apiLimiter, requireAuth, reconciliationLimiter, requireAction('platform.external-engines.reconcile', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id' }), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const dataSource = await getDataSource();
      const engineRepo = dataSource.getRepository(Engine);
      const registrationRepo = dataSource.getRepository(ExternalEngineRegistration);
      const engine = await engineRepo.findOneBy({ id: String(req.params.id) });
      if (!engine || !isExternalEngineTenantVisible(engine.tenantId, req.tenant?.tenantId || null)) throw Errors.notFound('Engine');
      if (!isExternallyRegistered(engine)) throw Errors.validation('Only externally registered engines can be reconciled');
      const registration = await registrationRepo.findOne({ where: { engineId: engine.id } });
      const capabilities = parseExternalEngineCapabilities(registration?.capabilitiesJson || engine.capabilitiesJson);
      const capabilityDiagnostics = getExternalEngineCapabilityDiagnostics(engine.type, capabilities);
      const capabilityStatus = capabilityDiagnostics.status;
      const now = Date.now();
      await engineRepo.update({ id: engine.id }, { capabilityStatus, updatedAt: now });
      if (registration) await registrationRepo.update({ id: registration.id }, { capabilityStatus, updatedAt: now });
      const materializationResults = await engineSetService.materializeEngineSetsForEngine(engine.id, req.tenant?.tenantId || engine.tenantId || null);
      const materializationDiagnostics = getExternalEngineMaterializationDiagnostics(materializationResults as Array<Record<string, unknown>>);
      await logAudit({
        tenantId: req.tenant?.tenantId || undefined, userId: req.user!.userId, action: 'engine.external_registration.reconcile', resourceType: 'engine', resourceId: engine.id,
        details: { externalId: registration?.externalId || engine.externalId || null, externalSystemId: registration?.externalSystemId || engine.externalSystemId || null, lifecycleStatus: registration?.lifecycleStatus || engine.lifecycleStatus || 'active', capabilityStatus, capabilityDiagnostics, materializationResults, materializationDiagnostics },
      });
      res.json({ engineId: engine.id, externalId: registration?.externalId || engine.externalId || null, lifecycleStatus: registration?.lifecycleStatus || engine.lifecycleStatus || 'active', capabilityStatus, capabilityDiagnostics, materializationResults, materializationDiagnostics });
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Reconcile external engine error:', error);
      throw Errors.internal('Failed to reconcile external engine');
    }
  }));
}
