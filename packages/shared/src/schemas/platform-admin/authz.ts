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
  IdentitySyncEventSchema,
  IdentitySyncRunSchema,
} from './identity.js';

export { IdentityProviderProtocolSchema } from './identity.js';

export const AuthzResourceTypeSchema = z.enum(AUTHZ_RESOURCE_TYPES);
export const AuthzPrincipalTypeSchema = z.enum(AUTHZ_PRINCIPAL_TYPES);
export const AuthzActionRiskSchema = z.enum(AUTHZ_ACTION_RISKS);
export const AuthzUiBehaviorSchema = z.enum(AUTHZ_UI_BEHAVIORS);

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

// Raw schema - matches TypeORM SsoProvider entity
export const SsoProviderSchemaRaw = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  clientId: z.string().nullable(),
  tenantId: z.string().nullable(),
  issuerUrl: z.string().nullable(),
  scopes: z.string().nullable(),
  callbackUrl: z.string().nullable(),
  iconUrl: z.string().nullable(),
  buttonLabel: z.string().nullable(),
  buttonColor: z.string().nullable(),
  displayOrder: z.number(),
  autoProvision: z.boolean(),
  defaultRole: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// SSO Provider - Select schema (API response)
export const SsoProviderSchema = SsoProviderSchemaRaw.transform((p) => ({
  id: p.id,
  name: p.name,
  type: p.type as 'microsoft' | 'google' | 'saml' | 'oidc',
  enabled: p.enabled,
  clientId: p.clientId ?? undefined,
  tenantId: p.tenantId ?? undefined,
  issuerUrl: p.issuerUrl ?? undefined,
  scopes: p.scopes ?? undefined,
  callbackUrl: p.callbackUrl ?? undefined,
  iconUrl: p.iconUrl ?? undefined,
  buttonLabel: p.buttonLabel ?? undefined,
  buttonColor: p.buttonColor ?? undefined,
  displayOrder: p.displayOrder,
  autoProvision: p.autoProvision,
  defaultRole: normalizeRoleValue(p.defaultRole),
  createdAt: Number(p.createdAt),
  updatedAt: Number(p.updatedAt),
}));

/**
 * Response for the legacy SSO provider compatibility API. Secret material is
 * never present; the two booleans only communicate whether a redacted value
 * is already configured so an edit form can preserve it.
 */
export const LegacySsoProviderResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['microsoft', 'google', 'saml', 'oidc']),
  enabled: z.boolean(),
  clientId: z.string().nullable(),
  tenantId: z.string().nullable(),
  issuerUrl: z.string().nullable(),
  authorizationUrl: z.string().nullable(),
  tokenUrl: z.string().nullable(),
  userInfoUrl: z.string().nullable(),
  scopes: z.array(z.string()),
  entityId: z.string().nullable(),
  ssoUrl: z.string().nullable(),
  sloUrl: z.string().nullable(),
  /** Legacy rows can expose a historical algorithm label; validation occurs at write/enable boundaries. */
  signatureAlgorithm: z.string().nullable(),
  callbackUrl: z.string().nullable(),
  iconUrl: z.string().nullable(),
  buttonLabel: z.string().nullable(),
  buttonColor: z.string().nullable(),
  displayOrder: z.number().int(),
  autoProvision: z.boolean(),
  defaultRole: z.enum(['admin', 'user']),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  hasClientSecret: z.boolean(),
  hasCertificate: z.boolean(),
}).strict();

// SSO Provider - Insert schema
export const SsoProviderInsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  type: z.enum(['microsoft', 'google', 'saml', 'oidc']),
});

// Raw schema - matches TypeORM SsoClaimsMapping entity
export const SsoClaimOperatorSchema = z.enum([
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
]);

