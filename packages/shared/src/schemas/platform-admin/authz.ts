import { z } from 'zod';
import {
  AUTHZ_ACTION_RISKS,
  AUTHZ_OPENAPI_EXTENSION_KEY,
  AUTHZ_PRINCIPAL_TYPES,
  AUTHZ_RESOURCE_TYPES,
  AUTHZ_UI_BEHAVIORS,
} from '../../authz/permission-actions.js';
import {
  AUTHZ_OPENAPI_EXEMPTION_KEY,
  AUTHZ_ROUTE_EXEMPTION_KINDS,
} from '../../authz/route-exemptions.js';
import { EngineConnectionModeSchema } from '../mission-control/engine.js';
import { RuntimeResourceKindSchema } from './config-bundle.js';
import {
  IdentityProviderAuthenticationModeSchema,
  IdentityProviderProtocolSchema as SharedIdentityProviderProtocolSchema,
  IdentityProviderSyncConfigurationSchema,
  IdentitySyncEventSchema,
  IdentitySyncRunSchema,
  LdapIdentityProviderConfigurationSchema,
  OidcIdentityProviderConfigurationSchema,
  SamlIdentityProviderConfigurationSchema,
} from './identity.js';

export { IdentityProviderProtocolSchema } from './identity.js';

export const AuthzResourceTypeSchema = z.enum(AUTHZ_RESOURCE_TYPES);
export const AuthzPrincipalTypeSchema = z.enum(AUTHZ_PRINCIPAL_TYPES);
export const AuthzActionRiskSchema = z.enum(AUTHZ_ACTION_RISKS);
export const AuthzUiBehaviorSchema = z.enum(AUTHZ_UI_BEHAVIORS);

// Bigint timestamps are hydrated as strings by PostgreSQL and as numbers by
// several other supported adapters. Normalize response contracts here so the
// same OpenAPI shape is returned for every database.
const PersistedTimestampSchema = z.union([
  z.number(),
  z.string().regex(/^\d+$/).transform(Number),
]);

export const AuthzOpenApiExtensionSchema = z.object({
  actionId: z.string().min(1),
  permission: z.string().min(1),
  resourceResolver: z.string().min(1),
  additionalChecks: z.array(z.string().min(1)).optional(),
  risk: AuthzActionRiskSchema,
  audit: z.boolean(),
  uiBehavior: AuthzUiBehaviorSchema,
});

export const AuthzOpenApiExemptionSchema = z.object({
  kind: z.enum(AUTHZ_ROUTE_EXEMPTION_KINDS),
  reason: z.string().min(1),
  risk: AuthzActionRiskSchema,
  owner: z.string().min(1),
});

export const EnterpriseGlueAuthzOpenApiExtensionSchema = z.object({
  [AUTHZ_OPENAPI_EXTENSION_KEY]: AuthzOpenApiExtensionSchema.optional(),
  [AUTHZ_OPENAPI_EXEMPTION_KEY]: AuthzOpenApiExemptionSchema.optional(),
}).refine((value) =>
  Boolean(value[AUTHZ_OPENAPI_EXTENSION_KEY]) !== Boolean(value[AUTHZ_OPENAPI_EXEMPTION_KEY]),
  { message: 'OpenAPI operation must declare exactly one EnterpriseGlue authz extension or exemption' }
);

function normalizeRoleValue(role?: string | null): 'admin' | 'user' {
  return role === 'admin' ? 'admin' : 'user';
}

export const PolicyConditionSchema = z.object({
  timeWindow: z.object({
    start: z.string().optional(),
    end: z.string().optional(),
    timezone: z.string().optional(),
    daysOfWeek: z.array(z.number().int()).optional(),
  }).optional(),
  userAttribute: z.object({
    key: z.string().min(1),
    operator: z.enum(['eq', 'neq', 'in', 'notIn', 'contains']),
    value: z.union([z.string(), z.array(z.string())]),
  }).optional(),
  resourceAttribute: z.object({
    key: z.string().min(1),
    operator: z.enum(['eq', 'neq', 'in', 'notIn']),
    value: z.union([z.string(), z.array(z.string()), z.boolean()]),
  }).optional(),
  environment: z.object({
    ipRange: z.array(z.string()).optional(),
    requireMfa: z.boolean().optional(),
  }).optional(),
});

function parsePolicyConditions(value: string | null): z.infer<typeof PolicyConditionSchema> {
  if (!value) return {};
  try {
    return PolicyConditionSchema.parse(JSON.parse(value));
  } catch {
    return {};
  }
}

// Raw schema - matches TypeORM AuthzPolicy entity
export const AuthzPolicySchemaRaw = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable(),
  effect: z.string(),
  priority: z.number(),
  resourceType: z.string().nullable(),
  action: z.string().nullable(),
  conditions: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  createdById: z.string().nullable(),
});

// Authorization Policy - Select schema (API response)
export const AuthzPolicySchema = AuthzPolicySchemaRaw.transform((p) => ({
  id: p.id,
  tenantId: p.tenantId ?? undefined,
  name: p.name,
  description: p.description ?? undefined,
  effect: p.effect as 'allow' | 'deny',
  priority: p.priority,
  resourceType: p.resourceType ?? undefined,
  action: p.action ?? undefined,
  conditions: parsePolicyConditions(p.conditions),
  isActive: p.isActive,
  createdAt: Number(p.createdAt),
  updatedAt: Number(p.updatedAt),
  createdById: p.createdById ?? undefined,
}));

/** Safe policy service view returned by the authorization API. */
export const AuthzPolicyResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable(),
  name: z.string(),
  description: z.string().optional(),
  effect: z.enum(['allow', 'deny']),
  priority: z.number().int(),
  resourceType: z.string().optional(),
  action: z.string().optional(),
  conditions: z.record(z.string(), z.unknown()),
  isActive: z.boolean(),
}).strict();

/** Public policy write contract; persistence-only tenant and actor fields are route-owned. */
export const AuthzPolicyCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  effect: z.enum(['allow', 'deny']),
  resourceType: z.string().optional(),
  action: z.string().optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().min(0).optional(),
});
export const AuthzPolicyUpdateSchema = AuthzPolicyCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/** Caller-supplied context is diagnostic input only; authorization still resolves server-side identity and tenancy. */
export const AuthzCheckRequestSchema = z.object({
  action: z.string().min(1),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  userAttributes: z.record(z.string(), z.unknown()).optional(),
  resourceAttributes: z.record(z.string(), z.unknown()).optional(),
});

export const AuthzCheckResponseSchema = z.object({
  allowed: z.boolean(),
  decision: z.enum(['allow', 'deny']),
  reason: z.string(),
  policyId: z.string().optional(),
  policyName: z.string().optional(),
});

export const AuthzCheckBatchRequestSchema = z.object({
  checks: z.array(AuthzCheckRequestSchema).min(1),
});

export const AuthzCheckBatchResponseSchema = z.object({
  results: z.array(z.object({
    action: z.string(),
    resourceType: z.string().optional(),
    resourceId: z.string().optional(),
    allowed: z.boolean(),
    reason: z.string(),
  })),
});

// Authorization Policy - Insert schema
export const AuthzPolicyInsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  effect: z.enum(['allow', 'deny']).optional(),
  priority: z.number().int().optional(),
  conditions: z.string().optional(),
});

