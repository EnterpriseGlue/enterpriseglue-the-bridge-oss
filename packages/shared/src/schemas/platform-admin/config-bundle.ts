import { z } from 'zod';
import {
  ExternalEntitlementTypeSchema,
  HumanIdentityEntitlementTypeSchema,
  IdentityEntitlementMatchOperatorSchema,
  IdentityEntitlementSyncModeSchema,
} from './identity.js';
import {
  AccessAuthorityModeSchema,
  EngineOnboardingModeSchema,
  EngineRuntimeAuthorizationModeSchema,
  ProjectEngineTargetPolicyModeSchema,
} from './platform-settings.js';
import { EngineConnectionModeSchema } from '../mission-control/engine.js';

export const ENTERPRISEGLUE_CONFIG_API_VERSION = 'enterpriseglue.ai/v1alpha1' as const;
export const ENTERPRISEGLUE_CONFIG_KIND = 'EnterpriseGlueConfigBundle' as const;

const ConfigKeySchema = z.string()
  .min(3)
  .max(160)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/, 'Use a stable lowercase config key');
export const ConfigReferenceKeySchema = ConfigKeySchema;
const ReferenceKeySchema = ConfigReferenceKeySchema;
export const ConfigEngineReferenceSchema = z.object({ engineKey: ReferenceKeySchema }).strict();
export const ConfigEngineSetReferenceSchema = z.object({ engineSetKey: ReferenceKeySchema }).strict();
export const ConfigGroupReferenceSchema = z.object({ groupKey: ReferenceKeySchema.regex(/^group\./) }).strict();
export const ConfigRoleReferenceSchema = z.object({ roleKey: ReferenceKeySchema }).strict();
/** Projects do not yet have a stable config key, so bundles use immutable IDs. */
export const ConfigProjectReferenceSchema = z.object({
  id: z.string().uuid(),
}).strict();
const SecretReferenceSchema = z.string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z][A-Za-z0-9_.:/-]*$/, 'Secret references must be opaque identifiers');
const PermissionIdSchema = z.string().min(3).max(255).regex(/^[a-z][a-z0-9-]*(?::[a-z0-9-]+)+$/);
const LabelKeySchema = z.string().min(1).max(128).regex(/^[a-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/, 'Label keys must be stable identifiers and cannot contain whitespace');
const LabelSchema = z.record(LabelKeySchema, z.string().min(1).max(512));

const AllowedImportPaths = [
  './engines.json',
  './engine-sets.json',
  './runtime-resource-sets.json',
  './roles.json',
  './groups.json',
  './assignments.json',
  './identity-providers.json',
  './identity-mappings.json',
  './project-engine-targets.json',
] as const;

export const ConfigBundleModeSchema = z.enum(['additive', 'authoritative', 'preview_only']);
export const ConfigOwnershipModeSchema = z.enum(['config_locked', 'config_warn', 'manual']);

/** Public, sanitized receipts for hash-bound configuration apply and recovery. */
export const ConfigBundleBootstrapStatusSchema = z.object({
  mode: z.enum(['disabled', 'validate', 'apply']),
  status: z.enum(['disabled', 'validated', 'applied', 'failed']),
  hash: z.string().nullable(),
  message: z.string().nullable(),
  reconciliation: z.enum(['not_run', 'completed', 'pending']),
  secretPreflight: z.enum(['not_required', 'passed', 'failed']),
  issueCode: z.enum([
    'bundle_path_missing', 'bundle_read_failed', 'hash_mismatch', 'validation_failed',
    'secret_preflight_failed', 'tenant_scope_missing', 'apply_failed', 'identity_reconciliation_failed',
  ]).nullable(),
});

export const ConfigBundleIdentityReconciliationModeSchema = z.enum(['none', 'preview', 'apply']);
export const ConfigBundleIdentitySnapshotStatusSchema = z.enum(['not_needed', 'skipped', 'previewed', 'completed', 'truncated', 'failed']);
export const ConfigBundleRuntimeReconciliationStatusSchema = z.enum(['not_needed', 'queued', 'completed', 'failed']);

/**
 * Transport envelope accepted by the preview, diff, secret-preflight, and
 * archive-import routes. Semantic validation intentionally remains in the
 * compiler so every entry point gets the same diagnostics.
 */
export const ConfigBundleRequestSchema = z.object({
  bundle: z.unknown(),
  files: z.record(z.string(), z.unknown()),
}).strict();

/**
 * A deliberately narrow remote-source request. The backend accepts only
 * HTTPS raw-file URLs from the supported public Git hosts; it never clones a
 * repository or follows redirects supplied by the caller.
 */
export const ConfigBundleRemoteImportRequestSchema = z.object({
  url: z.string().url().max(2048),
}).strict();

export const ConfigBundleValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
  severity: z.literal('error'),
  remediation: z.string(),
  objectKey: z.string().optional(),
});

