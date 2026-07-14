import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { identityEntitlementMappingService } from '@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { identityAdminLimiter, reconciliationLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { identityAdminJsonPayloadLimit } from '@enterpriseglue/shared/middleware/requestSizeLimit.js';
import {
  IdentityMappingProvisionAccessRequestSchema,
  IdentityMappingRequestSchema,
  IdentityMappingStoredSnapshotPreviewRequestSchema,
  IdentityMappingTestRequestSchema,
  IdentityMappingUpdateSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

const router = Router();
const idSchema = z.string().min(1).max(128);

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
      tenantId,
      createdById: req.user!.userId,
      principalType: 'group',
      principalId: mapping.targetGroupId,
      roleId: req.body.roleId,
      resourceType: req.body.resourceType,
      resourceId: req.body.resourceId || null,
    }, manager);
    return { mapping, assignment, createdGroup };
  });
  await logAudit({ action: 'identity.mapping.provision_access', userId: req.user!.userId, resourceType: 'identity_entitlement_mapping', resourceId: result.mapping.id, details: { targetGroupKey: result.mapping.targetGroupKey, createdGroupId: result.createdGroup?.id || null, roleId: req.body.roleId, resourceType: req.body.resourceType, resourceId: req.body.resourceId } });
  res.status(201).json(result);
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
