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
  conditions: p.conditions,
  isActive: p.isActive,
  createdAt: Number(p.createdAt),
  updatedAt: Number(p.updatedAt),
  createdById: p.createdById ?? undefined,
}));

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
  tenantId: l.tenantId ?? undefined,
  userId: l.userId,
  action: l.action,
  resourceType: l.resourceType ?? undefined,
  resourceId: l.resourceId ?? undefined,
  decision: l.decision as 'allow' | 'deny',
  reason: l.reason,
  policyId: l.policyId ?? undefined,
  context: l.context,
  ipAddress: l.ipAddress ?? undefined,
  userAgent: l.userAgent ?? undefined,
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

// SSO Provider - Insert schema
export const SsoProviderInsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  type: z.enum(['microsoft', 'google', 'saml', 'oidc']),
  defaultRole: z.enum(['admin', 'user']).optional(),
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
  permissionCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const RoleDetailSchema = RoleSummarySchema.extend({
  permissions: z.array(z.string()),
});

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
  source: z.enum(['legacy', 'manual', 'sso', 'api', 'system', 'automation', 'bootstrap']),
  sourceMappingId: z.string().nullable(),
  sourceRef: z.string().nullable(),
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

export const AuthzGroupSourceSchema = z.enum(['manual', 'sso', 'api', 'automation', 'system']);

export const AuthzGroupSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  source: AuthzGroupSourceSchema,
  sourceRef: z.string().nullable(),
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
  scopes: z.array(z.enum(['engine:register', 'deployment:execute'])).min(1).optional(),
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
export const ExternalEngineCapabilitiesSchema = z.object({
  operations: z.array(z.string()).optional(),
  supportLevel: z.string().nullable().optional(),
  compatibilityProfile: z.string().nullable().optional(),
}).passthrough();

export const ExternalEngineCapabilityDiagnosticsSchema = z.object({
  status: EngineCapabilityStatusSchema,
  expectedOperations: z.array(z.string()),
  reportedOperations: z.array(z.string()),
  missingOperations: z.array(z.string()),
  extraOperations: z.array(z.string()),
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
  source: z.enum(['manual', 'sso', 'api', 'external', 'system', 'automation']),
  sourceRef: z.string().nullable(),
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
export const ProjectEngineTargetSourceSchema = z.enum(['manual', 'legacy', 'ci', 'api', 'import', 'deployment_history', 'external', 'system', 'automation']);
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
});

export const EffectiveAccessEvaluateResponseSchema = z.object({
  allowed: z.boolean(),
  decision: z.enum(['allow', 'deny']),
  reason: z.string(),
  policyId: z.string().optional(),
  policyName: z.string().optional(),
  baseAllowed: z.boolean(),
  baseReason: z.string(),
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
    permission: z.string().optional(),
  })),
});

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

// Types
export type AuthzPolicy = z.infer<typeof AuthzPolicySchema>;
export type AuthzAuditLogEntry = z.infer<typeof AuthzAuditLogSchema>;
export type SsoProvider = z.infer<typeof SsoProviderSchema>;
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
export type AuthzGroup = z.infer<typeof AuthzGroupSchema>;
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
export type ExternalEngineRegistration = z.infer<typeof ExternalEngineRegistrationSchema>;
export type ExternalEngineRegistrationAuditEntry = z.infer<typeof ExternalEngineRegistrationAuditEntrySchema>;
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
export type SsoAssignmentMapping = z.infer<typeof SsoAssignmentMappingSchema>;
export type SsoEngineAccessSnapshot = z.infer<typeof SsoEngineAccessSnapshotSchema>;
export type SsoEngineAccessSnapshotStatus = z.infer<typeof SsoEngineAccessSnapshotStatusSchema>;
export type EngineAccessTransitionCleanupPreview = z.infer<typeof EngineAccessTransitionCleanupPreviewSchema>;
export type EngineAccessTransitionCleanupApplyRequest = z.infer<typeof EngineAccessTransitionCleanupApplyRequestSchema>;
export type EngineAccessTransitionCleanupApplyResponse = z.infer<typeof EngineAccessTransitionCleanupApplyResponseSchema>;
export type BridgeDecisionRequest = z.infer<typeof BridgeDecisionRequestSchema>;
export type BridgeDecisionResponse = z.infer<typeof BridgeDecisionResponseSchema>;
export type SsoGroupMapping = z.infer<typeof SsoGroupMappingSchema>;
export type AuthzResourceType = z.infer<typeof AuthzResourceTypeSchema>;
export type AuthzPrincipalType = z.infer<typeof AuthzPrincipalTypeSchema>;
export type AuthzActionRisk = z.infer<typeof AuthzActionRiskSchema>;
export type AuthzOpenApiExtension = z.infer<typeof AuthzOpenApiExtensionSchema>;