export const ConfigBundleRoleTemplateBaselineSchema = z.object({
  copyFromRoleKey: z.string(),
  fingerprint: z.string(),
  permissions: z.array(z.string()),
});

/** Shared sanitized result of an in-memory config compilation. */
export const ConfigBundlePreviewResponseSchema = z.object({
  valid: z.boolean(),
  canonicalHash: z.string().optional(),
  errors: z.array(ConfigBundleValidationIssueSchema),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  expandedRolePermissions: z.record(z.string(), z.array(z.string())).optional(),
  roleTemplateBaselines: z.record(z.string(), ConfigBundleRoleTemplateBaselineSchema).optional(),
});

export const ConfigBundleSecretReferenceStatusSchema = z.object({
  reference: z.string(),
  locations: z.array(z.string()),
  available: z.boolean(),
  reason: z.enum([
    'file_provider_not_configured',
    'file_outside_root',
    'file_unavailable',
    'environment_variable_missing',
  ]).optional(),
});

/** Secret availability only; this response must never contain secret bytes. */
export const ConfigBundleSecretPreflightResponseSchema = z.object({
  valid: z.boolean(),
  canonicalHash: z.string().optional(),
  availabilityHash: z.string().optional(),
  available: z.boolean(),
  errors: z.array(ConfigBundleValidationIssueSchema),
  references: z.array(ConfigBundleSecretReferenceStatusSchema),
});

export const ConfigBundleDiffOperationSchema = z.enum(['create', 'update', 'noop', 'archive', 'conflict']);
export const ConfigBundleDiffObjectTypeSchema = z.enum([
  'role', 'group', 'engine', 'engine_set', 'runtime_resource_set',
  'identity_provider', 'identity_mapping', 'project_engine_target', 'assignment',
]);
const ConfigBundleRuntimeResourceReferenceSchema = z.object({
  resourceKind: z.string(),
  resourceKey: z.string(),
  runtimeTenantId: z.string().nullable(),
});

export const ConfigBundleDiffChangeSchema = z.object({
  objectType: ConfigBundleDiffObjectTypeSchema,
  key: z.string(),
  operation: ConfigBundleDiffOperationSchema,
  reason: z.string(),
  currentId: z.string().optional(),
  permissionChanges: z.object({
    additions: z.array(z.string()),
    removals: z.array(z.string()),
    effectivePermissions: z.array(z.string()),
  }).optional(),
  affectedAssignmentCount: z.number().int().nonnegative().optional(),
  runtimeResourceChanges: z.object({
    matchedCount: z.number().int().nonnegative(),
    unmatchedCount: z.number().int().nonnegative(),
    currentlyMaterialized: z.array(ConfigBundleRuntimeResourceReferenceSchema),
    newlyMatched: z.array(ConfigBundleRuntimeResourceReferenceSchema),
    noLongerMatched: z.array(ConfigBundleRuntimeResourceReferenceSchema),
    unmatchedSelectors: z.array(z.string()),
    detailsTruncated: z.boolean(),
  }).optional(),
  identitySnapshotPreview: z.object({
    scanned: z.number().int().nonnegative(),
    matches: z.number().int().nonnegative(),
    nonMatches: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    truncated: z.boolean(),
    latestSnapshotAt: z.number().nullable(),
    warnings: z.array(z.string()),
  }).optional(),
});

export const ConfigBundleDiffWarningSchema = z.object({
  id: z.string(),
  message: z.string(),
  acknowledgementId: z.string().optional(),
});