// Raw schema - matches TypeORM AuthzAuditLog entity
export const AuthzAuditLogSchemaRaw = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  userId: z.string(),
  action: z.string(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  decision: z.string(),
  reason: z.string().nullable(),
  policyId: z.string().nullable(),
  context: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  timestamp: z.number(),
});

// Authorization Audit Log - Select schema (API response)
export const AuthzAuditLogSchema = AuthzAuditLogSchemaRaw.transform((l) => ({
  id: l.id,
  tenantId: l.tenantId,
  userId: l.userId,
  action: l.action,
  resourceType: l.resourceType,
  resourceId: l.resourceId,
  decision: l.decision as 'allow' | 'deny',
  reason: l.reason || '',
  policyId: l.policyId,
  context: l.context || '',
  ipAddress: l.ipAddress,
  userAgent: l.userAgent,
  timestamp: Number(l.timestamp),
}));

/** Query contract for the tenant-scoped authorization audit API. */
export const AuthzAuditQuerySchema = z.object({
  userId: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  decision: z.enum(['allow', 'deny']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** Safe service view returned by the tenant-scoped authorization audit API. */
export const AuthzAuditLogResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable(),
  userId: z.string(),
  action: z.string(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  decision: z.enum(['allow', 'deny']),
  reason: z.string(),
  policyId: z.string().nullable(),
  context: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  timestamp: z.number(),
}).strict();

/** Public SAML readiness indicators; this contract never exposes provider secrets or configuration. */
export const SamlAuthenticationStatusSchema = z.object({
  enabled: z.boolean(),
  message: z.string(),
  providerConfigured: z.boolean(),
  providerEnabled: z.boolean(),
  missingFields: z.array(z.enum(['entityId', 'ssoUrl', 'certificate'])),
}).strict();

export const PermissionCatalogEntrySchema = z.object({
  key: z.string(),
  scope: AuthzResourceTypeSchema,
  category: z.string(),
  label: z.string(),
  description: z.string(),
  tenantSafe: z.boolean().optional(),
  kind: z.enum(['system', 'custom']).optional(),
  isEditable: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  createdById: z.string().nullable().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

export const CustomPermissionCreateSchema = z.object({
  key: z.string().min(1).max(255),
  scope: AuthzResourceTypeSchema,
  category: z.string().min(1).max(128),
  label: z.string().min(1).max(128),
  description: z.string().max(2000).nullable().optional(),
});

export const EffectiveResourcePermissionsSchema = z.object({
  resourceId: z.string(),
  permissions: z.array(z.string()),
});

export const EffectiveEngineResourcePermissionsSchema = EffectiveResourcePermissionsSchema.extend({
  // A coarse, key-free signal used only to admit a principal into a runtime
  // UI. Runtime collections remain authoritatively filtered server-side.
  runtimePermissions: z.array(z.string()).default([]),
});

export const CurrentUserPermissionsSchema = z.object({
  userId: z.string(),
  tenantId: z.string().nullable(),
  platform: z.array(z.string()),
  projects: z.array(EffectiveResourcePermissionsSchema),
  engines: z.array(EffectiveEngineResourcePermissionsSchema),
  authorizationVersion: z.string(),
  generatedAt: z.number(),
});

export const RoleSummarySchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  scope: AuthzResourceTypeSchema,
  kind: z.enum(['system', 'custom']),
  isEditable: z.boolean(),
  isAssignable: z.boolean(),
  isArchived: z.boolean(),
  source: z.string(),
  sourceRef: z.string().nullable(),
  ownershipMode: z.enum(['manual', 'config_locked', 'config_warn']),
  sourceHash: z.string().nullable(),
  lastAppliedAt: z.number().nullable(),
  driftStatus: z.string().nullable(),
  permissionCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const RoleDetailSchema = RoleSummarySchema.extend({
  permissions: z.array(z.string()),
});

export const RoleAssignmentSourceSchema = z.enum(['legacy', 'manual', 'sso', 'api', 'system', 'automation', 'bootstrap', 'config']);
export const AuthzOwnershipModeSchema = z.enum(['manual', 'config_locked', 'config_warn']);

const customRoleDenyFieldNames = [
  'denyPermissionIds',
  'deniedPermissionIds',
  'denyPermissions',
  'deniedPermissions',
  'permissionDenies',
] as const;

const customRoleAllowOnlyMessage = 'Custom roles are allow-only; use authorization policies for deny rules';

const CustomRoleAllowOnlyGuard = z.object({}).passthrough().superRefine((input, ctx) => {
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

export const CustomRoleCreateSchema = CustomRoleAllowOnlyGuard.pipe(z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  scope: AuthzResourceTypeSchema,
  permissionIds: z.array(z.string().min(1)).min(1),
}));

export const CustomRoleUpdateSchema = CustomRoleAllowOnlyGuard.pipe(z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  permissionIds: z.array(z.string().min(1)).min(1).optional(),
  isAssignable: z.boolean().optional(),
  isArchived: z.boolean().optional(),
}));

export const RoleAssignmentSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  userId: z.string(),
  principalType: AuthzPrincipalTypeSchema,
  principalId: z.string(),
  roleId: z.string(),
  roleKey: z.string().nullable(),
  roleName: z.string().nullable(),
  roleScope: AuthzResourceTypeSchema.nullable(),
  resourceType: AuthzResourceTypeSchema.nullable(),
  resourceId: z.string().nullable(),
  scopeType: AuthzResourceTypeSchema.nullable(),
  scopeId: z.string().nullable(),
  source: RoleAssignmentSourceSchema,
  sourceRef: z.string().nullable(),
  ownershipMode: AuthzOwnershipModeSchema,
  sourceHash: z.string().nullable(),
  lastAppliedAt: z.number().nullable(),
  driftStatus: z.string().nullable(),
  expiresAt: z.number().nullable(),
  lastSeenAt: z.number().nullable(),
  createdById: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const RoleAssignmentCreateSchema = z.object({
  principalType: AuthzPrincipalTypeSchema,
  principalId: z.string().min(1),
  roleId: z.string().min(1),
  resourceType: AuthzResourceTypeSchema.optional(),
  resourceId: z.string().nullable().optional(),
  scopeType: AuthzResourceTypeSchema.optional(),
  scopeId: z.string().nullable().optional(),
  expiresAt: z.number().nullable().optional(),
});

/** Standard response for authorization creates that expose only a stable identifier. */
export const AuthzCreatedIdResponseSchema = z.object({ id: z.string() });
/** Standard response for authorization mutations that do not return the updated record. */
export const AuthzMutationSuccessResponseSchema = z.object({ success: z.literal(true) });
export const CustomPermissionCreateResponseSchema = AuthzCreatedIdResponseSchema.extend({ key: z.string() });
export const RoleAssignmentCreateResponseSchema = AuthzCreatedIdResponseSchema.extend({ warnings: z.array(z.string()) });
export const ProjectEngineTargetSyncLegacyRequestSchema = z.object({ projectId: z.string().min(1) });
export const ProjectEngineTargetSyncLegacyResponseSchema = z.object({ createdOrUpdated: z.number().int().nonnegative() });

export const AuthzGroupSourceSchema = z.enum(['manual', 'sso', 'identity_provider', 'api', 'automation', 'system', 'config']);

export const AuthzGroupSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  source: AuthzGroupSourceSchema,
  sourceRef: z.string().nullable(),
  ownershipMode: AuthzOwnershipModeSchema,
  sourceHash: z.string().nullable(),
  lastAppliedAt: z.number().nullable(),
  driftStatus: z.string().nullable(),
  isSystem: z.boolean(),
  isArchived: z.boolean(),
  createdById: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const AuthzGroupCreateSchema = z.object({
  key: z.string().min(1).max(255).optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
});

export const AuthzGroupUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  isArchived: z.boolean().optional(),
});

