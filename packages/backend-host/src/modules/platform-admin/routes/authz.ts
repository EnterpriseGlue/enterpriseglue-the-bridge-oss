/**
 * Platform Authorization API Routes
 *
 * Provides authorization check endpoint and policy management for admins.
 */

import { Router, Request, Response, NextFunction, raw } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { z } from 'zod';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { ConfigBundleApplyRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/ConfigBundleApplyRun.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSetMaterialization.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { ExternalEngineRegistration } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineRegistration.js';
import { ExternalEngineSystem } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineSystem.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { requireApiClientAction } from '@enterpriseglue/shared/middleware/apiClientAuth.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import {
  policyService,
  ssoClaimsMappingService,
  ssoAssignmentMappingService,
  ssoEngineAccessSnapshotService,
  ssoGroupMappingService,
  legacyMappingCoverageService,
  ssoSyncDiagnosticsService,
  permissionService,
  authzGroupService,
  engineSetService,
  projectEngineTargetService,
  deploymentEligibilityService,
  apiClientService,
  serviceAccountService,
  API_CLIENT_TOKEN_PREFIX,
  ApiClientScopes,
  ServiceAccountScopes,
  AllPermissions,
  EnginePermissions,
  Permission,
  PlatformPermissions,
  ProjectPermissions,
  EvaluationContext,
  SYSTEM_ROLE_IDS,
} from '@enterpriseglue/shared/services/platform-admin/index.js';
import { AUTHZ_PRINCIPAL_TYPES, AUTHZ_RESOURCE_TYPES } from '@enterpriseglue/shared/authz/permission-actions.js';
import { In, IsNull, Not } from 'typeorm';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { getEngineCapabilities } from '@enterpriseglue/shared/services/bpmn-engine-capabilities.js';
import { configBundlePreviewService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js';
import { configBundleSecretPreflightService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleSecretPreflightService.js';
import { configBundleDiffService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleDiffService.js';
import { configBundleApplyService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleApplyService.js';
import { configBundleExportService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleExportService.js';
import { configBundleArchiveService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleArchiveService.js';
import { configBundleIdentityReplayTaskService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleIdentityReplayTaskService.js';
import { runtimeResourceInventoryService } from '@enterpriseglue/shared/services/platform-admin/RuntimeResourceInventoryService.js';
import { deploymentDiscoveryService } from '@enterpriseglue/shared/services/platform-admin/DeploymentDiscoveryService.js';
import {
  evaluateMissionControlStarbaseBridge,
  evaluateStarbaseMissionControlBridge,
} from '../services/bridgeDecisionService.js';

// Validation schemas
const authzResourceTypeSchema = z.enum(AUTHZ_RESOURCE_TYPES);
const authzPrincipalTypeSchema = z.enum(AUTHZ_PRINCIPAL_TYPES);

const authzCheckSchema = z.object({
  action: z.string().min(1),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  userAttributes: z.record(z.string(), z.unknown()).optional(),
  resourceAttributes: z.record(z.string(), z.unknown()).optional(),
});

const authzCheckBatchSchema = z.object({
  checks: z.array(authzCheckSchema).min(1),
});
const legacyMappingCoverageVerificationSchema = z.object({ family: z.enum(['platform_role', 'group', 'engine_assignment']), candidateIdentityMappingId: z.string().min(1), note: z.string().min(3).max(2000) });
const legacyMappingRetirementSchema = z.object({ confirmation: z.literal('RETIRE_LEGACY_MAPPINGS') });
const configBundlePreviewSchema = z.object({
  bundle: z.unknown(),
  files: z.record(z.string(), z.unknown()),
});
const configBundleApplySchema = configBundlePreviewSchema.extend({
  expectedPreviewHash: z.string().min(1),
  expectedSecretPreflightHash: z.string().min(1).max(255).optional(),
  acknowledgements: z.array(z.string().min(1).max(500)).max(100).optional(),
  idempotencyKey: z.string().min(8).max(160).optional(),
  expectedTenantScope: z.string().min(1).max(255).optional(),
  identityReconciliationMode: z.enum(['none', 'preview', 'apply']).optional(),
});

function configBundleRunResponse(row: ConfigBundleApplyRun): Record<string, unknown> {
  let result: Record<string, unknown> = {};
  try { result = row.resultJson ? JSON.parse(row.resultJson) as Record<string, unknown> : {}; } catch { /* preserve run-history availability */ }
  return {
    id: row.id,
    bundleKey: row.bundleKey,
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

const idParamSchema = z.object({ id: z.string().uuid() });
const resourceIdParamSchema = z.object({ id: z.string().min(1) });
const runtimeResourceQuerySchema = z.object({ engineId: z.string().min(1), resourceKind: z.enum(['process_definition', 'decision_definition']).optional(), includeInactive: z.enum(['true', 'false']).optional() });
const externalEngineAuditActions = [
  'engine.external_registration.create',
  'engine.external_registration.update',
  'engine.external_registration.decommission',
  'engine.external_registration.reactivate',
  'engine.external_registration.reconcile',
] as const;
const externalEngineAuditQuerySchema = z.object({
  action: z.enum(['all', ...externalEngineAuditActions]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const externalEngineLifecycleBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

const policyCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  effect: z.enum(['allow', 'deny']),
  resourceType: z.string().optional(),
  action: z.string().optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().min(0).optional(),
});

const policyUpdateSchema = policyCreateSchema.partial();

const ssoMappingCreateSchema = z.object({
  providerId: z.string().min(1).optional(),
  claimType: z.enum(['group', 'role', 'email_domain', 'custom']),
  claimKey: z.string().min(1),
  claimValue: z.string().optional().default(''),
  claimOperator: z.enum([
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'contains_any',
    'not_contains_any',
    'contains_all',
    'not_contains_all',
    'matches_regex',
    'not_matches_regex',
    'exists',
    'not_exists',
  ]).nullable().optional(),
  targetRole: z.enum(['admin', 'user']),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
  riskAcknowledged: z.boolean().optional(),
});

const ssoMappingUpdateSchema = ssoMappingCreateSchema.partial();

const ssoMappingTestSchema = z.object({
  claims: z.record(z.string(), z.unknown()),
  providerId: z.string().min(1).optional(),
});

const authzEvaluateSchema = z.object({
  userId: z.string().uuid(),
  permission: z.string().min(1),
  resourceType: authzResourceTypeSchema.optional(),
  resourceId: z.string().optional(),
});

const customPermissionCreateSchema = z.object({
  key: z.string().min(1).max(255),
  scope: authzResourceTypeSchema,
  category: z.string().min(1).max(128),
  label: z.string().min(1).max(128),
  description: z.string().max(2000).nullable().optional(),
});

const roleIdParamSchema = z.object({ id: z.string().min(1) });
const rolesQuerySchema = z.object({
  scope: authzResourceTypeSchema.optional(),
  kind: z.enum(['system', 'custom']).optional(),
  assignable: z.enum(['true', 'false']).optional(),
  resourceType: z.enum(['project', 'engine']).optional(),
  resourceId: z.string().optional(),
});

const customRoleCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  scope: authzResourceTypeSchema,
  permissionIds: z.array(z.string().min(1)).min(1),
});

const customRoleUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  permissionIds: z.array(z.string().min(1)).min(1).optional(),
  isArchived: z.boolean().optional(),
});

const customRoleDenyFieldNames = [
  'denyPermissionIds',
  'deniedPermissionIds',
  'denyPermissions',
  'deniedPermissions',
  'permissionDenies',
] as const;

const customRoleAllowOnlyMessage = 'Custom roles are allow-only; use authorization policies for deny rules';

const customRoleAllowOnlyGuard = z.object({}).passthrough().superRefine((input, ctx) => {
  for (const field of customRoleDenyFieldNames) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: customRoleAllowOnlyMessage,
      });
    }
  }
});

const customRoleCreateRequestSchema = customRoleAllowOnlyGuard.pipe(customRoleCreateSchema);
const customRoleUpdateRequestSchema = customRoleAllowOnlyGuard.pipe(customRoleUpdateSchema);

const roleAssignmentQuerySchema = z.object({
  principalType: authzPrincipalTypeSchema.optional(),
  principalId: z.string().min(1).optional(),
  resourceType: authzResourceTypeSchema.optional(),
  resourceId: z.string().optional(),
  scopeType: authzResourceTypeSchema.optional(),
  scopeId: z.string().optional(),
});

const roleAssignmentCreateSchema = z.object({
  principalType: authzPrincipalTypeSchema,
  principalId: z.string().min(1),
  roleId: z.string().min(1),
  resourceType: authzResourceTypeSchema.optional(),
  resourceId: z.string().nullable().optional(),
  scopeType: authzResourceTypeSchema.optional(),
  scopeId: z.string().nullable().optional(),
  expiresAt: z.number().nullable().optional(),
});

const authzGroupCreateSchema = z.object({
  key: z.string().min(1).max(255).optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
});

const authzGroupUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  isArchived: z.boolean().optional(),
});

const authzGroupMembershipQuerySchema = z.object({
  groupId: z.string().min(1).optional(),
  userId: z.string().uuid().optional(),
});

const authzGroupMembershipCreateSchema = z.object({
  groupId: z.string().min(1),
  userId: z.string().uuid(),
  expiresAt: z.number().nullable().optional(),
});

type ScopedAssignmentResource = {
  resourceType: 'project' | 'engine';
  resourceId: string;
};

const AUTHZ_ROLE_READ_PERMISSIONS = [
  PlatformPermissions.AUTHZ_ROLES_VIEW,
  PlatformPermissions.AUTHZ_ROLES_MANAGE,
] as Permission[];

const SCOPED_MANAGER_ASSIGNABLE_SYSTEM_ROLE_IDS: Record<ScopedAssignmentResource['resourceType'], Set<string>> = {
  project: new Set([
    SYSTEM_ROLE_IDS.PROJECT_DEVELOPER,
    SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
    SYSTEM_ROLE_IDS.PROJECT_EDITOR,
    SYSTEM_ROLE_IDS.PROJECT_VIEWER,
  ]),
  engine: new Set([
    SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
    SYSTEM_ROLE_IDS.ENGINE_DEPLOYER,
  ]),
};

type ScopedAssignableRoleLike = {
  id: string;
  key?: string | null;
  scope: string | null;
  kind: string;
  isAssignable: boolean;
  isArchived?: boolean;
};

function isScopedManagerAssignableRole(role: ScopedAssignableRoleLike, resource: ScopedAssignmentResource): boolean {
  if (role.scope !== resource.resourceType || !role.isAssignable || role.isArchived) {
    return false;
  }

  if (role.kind === 'custom') {
    return true;
  }

  if (role.kind !== 'system') {
    return false;
  }

  const allowed = SCOPED_MANAGER_ASSIGNABLE_SYSTEM_ROLE_IDS[resource.resourceType];
  return allowed.has(role.id) || Boolean(role.key && allowed.has(role.key));
}

async function hasPlatformPermission(req: Request, permission: Permission): Promise<boolean> {
  return permissionService.hasPermission(permission, {
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    platformRole: req.user!.platformRole || (req.user as any).role,
    resourceType: 'platform',
  });
}

async function hasAnyPlatformPermission(req: Request, permissions: Permission[]): Promise<boolean> {
  for (const permission of permissions) {
    if (await hasPlatformPermission(req, permission)) {
      return true;
    }
  }
  return false;
}

async function assertPlatformPermission(req: Request, permission: Permission): Promise<void> {
  if (!await hasPlatformPermission(req, permission)) {
    throw Errors.adminRequired();
  }
}

async function assertAnyPlatformPermission(req: Request, permissions: Permission[]): Promise<void> {
  if (!await hasAnyPlatformPermission(req, permissions)) {
    throw Errors.adminRequired();
  }
}

function scopedAssignmentPermission(resourceType: 'project' | 'engine') {
  return resourceType === 'project' ? ProjectPermissions.MEMBERS_MANAGE : EnginePermissions.MEMBERS_MANAGE;
}