export const ConfigBundleDiffResponseSchema = ConfigBundlePreviewResponseSchema.extend({
  changes: z.array(ConfigBundleDiffChangeSchema),
  warnings: z.array(ConfigBundleDiffWarningSchema),
  requiredAcknowledgements: z.array(z.string()),
  affectedPrincipals: z.object({
    affectedGroupCount: z.number().int().nonnegative(),
    affectedUserCount: z.number().int().nonnegative(),
    externalIdentityMappingChangeCount: z.number().int().nonnegative(),
  }),
});

export const ConfigBundleApplyRequestSchema = ConfigBundleRequestSchema.extend({
  expectedPreviewHash: z.string().min(1),
  expectedSecretPreflightHash: z.string().min(1).max(255).optional(),
  acknowledgements: z.array(z.string().min(1).max(500)).max(100).optional(),
  idempotencyKey: z.string().min(8).max(160).optional(),
  expectedTenantScope: z.string().min(1).max(255).optional(),
  identityReconciliationMode: ConfigBundleIdentityReconciliationModeSchema.optional(),
});

export const ConfigBundleIdentitySnapshotSchema = z.object({
  mode: ConfigBundleIdentityReconciliationModeSchema,
  status: ConfigBundleIdentitySnapshotStatusSchema,
  providerCount: z.number().int().nonnegative(),
  scanned: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const ConfigBundleRuntimeReconciliationSchema = z.object({
  status: ConfigBundleRuntimeReconciliationStatusSchema,
  taskId: z.string().nullable(),
  engineSetCount: z.number().int().nonnegative(),
  runtimeResourceSetCount: z.number().int().nonnegative(),
  engineCount: z.number().int().nonnegative(),
});

export const ConfigBundleApplyReconciliationSchema = z.object({
  status: z.literal('completed'),
  engineSetCount: z.number().int().nonnegative(),
  runtimeResourceSetCount: z.number().int().nonnegative(),
  engineCount: z.number().int().nonnegative(),
  identitySnapshot: ConfigBundleIdentitySnapshotSchema,
  runtimeReconciliation: ConfigBundleRuntimeReconciliationSchema,
});

export const ConfigBundleApplyRunChangeSchema = z.object({
  objectType: z.string(),
  key: z.string(),
  operation: z.string(),
  reason: z.string(),
});

export const ConfigBundleApplyResultSchema = z.object({
  canonicalHash: z.string(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  changes: z.array(ConfigBundleDiffChangeSchema),
  reconciliation: ConfigBundleApplyReconciliationSchema,
  idempotent: z.boolean().optional(),
  applyRunId: z.string().optional(),
});

export const ConfigBundleApplyRunSchema = z.object({
  id: z.string(),
  bundleKey: z.string(),
  bundleApiVersion: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  actorId: z.string().nullable(),
  status: z.enum(['pending', 'succeeded', 'failed']),
  errorMessage: z.string().nullable(),
  completedAt: z.number().nullable(),
  createdAt: z.number(),
  canonicalHash: z.string(),
  created: z.number().int().nonnegative().optional(),
  updated: z.number().int().nonnegative().optional(),
  archived: z.number().int().nonnegative().optional(),
  reconciliation: ConfigBundleApplyReconciliationSchema.optional(),
  mode: ConfigBundleModeSchema.nullable().optional(),
  changes: z.array(ConfigBundleDiffChangeSchema).optional(),
  bootstrap: ConfigBundleBootstrapStatusSchema.optional(),
});

export const ConfigBundleIdentityReplayTaskSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  syncRunId: z.string().nullable(),
  status: z.enum(['queued', 'running', 'completed', 'cancelled']),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.number().int().nullable(),
  scanned: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  completedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const ConfigBundleRuntimeReconciliationTaskSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'completed']),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.number().int().nullable(),
  engineSetIds: z.array(z.string()),
  runtimeResourceSetIds: z.array(z.string()),
  engineIds: z.array(z.string()),
  lastError: z.string().nullable(),
  completedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const ConfigBundleSettingsSchema = z.object({
  engineAccessAuthority: AccessAuthorityModeSchema.default('manual'),
  projectAccessAuthority: AccessAuthorityModeSchema.default('manual'),
  engineOnboardingMode: EngineOnboardingModeSchema.default('manual_allowed'),
  projectEngineTargetMode: ProjectEngineTargetPolicyModeSchema.default('manual_allowed'),
  // Other modes are deliberately not accepted until their corresponding
  // engine-native synchronization design is implemented.
  engineRuntimeAuthorizationMode: EngineRuntimeAuthorizationModeSchema.default('enterpriseglue_authoritative'),
}).strict();

export const EnterpriseGlueConfigBundleSchema = z.object({
  apiVersion: z.literal(ENTERPRISEGLUE_CONFIG_API_VERSION),
  kind: z.literal(ENTERPRISEGLUE_CONFIG_KIND),
  metadata: z.object({
    key: ConfigKeySchema,
    description: z.string().max(2000).optional(),
    owner: z.string().min(1).max(255),
  }).strict(),
  tenantKey: ReferenceKeySchema,
  mode: ConfigBundleModeSchema,
  settings: ConfigBundleSettingsSchema,
  imports: z.array(z.enum(AllowedImportPaths)).min(1),
}).strict().superRefine((bundle, ctx) => {
  const duplicates = bundle.imports.filter((entry, index) => bundle.imports.indexOf(entry) !== index);
  if (duplicates.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['imports'],
      message: `Duplicate imports are not allowed: ${Array.from(new Set(duplicates)).join(', ')}`,
    });
  }
  for (const importedPath of bundle.imports) {
    if (importedPath.includes('..') || importedPath.startsWith('./test/') || importedPath.includes('identity-mocks')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['imports'],
        message: 'Production bundles cannot import test fixtures or traversal paths',
      });
    }
  }
});