export const AuthzGroupMembershipSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  groupId: z.string(),
  groupKey: z.string().nullable(),
  groupName: z.string().nullable(),
  userId: z.string(),
  source: AuthzGroupSourceSchema,
  sourceRef: z.string().nullable(),
  expiresAt: z.number().nullable(),
  createdById: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const AuthzGroupMembershipCreateSchema = z.object({
  groupId: z.string().min(1),
  userId: z.string().uuid(),
  expiresAt: z.number().nullable().optional(),
});

export const ApiClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  tokenPrefix: z.string(),
  scopes: z.array(z.string()),
  isActive: z.boolean(),
  createdById: z.string().nullable(),
  lastUsedAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const ApiClientCreateSchema = z.object({
  name: z.string().min(1).max(255),
  scopes: z.array(z.enum(['config:bundle:manage', 'engine:register', 'deployment:execute'])).min(1).optional(),
});

export const ApiClientWithTokenSchema = z.object({
  client: ApiClientSchema,
  token: z.string(),
});

export const ServiceAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  tokenPrefix: z.string().nullable(),
  scopes: z.array(z.string()),
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdById: z.string().nullable(),
  lastUsedAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const ServiceAccountCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  scopes: z.array(z.enum(['deployment:execute'])).min(1).optional(),
});

export const ServiceAccountWithTokenSchema = z.object({
  account: ServiceAccountSchema,
  token: z.string(),
});

export const EngineManagementModeSchema = z.enum(['manual', 'external_managed', 'hybrid']);
export const EngineLifecycleStatusSchema = z.enum(['active', 'disabled', 'stale', 'decommissioned']);
export const EngineCapabilityStatusSchema = z.enum(['unknown', 'in_sync', 'mismatch']);
export const EngineFieldOwnerSchema = z.enum(['manual', 'external']);
export const EngineFieldOwnershipSchema = z.record(z.string().min(1), EngineFieldOwnerSchema);
export const EngineRuntimeQueryCapabilitiesSchema = z.object({
  processDefinitionKey: z.boolean().optional(),
  decisionDefinitionKey: z.boolean().optional(),
  tenantFilters: z.boolean().optional(),
  instanceLineage: z.boolean().optional(),
  history: z.boolean().optional(),
  jobs: z.boolean().optional(),
  incidents: z.boolean().optional(),
  batches: z.boolean().optional(),
  counts: z.boolean().optional(),
}).strict();
export const ExternalEngineCapabilitiesSchema = z.object({
  operations: z.array(z.string()).optional(),
  queryCapabilities: EngineRuntimeQueryCapabilitiesSchema.optional(),
  supportLevel: z.string().nullable().optional(),
  compatibilityProfile: z.string().nullable().optional(),
}).passthrough();

export const ExternalEngineCapabilityDiagnosticsSchema = z.object({
  status: EngineCapabilityStatusSchema,
  expectedOperations: z.array(z.string()),
  reportedOperations: z.array(z.string()),
  missingOperations: z.array(z.string()),
  extraOperations: z.array(z.string()),
  expectedQueryCapabilities: EngineRuntimeQueryCapabilitiesSchema,
  reportedQueryCapabilities: EngineRuntimeQueryCapabilitiesSchema.nullable(),
  mismatchedQueryCapabilities: z.array(z.string()),
  expectedSupportLevel: z.string(),
  reportedSupportLevel: z.string().nullable(),
  expectedCompatibilityProfile: z.string(),
  reportedCompatibilityProfile: z.string().nullable(),
  issues: z.array(z.string()),
  recommendation: z.string(),
});

export const ExternalEngineMaterializationDiagnosticsSchema = z.object({
  engineSetCount: z.number(),
  matched: z.number(),
  created: z.number(),
  updated: z.number(),
  removed: z.number(),
  errors: z.array(z.object({
    engineSetId: z.string(),
    error: z.string(),
  })),
  status: z.enum(['ok', 'failed']),
  summary: z.string(),
});

export const ExternalEngineSystemSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  defaultManagementMode: EngineManagementModeSchema,
  defaultFieldOwnership: EngineFieldOwnershipSchema,
  isActive: z.boolean(),
  createdById: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const ExternalEngineSystemCreateSchema = z.object({
  key: z.string().min(1).max(255).optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  defaultManagementMode: EngineManagementModeSchema.exclude(['manual']).optional(),
  defaultFieldOwnership: EngineFieldOwnershipSchema.optional(),
});

export const ExternalEngineSystemUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  defaultManagementMode: EngineManagementModeSchema.exclude(['manual']).optional(),
  defaultFieldOwnership: EngineFieldOwnershipSchema.optional(),
  isActive: z.boolean().optional(),
});