function scopedAssignmentViewPermission(resourceType: 'project' | 'engine') {
  return resourceType === 'project' ? ProjectPermissions.MEMBERS_VIEW : EnginePermissions.MEMBERS_VIEW;
}

function toScopedAssignmentResource(resourceType?: unknown, resourceId?: unknown): ScopedAssignmentResource | null {
  if ((resourceType !== 'project' && resourceType !== 'engine') || typeof resourceId !== 'string' || !resourceId.trim()) {
    return null;
  }
  return { resourceType, resourceId: resourceId.trim() };
}

async function hasScopedAssignmentPermission(req: Request, resource: ScopedAssignmentResource, permission: Permission): Promise<boolean> {
  return permissionService.hasPermission(permission, {
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    platformRole: req.user!.platformRole || (req.user as any).role,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
  });
}

async function canViewScopedAssignments(req: Request, resource: ScopedAssignmentResource): Promise<boolean> {
  return await hasScopedAssignmentPermission(req, resource, scopedAssignmentViewPermission(resource.resourceType) as Permission) ||
    await hasScopedAssignmentPermission(req, resource, scopedAssignmentPermission(resource.resourceType) as Permission);
}

async function canManageScopedAssignments(req: Request, resource: ScopedAssignmentResource): Promise<boolean> {
  return hasScopedAssignmentPermission(req, resource, scopedAssignmentPermission(resource.resourceType) as Permission);
}

async function assertCanViewRoleAssignments(req: Request, resource: ScopedAssignmentResource | null): Promise<void> {
  if (await hasAnyPlatformPermission(req, AUTHZ_ROLE_READ_PERMISSIONS)) return;
  if (!resource || !await canViewScopedAssignments(req, resource)) {
    throw Errors.adminRequired();
  }
}

async function assertCanAssignScopedRole(req: Request, input: z.infer<typeof roleAssignmentCreateSchema>): Promise<void> {
  if (await hasPlatformPermission(req, PlatformPermissions.AUTHZ_ROLES_MANAGE)) return;

  const resource = toScopedAssignmentResource(input.resourceType, input.resourceId);
  if (!resource || !await canManageScopedAssignments(req, resource)) {
    throw Errors.adminRequired();
  }

  const role = await permissionService.getRole(input.roleId, req.tenant?.tenantId || null);
  if (!role) {
    throw Errors.notFound('Role');
  }
  if (!isScopedManagerAssignableRole(role, resource)) {
    throw Errors.forbidden('Resource managers can assign only delegated system roles or active custom roles for the same resource scope');
  }
}

async function assertCanRemoveScopedAssignment(req: Request, id: string): Promise<void> {
  if (await hasPlatformPermission(req, PlatformPermissions.AUTHZ_ROLES_MANAGE)) return;

  const dataSource = await getDataSource();
  const assignment = await dataSource.getRepository(RbacRoleAssignment).findOne({ where: { id } });
  if (!assignment) {
    throw Errors.notFound('Role assignment');
  }
  const resource = toScopedAssignmentResource(assignment.resourceType, assignment.resourceId);
  if (!resource || !await canManageScopedAssignments(req, resource)) {
    throw Errors.adminRequired();
  }

  const role = await permissionService.getRole(assignment.roleId, req.tenant?.tenantId || null);
  if (!role || !isScopedManagerAssignableRole(role, resource) || assignment.source !== 'manual') {
    throw Errors.forbidden('Resource managers can remove only manual delegated system or custom role assignments for the same resource scope');
  }
}

const apiClientCreateSchema = z.object({
  name: z.string().min(1).max(255),
  scopes: z.array(z.enum([
    ApiClientScopes.CONFIG_BUNDLE_MANAGE,
    ApiClientScopes.ENGINE_REGISTER,
    ApiClientScopes.DEPLOYMENT_EXECUTE,
  ])).min(1).optional(),
});

const serviceAccountCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  scopes: z.array(z.enum([ServiceAccountScopes.DEPLOYMENT_EXECUTE])).min(1).optional(),
});

const engineManagementModeSchema = z.enum(['external_managed', 'hybrid']);
const engineFieldOwnerSchema = z.enum(['manual', 'external']);
const engineFieldOwnershipSchema = z.record(z.string().min(1).max(128), engineFieldOwnerSchema);
type EngineFieldOwnership = z.infer<typeof engineFieldOwnershipSchema>;

const DEFAULT_EXTERNAL_ENGINE_FIELD_OWNERSHIP: EngineFieldOwnership = {
  identity: 'external',
  connection: 'external',
  metadata: 'external',
  labels: 'external',
  auth: 'external',
  version: 'external',
  display: 'manual',
  environment: 'manual',
};

const externalEngineSystemCreateSchema = z.object({
  key: z.string().min(1).max(255).regex(/^[a-z0-9][a-z0-9._-]*$/).optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  defaultManagementMode: engineManagementModeSchema.optional(),
  defaultFieldOwnership: engineFieldOwnershipSchema.optional(),
});

const externalEngineSystemUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  defaultManagementMode: engineManagementModeSchema.optional(),
  defaultFieldOwnership: engineFieldOwnershipSchema.optional(),
  isActive: z.boolean().optional(),
});

const engineSetSelectorSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({
    mode: z.literal('engine_ids'),
    engineIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    mode: z.literal('labels'),
    labels: z.record(z.string().min(1), z.string().min(1)).refine((labels) => Object.keys(labels).length > 0, {
      message: 'At least one label is required',
    }),
    labelMatch: z.enum(['all', 'any']).optional(),
  }),
]);

const engineSetCreateSchema = z.object({
  key: z.string().min(1).max(255).optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  selector: engineSetSelectorSchema,
  riskAcknowledged: z.boolean().optional(),
});

const engineSetUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  selector: engineSetSelectorSchema.optional(),
  isArchived: z.boolean().optional(),
  riskAcknowledged: z.boolean().optional(),
});

const engineSetPreviewSchema = z.object({
  selector: engineSetSelectorSchema,
});

const projectEngineTargetStatusSchema = z.enum(['active', 'disabled', 'archived']);
const projectEngineTargetSourceSchema = z.enum(['manual', 'legacy', 'ci', 'api', 'import', 'deployment_history', 'external', 'system', 'automation']);
const projectEngineTargetModeSchema = z.enum(['manual', 'ci', 'api', 'import']);
const projectEngineTargetApprovalStatusSchema = z.enum(['not_required', 'pending', 'approved', 'rejected']);
const projectEngineTargetDiagnosticsSchema = z.record(z.string(), z.unknown());

const projectEngineTargetQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  engineId: z.string().min(1).optional(),
  status: z.enum(['active', 'disabled', 'archived', 'all']).optional(),
  source: projectEngineTargetSourceSchema.optional(),
});

const projectEngineTargetCreateSchema = z.object({
  projectId: z.string().min(1),
  engineId: z.string().min(1),
  status: projectEngineTargetStatusSchema.optional(),
  source: projectEngineTargetSourceSchema.optional(),
  sourceRef: z.string().nullable().optional(),
  externalSystemId: z.string().nullable().optional(),
  externalProjectId: z.string().nullable().optional(),
  externalEngineId: z.string().nullable().optional(),
  externalTargetId: z.string().nullable().optional(),
  allowManualDeploy: z.boolean().optional(),
  allowCiDeploy: z.boolean().optional(),
  allowApiDeploy: z.boolean().optional(),
  allowImport: z.boolean().optional(),
  approvedById: z.string().nullable().optional(),
  approvalStatus: projectEngineTargetApprovalStatusSchema.optional(),
  approvedAt: z.number().nullable().optional(),
  policyTags: z.array(z.string()).optional(),
  diagnostics: projectEngineTargetDiagnosticsSchema.nullable().optional(),
});

const projectEngineTargetUpdateSchema = z.object({
  status: projectEngineTargetStatusSchema.optional(),
  source: projectEngineTargetSourceSchema.optional(),
  sourceRef: z.string().nullable().optional(),
  externalSystemId: z.string().nullable().optional(),
  externalProjectId: z.string().nullable().optional(),
  externalEngineId: z.string().nullable().optional(),
  externalTargetId: z.string().nullable().optional(),
  allowManualDeploy: z.boolean().optional(),
  allowCiDeploy: z.boolean().optional(),
  allowApiDeploy: z.boolean().optional(),
  allowImport: z.boolean().optional(),
  approvedById: z.string().nullable().optional(),
  approvalStatus: projectEngineTargetApprovalStatusSchema.optional(),
  approvedAt: z.number().nullable().optional(),
  policyTags: z.array(z.string()).optional(),
  diagnostics: projectEngineTargetDiagnosticsSchema.nullable().optional(),
});

const projectEngineTargetSyncLegacySchema = z.object({
  projectId: z.string().min(1),
});

const deploymentEligibilityEvaluateSchema = z.object({
  userId: z.string().min(1),
  projectId: z.string().min(1),
  engineId: z.string().min(1),
  mode: projectEngineTargetModeSchema.optional(),
});

const ssoAssignmentMappingCreateSchema = z.object({
  providerId: z.string().min(1).nullable().optional(),
  claimType: z.enum(['group', 'role', 'email_domain', 'custom']),
  claimKey: z.string().min(1),
  claimValue: z.string().optional().default(''),
  claimOperator: z.enum([
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'contains_any',
    'not_contains_any',
    'contains_all',
    'not_contains_all',
    'matches_regex',
    'not_matches_regex',
    'exists',
    'not_exists',
  ]).nullable().optional(),
  targetSelectorType: z.enum(['engine_id', 'all_engines', 'external_engine_id', 'engine_label']),
  targetEngineId: z.string().min(1).nullable().optional(),
  targetExternalEngineId: z.string().min(1).nullable().optional(),
  targetLabelKey: z.string().min(1).nullable().optional(),
  targetLabelValue: z.string().min(1).nullable().optional(),
  targetRoleId: z.string().min(1),
  syncMode: z.enum(['authoritative', 'additive']).optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
  riskAcknowledged: z.boolean().optional(),
});

const ssoAssignmentMappingUpdateSchema = ssoAssignmentMappingCreateSchema.partial();
const ssoAssignmentMappingProviderNeutralMigrationSchema = z.object({
  providerKey: z.string().min(1).max(128),
  targetGroupKey: z.string().min(1).max(160).optional(),
  newGroup: z.object({ key: z.string().min(1).max(255), name: z.string().min(1).max(255), description: z.string().max(2000).nullable().optional() }).optional(),
}).refine((value) => Boolean(value.targetGroupKey) !== Boolean(value.newGroup), { message: 'Provide exactly one of targetGroupKey or newGroup' });

const ssoAssignmentMappingTestSchema = z.object({
  claims: z.record(z.string(), z.unknown()),
  providerId: z.string().min(1).optional(),
});

const ssoGroupMappingCreateSchema = z.object({
  providerId: z.string().min(1).nullable().optional(),
  claimType: z.enum(['group', 'role', 'email_domain', 'custom']),
  claimKey: z.string().min(1),
  claimValue: z.string().optional().default(''),
  claimOperator: z.enum([
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'contains_any',
    'not_contains_any',
    'contains_all',
    'not_contains_all',
    'matches_regex',
    'not_matches_regex',
    'exists',
    'not_exists',
  ]).nullable().optional(),
  targetGroupId: z.string().min(1),
  syncMode: z.enum(['authoritative', 'additive']).optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
  riskAcknowledged: z.boolean().optional(),
});

const ssoGroupMappingUpdateSchema = ssoGroupMappingCreateSchema.partial();

const ssoGroupMappingTestSchema = z.object({
  claims: z.record(z.string(), z.unknown()),
  providerId: z.string().min(1).optional(),
});
const ssoGroupMappingProviderNeutralMigrationSchema = z.object({ providerKey: z.string().min(1).max(128) });
const ssoPlatformMappingProviderNeutralMigrationSchema = z.object({ providerKey: z.string().min(1).max(128), targetGroupKey: z.string().min(1).max(160).optional(), newGroup: z.object({ key: z.string().min(1).max(255), name: z.string().min(1).max(255), description: z.string().max(2000).nullable().optional() }).optional() }).refine((value) => Boolean(value.targetGroupKey) !== Boolean(value.newGroup), { message: 'Provide exactly one of targetGroupKey or newGroup' });