function uniqueKeys<T extends { key: string }>(items: T[], ctx: z.RefinementCtx, path: string): void {
  const keys = new Set<string>();
  items.forEach((item, index) => {
    if (keys.has(item.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path, index, 'key'],
        message: `Duplicate config key: ${item.key}`,
      });
    }
    keys.add(item.key);
  });
}

export const ConfigRoleScopeSchema = z.enum(['platform', 'project', 'engine', 'engine_runtime_resource']);

const ExplicitConfigRoleSchema = z.object({
  key: ConfigKeySchema.regex(/^custom\./, 'Config bundles may create only custom.* roles'),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  scope: ConfigRoleScopeSchema,
  permissions: z.array(PermissionIdSchema).min(1),
  ownershipMode: ConfigOwnershipModeSchema.optional(),
}).strict();

const TemplateConfigRoleSchema = z.object({
  key: ConfigKeySchema.regex(/^custom\./, 'Config bundles may create only custom.* roles'),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  scope: ConfigRoleScopeSchema,
  copyFromRoleKey: ReferenceKeySchema,
  addPermissions: z.array(PermissionIdSchema).optional().default([]),
  removePermissions: z.array(PermissionIdSchema).optional().default([]),
  ownershipMode: ConfigOwnershipModeSchema.optional(),
}).strict().superRefine((role, ctx) => {
  if (role.addPermissions.length === 0 && role.removePermissions.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['copyFromRoleKey'],
      message: 'A copied role must add or remove at least one permission',
    });
  }
  const overlap = role.addPermissions.filter((permission) => role.removePermissions.includes(permission));
  if (overlap.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['removePermissions'],
      message: `Permissions cannot be both added and removed: ${overlap.join(', ')}`,
    });
  }
});

export const ConfigRoleSchema = z.union([ExplicitConfigRoleSchema, TemplateConfigRoleSchema]);
export const ConfigRolesFileSchema = z.object({
  roles: z.array(ConfigRoleSchema),
}).strict().superRefine((file, ctx) => uniqueKeys(file.roles, ctx, 'roles'));

export const ConfigGroupSchema = z.object({
  key: ConfigKeySchema.regex(/^group\./, 'Group keys must use the group.* namespace'),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  ownershipMode: ConfigOwnershipModeSchema.optional(),
}).strict();
export const ConfigGroupsFileSchema = z.object({
  groups: z.array(ConfigGroupSchema),
}).strict().superRefine((file, ctx) => uniqueKeys(file.groups, ctx, 'groups'));

const ConfigEngineAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('basic'), username: z.string().min(1).max(255), passwordRef: SecretReferenceSchema }).strict(),
  z.object({ type: z.literal('bearer'), tokenRef: SecretReferenceSchema }).strict(),
  z.object({
    type: z.literal('oauth2-client-credentials'),
    username: z.string().min(1).max(255),
    passwordRef: SecretReferenceSchema,
    tokenUrl: z.string().url(),
    scopes: z.string().min(1).max(2000).optional(),
    audience: z.string().min(1).max(2000).optional(),
  }).strict(),
  z.object({ type: z.literal('none') }).strict(),
]);