export const SsoClaimsMappingSchemaRaw = z.object({
  id: z.string(),
  providerId: z.string().nullable(),
  claimType: z.string(),
  claimKey: z.string(),
  claimValue: z.string(),
  claimOperator: SsoClaimOperatorSchema.nullable().optional(),
  targetRole: z.string(),
  priority: z.number(),
  isActive: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// SSO Claims Mapping - Select schema (API response)
export const SsoClaimsMappingSchema = SsoClaimsMappingSchemaRaw.transform((m) => ({
  id: m.id,
  providerId: m.providerId ?? undefined,
  claimType: m.claimType as 'group' | 'role' | 'email_domain' | 'custom',
  claimKey: m.claimKey,
  claimValue: m.claimValue,
  claimOperator: m.claimOperator ?? null,
  targetRole: normalizeRoleValue(m.targetRole),
  priority: m.priority,
  isActive: m.isActive,
  createdAt: Number(m.createdAt),
  updatedAt: Number(m.updatedAt),
}));

// SSO Claims Mapping - Insert schema
export const SsoClaimsMappingInsertSchema = z.object({
  id: z.string().uuid().optional(),
  claimType: z.enum(['group', 'role', 'email_domain', 'custom']),
  claimKey: z.string().min(1),
  claimValue: z.string().optional().default(''),
  claimOperator: SsoClaimOperatorSchema.nullable().optional(),
  targetRole: z.enum(['admin', 'user']),
  isActive: z.boolean().optional(),
  riskAcknowledged: z.boolean().optional(),
});

export const PermissionCatalogEntrySchema = z.object({
  key: z.string(),
  scope: AuthzResourceTypeSchema,
  category: z.string(),
  label: z.string(),
  description: z.string(),
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

export const CurrentUserPermissionsSchema = z.object({
  userId: z.string(),
  platform: z.array(z.string()),
  projects: z.array(EffectiveResourcePermissionsSchema),
  engines: z.array(EffectiveResourcePermissionsSchema),
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
  sourceMappingId: z.string().nullable(),
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
  }).optional(),
  sources: z.array(z.object({
    type: z.string(),
    assignmentId: z.string().optional(),
    roleId: z.string().optional(),
    role: z.string().optional(),
    principalType: z.string().optional(),
    principalId: z.string().optional(),
    source: z.string().optional(),
    sourceMappingId: z.string().nullable().optional(),
    sourceRef: z.string().nullable().optional(),
    scopeType: z.string().nullable().optional(),
    scopeId: z.string().nullable().optional(),
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
  observedAt: z.number(),
  isActive: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
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

/** Diagnostics and retirement gate for compatibility mapping evaluators. */
export const LegacyMappingCoverageFamilySchema = z.enum(['platform_role', 'group', 'engine_assignment']);
export const LegacyMappingCoverageStatusSchema = z.enum(['replacement_candidate', 'manual_redesign_required', 'no_replacement_candidate']);
export const LegacyMappingCoverageVerificationSchema = z.object({
  candidateIdentityMappingId: z.string(),
  verifiedById: z.string().nullable(),
  verifiedAt: z.number(),
  note: z.string(),
});
export const LegacyMappingCoverageItemSchema = z.object({
  id: z.string(),
  family: LegacyMappingCoverageFamilySchema,
  status: LegacyMappingCoverageStatusSchema,
  reason: z.string(),
  candidateIdentityMappingIds: z.array(z.string()),
  verification: LegacyMappingCoverageVerificationSchema.nullable(),
});
export const LegacyMappingRetirementBlockerSchema = z.object({
  id: z.string(),
  family: LegacyMappingCoverageFamilySchema,
  reason: z.string(),
});
export const LegacyMappingRetirementReadinessSchema = z.object({
  ready: z.boolean(),
  activeLegacyMappingCount: z.number().int().nonnegative(),
  verifiedReplacementCount: z.number().int().nonnegative(),
  blockers: z.array(LegacyMappingRetirementBlockerSchema),
});
export const LegacyMappingCoverageVerifyRequestSchema = z.object({
  family: LegacyMappingCoverageFamilySchema,
  candidateIdentityMappingId: z.string().min(1),
  note: z.string().min(3).max(2000),
});
export const LegacyMappingRetirementRequestSchema = z.object({ confirmation: z.literal('RETIRE_LEGACY_MAPPINGS') });
export const LegacyGlobalMappingRetirementRequestSchema = z.object({ confirmation: z.literal('RETIRE_GLOBAL_LEGACY_MAPPINGS') });
export const LegacyMappingRetirementResultSchema = z.object({
  platformRoleMappingsDisabled: z.number().int().nonnegative(),
  groupMappingsDisabled: z.number().int().nonnegative(),
  engineAssignmentMappingsDisabled: z.number().int().nonnegative(),
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

export const IdentityProviderMigrationReadinessQuerySchema = z.object({
  targetProviderKey: z.string().min(1).max(128),
  legacyProviderId: z.string().min(1).max(128).optional(),
});

/**
 * A non-persistent, non-secret migration plan for a legacy SSO provider.
 * The configuration deliberately contains references only; never copy or
 * resolve legacy ciphertext into this API contract.
 */
export const LegacyIdentityProviderMigrationDraftSchema = z.object({
  legacyProvider: z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['microsoft', 'google', 'oidc', 'saml']),
    enabled: z.boolean(),
    clientSecretConfigured: z.boolean().optional(),
    signingCertificateConfigured: z.boolean().optional(),
  }),
  provider: z.discriminatedUnion('protocol', [
    z.object({
      key: z.string(),
      protocol: z.literal('oidc'),
      isEnabled: z.literal(false),
      authenticationMode: z.literal('direct'),
      directoryTenantId: z.string().nullable(),
      configuration: z.object({
        issuerUrl: z.string().url(),
        clientId: z.string(),
        callbackUrl: z.string().url(),
        scopes: z.array(z.string()),
        clientSecretRef: z.string().optional(),
      }).strict(),
    }),
    z.object({
      key: z.string(),
      protocol: z.literal('saml'),
      isEnabled: z.literal(false),
      authenticationMode: z.literal('direct'),
      directoryTenantId: z.null(),
      configuration: z.object({
        entityId: z.string(),
        callbackUrl: z.string().url(),
        ssoUrl: z.string().url(),
        signingCertificateRef: z.string(),
        signatureAlgorithm: z.enum(['sha256', 'sha512']),
      }).strict(),
    }),
  ]),
  requirements: z.array(z.enum([
    'client_secret_reference',
    'signing_certificate_reference',
    'identity_provider_redirect_uri',
    'identity_mappings',
    'legacy_provider_cutover',
  ])),
  warnings: z.array(z.string()),
});

export const LegacyIdentityProviderCutoverRequestSchema = z.object({
  legacyProviderId: z.string().min(1).max(128),
  targetProviderKey: z.string().min(1).max(128),
});

export const LegacyIdentityProviderCutoverResponseSchema = z.object({
  legacyProvider: z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['microsoft', 'google', 'oidc', 'saml']),
  }),
  targetProviderKey: z.string(),
  legacyProviderDisabled: z.boolean(),
  alreadyDisabled: z.boolean(),
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

export const IdentityProviderMigrationReadinessResponseSchema = z.object({
  ready: z.boolean(),
  targetProviderKey: z.string(),
  legacyProviderId: z.string().nullable(),
  requiredDefaultGroupId: z.string().nullable(),
  activeMappingCount: z.number().int().nonnegative(),
  checks: z.object({
    targetExists: z.boolean(),
    directOidc: z.boolean(),
    directLoginProtocol: z.boolean(),
    enabled: z.boolean(),
    secretReferenceConfigured: z.boolean(),
    secretReferenceAvailable: z.boolean(),
    activeMappingsConfigured: z.boolean(),
    defaultRoleMappingConfigured: z.boolean().nullable(),
  }),
  blockers: z.array(z.enum([
    'target_not_found',
    'target_not_direct_oidc',
    'target_protocol_mismatch',
    'target_disabled',
    'secret_reference_missing',
    'secret_reference_unavailable',
    'identity_mappings_missing',
    'legacy_provider_not_found',
    'default_role_mapping_missing',
  ])),
});

export const IdentityProviderConfigurationSchema = z.record(z.string(), z.unknown());

/** Configuration contains opaque secret references only; resolved values are never an API contract. */
export const IdentityProviderRequestSchema = z.object({
  key: z.string().min(1).max(128),
  protocol: SharedIdentityProviderProtocolSchema,
  isEnabled: z.boolean().optional(),
  authenticationMode: IdentityProviderAuthenticationModeSchema.optional(),
  directoryTenantId: z.string().nullable().optional(),
  configuration: IdentityProviderConfigurationSchema,
  sync: z.record(z.string(), z.unknown()).optional(),
  ownershipMode: z.string().max(64).optional(),
  sourceRef: z.string().nullable().optional(),
});

export const IdentityProviderUpdateSchema = IdentityProviderRequestSchema.omit({ key: true }).partial();

export const IdentityProviderResponseSchema = IdentityProviderRequestSchema.extend({
  id: z.string(),
  tenantId: z.string().nullable(),
  isEnabled: z.boolean(),
  authenticationMode: IdentityProviderAuthenticationModeSchema,
  configurationJson: z.string(),
  syncJson: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).omit({ configuration: true, sync: true });

export const IdentityProviderConnectionTestResponseSchema = z.discriminatedUnion('protocol', [
  z.object({ status: z.literal('connected'), protocol: z.literal('oidc'), issuer: z.string() }),
  z.object({ status: z.literal('connected'), protocol: z.literal('saml'), entityDescriptorCount: z.number().int().nonnegative() }),
  z.object({ status: z.literal('connected'), protocol: z.literal('ldap'), sampledIdentities: z.number().int().nonnegative() }),
]);

export const SsoAssignmentMappingSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  providerId: z.string().nullable(),
  claimType: z.enum(['group', 'role', 'email_domain', 'custom']),
  claimKey: z.string(),
  claimValue: z.string(),
  claimOperator: SsoClaimOperatorSchema.nullable().optional(),
  targetScope: z.literal('engine'),
  targetSelectorType: z.enum(['engine_id', 'all_engines', 'external_engine_id', 'engine_label']),
  targetEngineId: z.string().nullable(),
  targetExternalEngineId: z.string().nullable(),
  targetLabelKey: z.string().nullable(),
  targetLabelValue: z.string().nullable(),
  targetRoleId: z.string().min(1),
  syncMode: z.enum(['authoritative', 'additive']),
  priority: z.number(),
  isActive: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const SsoAssignmentMappingInsertSchema = z.object({
  providerId: z.string().nullable().optional(),
  claimType: z.enum(['group', 'role', 'email_domain', 'custom']),
  claimKey: z.string().min(1),
  claimValue: z.string().optional().default(''),
  claimOperator: SsoClaimOperatorSchema.nullable().optional(),
  targetSelectorType: z.enum(['engine_id', 'all_engines', 'external_engine_id', 'engine_label']),
  targetEngineId: z.string().nullable().optional(),
  targetExternalEngineId: z.string().nullable().optional(),
  targetLabelKey: z.string().nullable().optional(),
  targetLabelValue: z.string().nullable().optional(),
  targetRoleId: z.string().min(1),
  syncMode: z.enum(['authoritative', 'additive']).optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
  riskAcknowledged: z.boolean().optional(),
});

export const SsoEngineAccessSnapshotStatusSchema = z.enum([
  'active',
  'stale',
  'removed_by_sso',
  'removed_by_admin',
  'mapping_disabled',
  'provider_identity_missing',
  'provider_group_missing',
  'engine_no_longer_matches_selector',
]);

export const SsoEngineAccessSnapshotSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable(),
  providerId: z.string().nullable(),
  mappingId: z.string(),
  principalType: z.string(),
  principalId: z.string(),
  engineId: z.string(),
  providerSubjectIds: z.array(z.string()),
  providerGroupIds: z.array(z.string()),
  providerAppRoleIds: z.array(z.string()),
  currentRoleIds: z.array(z.string()),
  previousRoleIds: z.array(z.string()),
  status: SsoEngineAccessSnapshotStatusSchema,
  cleanupReason: z.string().nullable(),
  lastSeenAt: z.number(),
  lastSyncedAt: z.number(),
  removedAt: z.number().nullable(),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const SsoEngineAccessSnapshotQuerySchema = z.object({
  providerId: z.string().optional(),
  mappingId: z.string().optional(),
  principalType: z.string().optional(),
  principalId: z.string().optional(),
  engineId: z.string().optional(),
  status: SsoEngineAccessSnapshotStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const EngineAccessTransitionCleanupCandidateSchema = z.object({
  manualAssignmentId: z.string(),
  ssoAssignmentId: z.string(),
  principalType: z.string(),
  principalId: z.string(),
  engineId: z.string(),
  manualRoleId: z.string(),
  ssoRoleId: z.string(),
  sourceMappingId: z.string().nullable(),
  lastSnapshotStatus: SsoEngineAccessSnapshotStatusSchema.nullable(),
  recommendedAction: z.enum(['remove_manual_duplicate', 'review_manual_conflict']),
});

export const EngineAccessTransitionCleanupPreviewSchema = z.object({
  previewCorrelationId: z.string(),
  engineId: z.string(),
  candidates: z.array(EngineAccessTransitionCleanupCandidateSchema),
});

export const EngineAccessTransitionCleanupApplyRequestSchema = z.object({
  previewCorrelationId: z.string().optional(),
  assignmentIds: z.array(z.string().min(1)).min(1),
});

export const EngineAccessTransitionCleanupApplyResponseSchema = z.object({
  previewCorrelationId: z.string(),
  engineId: z.string(),
  removedAssignmentIds: z.array(z.string()),
  removedCount: z.number(),
});

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

export const SsoGroupMappingSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  providerId: z.string().nullable(),
  claimType: z.enum(['group', 'role', 'email_domain', 'custom']),
  claimKey: z.string(),
  claimValue: z.string(),
  claimOperator: SsoClaimOperatorSchema.nullable().optional(),
  targetGroupId: z.string(),
  targetGroupKey: z.string().nullable(),
  targetGroupName: z.string().nullable(),
  syncMode: z.enum(['authoritative', 'additive']),
  priority: z.number(),
  isActive: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const SsoGroupMappingInsertSchema = z.object({
  providerId: z.string().nullable().optional(),
  claimType: z.enum(['group', 'role', 'email_domain', 'custom']),
  claimKey: z.string().min(1),
  claimValue: z.string().optional().default(''),
  claimOperator: SsoClaimOperatorSchema.nullable().optional(),
  targetGroupId: z.string().min(1),
  syncMode: z.enum(['authoritative', 'additive']).optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
  riskAcknowledged: z.boolean().optional(),
});

/** Shared legacy SSO mapping preview input retained while migration remains evidence-gated. */
export const SsoMappingTestRequestSchema = z.object({
  claims: z.record(z.string(), z.unknown()),
  providerId: z.string().min(1).optional(),
});

export const SsoPlatformMappingTestResponseSchema = z.object({
  resolvedRole: z.enum(['admin', 'user']),
  matchedMappings: z.array(z.object({
    id: z.string(),
    name: z.string(),
    targetRole: z.string(),
  })),
});

export const SsoAssignmentMappingTestResponseSchema = z.object({
  matchedMappings: z.array(SsoAssignmentMappingSchema.extend({
    targetResourceId: z.string().nullable(),
    targetResourceIds: z.array(z.string().nullable()),
  })),
  assignments: z.array(z.object({
    roleId: z.string(),
    resourceType: z.literal('engine'),
    resourceId: z.string().nullable(),
    mappingId: z.string(),
  })),
});

export const SsoGroupMappingTestResponseSchema = z.object({
  matchedMappings: z.array(SsoGroupMappingSchema),
  memberships: z.array(z.object({
    groupId: z.string(),
    mappingId: z.string(),
  })),
});

// Types
export type AuthzPolicy = z.infer<typeof AuthzPolicySchema>;
export type AuthzCheckRequest = z.input<typeof AuthzCheckRequestSchema>;
export type AuthzCheckResponse = z.infer<typeof AuthzCheckResponseSchema>;
export type AuthzCheckBatchRequest = z.input<typeof AuthzCheckBatchRequestSchema>;
export type AuthzCheckBatchResponse = z.infer<typeof AuthzCheckBatchResponseSchema>;
export type PolicyCondition = z.infer<typeof PolicyConditionSchema>;
export type AuthzAuditLogEntry = z.infer<typeof AuthzAuditLogSchema>;
export type SsoProvider = z.infer<typeof SsoProviderSchema>;
export type LegacySsoProviderResponse = z.infer<typeof LegacySsoProviderResponseSchema>;
export type SsoClaimOperator = z.infer<typeof SsoClaimOperatorSchema>;
export type SsoClaimsMapping = z.infer<typeof SsoClaimsMappingSchema>;
export type PermissionCatalogEntry = z.infer<typeof PermissionCatalogEntrySchema>;
export type CustomPermissionCreate = z.infer<typeof CustomPermissionCreateSchema>;
export type EffectiveResourcePermissions = z.infer<typeof EffectiveResourcePermissionsSchema>;
export type CurrentUserPermissions = z.infer<typeof CurrentUserPermissionsSchema>;
export type RoleSummary = z.infer<typeof RoleSummarySchema>;
export type RoleDetail = z.infer<typeof RoleDetailSchema>;
export type CustomRoleCreate = z.infer<typeof CustomRoleCreateSchema>;
export type CustomRoleUpdate = z.infer<typeof CustomRoleUpdateSchema>;
export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>;
export type RoleAssignmentCreate = z.infer<typeof RoleAssignmentCreateSchema>;
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
export type ProjectEngineTarget = z.infer<typeof ProjectEngineTargetSchema>;
export type ProjectEngineTargetCreate = z.infer<typeof ProjectEngineTargetCreateSchema>;
export type ProjectEngineTargetUpdate = z.infer<typeof ProjectEngineTargetUpdateSchema>;
export type DeploymentEligibilityEvaluateRequest = z.infer<typeof DeploymentEligibilityEvaluateRequestSchema>;
export type DeploymentEligibilityEvaluateResponse = z.infer<typeof DeploymentEligibilityEvaluateResponseSchema>;
export type EffectiveAccessEvaluateRequest = z.infer<typeof EffectiveAccessEvaluateRequestSchema>;
export type EffectiveAccessEvaluateResponse = z.infer<typeof EffectiveAccessEvaluateResponseSchema>;
export type IdentityMappingRequest = z.infer<typeof IdentityMappingRequestSchema>;
export type IdentityMappingResponse = z.infer<typeof IdentityMappingResponseSchema>;
export type LegacyMappingCoverageFamily = z.infer<typeof LegacyMappingCoverageFamilySchema>;
export type LegacyMappingCoverageStatus = z.infer<typeof LegacyMappingCoverageStatusSchema>;
export type LegacyMappingCoverageVerification = z.infer<typeof LegacyMappingCoverageVerificationSchema>;
export type LegacyMappingCoverageItem = z.infer<typeof LegacyMappingCoverageItemSchema>;
export type LegacyMappingRetirementBlocker = z.infer<typeof LegacyMappingRetirementBlockerSchema>;
export type LegacyMappingRetirementReadiness = z.infer<typeof LegacyMappingRetirementReadinessSchema>;
export type LegacyMappingRetirementResult = z.infer<typeof LegacyMappingRetirementResultSchema>;
export type IdentityProviderResponse = z.infer<typeof IdentityProviderResponseSchema>;
export type IdentityProviderMembershipReplayResponse = z.infer<typeof IdentityProviderMembershipReplayResponseSchema>;
export type IdentityProviderExternalIdentityUnlinkResponse = z.infer<typeof IdentityProviderExternalIdentityUnlinkResponseSchema>;
export type IdentityProviderReconciliationPreview = z.infer<typeof IdentityProviderReconciliationPreviewSchema>;
export type IdentityProviderConnectionTestResponse = z.infer<typeof IdentityProviderConnectionTestResponseSchema>;
export type IdentityProviderMigrationReadinessResponse = z.infer<typeof IdentityProviderMigrationReadinessResponseSchema>;
export type LegacyIdentityProviderMigrationDraft = z.infer<typeof LegacyIdentityProviderMigrationDraftSchema>;
export type LegacyIdentityProviderCutoverResponse = z.infer<typeof LegacyIdentityProviderCutoverResponseSchema>;
export type RuntimeResource = z.infer<typeof RuntimeResourceSchema>;
export type RuntimeResourceSet = z.infer<typeof RuntimeResourceSetSchema>;
export type RuntimeResourceSetMaterializationResult = z.infer<typeof RuntimeResourceSetMaterializationResultSchema>;
export type SsoAssignmentMapping = z.infer<typeof SsoAssignmentMappingSchema>;
export type SsoMappingTestRequest = z.input<typeof SsoMappingTestRequestSchema>;
export type SsoPlatformMappingTestResponse = z.infer<typeof SsoPlatformMappingTestResponseSchema>;
export type SsoAssignmentMappingTestResponse = z.infer<typeof SsoAssignmentMappingTestResponseSchema>;
export type SsoEngineAccessSnapshot = z.infer<typeof SsoEngineAccessSnapshotSchema>;
export type SsoEngineAccessSnapshotStatus = z.infer<typeof SsoEngineAccessSnapshotStatusSchema>;
export type SsoEngineAccessSnapshotQuery = z.input<typeof SsoEngineAccessSnapshotQuerySchema>;
export type SsoSyncRunsQuery = z.input<typeof SsoSyncRunsQuerySchema>;
export type SsoSyncEventsQuery = z.input<typeof SsoSyncEventsQuerySchema>;
export type SsoSyncDiagnosticsRunRequest = z.infer<typeof SsoSyncDiagnosticsRunRequestSchema>;
export type SsoSyncDiagnosticsScanResult = z.infer<typeof SsoSyncDiagnosticsScanResultSchema>;
export type EngineAccessTransitionCleanupCandidate = z.infer<typeof EngineAccessTransitionCleanupCandidateSchema>;
export type EngineAccessTransitionCleanupPreview = z.infer<typeof EngineAccessTransitionCleanupPreviewSchema>;
export type EngineAccessTransitionCleanupApplyRequest = z.infer<typeof EngineAccessTransitionCleanupApplyRequestSchema>;
export type EngineAccessTransitionCleanupApplyResponse = z.infer<typeof EngineAccessTransitionCleanupApplyResponseSchema>;
export type BridgeDecisionRequest = z.infer<typeof BridgeDecisionRequestSchema>;
export type BridgeDecisionResponse = z.infer<typeof BridgeDecisionResponseSchema>;
export type SsoGroupMapping = z.infer<typeof SsoGroupMappingSchema>;
export type SsoGroupMappingTestResponse = z.infer<typeof SsoGroupMappingTestResponseSchema>;
export type AuthzResourceType = z.infer<typeof AuthzResourceTypeSchema>;
export type AuthzPrincipalType = z.infer<typeof AuthzPrincipalTypeSchema>;
export type AuthzActionRisk = z.infer<typeof AuthzActionRiskSchema>;
export type AuthzOpenApiExtension = z.infer<typeof AuthzOpenApiExtensionSchema>;