const ssoSyncRunsQuerySchema = z.object({
  providerId: z.string().min(1).optional(),
  userId: z.string().uuid().optional(),
  status: z.enum(['running', 'success', 'failed']).optional(),
  trigger: z.enum(['login', 'scheduled', 'manual', 'mapping_change', 'engine_change']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const ssoSyncEventsQuerySchema = z.object({
  providerId: z.string().min(1).optional(),
  severity: z.enum(['info', 'warning', 'error']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const ssoSyncDiagnosticsRunSchema = z.object({
  providerId: z.string().min(1).optional(),
  trigger: z.enum(['manual', 'scheduled', 'mapping_change', 'engine_change']).optional(),
  includeProviderChecks: z.boolean().optional(),
  includeSnapshotReplay: z.boolean().optional(),
  refreshProviderClaims: z.boolean().optional(),
  includeCleanup: z.boolean().optional(),
});

const ssoEngineAccessSnapshotQuerySchema = z.object({
  providerId: z.string().min(1).optional(),
  mappingId: z.string().min(1).optional(),
  principalType: z.string().min(1).optional(),
  principalId: z.string().min(1).optional(),
  engineId: z.string().min(1).optional(),
  status: z.enum([
    'active',
    'stale',
    'removed_by_sso',
    'removed_by_admin',
    'mapping_disabled',
    'provider_identity_missing',
    'provider_group_missing',
    'engine_no_longer_matches_selector',
  ]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const engineIdParamSchema = z.object({ engineId: z.string().min(1) });

const transitionCleanupApplySchema = z.object({
  previewCorrelationId: z.string().min(1).optional(),
  assignmentIds: z.array(z.string().min(1)).min(1),
});

const bridgeDecisionSchema = z.object({
  engineId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  fileId: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
  definitionId: z.string().min(1).optional(),
  definitionKey: z.string().min(1).optional(),
  decisionDefinitionId: z.string().min(1).optional(),
  decisionDefinitionKey: z.string().min(1).optional(),
  kind: z.enum(['process', 'decision', 'bpmn', 'dmn']).optional(),
}).passthrough();

const authzAuditQuerySchema = z.object({
  userId: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  decision: z.enum(['allow', 'deny']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const router = Router();

function requirePlatformAction(actionId: string) {
  return requireAction(actionId, { resourceResolver: 'platform.self' });
}

function hasApiClientBearerToken(req: Request): boolean {
  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  return authorization.startsWith(`Bearer ${API_CLIENT_TOKEN_PREFIX}_`);
}

/**
 * Config bundles can be changed by an interactive platform administrator or
 * by an explicitly scoped API client that also holds the matching RBAC action.
 */
function requireConfigBundleAccess(req: Request, res: Response, next: NextFunction) {
  if (hasApiClientBearerToken(req)) {
    return requireApiClientAction(
      ApiClientScopes.CONFIG_BUNDLE_MANAGE,
      'platform.authz.roles.manage',
    )(req, res, next);
  }

  return requireAuth(req, res, (error?: unknown) => {
    if (error) return next(error);
    return requirePlatformAction('platform.authz.roles.manage')(req, res, next);
  });
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseEngineLabels(labelsJson: string | null | undefined): Record<string, string> {
  const parsed = parseJsonObject(labelsJson);
  if (!parsed) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function normalizeExternalSystemKey(name: string): string {
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 255) || 'external-engine-system';
}

function normalizeFieldOwnership(ownership?: EngineFieldOwnership | null): EngineFieldOwnership {
  return {
    ...DEFAULT_EXTERNAL_ENGINE_FIELD_OWNERSHIP,
    ...(ownership || {}),
  };
}

function fieldOwnershipToJson(ownership?: EngineFieldOwnership | null): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(normalizeFieldOwnership(ownership)).sort(([left], [right]) => left.localeCompare(right))
  ));
}

function parseFieldOwnership(value: string | null | undefined): EngineFieldOwnership {
  const parsed = parseJsonObject(value);
  if (!parsed) return { ...DEFAULT_EXTERNAL_ENGINE_FIELD_OWNERSHIP };
  return normalizeFieldOwnership(Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, 'manual' | 'external'] => entry[1] === 'manual' || entry[1] === 'external')
  ));
}

function parseExternalEngineCapabilities(value: string | null | undefined): Record<string, unknown> | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const operations = Array.isArray(parsed.operations)
    ? Array.from(new Set(parsed.operations.filter((operation): operation is string => typeof operation === 'string'))).sort()
    : [];
  return {
    ...parsed,
    operations,
  };
}

function tenantVisible(rowTenantId: string | null | undefined, tenantId?: string | null): boolean {
  const normalizedTenantId = tenantId?.trim() || null;
  return !normalizedTenantId || !rowTenantId || rowTenantId === normalizedTenantId;
}

function getCapabilityDiagnostics(type: unknown, capabilities: Record<string, unknown> | null) {
  const expected = getEngineCapabilities(type);
  const expectedOperations: string[] = [...expected.operations].sort();
  const reportedOperations = Array.isArray(capabilities?.operations)
    ? Array.from(new Set(capabilities.operations.filter((operation): operation is string => typeof operation === 'string'))).sort()
    : [];
  const reported = new Set(reportedOperations);
  const expectedSet = new Set(expectedOperations);
  const missingOperations = expectedOperations.filter((operation) => !reported.has(operation));
  const extraOperations = reportedOperations.filter((operation) => !expectedSet.has(operation));
  const status: 'unknown' | 'in_sync' | 'mismatch' = reportedOperations.length === 0 ? 'unknown' : missingOperations.length > 0 ? 'mismatch' : 'in_sync';
  const issues = [
    reportedOperations.length === 0 ? 'No operation capabilities were reported by the external system.' : '',
    missingOperations.length > 0 ? `Missing expected operations: ${missingOperations.join(', ')}.` : '',
    extraOperations.length > 0 ? `Reported unsupported operations: ${extraOperations.join(', ')}.` : '',
  ].filter(Boolean);

  return {
    status,
    expectedOperations,
    reportedOperations,
    missingOperations,
    extraOperations,
    expectedSupportLevel: expected.supportLevel,
    reportedSupportLevel: typeof capabilities?.supportLevel === 'string' ? capabilities.supportLevel : null,
    expectedCompatibilityProfile: expected.compatibilityProfile,
    reportedCompatibilityProfile: typeof capabilities?.compatibilityProfile === 'string' ? capabilities.compatibilityProfile : null,
    issues,
    recommendation: status === 'in_sync'
      ? 'No capability action required.'
      : 'Update the external registration payload to report the missing operations, then run reconcile again.',
  };
}

function getCapabilityStatus(type: unknown, capabilities: Record<string, unknown> | null): 'unknown' | 'in_sync' | 'mismatch' {
  return getCapabilityDiagnostics(type, capabilities).status;
}

function getMaterializationDiagnostics(results: Array<Record<string, unknown>>) {
  const errors = results
    .filter((result) => typeof result.error === 'string')
    .map((result) => ({
      engineSetId: typeof result.engineSetId === 'string' ? result.engineSetId : '',
      error: String(result.error),
    }));
  const totals = results.reduce<{ matched: number; created: number; updated: number; removed: number }>((acc, result) => ({
    matched: acc.matched + (typeof result.matched === 'number' ? result.matched : 0),
    created: acc.created + (typeof result.created === 'number' ? result.created : 0),
    updated: acc.updated + (typeof result.updated === 'number' ? result.updated : 0),
    removed: acc.removed + (typeof result.removed === 'number' ? result.removed : 0),
  }), { matched: 0, created: 0, updated: 0, removed: 0 });

  return {
    engineSetCount: results.length,
    ...totals,
    errors,
    status: errors.length > 0 ? 'failed' : 'ok',
    summary: errors.length > 0
      ? `${errors.length} Engine Set materialization error${errors.length === 1 ? '' : 's'}`
      : `${results.length} Engine Set${results.length === 1 ? '' : 's'} checked; ${totals.created} created, ${totals.updated} updated, ${totals.removed} removed`,
  };
}

function serializeExternalEngineSystem(system: ExternalEngineSystem) {
  return {
    id: system.id,
    tenantId: system.tenantId,
    key: system.key,
    name: system.name,
    description: system.description,
    defaultManagementMode: system.defaultManagementMode === 'hybrid' ? 'hybrid' : 'external_managed',
    defaultFieldOwnership: parseFieldOwnership(system.defaultFieldOwnershipJson),
    isActive: system.isActive,
    createdById: system.createdById,
    createdAt: system.createdAt,
    updatedAt: system.updatedAt,
  };
}

// ============================================================================
// Authorization Check Endpoint
// ============================================================================

/**
 * POST /api/platform-admin/authz/check
 * Check if a user has permission to perform an action on a resource.
 * Returns the decision and the reason.
 */
router.post('/api/authz/check', apiLimiter, requireAuth, validateBody(authzCheckSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { action, resourceType, resourceId, userAttributes, resourceAttributes } = req.body;

    const context: EvaluationContext = {
      userId: req.user!.userId,
      tenantId: req.tenant?.tenantId || null,
      platformRole: req.user!.platformRole || (req.user as { role?: string }).role,
      resourceType,
      resourceId,
      userAttributes,
      resourceAttributes,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: Date.now(),
    };

    const result = await policyService.evaluateAndLog(action as Permission, context);

    res.json({
      allowed: result.decision === 'allow',
      decision: result.decision,
      reason: result.reason,
      policyId: result.policyId,
      policyName: result.policyName,
    });
  } catch (error: any) {
    logger.error('Authorization check error:', error);
    throw Errors.internal('Authorization check failed');
  }
}));

/**
 * POST /api/platform-admin/authz/check-batch
 * Check multiple permissions at once.
 */
router.post('/api/authz/check-batch', apiLimiter, requireAuth, validateBody(authzCheckBatchSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { checks } = req.body;

    const results = await Promise.all(
      checks.map(async (check: any) => {
        const context: EvaluationContext = {
          userId: req.user!.userId,
          tenantId: req.tenant?.tenantId || null,
          platformRole: req.user!.platformRole || (req.user as { role?: string }).role,
          resourceType: check.resourceType,
          resourceId: check.resourceId,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          timestamp: Date.now(),
        };

        const result = await policyService.evaluate(check.action as Permission, context);

        return {
          action: check.action,
          resourceType: check.resourceType,
          resourceId: check.resourceId,
          allowed: result.decision === 'allow',
          reason: result.reason,
        };
      })
    );

    res.json({ results });
  } catch (error: any) {
    logger.error('Batch authorization check error:', error);
    throw Errors.internal('Authorization check failed');
  }
}));

/**
 * GET /api/platform-admin/authz/me/permissions
 * Return the current user's effective platform, project, and engine permissions.
 */
router.get('/api/authz/me/permissions', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const snapshot = await permissionService.getCurrentUserPermissions(req.user!.userId, req.tenant?.tenantId || null);
    res.json(snapshot);
  } catch (error: any) {
    logger.error('Get current user permissions error:', error);
    throw Errors.internal('Failed to get current user permissions');
  }
}));

/**
 * GET /api/platform-admin/authz/permissions
 * List the seeded permission catalog.
 */
router.get('/api/authz/permissions', apiLimiter, requireAuth, requirePlatformAction('platform.authz.permissions.read'), asyncHandler(async (_req: Request, res: Response) => {
  res.json(await permissionService.getPermissionCatalog());
}));

/**
 * POST /api/platform-admin/authz/permissions
 * Create a custom permission catalog entry.
 */
router.post('/api/authz/permissions', apiLimiter, requireAuth, requirePlatformAction('platform.authz.roles.manage'), validateBody(customPermissionCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await permissionService.createCustomPermission({
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
      createdById: req.user!.userId,
    });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Create custom permission error:', error);
    throw Errors.badRequest(error.message || 'Failed to create custom permission');
  }
}));

/**
 * GET /api/platform-admin/authz/roles
 * List seeded and custom roles with permission counts.
 */