export const ConfigEngineSchema = z.object({
  key: ConfigKeySchema.regex(/^engine[._-]/, 'Engine keys must begin with engine'),
  name: z.string().min(1).max(255),
  type: z.enum(['ion', 'operaton', 'camunda7']),
  baseUrl: z.string().url(),
  externalId: z.string().min(1).max(255).optional(),
  labels: LabelSchema.default({}),
  auth: ConfigEngineAuthSchema,
  connectionMode: EngineConnectionModeSchema.default('direct'),
  runtimeAccessScope: z.enum(['engine_wide', 'resource_aware']).default('engine_wide'),
  deploymentIntegration: z.enum(['enterpriseglue_proxy', 'direct_engine']).default('enterpriseglue_proxy'),
  metadataDiscoveryEnabled: z.boolean().default(true),
  deploymentDiscoveryEnabled: z.boolean().default(true),
  reconciliationIntervalSeconds: z.number().int().min(60).max(86400).default(300),
  pipelineReceiptEnabled: z.boolean().default(true),
  version: z.string().max(255).nullable().optional(),
  environmentTagId: z.string().uuid().nullable().optional(),
  ownershipMode: ConfigOwnershipModeSchema.optional(),
}).strict().superRefine((engine, ctx) => {
  if (engine.auth.type === 'none' && engine.connectionMode !== 'customer_sidecar') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['auth', 'type'],
      message: 'Credentialless endpoint authentication is allowed only for customer_sidecar engines',
    });
  }
});
export const ConfigEnginesFileSchema = z.object({
  engines: z.array(ConfigEngineSchema),
}).strict().superRefine((file, ctx) => uniqueKeys(file.engines, ctx, 'engines'));

export const ConfigEngineSetSelectorSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }).strict(),
  z.object({ mode: z.literal('engine_ids'), engineKeys: z.array(ReferenceKeySchema).min(1) }).strict(),
  z.object({ mode: z.literal('labels'), labels: LabelSchema.refine((labels) => Object.keys(labels).length > 0), labelMatch: z.enum(['all', 'any']).default('all') }).strict(),
]);
export const ConfigEngineSetSchema = z.object({
  key: ConfigKeySchema.regex(/^engines\./, 'Engine Set keys must use the engines.* namespace'),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  selector: ConfigEngineSetSelectorSchema,
  ownershipMode: ConfigOwnershipModeSchema.optional(),
}).strict();
export const ConfigEngineSetsFileSchema = z.object({
  engineSets: z.array(ConfigEngineSetSchema),
}).strict().superRefine((file, ctx) => uniqueKeys(file.engineSets, ctx, 'engineSets'));

export const RuntimeResourceKindSchema = z.enum(['process_definition', 'decision_definition']);
export const ConfigRuntimeResourceSetSchema = z.object({
  key: ConfigKeySchema.regex(/^runtime\./, 'Runtime resource set keys must use the runtime.* namespace'),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  engineRef: ConfigEngineReferenceSchema,
  resourceKind: RuntimeResourceKindSchema,
  selector: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('keys'), keys: z.array(z.string().min(1).max(255)).min(1) }).strict(),
    z.object({ mode: z.literal('prefix'), prefix: z.string().min(1).max(255) }).strict(),
    z.object({ mode: z.literal('labels'), labels: LabelSchema.refine((labels) => Object.keys(labels).length > 0), labelMatch: z.enum(['all', 'any']).default('all') }).strict(),
    z.object({ mode: z.literal('project_lineage'), projectRef: ConfigProjectReferenceSchema }).strict(),
  ]),
  runtimeTenantId: z.string().min(1).max(255).optional(),
  ownershipMode: ConfigOwnershipModeSchema.optional(),
}).strict();
export const ConfigRuntimeResourceSetsFileSchema = z.object({
  runtimeResourceSets: z.array(ConfigRuntimeResourceSetSchema),
}).strict().superRefine((file, ctx) => uniqueKeys(file.runtimeResourceSets, ctx, 'runtimeResourceSets'));

const ConfigAssignmentScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('platform') }).strict(),
  z.object({ type: z.literal('project'), projectRef: ConfigProjectReferenceSchema }).strict(),
  z.object({ type: z.literal('engine'), engineKey: ReferenceKeySchema }).strict(),
  z.object({ type: z.literal('engine_set'), engineSetKey: ReferenceKeySchema }).strict(),
  z.object({ type: z.literal('engine_runtime_resource'), engineKey: ReferenceKeySchema, resourceKind: RuntimeResourceKindSchema, resourceKey: z.string().min(1).max(255), runtimeTenantId: z.string().min(1).max(255).optional() }).strict(),
  z.object({ type: z.literal('engine_runtime_resource_set'), runtimeResourceSetKey: ReferenceKeySchema }).strict(),
]);

export const ConfigAssignmentSchema = z.object({
  key: ConfigKeySchema.optional(),
  principal: z.discriminatedUnion('type', [
    z.object({ type: z.literal('group'), key: ReferenceKeySchema }).strict(),
    z.object({ type: z.literal('user'), id: z.string().uuid() }).strict(),
    z.object({ type: z.literal('api_client'), id: z.string().uuid() }).strict(),
    z.object({ type: z.literal('service_account'), id: z.string().uuid() }).strict(),
  ]),
  roleKey: ReferenceKeySchema,
  scope: ConfigAssignmentScopeSchema,
  expiresAt: z.number().int().positive().optional(),
  ownershipMode: ConfigOwnershipModeSchema.optional(),
}).strict();
export const ConfigAssignmentsFileSchema = z.object({
  assignments: z.array(ConfigAssignmentSchema),
}).strict().superRefine((file, ctx) => {
  const keyed = file.assignments.filter((assignment): assignment is z.infer<typeof ConfigAssignmentSchema> & { key: string } => Boolean(assignment.key));
  uniqueKeys(keyed, ctx, 'assignments');
});

const IdentityProviderSyncSchema = z.object({
  triggers: z.array(z.enum(['login', 'scheduled', 'manual'])).min(1),
  intervalSeconds: z.number().int().min(60).max(86_400).optional(),
  requiredForLogin: z.boolean().default(true),
  incompleteEntitlements: z.enum(['fail_closed', 'preserve_previous']).default('fail_closed'),
  connectorCapability: z.enum(['claim_only', 'ldap_directory', 'scim', 'graph']).default('claim_only'),
  scheduled: z.boolean().default(false),
}).strict();

const CommonIdentityProviderSchema = z.object({
  key: ConfigKeySchema,
  enabled: z.boolean().default(true),
  authenticationMode: z.enum(['direct', 'claims_only']).default('claims_only'),
  allowVerifiedEmailLinking: z.boolean().default(false),
  authorizationAttributeKeys: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/)).max(20).optional(),
  directoryTenantId: z.string().min(1).max(255).optional(),
  sync: IdentityProviderSyncSchema,
  ownershipMode: ConfigOwnershipModeSchema.optional(),
});

