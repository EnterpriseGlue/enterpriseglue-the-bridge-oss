import { Router } from 'express';
import { z } from 'zod';
import type { EntityManager } from 'typeorm';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js';
import { identityEntitlementMappingService } from '@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { identityAdminLimiter, reconciliationLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { identityAdminJsonPayloadLimit } from '@enterpriseglue/shared/middleware/requestSizeLimit.js';
import {
  IdentityMappingProvisionAccessRequestSchema,
  IdentityMappingAccessGrantRequestSchema,
  IdentityMappingRequestSchema,
  IdentityMappingStoredSnapshotPreviewRequestSchema,
  IdentityMappingTestRequestSchema,
  IdentityMappingUpdateSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

const router = Router();
const idSchema = z.string().min(1).max(128);

/**
 * Identity providers and mappings are administered at platform scope, but an
 * engine/resource role assignment must live in the tenant that owns its
 * target.  OSS platform-settings routes do not carry a tenant context, so a
 * mapping provisioned for a dedicated default-tenant engine would otherwise
 * be validated as though the engine were global and fail atomically.
 *
 * Preserve an explicit request tenant (EE) and derive only the absent context
 * from the selected resource. The permission service still validates that the
 * resource exists in the resulting tenant before writing the assignment.
 */
async function resolveProvisioningAssignmentTenant(
  manager: EntityManager,
  requestTenantId: string | null,
  resourceType: string,
  resourceId: string | null | undefined,
): Promise<string | null> {
  if (requestTenantId || !resourceId) return requestTenantId;

  const entityByResourceType: Record<string, unknown> = {
    engine: Engine,
    engine_set: EngineSet,
    engine_runtime_resource: RuntimeResource,
    engine_runtime_resource_set: RuntimeResourceSet,
  };
  const entity = entityByResourceType[resourceType];
  if (!entity) return null;

  const resource = await manager.getRepository(entity as any).findOne({
    where: { id: resourceId },
    select: ['tenantId'],
  }) as { tenantId?: string | null } | null;
  return resource?.tenantId || null;
}

router.get('/api/identity/mappings', requireAuth, identityAdminLimiter, requireAction('platform.sso.group-mappings.read'), asyncHandler(async (req, res) => {
  res.json(await identityEntitlementMappingService.list(req.tenant?.tenantId || null));
}));
router.post('/api/identity/mappings', requireAuth, identityAdminLimiter, requireAction('platform.sso.group-mappings.manage'), identityAdminJsonPayloadLimit, validateBody(IdentityMappingRequestSchema), asyncHandler(async (req, res) => {
  const mapping = await identityEntitlementMappingService.create(req.body, req.tenant?.tenantId || null);
  await logAudit({ action: 'identity.mapping.create', userId: req.user!.userId, resourceType: 'identity_entitlement_mapping', resourceId: mapping.id, details: { providerKey: mapping.providerKey, targetGroupKey: mapping.targetGroupKey, entitlementType: mapping.entitlementType, matchOperator: mapping.matchOperator } });
  res.status(201).json(mapping);
}));
router.post('/api/identity/mappings/provision-access', requireAuth, identityAdminLimiter, requireAction('platform.sso.group-mappings.manage'), requireAction('platform.authz.groups.manage'), requireAction('platform.authz.roles.manage'), identityAdminJsonPayloadLimit, validateBody(IdentityMappingProvisionAccessRequestSchema), asyncHandler(async (req, res) => {
  const tenantId = req.tenant?.tenantId || null;
  const dataSource = await getDataSource();
  const result = await dataSource.transaction(async (manager) => {
    const assignmentTenantId = await resolveProvisioningAssignmentTenant(
      manager,
      tenantId,
      req.body.resourceType,
      req.body.resourceId,
    );
    const createdGroup = req.body.newGroup ? await authzGroupService.createGroup({
      tenantId,
      key: req.body.newGroup.key,
      name: req.body.newGroup.name,
      description: req.body.newGroup.description,
      source: 'manual',
      createdById: req.user!.userId,
    }, manager) : null;
    const targetGroupKey = req.body.newGroup?.key || req.body.targetGroupKey!;
    const mapping = await identityEntitlementMappingService.create({
      providerKey: req.body.providerKey,
      targetGroupKey,
      entitlementType: req.body.entitlementType,
      externalId: req.body.externalId,
      matchOperator: req.body.matchOperator,
      syncMode: req.body.syncMode,
    }, tenantId, manager);
    const assignment = await permissionService.assignRole({
      tenantId: assignmentTenantId,
      createdById: req.user!.userId,
      principalType: 'group',
      principalId: mapping.targetGroupId,
      roleId: req.body.roleId,
      resourceType: req.body.resourceType,
      resourceId: req.body.resourceId || null,
      source: 'sso',
      sourceRef: `identity_mapping:${mapping.id}`,
    }, manager);
    return { mapping, assignment, createdGroup };
  });
  await logAudit({ action: 'identity.mapping.provision_access', userId: req.user!.userId, resourceType: 'identity_entitlement_mapping', resourceId: result.mapping.id, details: { targetGroupKey: result.mapping.targetGroupKey, createdGroupId: result.createdGroup?.id || null, roleId: req.body.roleId, resourceType: req.body.resourceType, resourceId: req.body.resourceId } });
  res.status(201).json(result);
}));
router.post('/api/identity/mappings/:id/access', requireAuth, identityAdminLimiter, requireAction('platform.sso.group-mappings.manage'), requireAction('platform.authz.roles.manage'), validateParams(z.object({ id: idSchema })), identityAdminJsonPayloadLimit, validateBody(IdentityMappingAccessGrantRequestSchema), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const tenantId = req.tenant?.tenantId || null;
  const dataSource = await getDataSource();
  const assignment = await dataSource.transaction(async (manager) => {
    const mapping = await manager.getRepository(IdentityEntitlementMapping).findOne({
      where: tenantId ? { id, tenantId } : { id, tenantId: null } as any,
    });
    if (!mapping || !mapping.isActive) throw Errors.notFound('Active identity mapping');
    if (mapping.sourceRef && mapping.ownershipMode !== 'config_warn') {
      throw Errors.forbidden('This identity mapping is managed by configuration');
    }
    const assignmentTenantId = await resolveProvisioningAssignmentTenant(
      manager,
      tenantId,
      req.body.resourceType,
      req.body.resourceId,
    );
    return permissionService.assignRole({
      tenantId: assignmentTenantId,
      createdById: req.user!.userId,
      principalType: 'group',
      principalId: mapping.targetGroupId,
      roleId: req.body.roleId,
      resourceType: req.body.resourceType,
      resourceId: req.body.resourceId,
      source: 'sso',
      sourceRef: `identity_mapping:${mapping.id}`,
    }, manager);
  });
  await logAudit({
    action: 'identity.mapping.grant_access',
    userId: req.user!.userId,
    resourceType: 'identity_entitlement_mapping',
    resourceId: id,
    details: {
      assignmentId: assignment.id,
      roleId: req.body.roleId,
      resourceType: req.body.resourceType,
      resourceId: req.body.resourceId,
    },
  });
  res.status(201).json(assignment);
}));
router.put('/api/identity/mappings/:id', requireAuth, identityAdminLimiter, requireAction('platform.sso.group-mappings.manage'), identityAdminJsonPayloadLimit, validateBody(IdentityMappingUpdateSchema), asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const mapping = await identityEntitlementMappingService.update(id, req.body, req.tenant?.tenantId || null);
  await logAudit({ action: 'identity.mapping.update', userId: req.user!.userId, resourceType: 'identity_entitlement_mapping', resourceId: mapping.id, details: { changedFields: Object.keys(req.body) } });
  res.json(mapping);
}));
router.delete('/api/identity/mappings/:id', requireAuth, identityAdminLimiter, requireAction('platform.sso.group-mappings.manage'), asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  await identityEntitlementMappingService.remove(id, req.tenant?.tenantId || null);
  await logAudit({ action: 'identity.mapping.delete', userId: req.user!.userId, resourceType: 'identity_entitlement_mapping', resourceId: id, details: {} });
  res.status(204).send();
}));
router.post('/api/identity/mappings/test', requireAuth, identityAdminLimiter, reconciliationLimiter, requireAction('platform.sso.group-mappings.manage'), identityAdminJsonPayloadLimit, validateBody(IdentityMappingTestRequestSchema), asyncHandler(async (req, res) => {
  const result = await identityEntitlementMappingService.test(req.body, req.tenant?.tenantId || null);
  res.json(result);
}));
router.post('/api/identity/mappings/stored-snapshot-preview', requireAuth, identityAdminLimiter, reconciliationLimiter, requireAction('platform.sso.group-mappings.manage'), identityAdminJsonPayloadLimit, validateBody(IdentityMappingStoredSnapshotPreviewRequestSchema), asyncHandler(async (req, res) => {
  res.json(await identityEntitlementMappingService.previewStoredSnapshots(req.body, req.tenant?.tenantId || null));
}));

export default router;