router.get('/api/authz/roles', apiLimiter, requireAuth, validateQuery(rolesQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const resource = toScopedAssignmentResource(req.query.resourceType, req.query.resourceId);
    const canListPlatformRoles = await hasAnyPlatformPermission(req, AUTHZ_ROLE_READ_PERMISSIONS);
    if (!canListPlatformRoles) {
      if (!resource || !await canManageScopedAssignments(req, resource)) {
        throw Errors.adminRequired();
      }
      if (req.query.scope !== resource.resourceType || req.query.assignable !== 'true') {
        throw Errors.forbidden('Resource managers can list only assignable roles for their managed resource scope');
      }
    }

    const roles = await permissionService.getRoles(req.tenant?.tenantId || null);
    let filtered = roles.filter((role) => {
      if (req.query.scope && role.scope !== req.query.scope) return false;
      if (req.query.kind && role.kind !== req.query.kind) return false;
      if (req.query.assignable === 'true' && (!role.isAssignable || role.isArchived)) return false;
      if (req.query.assignable === 'false' && role.isAssignable) return false;
      return true;
    });
    if (!canListPlatformRoles && resource) {
      filtered = filtered.filter((role) => isScopedManagerAssignableRole(role, resource));
    }
    res.json(filtered);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Get roles error:', error);
    throw Errors.internal('Failed to get roles');
  }
}));

/**
 * GET /api/platform-admin/authz/roles/:id
 * Get a role with its assigned permissions.
 */
router.get('/api/authz/roles/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.roles.read'), validateParams(roleIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const role = await permissionService.getRole(String(req.params.id), req.tenant?.tenantId || null);
    if (!role) {
      throw Errors.notFound('Role');
    }
    res.json(role);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Get role error:', error);
    throw Errors.internal('Failed to get role');
  }
}));

/**
 * POST /api/platform-admin/authz/roles
 * Create a custom role.
 */
router.post('/api/authz/roles', apiLimiter, requireAuth, requirePlatformAction('platform.authz.roles.manage'), validateBody(customRoleCreateRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await permissionService.createCustomRole({
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
      createdById: req.user!.userId,
    });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Create custom role error:', error);
    throw Errors.badRequest(error.message || 'Failed to create custom role');
  }
}));

/**
 * PUT /api/platform-admin/authz/roles/:id
 * Update a custom role.
 */
router.put('/api/authz/roles/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.roles.manage'), validateParams(roleIdParamSchema), validateBody(customRoleUpdateRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await permissionService.updateCustomRole(String(req.params.id), {
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
      updatedById: req.user!.userId,
    });
    res.json({ success: true });
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Update custom role error:', error);
    throw Errors.badRequest(error.message || 'Failed to update custom role');
  }
}));

/**
 * DELETE /api/platform-admin/authz/roles/:id
 * Archive a custom role.
 */
router.delete('/api/authz/roles/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.roles.manage'), validateParams(roleIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await permissionService.archiveCustomRole(String(req.params.id), req.user!.userId);
    res.status(204).send();
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Archive custom role error:', error);
    throw Errors.badRequest(error.message || 'Failed to archive custom role');
  }
}));

/**
 * GET /api/platform-admin/authz/role-assignments
 * List role assignments.
 */
router.get('/api/authz/role-assignments', apiLimiter, requireAuth, validateQuery(roleAssignmentQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const resource = toScopedAssignmentResource(req.query.resourceType, req.query.resourceId);
    await assertCanViewRoleAssignments(req, resource);

    const assignments = await permissionService.listRoleAssignments({
      tenantId: req.tenant?.tenantId || null,
      principalType: typeof req.query.principalType === 'string' ? req.query.principalType as any : undefined,
      principalId: typeof req.query.principalId === 'string' ? req.query.principalId : undefined,
      resourceType: typeof req.query.resourceType === 'string' ? req.query.resourceType as any : undefined,
      resourceId: typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined,
      scopeType: typeof req.query.scopeType === 'string' ? req.query.scopeType as any : undefined,
      scopeId: typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined,
    });
    res.json(assignments);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('List role assignments error:', error);
    throw Errors.internal('Failed to list role assignments');
  }
}));

/**
 * POST /api/platform-admin/authz/role-assignments
 * Assign a role manually.
 */
router.post('/api/authz/role-assignments', apiLimiter, requireAuth, validateBody(roleAssignmentCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await assertCanAssignScopedRole(req, req.body);

    const result = await permissionService.assignRole({
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
      createdById: req.user!.userId,
    });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Assign role error:', error);
    throw Errors.badRequest(error.message || 'Failed to assign role');
  }
}));

/**
 * DELETE /api/platform-admin/authz/role-assignments/:id
 * Remove a manual role assignment.
 */
router.delete('/api/authz/role-assignments/:id', apiLimiter, requireAuth, validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await assertCanRemoveScopedAssignment(req, String(req.params.id));

    await permissionService.removeRoleAssignment(String(req.params.id), req.user!.userId);
    res.status(204).send();
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Remove role assignment error:', error);
    throw Errors.badRequest(error.message || 'Failed to remove role assignment');
  }
}));

/**
 * GET /api/platform-admin/authz/groups
 * List internal authorization groups.
 */
router.get('/api/authz/groups', apiLimiter, requireAuth, requirePlatformAction('platform.authz.groups.read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const groups = await authzGroupService.listGroups({
      tenantId: req.tenant?.tenantId || null,
      includeArchived: req.query.includeArchived === 'true',
    });
    res.json(groups);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('List authz groups error:', error);
    throw Errors.internal('Failed to list authorization groups');
  }
}));

/**
 * POST /api/platform-admin/authz/groups
 * Create an internal authorization group.
 */
router.post('/api/authz/groups', apiLimiter, requireAuth, requirePlatformAction('platform.authz.groups.manage'), validateBody(authzGroupCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await authzGroupService.createGroup({
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
      source: 'manual',
      createdById: req.user!.userId,
    });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Create authz group error:', error);
    throw Errors.badRequest(error.message || 'Failed to create authorization group');
  }
}));

/**
 * PUT /api/platform-admin/authz/groups/:id
 * Update an internal authorization group.
 */
router.put('/api/authz/groups/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.groups.manage'), validateParams(resourceIdParamSchema), validateBody(authzGroupUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await authzGroupService.updateGroup(String(req.params.id), {
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
      updatedById: req.user!.userId,
    });
    res.json({ success: true });
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Update authz group error:', error);
    throw Errors.badRequest(error.message || 'Failed to update authorization group');
  }
}));

/**
 * DELETE /api/platform-admin/authz/groups/:id
 * Archive an internal authorization group.
 */
router.delete('/api/authz/groups/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.groups.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await authzGroupService.updateGroup(String(req.params.id), {
      tenantId: req.tenant?.tenantId || null,
      isArchived: true,
      updatedById: req.user!.userId,
    });
    res.status(204).send();
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Archive authz group error:', error);
    throw Errors.badRequest(error.message || 'Failed to archive authorization group');
  }
}));

/**
 * GET /api/platform-admin/authz/group-memberships
 * List internal authorization group memberships.
 */
router.get('/api/authz/group-memberships', apiLimiter, requireAuth, requirePlatformAction('platform.authz.groups.read'), validateQuery(authzGroupMembershipQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const memberships = await authzGroupService.listMemberships({
      tenantId: req.tenant?.tenantId || null,
      groupId: typeof req.query.groupId === 'string' ? req.query.groupId : undefined,
      userId: typeof req.query.userId === 'string' ? req.query.userId : undefined,
    });
    res.json(memberships);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('List authz group memberships error:', error);
    throw Errors.internal('Failed to list authorization group memberships');
  }
}));

/**
 * POST /api/platform-admin/authz/group-memberships
 * Add a user to an authorization group.
 */
router.post('/api/authz/group-memberships', apiLimiter, requireAuth, requirePlatformAction('platform.authz.groups.manage'), validateBody(authzGroupMembershipCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await authzGroupService.addMembership({
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
      source: 'manual',
      createdById: req.user!.userId,
    });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Create authz group membership error:', error);
    throw Errors.badRequest(error.message || 'Failed to create authorization group membership');
  }
}));

/**
 * DELETE /api/platform-admin/authz/group-memberships/:id
 * Remove an authorization group membership.
 */
router.delete('/api/authz/group-memberships/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.groups.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await authzGroupService.removeMembership(String(req.params.id), req.user!.userId);
    res.status(204).send();
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Delete authz group membership error:', error);
    throw Errors.badRequest(error.message || 'Failed to remove authorization group membership');
  }
}));

/**
 * POST /api/platform-admin/authz/evaluate
 * Explain effective access for a user/resource/permission.
 */
router.post('/api/authz/evaluate', apiLimiter, requireAuth, requirePlatformAction('platform.authz.evaluate'), validateBody(authzEvaluateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { userId, permission, resourceType, resourceId } = req.body;
    if (!new Set<string>(Object.values(AllPermissions)).has(permission)) {
      throw Errors.validation('Unknown permission');
    }

    const context: EvaluationContext = {
      userId,
      tenantId: req.tenant?.tenantId || null,
      resourceType,
      resourceId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: Date.now(),
    };

    const base = await permissionService.evaluatePermission(permission as Permission, context);
    const policy = await policyService.evaluate(permission as Permission, context);

    res.json({
      allowed: policy.decision === 'allow',
      decision: policy.decision,
      reason: policy.reason,
      policyId: policy.policyId,
      policyName: policy.policyName,
      baseAllowed: base.allowed,
      baseReason: base.reason,
      sources: base.sources,
    });
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Evaluate effective access error:', error);
    throw Errors.internal('Failed to evaluate access');
  }
}));

/** Validate a config bundle for CI/CD without resolving secrets or mutating state. */
router.post('/api/authz/config-bundles/import-zip', apiLimiter, requireConfigBundleAccess, raw({ type: ['application/zip', 'application/octet-stream'], limit: '1mb' }), asyncHandler(async (req: Request, res: Response) => {
  const payload = configBundleArchiveService.readZip(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
  await logAudit({
    tenantId: req.tenant?.tenantId || undefined,
    userId: req.apiClient?.createdById || req.apiClient?.id || req.user!.userId,
    action: 'authz.config_bundle.import_zip',
    resourceType: 'config_bundle',
    resourceId: String((payload.bundle as { metadata?: { key?: string } })?.metadata?.key || 'unknown'),
    details: { fileCount: Object.keys(payload.files).length, actorType: req.apiClient ? 'api_client' : 'user' },
  });
  res.json(payload);
}));
router.post('/api/authz/config-bundles/preview', apiLimiter, requireConfigBundleAccess, validateBody(configBundlePreviewSchema), asyncHandler(async (req: Request, res: Response) => {
  const preview = configBundlePreviewService.preview(req.body);
  res.status(preview.valid ? 200 : 422).json(preview);
}));

/** Check configured secret references without returning their values or mutating state. */
router.post('/api/authz/config-bundles/validate-secret-refs', apiLimiter, requireConfigBundleAccess, validateBody(configBundlePreviewSchema), asyncHandler(async (req: Request, res: Response) => {
  const preflight = configBundleSecretPreflightService.check(req.body);
  await logAudit({
    tenantId: req.tenant?.tenantId || undefined,
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

/** Compare a validated bundle with persisted config-owned role and group state. */
router.post('/api/authz/config-bundles/diff', apiLimiter, requireConfigBundleAccess, validateBody(configBundlePreviewSchema), asyncHandler(async (req: Request, res: Response) => {
  const diff = await configBundleDiffService.diff(req.body, req.tenant?.tenantId || null);
  res.status(diff.valid ? 200 : 422).json(diff);
}));

/** Apply a hash-bound config bundle after a successful persisted-state diff. */
router.post('/api/authz/config-bundles/apply', apiLimiter, requireConfigBundleAccess, validateBody(configBundleApplySchema), asyncHandler(async (req: Request, res: Response) => {
  const actorId = req.apiClient?.createdById || req.apiClient?.id || req.user!.userId;
  const result = await configBundleApplyService.apply({
    ...req.body,
    tenantId: req.tenant?.tenantId || null,
    actorId,
  });
  await logAudit({
    tenantId: req.tenant?.tenantId || undefined,
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
    },
  });
  res.status(200).json(result);
}));

/** Recent hash-bound applies are the operational history for UI and CI diagnostics. */
router.get('/api/authz/config-bundles/runs', apiLimiter, requireConfigBundleAccess, validateQuery(z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) })), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.tenantId || null;
  const rows = await (await getDataSource()).getRepository(ConfigBundleApplyRun).find({
    where: tenantId ? { tenantId } : { tenantId: IsNull() },
    order: { createdAt: 'DESC' },
    take: Number(req.query.limit || 25),
  });
  res.json(rows.map(configBundleRunResponse));
}));