export const ConfigIdentityProviderSchema = z.discriminatedUnion('type', [
  CommonIdentityProviderSchema.extend({
    type: z.literal('oidc'),
    oidc: z.object({
      issuerUrl: z.string().url(),
      clientId: z.string().min(1).max(255),
      clientSecretRef: SecretReferenceSchema.optional(),
      callbackUrl: z.string().url(),
      scopes: z.array(z.string().min(1).max(255)).min(1),
      groupClaim: z.string().min(1).max(255).optional(),
      expectedAudience: z.string().min(1).max(2000).optional(),
    }).strict(),
  }).strict(),
  CommonIdentityProviderSchema.extend({
    type: z.literal('saml'),
    saml: z.object({
      metadataUrl: z.string().url().optional(),
      metadataXmlRef: SecretReferenceSchema.optional(),
      entityId: z.string().min(1).max(2000),
      callbackUrl: z.string().url(),
      ssoUrl: z.string().url(),
      nameIdAttribute: z.string().min(1).max(255),
      emailAttribute: z.string().min(1).max(255).optional(),
      groupAttribute: z.string().min(1).max(255).optional(),
      signingCertificateRef: SecretReferenceSchema,
      signatureAlgorithm: z.enum(['sha256', 'sha512']).default('sha256'),
    }).strict(),
  }).strict(),
  CommonIdentityProviderSchema.extend({
    type: z.literal('ldap'),
    authenticationMode: z.enum(['direct', 'claims_only']).default('direct'),
    ldap: z.object({
      url: z.string().url().refine((url) => url.startsWith('ldaps://'), 'LDAP URLs must use LDAPS'),
      bindDn: z.string().min(1).max(2000),
      bindPasswordRef: SecretReferenceSchema,
      userBaseDn: z.string().min(1).max(2000),
      userSearchFilter: z.string().min(1).max(2000),
      userEnumerationFilter: z.string().min(1).max(2000).default('(objectClass=person)'),
      pageSize: z.number().int().min(1).max(1000).default(200),
      subjectAttribute: z.string().min(1).max(255).default('entryUUID'),
      emailAttribute: z.string().min(1).max(255).default('mail'),
      groupBaseDn: z.string().min(1).max(2000),
      groupIdAttribute: z.string().min(1).max(255),
      membershipMode: z.enum(['memberOf', 'group_search']),
      nestedGroups: z.boolean().default(false),
      tlsTrustRef: SecretReferenceSchema.optional(),
    }).strict(),
  }).strict(),
]);
export const ConfigIdentityProvidersFileSchema = z.object({
  identityProviders: z.array(ConfigIdentityProviderSchema),
}).strict().superRefine((file, ctx) => uniqueKeys(file.identityProviders, ctx, 'identityProviders'));

export const ConfigIdentityMappingSchema = z.object({
  key: ConfigKeySchema,
  providerKey: ReferenceKeySchema,
  source: z.object({
    type: HumanIdentityEntitlementTypeSchema,
    externalId: z.string().min(1).max(2000).optional(),
    operator: IdentityEntitlementMatchOperatorSchema.default('exact'),
  }).strict(),
  targetGroupKey: ReferenceKeySchema.regex(/^group\./, 'Identity mappings must target an internal group key'),
  syncMode: IdentityEntitlementSyncModeSchema.default('authoritative'),
  ownershipMode: ConfigOwnershipModeSchema.optional(),
}).strict().superRefine((mapping, ctx) => {
  if (mapping.source.operator !== 'exists' && !mapping.source.externalId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source', 'externalId'], message: 'externalId is required unless operator is exists' });
  }
  if (mapping.source.operator === 'exists' && mapping.source.externalId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source', 'externalId'], message: 'externalId is not allowed with the exists operator' });
  }
});
export const ConfigIdentityMappingsFileSchema = z.object({
  identityMappings: z.array(ConfigIdentityMappingSchema),
}).strict().superRefine((file, ctx) => uniqueKeys(file.identityMappings, ctx, 'identityMappings'));

export const ConfigProjectEngineTargetSchema = z.object({
  key: ConfigKeySchema.optional(),
  projectRef: ConfigProjectReferenceSchema,
  engineRef: ConfigEngineReferenceSchema,
  status: z.enum(['active', 'disabled']).default('active'),
  allowManualDeploy: z.boolean().default(false),
  allowCiDeploy: z.boolean().default(false),
  allowApiDeploy: z.boolean().default(false),
  allowImport: z.boolean().default(false),
  ownershipMode: ConfigOwnershipModeSchema.optional(),
  transferOwnership: z.object({
    reason: z.string().min(8).max(1000),
  }).strict().optional(),
}).strict().refine((target) => target.allowManualDeploy || target.allowCiDeploy || target.allowApiDeploy || target.allowImport, {
  message: 'At least one deployment mode must be allowed',
});
export const ConfigProjectEngineTargetsFileSchema = z.object({
  projectEngineTargets: z.array(ConfigProjectEngineTargetSchema),
}).strict().superRefine((file, ctx) => {
  const seenPairs = new Map<string, number>();
  const seenKeys = new Map<string, number>();
  file.projectEngineTargets.forEach((target, index) => {
    const pair = `${target.projectRef.id}:${target.engineRef.engineKey}`;
    const duplicatePairIndex = seenPairs.get(pair);
    if (duplicatePairIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['projectEngineTargets', index, 'engineRef', 'engineKey'],
        message: `Duplicate project-engine target pair also declared at projectEngineTargets.${duplicatePairIndex}`,
      });
    } else {
      seenPairs.set(pair, index);
    }

    if (!target.key) return;
    const duplicateKeyIndex = seenKeys.get(target.key);
    if (duplicateKeyIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['projectEngineTargets', index, 'key'],
        message: `Duplicate project-engine target key also declared at projectEngineTargets.${duplicateKeyIndex}`,
      });
    } else {
      seenKeys.set(target.key, index);
    }
  });
});