export const ExternalEngineRegistrationSchema = z.object({
  id: z.string(),
  registrationId: z.string().optional(),
  name: z.string(),
  baseUrl: z.string(),
  type: z.string().nullable(),
  connectionMode: EngineConnectionModeSchema,
  externalId: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
  registrationSource: z.string().nullable(),
  apiClientId: z.string().nullable().optional(),
  externalSystemId: z.string().nullable().optional(),
  externalSystemName: z.string().nullable().optional(),
  managementMode: EngineManagementModeSchema.nullable().optional(),
  fieldOwnership: EngineFieldOwnershipSchema.optional(),
  driftStatus: z.string().nullable().optional(),
  lifecycleStatus: EngineLifecycleStatusSchema.nullable().optional(),
  lastExternalSyncAt: z.number().nullable().optional(),
  capabilities: ExternalEngineCapabilitiesSchema.nullable().optional(),
  capabilityStatus: EngineCapabilityStatusSchema.nullable().optional(),
  capabilityDiagnostics: ExternalEngineCapabilityDiagnosticsSchema.optional(),
  externalUpdatedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const ExternalEngineRegistrationAuditEntrySchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  action: z.string(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.number(),
});

export const ExternalEngineRegistrationAuditActionSchema = z.enum([
  'all',
  'engine.external_registration.create',
  'engine.external_registration.update',
  'engine.external_registration.decommission',
  'engine.external_registration.reactivate',
  'engine.external_registration.reconcile',
]);

/** Shared query contract for the External Registration audit history API. */
export const ExternalEngineRegistrationAuditQuerySchema = z.object({
  action: ExternalEngineRegistrationAuditActionSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** Bounded operator note retained in external-engine lifecycle audit events. */
export const ExternalEngineLifecycleRequestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const ExternalEngineDecommissionResponseSchema = z.object({
  decommissioned: z.boolean(),
  engineId: z.string(),
  externalId: z.string().nullable(),
  lifecycleStatus: z.literal('decommissioned'),
});

export const ExternalEngineReactivateResponseSchema = z.object({
  reactivated: z.boolean(),
  engineId: z.string(),
  externalId: z.string().nullable(),
  lifecycleStatus: z.literal('active'),
  driftStatus: z.string(),
  materializationResults: z.array(z.record(z.string(), z.unknown())),
  materializationDiagnostics: ExternalEngineMaterializationDiagnosticsSchema,
});

export const ExternalEngineReconcileResponseSchema = z.object({
  engineId: z.string(),
  externalId: z.string().nullable(),
  lifecycleStatus: EngineLifecycleStatusSchema,
  capabilityStatus: EngineCapabilityStatusSchema,
  capabilityDiagnostics: ExternalEngineCapabilityDiagnosticsSchema,
  materializationResults: z.array(z.record(z.string(), z.unknown())),
  materializationDiagnostics: ExternalEngineMaterializationDiagnosticsSchema,
});

export const EngineSetSelectorSchema = z.discriminatedUnion('mode', [
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

export const EngineSetSummarySchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  selector: EngineSetSelectorSchema,
  selectorFingerprint: z.string(),
  source: z.enum(['manual', 'sso', 'api', 'external', 'system', 'automation', 'config']),
  sourceRef: z.string().nullable(),
  ownershipMode: z.enum(['manual', 'config_locked', 'config_warn']),
  sourceHash: z.string().nullable(),
  lastAppliedAt: z.number().nullable(),
  driftStatus: z.string().nullable(),
  isArchived: z.boolean(),
  createdById: z.string().nullable(),
  lastMaterializedAt: z.number().nullable(),
  materializationStatus: z.string(),
  materializationError: z.string().nullable(),
  materializedEngineCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const EngineSetMaterializationSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  engineSetId: z.string(),
  engineId: z.string(),
  engineName: z.string().nullable(),
  selectorFingerprint: z.string(),
  matchedBy: z.record(z.string(), z.unknown()),
  lineage: z.record(z.string(), z.unknown()),
  source: z.string(),
  sourceRef: z.string().nullable(),
  lastSeenAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const EngineSetDetailSchema = EngineSetSummarySchema.extend({
  materializations: z.array(EngineSetMaterializationSchema),
});

export const EngineSetCreateSchema = z.object({
  key: z.string().min(1).max(255).optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  selector: EngineSetSelectorSchema,
  riskAcknowledged: z.boolean().optional(),
});

export const EngineSetUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  selector: EngineSetSelectorSchema.optional(),
  isArchived: z.boolean().optional(),
  riskAcknowledged: z.boolean().optional(),
});

export const EngineSetPreviewSchema = z.object({
  selector: EngineSetSelectorSchema,
  selectorFingerprint: z.string(),
  riskReasons: z.array(z.enum(['all_engines_selector', 'any_label_match'])),
  warnings: z.array(z.string()),
  matchedEngines: z.array(z.object({
    engineId: z.string(),
    engineName: z.string(),
    labels: z.record(z.string(), z.string()),
    matchedBy: z.record(z.string(), z.unknown()),
  })),
});

export const EngineSetMaterializationResultSchema = z.object({
  engineSetId: z.string(),
  selectorFingerprint: z.string(),
  matched: z.number(),
  created: z.number(),
  updated: z.number(),
  removed: z.number(),
  materializations: z.array(EngineSetMaterializationSchema),
});

export const ProjectEngineTargetModeSchema = z.enum(['manual', 'ci', 'api', 'import']);
export const ProjectEngineTargetStatusSchema = z.enum(['active', 'disabled', 'archived']);
export const ProjectEngineTargetSourceSchema = z.enum(['manual', 'legacy', 'ci', 'api', 'import', 'deployment_history', 'external', 'system', 'automation', 'config']);
export const ProjectEngineTargetApprovalStatusSchema = z.enum(['not_required', 'pending', 'approved', 'rejected']);
export const ProjectEngineTargetDiagnosticsSchema = z.record(z.string(), z.unknown());

export const ProjectEngineTargetSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  projectId: z.string(),
  projectName: z.string().nullable(),
  engineId: z.string(),
  engineName: z.string().nullable(),
  engineBaseUrl: z.string().nullable(),
  environment: z.object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    manualDeployAllowed: z.boolean(),
  }).nullable(),
  status: ProjectEngineTargetStatusSchema,
  source: ProjectEngineTargetSourceSchema,
  sourceRef: z.string().nullable(),
  ownershipMode: z.enum(['manual', 'config_locked', 'config_warn']),
  sourceHash: z.string().nullable(),
  lastAppliedAt: z.number().nullable(),
  driftStatus: z.string().nullable(),
  externalSystemId: z.string().nullable(),
  externalProjectId: z.string().nullable(),
  externalEngineId: z.string().nullable(),
  externalTargetId: z.string().nullable(),
  allowManualDeploy: z.boolean(),
  allowCiDeploy: z.boolean(),
  allowApiDeploy: z.boolean(),
  allowImport: z.boolean(),
  createdById: z.string().nullable(),
  approvedById: z.string().nullable(),
  approvalStatus: ProjectEngineTargetApprovalStatusSchema,
  approvedAt: z.number().nullable(),
  policyTags: z.array(z.string()),
  diagnostics: ProjectEngineTargetDiagnosticsSchema.nullable(),
  lastSeenAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const ProjectEngineTargetCreateSchema = z.object({
  projectId: z.string().min(1),
  engineId: z.string().min(1),
  status: ProjectEngineTargetStatusSchema.optional(),
  source: ProjectEngineTargetSourceSchema.optional(),
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
  approvalStatus: ProjectEngineTargetApprovalStatusSchema.optional(),
  approvedAt: z.number().nullable().optional(),
  policyTags: z.array(z.string()).optional(),
  diagnostics: ProjectEngineTargetDiagnosticsSchema.nullable().optional(),
});

export const ProjectEngineTargetUpdateSchema = z.object({
  status: ProjectEngineTargetStatusSchema.optional(),
  source: ProjectEngineTargetSourceSchema.optional(),
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
  approvalStatus: ProjectEngineTargetApprovalStatusSchema.optional(),
  approvedAt: z.number().nullable().optional(),
  policyTags: z.array(z.string()).optional(),
  diagnostics: ProjectEngineTargetDiagnosticsSchema.nullable().optional(),
});

export const DeploymentEligibilityEvaluateRequestSchema = z.object({
  userId: z.string().min(1),
  projectId: z.string().min(1),
  engineId: z.string().min(1),
  mode: ProjectEngineTargetModeSchema.optional(),
});

export const DeploymentEligibilityCheckSchema = z.object({
  id: z.string(),
  allowed: z.boolean(),
  reason: z.string(),
  remediation: z.string().optional(),
});

export const DeploymentEligibilityEvaluateResponseSchema = z.object({
  allowed: z.boolean(),
  decision: z.enum(['allow', 'deny']),
  mode: ProjectEngineTargetModeSchema,
  projectId: z.string(),
  engineId: z.string(),
  checks: z.array(DeploymentEligibilityCheckSchema),
  reasons: z.array(z.string()),
});

export const EffectiveAccessEvaluateRequestSchema = z.object({
  userId: z.string().uuid(),
  permission: z.string().min(1),
  resourceType: AuthzResourceTypeSchema.optional(),
  resourceId: z.string().optional(),
  runtimeResource: z.object({
    engineId: z.string().min(1),
    resourceKind: z.enum(['process_definition', 'decision_definition']),
    resourceKey: z.string().min(1),
    runtimeTenantId: z.string().max(255).optional(),
  }).optional(),
}).superRefine((value, ctx) => {
  if (value.runtimeResource && value.resourceType !== 'engine_runtime_resource') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['runtimeResource'], message: 'Runtime resource selector requires resourceType engine_runtime_resource' });
  }
  if (value.resourceType === 'engine_runtime_resource' && !value.resourceId && !value.runtimeResource) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['runtimeResource'], message: 'Runtime resource ID or selector is required' });
  }
});