/** One persisted apply receipt for UI and CI failure/reconciliation diagnostics. */
router.get('/api/authz/config-bundles/runs/:id', apiLimiter, requireConfigBundleAccess, validateParams(z.object({ id: z.string().min(1).max(255) })), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.tenantId || null;
  const runId = String(req.params.id);
  const row = await (await getDataSource()).getRepository(ConfigBundleApplyRun).findOne({
    where: tenantId ? { id: runId, tenantId } : { id: runId, tenantId: IsNull() },
  });
  if (!row) throw Errors.notFound('Configuration bundle apply run');
  res.json(configBundleRunResponse(row));
}));

/** Durable continuation state for bounded stored identity snapshot replay. */
router.get('/api/authz/config-bundles/runs/:id/identity-replay-tasks', apiLimiter, requireConfigBundleAccess, validateParams(z.object({ id: z.string().min(1).max(255) })), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.tenantId || null;
  const runId = String(req.params.id);
  const row = await (await getDataSource()).getRepository(ConfigBundleApplyRun).findOne({
    where: tenantId ? { id: runId, tenantId } : { id: runId, tenantId: IsNull() },
  });
  if (!row) throw Errors.notFound('Configuration bundle apply run');
  const tasks = await configBundleIdentityReplayTaskService.listForApplyRun(runId, tenantId);
  res.json(tasks.map((task) => ({
    id: task.id,
    providerId: task.providerId,
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

router.get('/api/authz/config-bundles/export', apiLimiter, requireConfigBundleAccess, validateQuery(z.object({ bundleKey: z.string().min(3).max(160), tenantKey: z.string().min(1).max(160).optional() })), asyncHandler(async (req: Request, res: Response) => {
  res.json(await configBundleExportService.exportBundle({ bundleKey: String(req.query.bundleKey), tenantKey: req.query.tenantKey ? String(req.query.tenantKey) : undefined, tenantId: req.tenant?.tenantId || null }));
}));

// ============================================================================
// API Client Management (Admin Only)
// ============================================================================

router.get('/api/authz/api-clients', apiLimiter, requireAuth, requirePlatformAction('platform.api-clients.read'), asyncHandler(async (_req: Request, res: Response) => {
  try {
    const clients = await apiClientService.listClients();
    res.json(clients);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('List API clients error:', error);
    throw Errors.internal('Failed to list API clients');
  }
}));

router.post('/api/authz/api-clients', apiLimiter, requireAuth, requirePlatformAction('platform.api-clients.manage'), validateBody(apiClientCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await apiClientService.createClient({
      name: req.body.name,
      scopes: req.body.scopes,
      createdById: req.user!.userId,
    });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Create API client error:', error);
    throw Errors.badRequest(error.message || 'Failed to create API client');
  }
}));

router.post('/api/authz/api-clients/:id/rotate', apiLimiter, requireAuth, requirePlatformAction('platform.api-clients.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await apiClientService.rotateClient(String(req.params.id));
    res.json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Rotate API client error:', error);
    throw Errors.badRequest(error.message || 'Failed to rotate API client');
  }
}));

router.delete('/api/authz/api-clients/:id', apiLimiter, requireAuth, requirePlatformAction('platform.api-clients.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await apiClientService.revokeClient(String(req.params.id));
    res.status(204).send();
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Revoke API client error:', error);
    throw Errors.badRequest(error.message || 'Failed to revoke API client');
  }
}));

// ============================================================================
// Service Account Management (Admin Only)
// ============================================================================

router.get('/api/authz/service-accounts', apiLimiter, requireAuth, requirePlatformAction('platform.service-accounts.read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const accounts = await serviceAccountService.listServiceAccounts({
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json(accounts);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('List service accounts error:', error);
    throw Errors.internal('Failed to list service accounts');
  }
}));

router.post('/api/authz/service-accounts', apiLimiter, requireAuth, requirePlatformAction('platform.service-accounts.manage'), validateBody(serviceAccountCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await serviceAccountService.createServiceAccount({
      name: req.body.name,
      description: req.body.description,
      scopes: req.body.scopes,
      createdById: req.user!.userId,
    });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Create service account error:', error);
    throw Errors.badRequest(error.message || 'Failed to create service account');
  }
}));

router.post('/api/authz/service-accounts/:id/rotate', apiLimiter, requireAuth, requirePlatformAction('platform.service-accounts.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await serviceAccountService.rotateServiceAccountToken(String(req.params.id));
    res.json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Rotate service account token error:', error);
    throw Errors.badRequest(error.message || 'Failed to rotate service account token');
  }
}));

router.delete('/api/authz/service-accounts/:id', apiLimiter, requireAuth, requirePlatformAction('platform.service-accounts.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await serviceAccountService.revokeServiceAccount(String(req.params.id));
    res.status(204).send();
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Revoke service account error:', error);
    throw Errors.badRequest(error.message || 'Failed to revoke service account');
  }
}));

// ============================================================================
// External Engine Registration Inventory (Admin Only)
// ============================================================================

router.get('/api/authz/external-engine-systems', apiLimiter, requireAuth, requirePlatformAction('platform.external-engine-systems.read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const dataSource = await getDataSource();
    const tenantId = req.tenant?.tenantId || null;
    const tenantWhere = tenantId === null ? IsNull() : tenantId;
    const systems = await dataSource.getRepository(ExternalEngineSystem).find({
      where: [
        { tenantId: tenantWhere },
        { tenantId: IsNull() },
      ],
      order: { isActive: 'DESC', name: 'ASC' },
    });
    res.json(systems.map(serializeExternalEngineSystem));
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('List external engine systems error:', error);
    throw Errors.internal('Failed to list external engine systems');
  }
}));

router.post('/api/authz/external-engine-systems', apiLimiter, requireAuth, requirePlatformAction('platform.external-engine-systems.manage'), validateBody(externalEngineSystemCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(ExternalEngineSystem);
    const tenantId = req.tenant?.tenantId || null;
    const now = Date.now();
    const key = req.body.key?.trim() || normalizeExternalSystemKey(req.body.name);
    const existing = await repo.findOne({ where: { tenantId: tenantId === null ? IsNull() : tenantId, key } });
    if (existing) {
      throw Errors.conflict('External engine system key already exists');
    }

    const payload = {
      id: generateId(),
      tenantId,
      key,
      name: req.body.name,
      description: req.body.description ?? null,
      defaultManagementMode: req.body.defaultManagementMode || 'external_managed',
      defaultFieldOwnershipJson: fieldOwnershipToJson(req.body.defaultFieldOwnership),
      isActive: true,
      createdById: req.user!.userId,
      createdAt: now,
      updatedAt: now,
    };
    await repo.insert(payload);
    await logAudit({
      tenantId: tenantId || undefined,
      userId: req.user!.userId,
      action: 'external_engine_system.create',
      resourceType: 'external_engine_system',
      resourceId: payload.id,
      details: {
        key,
        defaultManagementMode: payload.defaultManagementMode,
        defaultFieldOwnership: parseFieldOwnership(payload.defaultFieldOwnershipJson),
      },
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
    const repo = dataSource.getRepository(ExternalEngineSystem);
    const tenantId = req.tenant?.tenantId || null;
    const tenantWhere = tenantId === null ? IsNull() : tenantId;
    const system = await repo.findOne({
      where: [
        { id: String(req.params.id), tenantId: tenantWhere },
        { id: String(req.params.id), tenantId: IsNull() },
      ],
    });
    if (!system) throw Errors.notFound('External engine system');

    const updates = {
      name: req.body.name,
      description: req.body.description === undefined ? undefined : req.body.description ?? null,
      defaultManagementMode: req.body.defaultManagementMode,
      defaultFieldOwnershipJson: req.body.defaultFieldOwnership === undefined ? undefined : fieldOwnershipToJson(req.body.defaultFieldOwnership),
      isActive: req.body.isActive,
      updatedAt: Date.now(),
    };
    await repo.update({ id: system.id }, updates);
    await logAudit({
      tenantId: tenantId || undefined,
      userId: req.user!.userId,
      action: 'external_engine_system.update',
      resourceType: 'external_engine_system',
      resourceId: system.id,
      details: {
        changedFields: Object.entries(updates).filter(([, value]) => value !== undefined).map(([key]) => key),
      },
    });
    const updated = await repo.findOneBy({ id: system.id });
    if (!updated) throw Errors.notFound('External engine system');
    res.json(serializeExternalEngineSystem(updated));
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Update external engine system error:', error);
    throw Errors.badRequest(error.message || 'Failed to update external engine system');
  }
}));

router.delete('/api/authz/external-engine-systems/:id', apiLimiter, requireAuth, requirePlatformAction('platform.external-engine-systems.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(ExternalEngineSystem);
    const tenantId = req.tenant?.tenantId || null;
    const tenantWhere = tenantId === null ? IsNull() : tenantId;
    const system = await repo.findOne({
      where: [
        { id: String(req.params.id), tenantId: tenantWhere },
        { id: String(req.params.id), tenantId: IsNull() },
      ],
    });
    if (!system) throw Errors.notFound('External engine system');
    await repo.update({ id: system.id }, { isActive: false, updatedAt: Date.now() });
    await logAudit({
      tenantId: tenantId || undefined,
      userId: req.user!.userId,
      action: 'external_engine_system.archive',
      resourceType: 'external_engine_system',
      resourceId: system.id,
      details: { key: system.key },
    });
    res.status(204).send();
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Archive external engine system error:', error);
    throw Errors.badRequest(error.message || 'Failed to archive external engine system');
  }
}));

