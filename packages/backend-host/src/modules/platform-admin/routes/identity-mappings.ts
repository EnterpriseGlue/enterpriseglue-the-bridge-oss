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

const router = Router();
const mappingSchema = z.object({
  providerKey: z.string().min(1).max(160), targetGroupKey: z.string().min(1).max(160),
  entitlementType: z.enum(['group', 'role', 'scope', 'attribute']), externalId: z.string().min(1).max(2000).nullable().optional(),
  matchOperator: z.enum(['exact', 'contains', 'exists']), syncMode: z.enum(['additive', 'authoritative']).optional(),
});
const mappingUpdateSchema = mappingSchema.partial().extend({ isActive: z.boolean().optional() });
const testSchema = mappingSchema.omit({ targetGroupKey: true }).extend({ claims: z.record(z.string(), z.unknown()) });
const storedSnapshotPreviewSchema = mappingSchema.omit({ targetGroupKey: true }).extend({ limit: z.number().int().min(1).max(5000).optional() });
const provisionAccessSchema = mappingSchema.omit({ targetGroupKey: true }).extend({
  targetGroupKey: z.string().min(1).max(160).optional(),
  newGroup: z.object({ key: z.string().min(1).max(255), name: z.string().min(1).max(255), description: z.string().max(2000).nullable().optional() }).optional(),
  roleId: z.string().min(1).max(160),
  resourceType: z.enum(['engine', 'engine_set', 'engine_runtime_resource', 'engine_runtime_resource_set']),
  resourceId: z.string().min(1).max(160),
}).superRefine((value, context) => {
  if (value.targetGroupKey && value.newGroup) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide either targetGroupKey or newGroup, not both', path: ['targetGroupKey'] });
  if (!value.targetGroupKey && !value.newGroup) context.addIssue({ code: z.ZodIssueCode.custom, message: 'targetGroupKey or newGroup is required', path: ['targetGroupKey'] });
});
const idSchema = z.string().min(1).max(128);

router.get('/api/identity/mappings', requireAuth, requireAction('platform.sso.group-mappings.read'), asyncHandler(async (req, res) => {
  res.json(await identityEntitlementMappingService.list(req.tenant?.tenantId || null));
}));
router.post('/api/identity/mappings', requireAuth, requireAction('platform.sso.group-mappings.manage'), validateBody(mappingSchema), asyncHandler(async (req, res) => {
  const mapping = await identityEntitlementMappingService.create(req.body, req.tenant?.tenantId || null);
  await logAudit({ action: 'identity.mapping.create', userId: req.user!.userId, resourceType: 'identity_entitlement_mapping', resourceId: mapping.id, details: { providerKey: mapping.providerKey, targetGroupKey: mapping.targetGroupKey, entitlementType: mapping.entitlementType, matchOperator: mapping.matchOperator } });
  res.status(201).json(mapping);
}));
router.post('/api/identity/mappings/provision-access', requireAuth, requireAction('platform.sso.group-mappings.manage'), requireAction('platform.authz.groups.manage'), requireAction('platform.authz.roles.manage'), validateBody(provisionAccessSchema), asyncHandler(async (req, res) => {
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
      resourceId: req.body.resourceId,
    }, manager);
    return { mapping, assignment, createdGroup };
  });
  await logAudit({ action: 'identity.mapping.provision_access', userId: req.user!.userId, resourceType: 'identity_entitlement_mapping', resourceId: result.mapping.id, details: { targetGroupKey: result.mapping.targetGroupKey, createdGroupId: result.createdGroup?.id || null, roleId: req.body.roleId, resourceType: req.body.resourceType, resourceId: req.body.resourceId } });
  res.status(201).json(result);
}));
router.put('/api/identity/mappings/:id', requireAuth, requireAction('platform.sso.group-mappings.manage'), validateBody(mappingUpdateSchema), asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const mapping = await identityEntitlementMappingService.update(id, req.body, req.tenant?.tenantId || null);
  await logAudit({ action: 'identity.mapping.update', userId: req.user!.userId, resourceType: 'identity_entitlement_mapping', resourceId: mapping.id, details: { changedFields: Object.keys(req.body) } });
  res.json(mapping);
}));
router.delete('/api/identity/mappings/:id', requireAuth, requireAction('platform.sso.group-mappings.manage'), asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  await identityEntitlementMappingService.remove(id, req.tenant?.tenantId || null);
  await logAudit({ action: 'identity.mapping.delete', userId: req.user!.userId, resourceType: 'identity_entitlement_mapping', resourceId: id, details: {} });
  res.status(204).send();
}));
router.post('/api/identity/mappings/test', requireAuth, requireAction('platform.sso.group-mappings.manage'), validateBody(testSchema), asyncHandler(async (req, res) => {
  const result = await identityEntitlementMappingService.test(req.body, req.tenant?.tenantId || null);
  res.json(result);
}));
router.post('/api/identity/mappings/stored-snapshot-preview', requireAuth, requireAction('platform.sso.group-mappings.manage'), validateBody(storedSnapshotPreviewSchema), asyncHandler(async (req, res) => {
  res.json(await identityEntitlementMappingService.previewStoredSnapshots(req.body, req.tenant?.tenantId || null));
}));

export default router;