export const EffectiveAccessEvaluateResponseSchema = z.object({
  allowed: z.boolean(),
  decision: z.enum(['allow', 'deny']),
  reason: z.string(),
  policyId: z.string().optional(),
  policyName: z.string().optional(),
  baseAllowed: z.boolean(),
  baseReason: z.string(),
  resolvedRuntimeResource: z.object({
    id: z.string(),
    engineId: z.string(),
    resourceKind: z.enum(['process_definition', 'decision_definition']),
    resourceKey: z.string(),
    runtimeTenantId: z.string(),
    tenantId: z.string(),
    tenantResolutionStatus: z.literal('resolved'),
    tenantMappingId: z.string().nullable(),
    tenantMappingVersion: z.number().int().nonnegative(),
  }).optional(),
  sources: z.array(z.object({
    type: z.string(),
    assignmentId: z.string().optional(),
    roleId: z.string().optional(),
    role: z.string().optional(),
    principalType: z.string().optional(),
    principalId: z.string().optional(),
    source: z.string().optional(),
    sourceRef: z.string().nullable().optional(),
    tenantId: z.string().nullable().optional(),
    expiresAt: z.number().nullable().optional(),
    scopeType: z.string().nullable().optional(),
    scopeId: z.string().nullable().optional(),
    runtimeTenantResolution: z.object({
      tenantId: z.string(),
      status: z.literal('resolved'),
      mappingId: z.string().nullable(),
      mappingVersion: z.number().int().nonnegative(),
      code: z.string().nullable(),
      engineTenancyMode: z.enum(['dedicated', 'shared']),
    }).nullable().optional(),
    groupId: z.string().nullable().optional(),
    groupKey: z.string().nullable().optional(),
    groupName: z.string().nullable().optional(),
    groupMembership: z.object({
      id: z.string(),
      source: z.string(),
      sourceRef: z.string().nullable(),
      expiresAt: z.number().nullable(),
    }).nullable().optional(),
    engineSetId: z.string().nullable().optional(),
    engineSetKey: z.string().nullable().optional(),
    engineSetName: z.string().nullable().optional(),
    selectorFingerprint: z.string().nullable().optional(),
    materializationId: z.string().nullable().optional(),
    matchedEngineId: z.string().nullable().optional(),
    engineRegistration: z.object({
      engineId: z.string(),
      engineName: z.string().nullable(),
      externalId: z.string().nullable(),
      registrationId: z.string().nullable(),
      registrationSource: z.string().nullable(),
      externalSystemId: z.string().nullable(),
      lifecycleStatus: z.string().nullable(),
      apiClientId: z.string().nullable(),
      lastExternalSyncAt: z.number().nullable(),
      lastRegisteredAt: z.number().nullable(),
      externalUpdatedAt: z.number().nullable(),
    }).nullable().optional(),
    matchedBy: z.record(z.string(), z.unknown()).nullable().optional(),
    lineage: z.record(z.string(), z.unknown()).nullable().optional(),
    configBundle: z.object({
      bundleKey: z.string(),
      sourceRef: z.string(),
      objectType: z.literal('role_assignment'),
      objectId: z.string(),
      sourceHash: z.string().nullable(),
      lastAppliedAt: z.number().nullable(),
      driftStatus: z.string().nullable(),
      ownershipMode: z.string(),
      applyRun: z.object({
        id: z.string(),
        canonicalHash: z.string(),
        appliedAt: z.number(),
      }).nullable(),
    }).optional(),
    ssoMapping: z.object({
      id: z.string(),
      providerId: z.string().nullable(),
      claimType: z.string(),
      claimKey: z.string(),
      claimValue: z.string(),
      claimOperator: z.string().nullable(),
      targetSelectorType: z.string(),
    }).nullable().optional(),
    ssoGroupMapping: z.object({
      id: z.string(),
      providerId: z.string().nullable(),
      claimType: z.string(),
      claimKey: z.string(),
      claimValue: z.string(),
      claimOperator: z.string().nullable(),
      targetGroupId: z.string(),
      syncMode: z.string(),
    }).nullable().optional(),
    identityEntitlementMapping: z.object({
      id: z.string(),
      providerId: z.string(),
      entitlementType: z.string(),
      externalId: z.string().nullable(),
      matchOperator: z.string(),
      targetGroupId: z.string(),
      syncMode: z.string(),
    }).nullable().optional(),
    shadowedRuntimeAssignmentIds: z.array(z.string()).optional(),
    permission: z.string().optional(),
  })),
});

/** Sanitized runtime authorization inventory; it never contains engine payload data. */
export const RuntimeResourceSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable(),
  tenantResolutionStatus: z.enum(['resolved', 'unmapped', 'conflict', 'stale']).default('unmapped'),
  tenantMappingId: z.string().nullable().default(null),
  tenantMappingVersion: z.number().int().nonnegative().default(0),
  tenantResolutionDetailsJson: z.string().default('{}'),
  engineId: z.string(),
  resourceKind: RuntimeResourceKindSchema,
  resourceKey: z.string(),
  runtimeTenantId: z.string(),
  engineResourceId: z.string().nullable(),
  deploymentId: z.string().nullable(),
  projectId: z.string().nullable(),
  fileId: z.string().nullable(),
  version: z.number().int().nullable(),
  labelsJson: z.string(),
  lineageJson: z.string(),
  source: z.string(),
  sourceRef: z.string().nullable(),
  observedAt: PersistedTimestampSchema,
  isActive: z.boolean(),
  createdAt: PersistedTimestampSchema,
  updatedAt: PersistedTimestampSchema,
});

export const RuntimeResourceSetSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  engineId: z.string(),
  resourceKind: RuntimeResourceKindSchema,
  selectorJson: z.string(),
  selectorFingerprint: z.string(),
  runtimeTenantId: z.string().nullable(),
  source: z.string(),
  sourceRef: z.string().nullable(),
  ownershipMode: z.string(),
  sourceHash: z.string().nullable(),
  lastAppliedAt: z.number().nullable(),
  driftStatus: z.string().nullable(),
  isArchived: z.boolean(),
  createdById: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const RuntimeResourceQuerySchema = z.object({
  engineId: z.string().min(1),
  resourceKind: RuntimeResourceKindSchema.optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
});

export const RuntimeResourceSetQuerySchema = z.object({
  engineId: z.string().min(1).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});

export const RuntimeResourceSetMaterializationResultSchema = z.object({
  runtimeResourceSetId: z.string(),
  matched: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
});

/** Provider-neutral identity-mapping contracts. Claim payloads remain untrusted inputs. */
export const IdentityMappingRequestSchema = z.object({
  providerKey: z.string().min(1).max(160),
  targetGroupKey: z.string().min(1).max(160),
  entitlementType: z.enum(['group', 'role', 'attribute', 'authenticated']),
  externalId: z.string().min(1).max(2000).nullable().optional(),
  matchOperator: z.enum(['exact', 'contains', 'exists']),
  syncMode: z.enum(['additive', 'authoritative']).optional(),
});