router.get('/api/authz/external-engines', apiLimiter, requireAuth, requirePlatformAction('platform.external-engines.read'), asyncHandler(async (_req: Request, res: Response) => {
  try {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    const registrationRepo = dataSource.getRepository(ExternalEngineRegistration);
    const systemRepo = dataSource.getRepository(ExternalEngineSystem);
    const registrations = await registrationRepo.find({
      order: { lastRegisteredAt: 'DESC', updatedAt: 'DESC' },
    });

    if (registrations.length > 0) {
      const systemIds = Array.from(new Set(registrations.map((registration) => registration.externalSystemId).filter((id): id is string => Boolean(id))));
      const systems = systemIds.length > 0 ? await systemRepo.find({ where: { id: In(systemIds) } }) : [];
      const systemsById = new Map(systems.map((system) => [system.id, system]));
      const engines = await engineRepo.find({
        where: { id: In(registrations.map((registration) => registration.engineId)) },
      });
      const enginesById = new Map(engines.map((engine) => [engine.id, engine]));
      res.json(registrations
        .map((registration) => {
          const engine = enginesById.get(registration.engineId);
          if (!engine) return null;
          const capabilities = parseExternalEngineCapabilities(registration.capabilitiesJson || engine.capabilitiesJson);
          const capabilityDiagnostics = getCapabilityDiagnostics(engine.type, capabilities);
          return {
            id: engine.id,
            registrationId: registration.id,
            name: engine.name,
            baseUrl: engine.baseUrl,
            type: engine.type,
            externalId: registration.externalId,
            labels: parseEngineLabels(registration.labelsJson),
            registrationSource: registration.registrationSource,
            apiClientId: registration.apiClientId,
            externalSystemId: registration.externalSystemId,
            externalSystemName: registration.externalSystemId ? systemsById.get(registration.externalSystemId)?.name || null : null,
            managementMode: registration.managementMode || engine.managementMode || (registration.registrationSource === 'external_api' ? 'external_managed' : 'manual'),
            fieldOwnership: parseFieldOwnership(registration.fieldOwnershipJson || engine.fieldOwnershipJson),
            driftStatus: registration.driftStatus || engine.driftStatus,
            lifecycleStatus: registration.lifecycleStatus || engine.lifecycleStatus || 'active',
            lastExternalSyncAt: registration.lastExternalSyncAt || engine.lastExternalSyncAt || registration.lastRegisteredAt || engine.externalUpdatedAt || null,
            capabilities,
            capabilityStatus: registration.capabilityStatus || engine.capabilityStatus || capabilityDiagnostics.status,
            capabilityDiagnostics,
            externalUpdatedAt: registration.lastRegisteredAt,
            createdAt: engine.createdAt,
            updatedAt: engine.updatedAt,
          };
        })
        .filter(Boolean));
      return;
    }

    const engines = await engineRepo.find({
      where: [
        { externalId: Not(IsNull()) },
        { registrationSource: 'external_api' },
      ],
      order: { updatedAt: 'DESC' },
    });
    const systemIds = Array.from(new Set(engines.map((engine) => engine.externalSystemId).filter((id): id is string => Boolean(id))));
    const systems = systemIds.length > 0 ? await systemRepo.find({ where: { id: In(systemIds) } }) : [];
    const systemsById = new Map(systems.map((system) => [system.id, system]));

    res.json(engines.map((engine) => {
      const capabilities = parseExternalEngineCapabilities(engine.capabilitiesJson);
      const capabilityDiagnostics = getCapabilityDiagnostics(engine.type, capabilities);
      return {
        id: engine.id,
        name: engine.name,
        baseUrl: engine.baseUrl,
        type: engine.type,
        externalId: engine.externalId,
        labels: parseEngineLabels(engine.labelsJson),
        registrationSource: engine.registrationSource,
        apiClientId: null,
        externalSystemId: engine.externalSystemId,
        externalSystemName: engine.externalSystemId ? systemsById.get(engine.externalSystemId)?.name || null : null,
        managementMode: engine.managementMode || (engine.registrationSource === 'external_api' ? 'external_managed' : 'manual'),
        fieldOwnership: parseFieldOwnership(engine.fieldOwnershipJson),
        driftStatus: engine.driftStatus,
        lifecycleStatus: engine.lifecycleStatus || 'active',
        lastExternalSyncAt: engine.lastExternalSyncAt || engine.externalUpdatedAt || null,
        capabilities,
        capabilityStatus: engine.capabilityStatus || capabilityDiagnostics.status,
        capabilityDiagnostics,
        externalUpdatedAt: engine.externalUpdatedAt,
        createdAt: engine.createdAt,
        updatedAt: engine.updatedAt,
      };
    }));
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('List external engines error:', error);
    throw Errors.internal('Failed to list external engines');
  }
}));

router.get('/api/authz/external-engines/:id/audit', apiLimiter, requireAuth, requireAction('platform.external-engines.audit.read', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id' }), validateParams(resourceIdParamSchema), validateQuery(externalEngineAuditQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const dataSource = await getDataSource();
    const auditRepo = dataSource.getRepository(AuditLog);
    const action = req.query.action === 'all' ? undefined : req.query.action;
    const entries = await auditRepo.find({
      where: {
        resourceType: 'engine',
        resourceId: String(req.params.id),
        action: typeof action === 'string' ? action : In([...externalEngineAuditActions]),
      },
      order: { createdAt: 'DESC' },
      take: typeof req.query.limit === 'number' ? req.query.limit : 50,
    });

    res.json(entries.map((entry) => ({
      id: entry.id,
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      details: parseJsonObject(entry.details),
      createdAt: entry.createdAt,
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
    const materializationRepo = dataSource.getRepository(EngineSetMaterialization);
    const engine = await engineRepo.findOneBy({ id: String(req.params.id) });
    if (!engine) throw Errors.notFound('Engine');
    if (engine.registrationSource !== 'external_api' && !engine.externalId) {
      throw Errors.validation('Only externally registered engines can be decommissioned');
    }

    const registration = await registrationRepo.findOne({ where: { engineId: engine.id } });
    const now = Date.now();
    const previousLifecycleStatus = registration?.lifecycleStatus || engine.lifecycleStatus || 'active';
    await engineRepo.update({ id: engine.id }, {
      lifecycleStatus: 'decommissioned',
      driftStatus: 'decommissioned',
      updatedAt: now,
    });
    if (registration) {
      await registrationRepo.update({ id: registration.id }, {
        lifecycleStatus: 'decommissioned',
        driftStatus: 'decommissioned',
        updatedAt: now,
      });
    }
    await materializationRepo.delete({ engineId: engine.id });
    await logAudit({
      tenantId: req.tenant?.tenantId || undefined,
      userId: req.user!.userId,
      action: 'engine.external_registration.decommission',
      resourceType: 'engine',
      resourceId: engine.id,
      details: {
        source: 'platform_admin',
        externalId: registration?.externalId || engine.externalId || null,
        externalSystemId: registration?.externalSystemId || engine.externalSystemId || null,
        previousLifecycleStatus,
        lifecycleStatus: 'decommissioned',
        reason: req.body.reason || null,
      },
    });

    res.json({
      decommissioned: true,
      engineId: engine.id,
      externalId: registration?.externalId || engine.externalId || null,
      lifecycleStatus: 'decommissioned',
    });
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
    if (!engine) throw Errors.notFound('Engine');
    if (engine.registrationSource !== 'external_api' && !engine.externalId) {
      throw Errors.validation('Only externally registered engines can be reactivated');
    }

    const registration = await registrationRepo.findOne({ where: { engineId: engine.id } });
    const now = Date.now();
    const previousLifecycleStatus = registration?.lifecycleStatus || engine.lifecycleStatus || 'active';
    const driftStatus = (registration?.driftStatus || engine.driftStatus) === 'decommissioned'
      ? 'in_sync'
      : registration?.driftStatus || engine.driftStatus || 'in_sync';
    await engineRepo.update({ id: engine.id }, {
      lifecycleStatus: 'active',
      driftStatus,
      updatedAt: now,
    });
    if (registration) {
      await registrationRepo.update({ id: registration.id }, {
        lifecycleStatus: 'active',
        driftStatus,
        updatedAt: now,
      });
    }
    const materializationResults = await engineSetService.materializeEngineSetsForEngine(engine.id, req.tenant?.tenantId || engine.tenantId || null);
    const materializationDiagnostics = getMaterializationDiagnostics(materializationResults as Array<Record<string, unknown>>);
    await logAudit({
      tenantId: req.tenant?.tenantId || undefined,
      userId: req.user!.userId,
      action: 'engine.external_registration.reactivate',
      resourceType: 'engine',
      resourceId: engine.id,
      details: {
        source: 'platform_admin',
        externalId: registration?.externalId || engine.externalId || null,
        externalSystemId: registration?.externalSystemId || engine.externalSystemId || null,
        previousLifecycleStatus,
        lifecycleStatus: 'active',
        driftStatus,
        materializationResults,
        materializationDiagnostics,
        reason: req.body.reason || null,
      },
    });

    res.json({
      reactivated: true,
      engineId: engine.id,
      externalId: registration?.externalId || engine.externalId || null,
      lifecycleStatus: 'active',
      driftStatus,
      materializationResults,
      materializationDiagnostics,
    });
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Reactivate external engine error:', error);
    throw Errors.internal('Failed to reactivate external engine');
  }
}));

router.post('/api/authz/external-engines/:id/reconcile', apiLimiter, requireAuth, requireAction('platform.external-engines.reconcile', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id' }), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    const registrationRepo = dataSource.getRepository(ExternalEngineRegistration);
    const engine = await engineRepo.findOneBy({ id: String(req.params.id) });
    if (!engine) throw Errors.notFound('Engine');
    if (engine.registrationSource !== 'external_api' && !engine.externalId) {
      throw Errors.validation('Only externally registered engines can be reconciled');
    }

    const registration = await registrationRepo.findOne({ where: { engineId: engine.id } });
    const capabilities = parseExternalEngineCapabilities(registration?.capabilitiesJson || engine.capabilitiesJson);
    const capabilityDiagnostics = getCapabilityDiagnostics(engine.type, capabilities);
    const capabilityStatus = capabilityDiagnostics.status;
    const now = Date.now();
    await engineRepo.update({ id: engine.id }, {
      capabilityStatus,
      updatedAt: now,
    });
    if (registration) {
      await registrationRepo.update({ id: registration.id }, {
        capabilityStatus,
        updatedAt: now,
      });
    }
    const materializationResults = await engineSetService.materializeEngineSetsForEngine(engine.id, req.tenant?.tenantId || engine.tenantId || null);
    const materializationDiagnostics = getMaterializationDiagnostics(materializationResults as Array<Record<string, unknown>>);
    await logAudit({
      tenantId: req.tenant?.tenantId || undefined,
      userId: req.user!.userId,
      action: 'engine.external_registration.reconcile',
      resourceType: 'engine',
      resourceId: engine.id,
      details: {
        externalId: registration?.externalId || engine.externalId || null,
        externalSystemId: registration?.externalSystemId || engine.externalSystemId || null,
        lifecycleStatus: registration?.lifecycleStatus || engine.lifecycleStatus || 'active',
        capabilityStatus,
        capabilityDiagnostics,
        materializationResults,
        materializationDiagnostics,
      },
    });

    res.json({
      engineId: engine.id,
      externalId: registration?.externalId || engine.externalId || null,
      lifecycleStatus: registration?.lifecycleStatus || engine.lifecycleStatus || 'active',
      capabilityStatus,
      capabilityDiagnostics,
      materializationResults,
      materializationDiagnostics,
    });
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Reconcile external engine error:', error);
    throw Errors.internal('Failed to reconcile external engine');
  }
}));

// ============================================================================
// Engine Sets (Admin Only)
// ============================================================================

router.get('/api/authz/engine-sets', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.read'), validateQuery(z.object({ includeArchived: z.enum(['true', 'false']).optional() })), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineSets = await engineSetService.listEngineSets({
      tenantId: req.tenant?.tenantId || null,
      includeArchived: req.query.includeArchived === 'true',
    });
    res.json(engineSets);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('List Engine Sets error:', error);
    throw Errors.internal('Failed to list Engine Sets');
  }
}));

router.post('/api/authz/engine-sets/preview', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.manage'), validateBody(engineSetPreviewSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await engineSetService.previewSelector(req.body.selector, req.tenant?.tenantId || null);
    res.json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Preview Engine Set selector error:', error);
    throw Errors.badRequest(error.message || 'Failed to preview Engine Set selector');
  }
}));

router.post('/api/authz/engine-sets', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.manage'), validateBody(engineSetCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await engineSetService.createEngineSet({
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
      createdById: req.user!.userId,
    });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Create Engine Set error:', error);
    throw Errors.badRequest(error.message || 'Failed to create Engine Set');
  }
}));

router.get('/api/authz/engine-sets/:id', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.read'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engineSet = await engineSetService.getEngineSet(String(req.params.id), req.tenant?.tenantId || null);
    if (!engineSet) throw Errors.notFound('Engine Set');
    res.json(engineSet);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Get Engine Set error:', error);
    throw Errors.internal('Failed to get Engine Set');
  }
}));

router.put('/api/authz/engine-sets/:id', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.manage'), validateParams(resourceIdParamSchema), validateBody(engineSetUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await engineSetService.updateEngineSet(String(req.params.id), {
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
      updatedById: req.user!.userId,
    });
    res.json({ success: true });
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Update Engine Set error:', error);
    throw Errors.badRequest(error.message || 'Failed to update Engine Set');
  }
}));

router.delete('/api/authz/engine-sets/:id', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await engineSetService.archiveEngineSet(String(req.params.id), req.tenant?.tenantId || null);
    res.status(204).send();
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Archive Engine Set error:', error);
    throw Errors.badRequest(error.message || 'Failed to archive Engine Set');
  }
}));

router.post('/api/authz/engine-sets/:id/materialize', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await engineSetService.materializeEngineSet(String(req.params.id), req.tenant?.tenantId || null);
    res.json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Materialize Engine Set error:', error);
    throw Errors.badRequest(error.message || 'Failed to materialize Engine Set');
  }
}));