/** Test-harness input only. Production bundle manifests never import this shape. */
export const IdentityMockFixturesSchema = z.object({
  providerKey: ReferenceKeySchema,
  subjects: z.array(z.object({
    subjectId: z.string().min(1).max(512),
    email: z.string().email().optional(),
    entitlements: z.array(z.object({ type: ExternalEntitlementTypeSchema, externalId: z.string().min(1).max(2000) }).strict()),
  }).strict()),
}).strict();

export type EnterpriseGlueConfigBundle = z.infer<typeof EnterpriseGlueConfigBundleSchema>;
export type ConfigBundleRequest = z.infer<typeof ConfigBundleRequestSchema>;
export type ConfigBundleRemoteImportRequest = z.infer<typeof ConfigBundleRemoteImportRequestSchema>;
export type ConfigBundleApplyRequest = z.infer<typeof ConfigBundleApplyRequestSchema>;
export type ConfigBundleValidationIssue = z.infer<typeof ConfigBundleValidationIssueSchema>;
export type ConfigBundlePreviewResponse = z.infer<typeof ConfigBundlePreviewResponseSchema>;
export type ConfigBundleSecretReferenceStatus = z.infer<typeof ConfigBundleSecretReferenceStatusSchema>;
export type ConfigBundleSecretPreflightResponse = z.infer<typeof ConfigBundleSecretPreflightResponseSchema>;
export type ConfigBundleDiffChange = z.infer<typeof ConfigBundleDiffChangeSchema>;
export type ConfigBundleDiffWarning = z.infer<typeof ConfigBundleDiffWarningSchema>;
export type ConfigBundleDiffResponse = z.infer<typeof ConfigBundleDiffResponseSchema>;
export type ConfigBundleSettings = z.infer<typeof ConfigBundleSettingsSchema>;
export type ConfigBundleBootstrapStatus = z.infer<typeof ConfigBundleBootstrapStatusSchema>;
export type ConfigBundleIdentityReconciliationMode = z.infer<typeof ConfigBundleIdentityReconciliationModeSchema>;
export type ConfigBundleIdentitySnapshot = z.infer<typeof ConfigBundleIdentitySnapshotSchema>;
export type ConfigBundleRuntimeReconciliation = z.infer<typeof ConfigBundleRuntimeReconciliationSchema>;
export type ConfigBundleApplyReconciliation = z.infer<typeof ConfigBundleApplyReconciliationSchema>;
export type ConfigBundleApplyResult = z.infer<typeof ConfigBundleApplyResultSchema>;
export type ConfigBundleApplyRunChange = z.infer<typeof ConfigBundleApplyRunChangeSchema>;
export type ConfigBundleApplyRun = z.infer<typeof ConfigBundleApplyRunSchema>;
export type ConfigBundleIdentityReplayTask = z.infer<typeof ConfigBundleIdentityReplayTaskSchema>;
export type ConfigBundleRuntimeReconciliationTask = z.infer<typeof ConfigBundleRuntimeReconciliationTaskSchema>;
export type ConfigRole = z.infer<typeof ConfigRoleSchema>;
export type ConfigIdentityProvider = z.infer<typeof ConfigIdentityProviderSchema>;
export type ConfigIdentityMapping = z.infer<typeof ConfigIdentityMappingSchema>;
export type ConfigEngineReference = z.infer<typeof ConfigEngineReferenceSchema>;
export type ConfigEngineSetReference = z.infer<typeof ConfigEngineSetReferenceSchema>;
export type ConfigGroupReference = z.infer<typeof ConfigGroupReferenceSchema>;
export type ConfigRoleReference = z.infer<typeof ConfigRoleReferenceSchema>;
export type ConfigProjectReference = z.infer<typeof ConfigProjectReferenceSchema>;