export const IdentityMappingResponseSchema = IdentityMappingRequestSchema.extend({
  id: z.string(),
  providerId: z.string(),
  targetGroupId: z.string(),
  externalId: z.string().min(1).max(2000).nullable(),
  syncMode: z.enum(['additive', 'authoritative']),
  isActive: z.boolean(),
  configKey: z.string().nullable(),
  sourceRef: z.string().nullable(),
  ownershipMode: AuthzOwnershipModeSchema,
});

export const IdentityMappingUpdateSchema = IdentityMappingRequestSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const IdentityMappingTestRequestSchema = IdentityMappingRequestSchema
  .omit({ targetGroupKey: true })
  .extend({ claims: z.record(z.string(), z.unknown()) });

export const IdentityMappingTestResponseSchema = z.object({
  matches: z.boolean(),
  entitlements: z.array(z.object({
    type: z.string(),
    externalId: z.string(),
  })),
});

export const IdentityMappingStoredSnapshotPreviewRequestSchema = IdentityMappingRequestSchema
  .omit({ targetGroupKey: true })
  .extend({ limit: z.number().int().min(1).max(5000).optional() });

export const IdentityMappingStoredSnapshotPreviewResponseSchema = z.object({
  scanned: z.number(),
  matches: z.number(),
  nonMatches: z.number(),
  failed: z.number(),
  truncated: z.boolean(),
  latestSnapshotAt: z.number().nullable(),
  warnings: z.array(z.string()),
});

export const IdentityMappingProvisionAccessRequestSchema = IdentityMappingRequestSchema
  .omit({ targetGroupKey: true })
  .extend({
    targetGroupKey: z.string().min(1).max(160).optional(),
    newGroup: z.object({
      key: z.string().min(1).max(255),
      name: z.string().min(1).max(255),
      description: z.string().max(2000).nullable().optional(),
    }).optional(),
    roleId: z.string().min(1).max(160),
    resourceType: z.enum(['platform', 'engine', 'engine_set', 'engine_runtime_resource', 'engine_runtime_resource_set']),
    resourceId: z.string().min(1).max(160).optional(),
  }).superRefine((value, context) => {
    if (value.targetGroupKey && value.newGroup) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide either targetGroupKey or newGroup, not both', path: ['targetGroupKey'] });
    }
    if (!value.targetGroupKey && !value.newGroup) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'targetGroupKey or newGroup is required', path: ['targetGroupKey'] });
    }
    if (value.resourceType !== 'platform' && !value.resourceId) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'resourceId is required for non-platform access', path: ['resourceId'] });
    }
  });

export const IdentityMappingProvisionAccessResponseSchema = z.object({
  mapping: IdentityMappingResponseSchema,
  assignment: z.object({
    id: z.string(),
    warnings: z.array(z.string()),
  }),
  createdGroup: z.object({ id: z.string() }).nullable(),
});

export const IdentityMappingAccessGrantRequestSchema = z.object({
  roleId: z.string().min(1).max(160),
  resourceType: z.enum(['engine', 'engine_set', 'engine_runtime_resource', 'engine_runtime_resource_set']),
  resourceId: z.string().min(1).max(160),
}).strict();

export const IdentityMappingAccessGrantResponseSchema = z.object({
  id: z.string(),
  warnings: z.array(z.string()),
});

/** Backward-compatible names for the shared provider-neutral sync contracts. */
export const SsoSyncRunSchema = IdentitySyncRunSchema;
export const SsoSyncEventSchema = IdentitySyncEventSchema;