// Runtime resource inventory is the authority for resource-aware engine filtering.
router.get('/api/authz/runtime-resources', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.read'), validateQuery(runtimeResourceQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.tenantId || null;
  const dataSource = await getDataSource();
  const resources = await dataSource.getRepository(RuntimeResource).find({
    where: { engineId: String(req.query.engineId), ...(req.query.resourceKind ? { resourceKind: String(req.query.resourceKind) } : {}), ...(req.query.includeInactive === 'true' ? {} : { isActive: true }) },
    order: { resourceKind: 'ASC', resourceKey: 'ASC', id: 'ASC' },
  });
  res.json(resources.filter((resource) => (resource.tenantId || null) === tenantId));
}));

router.get('/api/authz/runtime-resource-sets', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.read'), validateQuery(z.object({ engineId: z.string().min(1).optional(), includeArchived: z.enum(['true', 'false']).optional() })), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.tenantId || null;
  const dataSource = await getDataSource();
  const sets = await dataSource.getRepository(RuntimeResourceSet).find({
    where: { ...(req.query.engineId ? { engineId: String(req.query.engineId) } : {}), ...(req.query.includeArchived === 'true' ? {} : { isArchived: false }) },
    order: { key: 'ASC' },
  });
  res.json(sets.filter((set) => (set.tenantId || null) === tenantId));
}));

router.post('/api/authz/runtime-resource-sets/:id/materialize', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  const result = await runtimeResourceInventoryService.materialize(String(req.params.id), req.tenant?.tenantId || null);
  res.json(result);
}));

router.post('/api/authz/runtime-resources/:id/reconcile', apiLimiter, requireAuth, requirePlatformAction('platform.engine-sets.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  const engineId = String(req.params.id);
  const tenantId = req.tenant?.tenantId || null;
  const result = await runtimeResourceInventoryService.reconcileEngine(engineId, tenantId);
  const deployments = await deploymentDiscoveryService.reconcileEngine(engineId, tenantId);
  res.json({ ...result, deployments });
}));

// ============================================================================
// Project Engine Targets (Admin Only)
// ============================================================================

router.get('/api/authz/project-engine-targets', apiLimiter, requireAuth, requirePlatformAction('platform.project-engine-targets.read'), validateQuery(projectEngineTargetQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const targets = await projectEngineTargetService.listTargets({
      tenantId: req.tenant?.tenantId || null,
      projectId: req.query.projectId as string | undefined,
      engineId: req.query.engineId as string | undefined,
      status: req.query.status as any,
      source: req.query.source as any,
    });
    res.json(targets);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('List project-engine targets error:', error);
    throw Errors.internal('Failed to list project-engine targets');
  }
}));

router.post('/api/authz/project-engine-targets/evaluate', apiLimiter, requireAuth, requirePlatformAction('project.deployment-eligibility.evaluate'), validateBody(deploymentEligibilityEvaluateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await deploymentEligibilityService.evaluate({
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
    });
    res.json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Evaluate deployment eligibility error:', error);
    throw Errors.internal('Failed to evaluate deployment eligibility');
  }
}));

router.post('/api/mission-control/bridge/starbase-edit/evaluate', apiLimiter, requireAuth, requireAction('mission-control.bridge.starbase-edit.evaluate', {
  resourceResolver: 'engine.byId',
  resourceIdFrom: 'body',
  resourceIdKey: 'engineId',
}), validateBody(bridgeDecisionSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await evaluateMissionControlStarbaseBridge(req.body, req.user!.userId, req.tenant?.tenantId || null);
    res.json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Evaluate Mission Control to Starbase bridge error:', error);
    throw Errors.internal('Failed to evaluate Mission Control to Starbase bridge');
  }
}));

router.post('/api/starbase/bridge/mission-control/evaluate', apiLimiter, requireAuth, requireAction('starbase.bridge.mission-control.evaluate', {
  resourceResolver: 'project.byId',
  resourceIdFrom: 'body',
  resourceIdKey: 'projectId',
}), validateBody(bridgeDecisionSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await evaluateStarbaseMissionControlBridge(req.body, req.user!.userId, req.tenant?.tenantId || null);
    res.json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Evaluate Starbase to Mission Control bridge error:', error);
    throw Errors.internal('Failed to evaluate Starbase to Mission Control bridge');
  }
}));

router.post('/api/authz/project-engine-targets/sync-legacy', apiLimiter, requireAuth, requirePlatformAction('platform.project-engine-targets.manage'), validateBody(projectEngineTargetSyncLegacySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await projectEngineTargetService.syncLegacyAccessForProject(req.body.projectId, req.tenant?.tenantId || null);
    res.json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Sync legacy project-engine targets error:', error);
    throw Errors.badRequest(error.message || 'Failed to sync legacy project-engine targets');
  }
}));

router.post('/api/authz/project-engine-targets', apiLimiter, requireAuth, requirePlatformAction('platform.project-engine-targets.manage'), validateBody(projectEngineTargetCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await projectEngineTargetService.createTarget({
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
      createdById: req.user!.userId,
    });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Create project-engine target error:', error);
    throw Errors.badRequest(error.message || 'Failed to create project-engine target');
  }
}));

router.get('/api/authz/project-engine-targets/:id', apiLimiter, requireAuth, requirePlatformAction('platform.project-engine-targets.read'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const target = await projectEngineTargetService.getTarget(String(req.params.id), req.tenant?.tenantId || null);
    if (!target) throw Errors.notFound('Project Engine Target');
    res.json(target);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Get project-engine target error:', error);
    throw Errors.internal('Failed to get project-engine target');
  }
}));

router.put('/api/authz/project-engine-targets/:id', apiLimiter, requireAuth, requirePlatformAction('platform.project-engine-targets.manage'), validateParams(resourceIdParamSchema), validateBody(projectEngineTargetUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await projectEngineTargetService.updateTarget(String(req.params.id), {
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
    });
    res.json({ success: true });
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Update project-engine target error:', error);
    throw Errors.badRequest(error.message || 'Failed to update project-engine target');
  }
}));

router.delete('/api/authz/project-engine-targets/:id', apiLimiter, requireAuth, requirePlatformAction('platform.project-engine-targets.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await projectEngineTargetService.archiveTarget(String(req.params.id), req.tenant?.tenantId || null);
    res.status(204).send();
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Archive project-engine target error:', error);
    throw Errors.badRequest(error.message || 'Failed to archive project-engine target');
  }
}));

// ============================================================================
// Policy Management (Admin Only)
// ============================================================================

/**
 * GET /api/platform-admin/authz/policies
 * List all authorization policies.
 */
router.get('/api/authz/policies', apiLimiter, requireAuth, requirePlatformAction('platform.authz.policies.read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const policies = await policyService.getAllPolicies(req.tenant?.tenantId || null);
    res.json(policies);
  } catch (error: any) {
    logger.error('Get policies error:', error);
    throw Errors.internal('Failed to get policies');
  }
}));

/**
 * POST /api/platform-admin/authz/policies
 * Create a new authorization policy.
 */
router.post('/api/authz/policies', apiLimiter, requireAuth, requirePlatformAction('platform.authz.policies.manage'), validateBody(policyCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { name, description, effect, priority, resourceType, action, conditions } = req.body;

    const result = await policyService.createPolicy({
      name,
      description,
      effect,
      priority,
      resourceType,
      action,
      conditions,
      tenantId: req.tenant?.tenantId || null,
      createdById: req.user!.userId,
    });

    res.status(201).json(result);
  } catch (error: any) {
    logger.error('Create policy error:', error);
    throw Errors.internal('Failed to create policy');
  }
}));

/**
 * PUT /api/platform-admin/authz/policies/:id
 * Update an authorization policy.
 */
router.put('/api/authz/policies/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.policies.manage'), validateParams(idParamSchema), validateBody(policyUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const policyId = String(req.params.id);
    await policyService.updatePolicy(policyId, {
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
      updatedById: req.user!.userId,
    });
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Update policy error:', error);
    throw Errors.internal('Failed to update policy');
  }
}));

/**
 * DELETE /api/platform-admin/authz/policies/:id
 * Delete an authorization policy.
 */
router.delete('/api/authz/policies/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.policies.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const policyId = String(req.params.id);
    await policyService.deletePolicy(policyId, req.user!.userId);
    res.status(204).send();
  } catch (error: any) {
    logger.error('Delete policy error:', error);
    throw Errors.internal('Failed to delete policy');
  }
}));

// ============================================================================
// SSO Claims Mapping Management (Admin Only)
// ============================================================================

/**
 * GET /api/platform-admin/authz/sso-mappings
 * List all SSO claims mappings.
 */
router.get('/api/authz/sso-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.platform-role-mappings.read'), asyncHandler(async (_req: Request, res: Response) => {
  try {
    const mappings = await ssoClaimsMappingService.getAllMappings();
    res.json(mappings);
  } catch (error: any) {
    logger.error('Get SSO mappings error:', error);
    throw Errors.internal('Failed to get SSO mappings');
  }
}));

/**
 * POST /api/platform-admin/authz/sso-mappings
 * Create a new SSO claims mapping.
 */
router.post('/api/authz/sso-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.platform-role-mappings.manage'), validateBody(ssoMappingCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { providerId, claimType, claimKey, claimValue, claimOperator, targetRole, priority, isActive, riskAcknowledged } = req.body;

    const result = await ssoClaimsMappingService.createMapping({
      providerId,
      claimType,
      claimKey,
      claimValue,
      claimOperator,
      targetRole,
      priority,
      isActive,
      riskAcknowledged,
    });

    res.status(201).json(result);
  } catch (error: any) {
    logger.error('Create SSO mapping error:', error);
    throw Errors.internal('Failed to create SSO mapping');
  }
}));
router.post('/api/authz/sso-mappings/:id/migrate-provider-neutral', apiLimiter, requireAuth, requirePlatformAction('platform.sso.platform-role-mappings.manage'), validateParams(idParamSchema), validateBody(ssoPlatformMappingProviderNeutralMigrationSchema), asyncHandler(async (req: Request, res: Response) => {
  const result = await ssoClaimsMappingService.migrateToProviderNeutral(String(req.params.id), { ...req.body, createdById: req.user!.userId });
  await logAudit({ action: 'authz.sso_platform_mapping.provider_neutral_migration', userId: req.user!.userId, resourceType: 'sso_mapping', resourceId: result.legacyMappingId, details: { providerKey: req.body.providerKey, identityMappingId: result.mapping.id, assignmentId: result.assignment.id, created: result.created } });
  res.status(result.created ? 201 : 200).json(result);
}));

/**
 * PUT /api/platform-admin/authz/sso-mappings/:id
 * Update an SSO claims mapping.
 */
router.put('/api/authz/sso-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.platform-role-mappings.manage'), validateParams(idParamSchema), validateBody(ssoMappingUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const mappingId = String(req.params.id);
    await ssoClaimsMappingService.updateMapping(mappingId, req.body);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Update SSO mapping error:', error);
    throw Errors.internal('Failed to update SSO mapping');
  }
}));

/**
 * DELETE /api/platform-admin/authz/sso-mappings/:id
 * Delete an SSO claims mapping.
 */
router.delete('/api/authz/sso-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.platform-role-mappings.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const mappingId = String(req.params.id);
    await ssoClaimsMappingService.deleteMapping(mappingId);
    res.status(204).send();
  } catch (error: any) {
    logger.error('Delete SSO mapping error:', error);
    throw Errors.internal('Failed to delete SSO mapping');
  }
}));

/**
 * POST /api/platform-admin/authz/sso-mappings/test
 * Test SSO claims against mappings (admin preview).
 */
router.post('/api/authz/sso-mappings/test', apiLimiter, requireAuth, requirePlatformAction('platform.sso.platform-role-mappings.manage'), validateBody(ssoMappingTestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { claims, providerId } = req.body;

    const result = await ssoClaimsMappingService.testClaims(claims, providerId);
    res.json(result);
  } catch (error: any) {
    logger.error('Test SSO mapping error:', error);
    throw Errors.internal('Failed to test SSO mapping');
  }
}));

// ============================================================================
// SSO Engine Assignment Mapping Management (Admin Only)
// ============================================================================

router.get('/api/authz/sso-assignment-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const mappings = await ssoAssignmentMappingService.getAllMappings(req.tenant?.tenantId || null);
    res.json(mappings);
  } catch (error: any) {
    logger.error('Get SSO assignment mappings error:', error);
    throw Errors.internal('Failed to get SSO assignment mappings');
  }
}));

router.get('/api/authz/legacy-mapping-coverage', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.read'), asyncHandler(async (req: Request, res: Response) => {
  res.json(await legacyMappingCoverageService.getCoverage(req.tenant?.tenantId || null));
}));

router.get('/api/authz/legacy-mapping-retirement-readiness', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.read'), asyncHandler(async (req: Request, res: Response) => {
  res.json(await legacyMappingCoverageService.getRetirementReadiness(req.tenant?.tenantId || null));
}));

router.post('/api/authz/legacy-mapping-coverage/:id/verify', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateParams(idParamSchema), validateBody(legacyMappingCoverageVerificationSchema), asyncHandler(async (req: Request, res: Response) => {
  await legacyMappingCoverageService.verifyReplacement({ tenantId: req.tenant?.tenantId || null, legacyMappingId: String(req.params.id), actorId: req.user!.userId, ...req.body });
  res.status(204).send();
}));

router.post('/api/authz/legacy-mapping-retirement/disable', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateBody(legacyMappingRetirementSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json(await legacyMappingCoverageService.retireLegacyMappings(req.tenant?.tenantId || null, req.user!.userId));
}));

router.post('/api/authz/sso-assignment-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateBody(ssoAssignmentMappingCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await ssoAssignmentMappingService.createMapping({
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
      actorUserId: req.user!.userId,
    });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Create SSO assignment mapping error:', error);
    throw Errors.badRequest(error.message || 'Failed to create SSO assignment mapping');
  }
}));

router.post('/api/authz/sso-assignment-mappings/:id/migrate-provider-neutral', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(idParamSchema), validateBody(ssoAssignmentMappingProviderNeutralMigrationSchema), asyncHandler(async (req: Request, res: Response) => {
  const result = await ssoAssignmentMappingService.migrateToProviderNeutral(String(req.params.id), { ...req.body, createdById: req.user!.userId });
  await logAudit({ action: 'authz.sso_engine_assignment_mapping.provider_neutral_migration', userId: req.user!.userId, resourceType: 'sso_assignment_mapping', resourceId: result.legacyMappingId, details: { providerKey: result.providerKey, identityMappingId: result.identityMapping.id, assignmentId: result.assignment.id, created: result.created } });
  res.status(result.created ? 201 : 200).json(result);
}));

router.put('/api/authz/sso-assignment-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(idParamSchema), validateBody(ssoAssignmentMappingUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await ssoAssignmentMappingService.updateMapping(String(req.params.id), {
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
      actorUserId: req.user!.userId,
    });
    res.json({ success: true });
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Update SSO assignment mapping error:', error);
    throw Errors.badRequest(error.message || 'Failed to update SSO assignment mapping');
  }
}));

router.delete('/api/authz/sso-assignment-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await ssoAssignmentMappingService.deleteMapping(String(req.params.id), req.user!.userId);
    res.status(204).send();
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Delete SSO assignment mapping error:', error);
    throw Errors.internal('Failed to delete SSO assignment mapping');
  }
}));

router.post('/api/authz/sso-assignment-mappings/test', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateBody(ssoAssignmentMappingTestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { claims, providerId } = req.body;
    const result = await ssoAssignmentMappingService.testClaims(claims, providerId, req.tenant?.tenantId || null);
    res.json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Test SSO assignment mapping error:', error);
    throw Errors.internal('Failed to test SSO assignment mapping');
  }
}));

router.get('/api/authz/sso-engine-access-snapshots', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.read'), validateQuery(ssoEngineAccessSnapshotQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const snapshots = await ssoEngineAccessSnapshotService.listSnapshots({
      tenantId: req.tenant?.tenantId || null,
      providerId: req.query.providerId as string | undefined,
      mappingId: req.query.mappingId as string | undefined,
      principalType: req.query.principalType as string | undefined,
      principalId: req.query.principalId as string | undefined,
      engineId: req.query.engineId as string | undefined,
      status: req.query.status as any,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(snapshots);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('List SSO engine access snapshots error:', error);
    throw Errors.internal('Failed to list SSO engine access snapshots');
  }
}));

router.get('/api/authz/sso-engine-access-snapshots/:engineId', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.read'), validateParams(engineIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const snapshots = await ssoEngineAccessSnapshotService.listSnapshotsForEngine(String(req.params.engineId), req.tenant?.tenantId || null);
    res.json(snapshots);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('List engine SSO access snapshots error:', error);
    throw Errors.internal('Failed to list engine SSO access snapshots');
  }
}));

router.post('/api/engines/:engineId/access/transition-cleanup-preview', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(engineIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const preview = await ssoEngineAccessSnapshotService.previewTransitionCleanup(String(req.params.engineId), req.tenant?.tenantId || null);
    res.json(preview);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Preview engine access transition cleanup error:', error);
    throw Errors.badRequest(error.message || 'Failed to preview engine access transition cleanup');
  }
}));

router.post('/api/engines/:engineId/access/transition-cleanup', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateParams(engineIdParamSchema), validateBody(transitionCleanupApplySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await ssoEngineAccessSnapshotService.applyTransitionCleanup(
      String(req.params.engineId),
      req.body.assignmentIds,
      req.user!.userId,
      req.tenant?.tenantId || null,
      req.body.previewCorrelationId
    );
    res.json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Apply engine access transition cleanup error:', error);
    throw Errors.badRequest(error.message || 'Failed to apply engine access transition cleanup');
  }
}));

// ============================================================================
// SSO Group Mapping Management (Admin Only)
// ============================================================================

router.get('/api/authz/sso-group-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const mappings = await ssoGroupMappingService.getAllMappings(req.tenant?.tenantId || null);
    res.json(mappings);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Get SSO group mappings error:', error);
    throw Errors.internal('Failed to get SSO group mappings');
  }
}));

router.post('/api/authz/sso-group-mappings', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateBody(ssoGroupMappingCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await ssoGroupMappingService.createMapping({
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
    });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Create SSO group mapping error:', error);
    throw Errors.badRequest(error.message || 'Failed to create SSO group mapping');
  }
}));

router.post('/api/authz/sso-group-mappings/:id/migrate-provider-neutral', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateParams(idParamSchema), validateBody(ssoGroupMappingProviderNeutralMigrationSchema), asyncHandler(async (req: Request, res: Response) => {
  const result = await ssoGroupMappingService.migrateToProviderNeutral(String(req.params.id), req.body.providerKey, req.tenant?.tenantId || null);
  await logAudit({
    action: 'authz.sso_group_mapping.provider_neutral_migration',
    userId: req.user!.userId,
    resourceType: 'sso_group_mapping',
    resourceId: result.legacyMappingId,
    details: { providerKey: result.providerKey, identityMappingId: result.identityMapping.id, created: result.created },
  });
  res.status(result.created ? 201 : 200).json(result);
}));

router.put('/api/authz/sso-group-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateParams(idParamSchema), validateBody(ssoGroupMappingUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await ssoGroupMappingService.updateMapping(String(req.params.id), {
      ...req.body,
      tenantId: req.tenant?.tenantId || null,
    });
    res.json({ success: true });
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Update SSO group mapping error:', error);
    throw Errors.badRequest(error.message || 'Failed to update SSO group mapping');
  }
}));

router.delete('/api/authz/sso-group-mappings/:id', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await ssoGroupMappingService.deleteMapping(String(req.params.id));
    res.status(204).send();
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Delete SSO group mapping error:', error);
    throw Errors.internal('Failed to delete SSO group mapping');
  }
}));

router.post('/api/authz/sso-group-mappings/test', apiLimiter, requireAuth, requirePlatformAction('platform.sso.group-mappings.manage'), validateBody(ssoGroupMappingTestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { claims, providerId } = req.body;
    const result = await ssoGroupMappingService.testClaims(claims, providerId, req.tenant?.tenantId || null);
    res.json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Test SSO group mapping error:', error);
    throw Errors.internal('Failed to test SSO group mapping');
  }
}));

// ============================================================================
// SSO Sync Diagnostics (Admin Only)
// ============================================================================

router.get('/api/authz/sso-sync-runs', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.read'), validateQuery(ssoSyncRunsQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const runs = await ssoSyncDiagnosticsService.listRuns({
      tenantId: req.tenant?.tenantId || null,
      providerId: typeof req.query.providerId === 'string' ? req.query.providerId : undefined,
      userId: typeof req.query.userId === 'string' ? req.query.userId : undefined,
      status: typeof req.query.status === 'string' ? req.query.status as any : undefined,
      trigger: typeof req.query.trigger === 'string' ? req.query.trigger as any : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(runs);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Get SSO sync runs error:', error);
    throw Errors.internal('Failed to get SSO sync runs');
  }
}));

router.post('/api/authz/sso-sync-runs/reconcile', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.manage'), validateBody(ssoSyncDiagnosticsRunSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const baseInput = {
      tenantId: req.tenant?.tenantId || null,
      providerId: req.body.providerId || null,
      trigger: req.body.trigger || 'manual',
      details: {
        actorUserId: req.user!.userId,
        source: 'admin_access_control',
      },
    };
    const result: any = await ssoSyncDiagnosticsService.runReconciliationDiagnostics(baseInput);
    if (req.body.includeProviderChecks) {
      result.providerIdentityCheck = await ssoSyncDiagnosticsService.runProviderIdentityCheck(baseInput);
    }
    if (req.body.includeSnapshotReplay) {
      result.snapshotReconciliation = await ssoSyncDiagnosticsService.runSnapshotReconciliation({
        ...baseInput,
        refreshProviderClaims: req.body.refreshProviderClaims === true,
      });
    }
    if (req.body.includeCleanup) {
      result.cleanup = await ssoSyncDiagnosticsService.runReconciliationCleanup(baseInput);
    }
    res.json(result);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Run SSO sync diagnostics error:', error);
    throw Errors.internal('Failed to run SSO sync diagnostics');
  }
}));

router.get('/api/authz/sso-sync-runs/:id/events', apiLimiter, requireAuth, requirePlatformAction('platform.sso.engine-assignments.read'), validateParams(idParamSchema), validateQuery(ssoSyncEventsQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const events = await ssoSyncDiagnosticsService.listEvents({
      tenantId: req.tenant?.tenantId || null,
      providerId: typeof req.query.providerId === 'string' ? req.query.providerId : undefined,
      runId: String(req.params.id),
      severity: typeof req.query.severity === 'string' ? req.query.severity as any : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(events);
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error('Get SSO sync events error:', error);
    throw Errors.internal('Failed to get SSO sync events');
  }
}));

// ============================================================================
// Audit Log (Admin Only)
// ============================================================================

/**
 * GET /api/platform-admin/authz/audit
 * Query authorization audit log.
 */
router.get('/api/authz/audit', apiLimiter, requireAuth, requirePlatformAction('platform.audit.read'), validateQuery(authzAuditQuerySchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    const resourceType = typeof req.query.resourceType === 'string' ? req.query.resourceType : undefined;
    const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
    const decision = req.query.decision === 'allow' || req.query.decision === 'deny'
      ? req.query.decision
      : undefined;
    const limit = typeof req.query.limit === 'number' ? req.query.limit : undefined;
    const offset = typeof req.query.offset === 'number' ? req.query.offset : undefined;

    const entries = await policyService.getAuditLog({
      tenantId: req.tenant?.tenantId || null,
      userId,
      resourceType,
      resourceId,
      decision,
      limit,
      offset,
    });

    res.json(entries);
  } catch (error: any) {
    logger.error('Get audit log error:', error);
    throw Errors.internal('Failed to get audit log');
  }
}));

export default router;