export const SsoSyncRunsQuerySchema = z.object({
  providerId: z.string().min(1).optional(),
  userId: z.string().uuid().optional(),
  status: z.enum(['running', 'success', 'failed']).optional(),
  trigger: z.enum(['login', 'scheduled', 'manual', 'mapping_change', 'engine_change']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const SsoSyncEventsQuerySchema = z.object({
  providerId: z.string().min(1).optional(),
  severity: z.enum(['info', 'warning', 'error']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const SsoSyncDiagnosticsRunRequestSchema = z.object({
  providerId: z.string().min(1).optional(),
  trigger: z.enum(['manual', 'scheduled', 'mapping_change', 'engine_change']).optional(),
  includeProviderChecks: z.boolean().optional(),
  includeSnapshotReplay: z.boolean().optional(),
  refreshProviderClaims: z.boolean().optional(),
  includeCleanup: z.boolean().optional(),
});

export const SsoSyncDiagnosticsScanResultSchema = z.object({
  runId: z.string().nullable(),
  scannedGroupMappings: z.number(),
  scannedAssignmentMappings: z.number(),
  scannedGroupMemberships: z.number(),
  scannedAssignments: z.number(),
  warnings: z.number(),
  errors: z.number(),
  providerIdentityCheck: z.record(z.string(), z.unknown()).optional(),
  snapshotReconciliation: z.record(z.string(), z.unknown()).optional(),
  cleanup: z.record(z.string(), z.unknown()).optional(),
});

export const IdentityProviderSyncRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const IdentityProviderSyncEventsQuerySchema = z.object({
  severity: z.enum(['info', 'warning', 'error']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const IdentityProviderMembershipReplayRequestSchema = z.object({
  limit: z.number().int().min(1).max(5000).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

export const IdentityProviderReconciliationPreviewSchema = z.object({
  scanned: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  removals: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  truncated: z.boolean(),
  nextCursor: z.string().nullable(),
  latestSnapshotAt: z.number().nullable(),
  warnings: z.array(z.enum(['stored_snapshots_only', 'no_active_snapshots', 'truncated'])),
  mappings: z.array(z.object({
    mappingId: z.string(),
    targetGroupId: z.string(),
    additions: z.number().int().nonnegative(),
    removals: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
  })),
});

export const IdentityProviderMembershipReplayResponseSchema = z.object({
  runId: z.string().nullable(),
  scanned: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  truncated: z.boolean(),
  nextCursor: z.string().nullable(),
});

/**
 * A conflicting provider subject is never reassigned by this request. It only
 * revokes the current account link and leaves a tombstone until a fresh,
 * verified provider sign-in satisfies the provider's linking policy.
 */
export const IdentityProviderExternalIdentityUnlinkRequestSchema = z.object({
  subjectId: z.string().min(1).max(2000),
  userId: z.string().min(1).max(128),
  confirmation: z.literal('UNLINK_EXTERNAL_IDENTITY'),
});

export const IdentityProviderExternalIdentityUnlinkResponseSchema = z.object({
  identityId: z.string().min(1),
  providerManagedMembershipsRemoved: z.number().int().nonnegative(),
  normalizedIdentitiesMarked: z.number().int().nonnegative(),
  providerRefreshSessionsRevoked: z.number().int().nonnegative(),
  recovery: z.literal('verified_sign_in_required'),
});

const IdentityProviderRequestFields = {
  key: z.string().min(1).max(128),
  isEnabled: z.boolean().optional(),
  authenticationMode: IdentityProviderAuthenticationModeSchema.optional(),
  directoryTenantId: z.string().nullable().optional(),
  sync: IdentityProviderSyncConfigurationSchema.optional(),
  ownershipMode: z.string().max(64).optional(),
  sourceRef: z.string().nullable().optional(),
};

/**
 * Direct API and configuration bundles intentionally use the same
 * protocol-specific options. The API shape nests options under
 * `configuration`; bundles nest them under the provider type.
 */
export const IdentityProviderRequestSchema = z.discriminatedUnion('protocol', [
  z.object({ ...IdentityProviderRequestFields, protocol: z.literal('oidc'), configuration: OidcIdentityProviderConfigurationSchema }).strict(),
  z.object({ ...IdentityProviderRequestFields, protocol: z.literal('saml'), configuration: SamlIdentityProviderConfigurationSchema }).strict(),
  z.object({ ...IdentityProviderRequestFields, protocol: z.literal('ldap'), configuration: LdapIdentityProviderConfigurationSchema }).strict(),
]);

/**
 * The provider protocol and key are path-owned on update. The route merges an
 * update with the stored record and validates that complete result through the
 * creation schema above.
 */
export const IdentityProviderUpdateSchema = z.object({
  isEnabled: z.boolean().optional(),
  authenticationMode: IdentityProviderAuthenticationModeSchema.optional(),
  directoryTenantId: z.string().nullable().optional(),
  configuration: z.union([
    OidcIdentityProviderConfigurationSchema,
    SamlIdentityProviderConfigurationSchema,
    LdapIdentityProviderConfigurationSchema,
  ]).optional(),
  sync: IdentityProviderSyncConfigurationSchema.optional(),
  ownershipMode: z.string().max(64).optional(),
  sourceRef: z.string().nullable().optional(),
}).strict();

export const IdentityProviderResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable(),
  key: z.string().min(1).max(128),
  protocol: SharedIdentityProviderProtocolSchema,
  isEnabled: z.boolean(),
  authenticationMode: IdentityProviderAuthenticationModeSchema,
  directoryTenantId: z.string().nullable(),
  ownershipMode: z.string().max(64),
  sourceRef: z.string().nullable(),
  configurationJson: z.string(),
  syncJson: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const IdentityProviderConnectionTestResponseSchema = z.discriminatedUnion('protocol', [
  z.object({ status: z.literal('connected'), protocol: z.literal('oidc'), issuer: z.string() }),
  z.object({ status: z.literal('connected'), protocol: z.literal('saml'), entityDescriptorCount: z.number().int().nonnegative() }),
  z.object({ status: z.literal('connected'), protocol: z.literal('ldap'), sampledIdentities: z.number().int().nonnegative() }),
]);


export const BridgeDecisionRequestSchema = z.object({
  engineId: z.string().optional(),
  projectId: z.string().optional(),
  fileId: z.string().optional(),
  targetId: z.string().optional(),
  definitionId: z.string().optional(),
  definitionKey: z.string().optional(),
  decisionDefinitionId: z.string().optional(),
  decisionDefinitionKey: z.string().optional(),
  kind: z.enum(['process', 'decision', 'bpmn', 'dmn']).optional(),
}).passthrough();

export const BridgeDecisionResponseSchema = z.object({
  allowed: z.boolean(),
  reasonCode: z.string(),
  reason: z.string(),
  missingActions: z.array(z.string()),
  projectId: z.string().nullable(),
  fileId: z.string().nullable(),
  engineId: z.string().nullable(),
  targetId: z.string().nullable(),
  lineage: z.record(z.string(), z.unknown()),
  diagnostics: z.object({
    effectiveAccessUrl: z.string().optional(),
    label: z.string().optional(),
  }).optional(),
});

// Types
export type AuthzPolicy = z.infer<typeof AuthzPolicySchema>;
export type AuthzPolicyResponse = z.infer<typeof AuthzPolicyResponseSchema>;
export type AuthzPolicyCreate = z.input<typeof AuthzPolicyCreateSchema>;
export type AuthzPolicyUpdate = z.input<typeof AuthzPolicyUpdateSchema>;
export type AuthzCheckRequest = z.input<typeof AuthzCheckRequestSchema>;
export type AuthzCheckResponse = z.infer<typeof AuthzCheckResponseSchema>;
export type AuthzCheckBatchRequest = z.input<typeof AuthzCheckBatchRequestSchema>;
export type AuthzCheckBatchResponse = z.infer<typeof AuthzCheckBatchResponseSchema>;
export type PolicyCondition = z.infer<typeof PolicyConditionSchema>;
export type AuthzAuditLogEntry = z.infer<typeof AuthzAuditLogSchema>;
export type AuthzAuditQuery = z.input<typeof AuthzAuditQuerySchema>;
export type AuthzAuditLogResponse = z.infer<typeof AuthzAuditLogResponseSchema>;
export type SamlAuthenticationStatus = z.infer<typeof SamlAuthenticationStatusSchema>;
export type PermissionCatalogEntry = z.infer<typeof PermissionCatalogEntrySchema>;
export type CustomPermissionCreate = z.infer<typeof CustomPermissionCreateSchema>;
export type EffectiveResourcePermissions = z.infer<typeof EffectiveResourcePermissionsSchema>;
export type EffectiveEngineResourcePermissions = z.infer<typeof EffectiveEngineResourcePermissionsSchema>;
export type CurrentUserPermissions = z.infer<typeof CurrentUserPermissionsSchema>;
export type RoleSummary = z.infer<typeof RoleSummarySchema>;
export type RoleDetail = z.infer<typeof RoleDetailSchema>;
export type CustomRoleCreate = z.infer<typeof CustomRoleCreateSchema>;
export type CustomRoleUpdate = z.infer<typeof CustomRoleUpdateSchema>;
export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>;
export type RoleAssignmentCreate = z.infer<typeof RoleAssignmentCreateSchema>;
export type AuthzCreatedIdResponse = z.infer<typeof AuthzCreatedIdResponseSchema>;
export type AuthzMutationSuccessResponse = z.infer<typeof AuthzMutationSuccessResponseSchema>;
export type CustomPermissionCreateResponse = z.infer<typeof CustomPermissionCreateResponseSchema>;
export type RoleAssignmentCreateResponse = z.infer<typeof RoleAssignmentCreateResponseSchema>;
export type ProjectEngineTargetSyncLegacyRequest = z.infer<typeof ProjectEngineTargetSyncLegacyRequestSchema>;
export type ProjectEngineTargetSyncLegacyResponse = z.infer<typeof ProjectEngineTargetSyncLegacyResponseSchema>;
export type RoleAssignmentSource = z.infer<typeof RoleAssignmentSourceSchema>;
export type AuthzOwnershipMode = z.infer<typeof AuthzOwnershipModeSchema>;
export type AuthzGroup = z.infer<typeof AuthzGroupSchema>;
export type AuthzGroupSource = z.infer<typeof AuthzGroupSourceSchema>;
export type AuthzGroupCreate = z.infer<typeof AuthzGroupCreateSchema>;
export type AuthzGroupUpdate = z.infer<typeof AuthzGroupUpdateSchema>;
export type AuthzGroupMembership = z.infer<typeof AuthzGroupMembershipSchema>;
export type AuthzGroupMembershipCreate = z.infer<typeof AuthzGroupMembershipCreateSchema>;
export type ApiClient = z.infer<typeof ApiClientSchema>;
export type ApiClientCreate = z.infer<typeof ApiClientCreateSchema>;
export type ApiClientWithToken = z.infer<typeof ApiClientWithTokenSchema>;
export type ServiceAccount = z.infer<typeof ServiceAccountSchema>;
export type ServiceAccountCreate = z.infer<typeof ServiceAccountCreateSchema>;
export type ServiceAccountWithToken = z.infer<typeof ServiceAccountWithTokenSchema>;
export type EngineManagementMode = z.infer<typeof EngineManagementModeSchema>;
export type EngineLifecycleStatus = z.infer<typeof EngineLifecycleStatusSchema>;
export type EngineCapabilityStatus = z.infer<typeof EngineCapabilityStatusSchema>;
export type EngineFieldOwnership = z.infer<typeof EngineFieldOwnershipSchema>;
export type EngineRuntimeQueryCapabilities = z.infer<typeof EngineRuntimeQueryCapabilitiesSchema>;
export type ExternalEngineCapabilities = z.infer<typeof ExternalEngineCapabilitiesSchema>;
export type ExternalEngineCapabilityDiagnostics = z.infer<typeof ExternalEngineCapabilityDiagnosticsSchema>;
export type ExternalEngineMaterializationDiagnostics = z.infer<typeof ExternalEngineMaterializationDiagnosticsSchema>;
export type ExternalEngineSystem = z.infer<typeof ExternalEngineSystemSchema>;
export type ExternalEngineSystemCreate = z.infer<typeof ExternalEngineSystemCreateSchema>;
export type ExternalEngineSystemUpdate = z.infer<typeof ExternalEngineSystemUpdateSchema>;
export type ExternalEngineRegistration = z.infer<typeof ExternalEngineRegistrationSchema>;
export type ExternalEngineRegistrationAuditEntry = z.infer<typeof ExternalEngineRegistrationAuditEntrySchema>;
export type ExternalEngineRegistrationAuditAction = z.infer<typeof ExternalEngineRegistrationAuditActionSchema>;
export type ExternalEngineRegistrationAuditQuery = z.infer<typeof ExternalEngineRegistrationAuditQuerySchema>;
export type ExternalEngineLifecycleRequest = z.input<typeof ExternalEngineLifecycleRequestSchema>;
export type ExternalEngineDecommissionResponse = z.infer<typeof ExternalEngineDecommissionResponseSchema>;
export type ExternalEngineReactivateResponse = z.infer<typeof ExternalEngineReactivateResponseSchema>;
export type ExternalEngineReconcileResponse = z.infer<typeof ExternalEngineReconcileResponseSchema>;
export type EngineSetSelector = z.infer<typeof EngineSetSelectorSchema>;
export type EngineSetSummary = z.infer<typeof EngineSetSummarySchema>;
export type EngineSetDetail = z.infer<typeof EngineSetDetailSchema>;
export type EngineSetCreate = z.infer<typeof EngineSetCreateSchema>;
export type EngineSetUpdate = z.infer<typeof EngineSetUpdateSchema>;
export type EngineSetPreview = z.infer<typeof EngineSetPreviewSchema>;
export type EngineSetMaterializationResult = z.infer<typeof EngineSetMaterializationResultSchema>;
export type ProjectEngineTargetMode = z.infer<typeof ProjectEngineTargetModeSchema>;
export type ProjectEngineTargetStatus = z.infer<typeof ProjectEngineTargetStatusSchema>;
export type ProjectEngineTargetSource = z.infer<typeof ProjectEngineTargetSourceSchema>;
export type ProjectEngineTargetApprovalStatus = z.infer<typeof ProjectEngineTargetApprovalStatusSchema>;
export type ProjectEngineTarget = z.infer<typeof ProjectEngineTargetSchema>;
export type ProjectEngineTargetCreate = z.infer<typeof ProjectEngineTargetCreateSchema>;
export type ProjectEngineTargetUpdate = z.infer<typeof ProjectEngineTargetUpdateSchema>;
export type DeploymentEligibilityEvaluateRequest = z.infer<typeof DeploymentEligibilityEvaluateRequestSchema>;
export type DeploymentEligibilityCheck = z.infer<typeof DeploymentEligibilityCheckSchema>;
export type DeploymentEligibilityEvaluateResponse = z.infer<typeof DeploymentEligibilityEvaluateResponseSchema>;
export type EffectiveAccessEvaluateRequest = z.infer<typeof EffectiveAccessEvaluateRequestSchema>;
export type EffectiveAccessEvaluateResponse = z.infer<typeof EffectiveAccessEvaluateResponseSchema>;
export type IdentityMappingRequest = z.infer<typeof IdentityMappingRequestSchema>;
export type IdentityMappingResponse = z.infer<typeof IdentityMappingResponseSchema>;
export type IdentityMappingTestRequest = z.input<typeof IdentityMappingTestRequestSchema>;
export type IdentityMappingTestResponse = z.infer<typeof IdentityMappingTestResponseSchema>;
export type IdentityMappingStoredSnapshotPreviewRequest = z.input<typeof IdentityMappingStoredSnapshotPreviewRequestSchema>;
export type IdentityMappingStoredSnapshotPreviewResponse = z.infer<typeof IdentityMappingStoredSnapshotPreviewResponseSchema>;
export type IdentityMappingProvisionAccessRequest = z.input<typeof IdentityMappingProvisionAccessRequestSchema>;
export type IdentityMappingProvisionAccessResponse = z.infer<typeof IdentityMappingProvisionAccessResponseSchema>;
export type IdentityMappingAccessGrantRequest = z.infer<typeof IdentityMappingAccessGrantRequestSchema>;
export type IdentityMappingAccessGrantResponse = z.infer<typeof IdentityMappingAccessGrantResponseSchema>;
export type IdentityProviderResponse = z.infer<typeof IdentityProviderResponseSchema>;
export type IdentityProviderMembershipReplayResponse = z.infer<typeof IdentityProviderMembershipReplayResponseSchema>;
export type IdentityProviderExternalIdentityUnlinkResponse = z.infer<typeof IdentityProviderExternalIdentityUnlinkResponseSchema>;
export type IdentityProviderReconciliationPreview = z.infer<typeof IdentityProviderReconciliationPreviewSchema>;
export type IdentityProviderConnectionTestResponse = z.infer<typeof IdentityProviderConnectionTestResponseSchema>;
export type RuntimeResource = z.infer<typeof RuntimeResourceSchema>;
export type RuntimeResourceSet = z.infer<typeof RuntimeResourceSetSchema>;
export type RuntimeResourceSetMaterializationResult = z.infer<typeof RuntimeResourceSetMaterializationResultSchema>;
export type SsoSyncRunsQuery = z.input<typeof SsoSyncRunsQuerySchema>;
export type SsoSyncEventsQuery = z.input<typeof SsoSyncEventsQuerySchema>;
export type SsoSyncDiagnosticsRunRequest = z.infer<typeof SsoSyncDiagnosticsRunRequestSchema>;
export type SsoSyncDiagnosticsScanResult = z.infer<typeof SsoSyncDiagnosticsScanResultSchema>;
export type BridgeDecisionRequest = z.infer<typeof BridgeDecisionRequestSchema>;
export type BridgeDecisionResponse = z.infer<typeof BridgeDecisionResponseSchema>;
export type AuthzResourceType = z.infer<typeof AuthzResourceTypeSchema>;
export type AuthzPrincipalType = z.infer<typeof AuthzPrincipalTypeSchema>;
export type AuthzActionRisk = z.infer<typeof AuthzActionRiskSchema>;
export type AuthzOpenApiExtension = z.infer<typeof AuthzOpenApiExtensionSchema>;
