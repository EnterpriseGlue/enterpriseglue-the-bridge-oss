import { z } from 'zod';
import {
  ExternalEntitlementTypeSchema,
  HumanIdentityEntitlementTypeSchema,
  IdentityEntitlementMatchOperatorSchema,
  IdentityEntitlementSyncModeSchema,
  IdentityProviderSyncConfigurationSchema,
  LdapIdentityProviderConfigurationSchema,
  OidcIdentityProviderConfigurationSchema,
  SamlIdentityProviderConfigurationSchema,
} from './identity.js';
import {
  AccessAuthorityModeSchema,
  EngineOnboardingModeSchema,
  EngineRuntimeAuthorizationModeSchema,
  ProjectEngineTargetPolicyModeSchema,
} from './platform-settings.js';
import {
  EngineConnectionModeSchema,
  EngineTenantMappingStrategySchema,
  EngineTenantReferenceSchema,
  EngineTenancyConfigurationSchema,
} from '../mission-control/engine.js';

export const ENTERPRISEGLUE_CONFIG_API_VERSION_V1ALPHA1 = 'enterpriseglue.ai/v1alpha1' as const;
export const ENTERPRISEGLUE_CONFIG_API_VERSION_V1BETA1 = 'enterpriseglue.ai/v1beta1' as const;
/** Default version for newly generated bundles and exports. */
export const ENTERPRISEGLUE_CONFIG_API_VERSION = ENTERPRISEGLUE_CONFIG_API_VERSION_V1BETA1;
export const ENTERPRISEGLUE_CONFIG_KIND = 'EnterpriseGlueConfigBundle' as const;
export const EnterpriseGlueConfigApiVersionSchema = z.enum([
  ENTERPRISEGLUE_CONFIG_API_VERSION_V1ALPHA1,
  ENTERPRISEGLUE_CONFIG_API_VERSION_V1BETA1,
]);

export const ConfigBundleContractWarningSchema = z.object({
  code: z.enum([
    'CONFIG_BUNDLE_V1ALPHA1_DEPRECATED',
    'CONFIG_BUNDLE_V1ALPHA1_GOVERNANCE_ALIASES_NORMALIZED',
  ]),
  message: z.string(),
}).strict();

export const ConfigBundleContractMetadataSchema = z.object({
  inputApiVersion: EnterpriseGlueConfigApiVersionSchema,
  normalizedApiVersion: z.literal(ENTERPRISEGLUE_CONFIG_API_VERSION_V1BETA1),
  warnings: z.array(ConfigBundleContractWarningSchema),
}).strict();

export function configBundleContractMetadataForApiVersion(
  apiVersion: z.infer<typeof EnterpriseGlueConfigApiVersionSchema>,
  governanceAliasesPresent = apiVersion === ENTERPRISEGLUE_CONFIG_API_VERSION_V1ALPHA1,
): z.infer<typeof ConfigBundleContractMetadataSchema> {
  const warnings: z.infer<typeof ConfigBundleContractWarningSchema>[] = [];
  if (apiVersion === ENTERPRISEGLUE_CONFIG_API_VERSION_V1ALPHA1) {
    warnings.push({
      code: 'CONFIG_BUNDLE_V1ALPHA1_DEPRECATED',
      message: 'enterpriseglue.ai/v1alpha1 is deprecated; migrate this bundle to enterpriseglue.ai/v1beta1.',
    });
    if (governanceAliasesPresent) {
      warnings.push({
        code: 'CONFIG_BUNDLE_V1ALPHA1_GOVERNANCE_ALIASES_NORMALIZED',
        message: 'v1alpha1 settings aliases were normalized to the v1beta1 governance contract.',
      });
    }
  }
  return {
    inputApiVersion: apiVersion,
    normalizedApiVersion: ENTERPRISEGLUE_CONFIG_API_VERSION_V1BETA1,
    warnings,
  };
}

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
  './engine-backstop-mappings.json',
  './engine-tenant-mappings.json',
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
  contract: ConfigBundleContractMetadataSchema.optional(),
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
  code: z.string().optional(),
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
  contract: ConfigBundleContractMetadataSchema.optional(),
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
    'docker_secret_provider_not_configured',
    'docker_secret_invalid_name',
    'docker_secret_unavailable',
    'environment_variable_missing',
  ]).optional(),
});

/** Secret availability only; this response must never contain secret bytes. */
export const ConfigBundleSecretPreflightResponseSchema = z.object({
  valid: z.boolean(),
  canonicalHash: z.string().optional(),
  contract: ConfigBundleContractMetadataSchema.optional(),
  availabilityHash: z.string().optional(),
  available: z.boolean(),
  errors: z.array(ConfigBundleValidationIssueSchema),
  references: z.array(ConfigBundleSecretReferenceStatusSchema),
});

export const ConfigBundleDiffOperationSchema = z.enum(['create', 'update', 'noop', 'archive', 'conflict']);
export const ConfigBundleDiffObjectTypeSchema = z.enum([
  'role', 'group', 'engine', 'engine_tenant_mapping', 'engine_set', 'runtime_resource_set',
  'engine_backstop_mapping', 'identity_provider', 'identity_mapping', 'project_engine_target', 'assignment',
  'platform_settings',
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

/**
 * Non-secret, bounded CI provenance attached to a reviewed configuration apply.
 * It identifies the repository artifact being applied without accepting a
 * human actor override or any credential material.
 */
export const ConfigBundleCiProvenanceSchema = z.object({
  repository: z.string().min(3).max(255).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'Use an owner/repository identifier'),
  revision: z.string().regex(/^[0-9a-f]{40}$/i, 'Use a full immutable commit SHA'),
  workflowRunId: z.string().min(1).max(64).regex(/^[0-9]+$/, 'Use a numeric workflow run id'),
  workflow: z.string().min(1).max(160).optional(),
}).strict();

export const ConfigBundleApplyRequestSchema = ConfigBundleRequestSchema.extend({
  expectedPreviewHash: z.string().min(1),
  expectedSecretPreflightHash: z.string().min(1).max(255).optional(),
  acknowledgements: z.array(z.string().min(1).max(500)).max(100).optional(),
  idempotencyKey: z.string().min(8).max(160).optional(),
  expectedTenantScope: z.string().min(1).max(255).optional(),
  identityReconciliationMode: ConfigBundleIdentityReconciliationModeSchema.optional(),
  ciProvenance: ConfigBundleCiProvenanceSchema.optional(),
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
  contract: ConfigBundleContractMetadataSchema.optional(),
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
  contract: ConfigBundleContractMetadataSchema.optional(),
  created: z.number().int().nonnegative().optional(),
  updated: z.number().int().nonnegative().optional(),
  archived: z.number().int().nonnegative().optional(),
  reconciliation: ConfigBundleApplyReconciliationSchema.optional(),
  mode: ConfigBundleModeSchema.nullable().optional(),
  changes: z.array(ConfigBundleDiffChangeSchema).optional(),
  bootstrap: ConfigBundleBootstrapStatusSchema.optional(),
});

export const GovernanceOwnershipOperationSchema = z.enum(['transfer', 'release', 'retire']);
export const GovernanceOwnershipAcknowledgementSchema = z.enum([
  'governance.settings-only',
  'governance.preserve-managed-objects',
  'governance.transfer-to-new-bundle',
  'governance.release-to-manual',
  'governance.retire-bundle-without-deleting-objects',
]);
const GovernanceOwnershipRequestObjectSchema = z.object({
  operation: GovernanceOwnershipOperationSchema,
  expectedCurrentSourceRef: z.string().min(1).max(500).nullable(),
  desiredBundleKey: ConfigReferenceKeySchema.optional(),
  desiredOwnershipMode: z.enum(['config_locked', 'config_warn']).optional(),
  reason: z.string().trim().min(10).max(1000),
}).strict();

function validateGovernanceOwnershipRequest(
  value: z.infer<typeof GovernanceOwnershipRequestObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  if (value.operation === 'transfer') {
    if (!value.desiredBundleKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['desiredBundleKey'], message: 'Transfer requires desiredBundleKey' });
    }
    if (!value.desiredOwnershipMode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['desiredOwnershipMode'], message: 'Transfer requires desiredOwnershipMode' });
    }
  } else {
    if (value.desiredBundleKey !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['desiredBundleKey'], message: `${value.operation} does not accept desiredBundleKey` });
    }
    if (value.desiredOwnershipMode !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['desiredOwnershipMode'], message: `${value.operation} does not accept desiredOwnershipMode` });
    }
  }
}

export const GovernanceOwnershipRequestSchema = GovernanceOwnershipRequestObjectSchema
  .superRefine(validateGovernanceOwnershipRequest);

export const GovernanceOwnershipStateSchema = z.object({
  sourceRef: z.string().nullable(),
  ownershipMode: z.enum(['manual', 'config_locked', 'config_warn']),
  sourceHash: z.string().nullable(),
  lastAppliedAt: z.number().nullable(),
  driftStatus: z.enum(['in_sync', 'drifted']).nullable(),
}).strict();

export const GovernanceOwnershipConflictSchema = z.object({
  code: z.string(),
  message: z.string(),
}).strict();

export const GovernanceOwnershipPreviewResponseSchema = z.object({
  operation: GovernanceOwnershipOperationSchema,
  current: GovernanceOwnershipStateSchema,
  desired: GovernanceOwnershipStateSchema,
  affectedFields: z.array(z.enum([
    'engineOnboardingMode',
    'projectEngineTargetMode',
    'engineAccessAuthority',
    'projectAccessAuthority',
    'engineRuntimeAuthorizationMode',
  ])),
  preservedObjectTypes: z.array(z.string()),
  conflicts: z.array(GovernanceOwnershipConflictSchema),
  requiredAcknowledgements: z.array(GovernanceOwnershipAcknowledgementSchema),
  noChanges: z.boolean(),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  previewExpiresAt: z.number().int().positive(),
}).strict();

export const GovernanceOwnershipApplyRequestSchema = GovernanceOwnershipRequestObjectSchema.extend({
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  previewExpiresAt: z.number().int().positive(),
  acknowledgements: z.array(GovernanceOwnershipAcknowledgementSchema),
  idempotencyKey: z.string().min(8).max(255),
}).strict().superRefine(validateGovernanceOwnershipRequest);

export const GovernanceOwnershipReceiptSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable(),
  operation: GovernanceOwnershipOperationSchema,
  actorId: z.string().nullable(),
  reason: z.string(),
  idempotencyKey: z.string(),
  previewHash: z.string(),
  current: GovernanceOwnershipStateSchema,
  desired: GovernanceOwnershipStateSchema,
  affectedFields: GovernanceOwnershipPreviewResponseSchema.shape.affectedFields,
  preservedObjectTypes: z.array(z.string()),
  appliedAt: z.number().int(),
  idempotent: z.boolean().optional(),
}).strict();

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
  engineAccessAuthority: AccessAuthorityModeSchema.default('manual')
    .describe('Engine membership and scoped assignment authority. This does not register engines or change runtime scope.'),
  projectAccessAuthority: AccessAuthorityModeSchema.default('manual')
    .describe('Project membership and scoped assignment authority. This does not control project creation.'),
  engineOnboardingMode: EngineOnboardingModeSchema.default('manual_allowed')
    .describe('Manual engine inventory policy. Engine records remain in ./engines.json or the external registration API.'),
  projectEngineTargetMode: ProjectEngineTargetPolicyModeSchema.default('manual_allowed')
    .describe('Manual project-engine target policy. This is separate from engine membership and project creation.'),
  // Other modes are deliberately not accepted until their corresponding
  // engine-native synchronization design is implemented.
  engineRuntimeAuthorizationMode: EngineRuntimeAuthorizationModeSchema.default('enterpriseglue_authoritative')
    .describe('Runtime authorization authority; runtimeAccessScope remains a per-engine field in ./engines.json.'),
  ownershipMode: ConfigOwnershipModeSchema.default('config_locked')
    .describe('Ownership of this settings block only, not ownership of engine, member, group, or assignment rows.'),
}).strict();

/**
 * v1beta1 separates membership, inventory, target, runtime, and settings
 * ownership terminology. These names are the public contract; the v1alpha1
 * aliases are accepted only by the versioned compatibility schema below.
 */
export const ConfigBundleGovernanceV1Beta1Schema = z.object({
  engineMembershipAuthority: AccessAuthorityModeSchema.default('manual')
    .describe('Authority for engine membership and scoped engine assignments only.'),
  projectMembershipAuthority: AccessAuthorityModeSchema.default('manual')
    .describe('Authority for project membership and scoped project assignments only.'),
  engineRegistrationPolicy: EngineOnboardingModeSchema.default('manual_allowed')
    .describe('Policy for registering engine inventory; unrelated to membership authority.'),
  projectEngineTargetPolicy: ProjectEngineTargetPolicyModeSchema.default('manual_allowed')
    .describe('Policy for managing project-to-engine deployment targets.'),
  runtimeAuthorizationAuthority: EngineRuntimeAuthorizationModeSchema.default('enterpriseglue_authoritative')
    .describe('Authority for runtime-resource authorization decisions.'),
  governanceSettingsOwnership: ConfigOwnershipModeSchema.default('config_locked')
    .describe('Ownership of this governance block only, never ownership of managed object rows.'),
}).strict();

const configBundleSettingsDefaults = {
  engineAccessAuthority: 'manual',
  projectAccessAuthority: 'manual',
  engineOnboardingMode: 'manual_allowed',
  projectEngineTargetMode: 'manual_allowed',
  engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative',
  ownershipMode: 'config_locked',
} as const;

const configBundleGovernanceDefaults = {
  engineMembershipAuthority: 'manual',
  projectMembershipAuthority: 'manual',
  engineRegistrationPolicy: 'manual_allowed',
  projectEngineTargetPolicy: 'manual_allowed',
  runtimeAuthorizationAuthority: 'enterpriseglue_authoritative',
  governanceSettingsOwnership: 'config_locked',
} as const;

const EnterpriseGlueConfigBundleCommonShape = {
  kind: z.literal(ENTERPRISEGLUE_CONFIG_KIND),
  metadata: z.object({
    key: ConfigKeySchema,
    description: z.string().max(2000).optional(),
    owner: z.string().min(1).max(255),
  }).strict(),
  tenantKey: ReferenceKeySchema,
  mode: ConfigBundleModeSchema,
  imports: z.array(z.enum(AllowedImportPaths)).min(1),
} as const;

function validateConfigBundleImports(
  bundle: { imports: readonly string[] },
  ctx: z.RefinementCtx,
): void {
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
}

export const EnterpriseGlueConfigBundleV1Alpha1Schema = z.object({
  apiVersion: z.literal(ENTERPRISEGLUE_CONFIG_API_VERSION_V1ALPHA1),
  ...EnterpriseGlueConfigBundleCommonShape,
  settings: ConfigBundleSettingsSchema.default(configBundleSettingsDefaults)
    .describe('Deprecated v1alpha1 governance aliases. Use the v1beta1 governance block for new bundles.'),
}).strict().superRefine(validateConfigBundleImports);

export const EnterpriseGlueConfigBundleV1Beta1Schema = z.object({
  apiVersion: z.literal(ENTERPRISEGLUE_CONFIG_API_VERSION_V1BETA1),
  ...EnterpriseGlueConfigBundleCommonShape,
  governance: ConfigBundleGovernanceV1Beta1Schema.default(configBundleGovernanceDefaults)
    .describe('Optional platform governance policy. Omit it when this bundle must not claim or reset governance settings.'),
}).strict().superRefine(validateConfigBundleImports);

/** Public version-discriminated input contract. */
export const EnterpriseGlueConfigBundleSchema = z.discriminatedUnion('apiVersion', [
  EnterpriseGlueConfigBundleV1Alpha1Schema,
  EnterpriseGlueConfigBundleV1Beta1Schema,
]);

/**
 * Canonical internal manifest. Persistence services use the established
 * internal field names after the version boundary has normalized them.
 */
export const NormalizedEnterpriseGlueConfigBundleSchema = z.object({
  apiVersion: z.literal(ENTERPRISEGLUE_CONFIG_API_VERSION_V1BETA1),
  ...EnterpriseGlueConfigBundleCommonShape,
  settings: ConfigBundleSettingsSchema.default(configBundleSettingsDefaults),
}).strict().superRefine(validateConfigBundleImports);

export function normalizeEnterpriseGlueConfigBundle(
  input: z.infer<typeof EnterpriseGlueConfigBundleSchema>,
): {
  bundle: z.infer<typeof NormalizedEnterpriseGlueConfigBundleSchema>;
  contract: z.infer<typeof ConfigBundleContractMetadataSchema>;
} {
  if (input.apiVersion === ENTERPRISEGLUE_CONFIG_API_VERSION_V1ALPHA1) {
    return {
      bundle: NormalizedEnterpriseGlueConfigBundleSchema.parse({
        ...input,
        apiVersion: ENTERPRISEGLUE_CONFIG_API_VERSION_V1BETA1,
        settings: input.settings,
      }),
      contract: configBundleContractMetadataForApiVersion(
        input.apiVersion,
        Object.prototype.hasOwnProperty.call(input, 'settings'),
      ),
    };
  }
  const { governance, ...common } = input;
  return {
    bundle: NormalizedEnterpriseGlueConfigBundleSchema.parse({
      ...common,
      settings: {
        engineAccessAuthority: governance.engineMembershipAuthority,
        projectAccessAuthority: governance.projectMembershipAuthority,
        engineOnboardingMode: governance.engineRegistrationPolicy,
        projectEngineTargetMode: governance.projectEngineTargetPolicy,
        engineRuntimeAuthorizationMode: governance.runtimeAuthorizationAuthority,
        ownershipMode: governance.governanceSettingsOwnership,
      },
    }),
    contract: configBundleContractMetadataForApiVersion(input.apiVersion, false),
  };
}

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

export const ConfigRoleScopeSchema = z.enum(['platform', 'tenant', 'project', 'engine', 'engine_runtime_resource']);

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
  tenancy: EngineTenancyConfigurationSchema.default({
    mode: 'dedicated',
    tenantRef: { type: 'request_context' },
  }),
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
  if (engine.tenancy.mode === 'shared' && engine.runtimeAccessScope !== 'resource_aware') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['runtimeAccessScope'],
      message: 'Shared engines require runtimeAccessScope=resource_aware',
    });
  }
});
export const ConfigEnginesFileSchema = z.object({
  engines: z.array(ConfigEngineSchema),
}).strict().superRefine((file, ctx) => uniqueKeys(file.engines, ctx, 'engines'));

/** The native group id is supplied only through an opaque external secret reference. */
export const ConfigEngineBackstopMappingSchema = z.object({
  key: ConfigKeySchema.regex(/^engine-backstop-mapping[._-]/, 'Backstop mapping keys must begin with engine-backstop-mapping'),
  engineRef: ConfigEngineReferenceSchema,
  groupRef: ConfigGroupReferenceSchema,
  nativeGroupIdRef: SecretReferenceSchema,
  isActive: z.boolean().default(true),
  ownershipMode: z.enum(['config_locked', 'config_warn']).default('config_locked'),
}).strict();
export const ConfigEngineBackstopMappingsFileSchema = z.object({
  engineBackstopMappings: z.array(ConfigEngineBackstopMappingSchema),
}).strict().superRefine((file, ctx) => uniqueKeys(file.engineBackstopMappings, ctx, 'engineBackstopMappings'));

export const ConfigEngineTenantMappingSchema = z.object({
  key: ConfigKeySchema.regex(
    /^engine-tenant-mapping[._-]/,
    'Engine tenant mapping keys must begin with engine-tenant-mapping',
  ),
  engineRef: ConfigEngineReferenceSchema,
  externalTenantId: z.string().max(255).default(''),
  tenantRef: EngineTenantReferenceSchema,
  strategy: EngineTenantMappingStrategySchema,
  active: z.boolean().default(true),
  ownershipMode: z.enum(['config_locked', 'config_warn']).default('config_locked'),
}).strict();

export const ConfigEngineTenantMappingsFileSchema = z.object({
  engineTenantMappings: z.array(ConfigEngineTenantMappingSchema),
}).strict().superRefine((file, ctx) => {
  uniqueKeys(file.engineTenantMappings, ctx, 'engineTenantMappings');
  const identities = new Map<string, number>();
  file.engineTenantMappings.forEach((mapping, index) => {
    const identity = `${mapping.engineRef.engineKey}\u0000${mapping.strategy}\u0000${mapping.externalTenantId}`;
    const duplicateIndex = identities.get(identity);
    if (duplicateIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['engineTenantMappings', index, 'externalTenantId'],
        message: `Duplicate engine tenant mapping identity also declared at engineTenantMappings.${duplicateIndex}`,
      });
    } else {
      identities.set(identity, index);
    }
  });
});

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
  z.object({ type: z.literal('tenant') }).strict(),
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

const CommonIdentityProviderSchema = z.object({
  key: ConfigKeySchema,
  enabled: z.boolean().default(true),
  authenticationMode: z.enum(['direct', 'claims_only']).default('claims_only'),
  allowVerifiedEmailLinking: z.boolean().default(false),
  authorizationAttributeKeys: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/)).max(20).optional(),
  directoryTenantId: z.string().min(1).max(255).optional(),
  sync: IdentityProviderSyncConfigurationSchema,
  ownershipMode: ConfigOwnershipModeSchema.optional(),
});

export const ConfigIdentityProviderSchema = z.discriminatedUnion('type', [
  CommonIdentityProviderSchema.extend({
    type: z.literal('oidc'),
    oidc: OidcIdentityProviderConfigurationSchema,
  }).strict(),
  CommonIdentityProviderSchema.extend({
    type: z.literal('saml'),
    saml: SamlIdentityProviderConfigurationSchema,
  }).strict(),
  CommonIdentityProviderSchema.extend({
    type: z.literal('ldap'),
    authenticationMode: z.enum(['direct', 'claims_only']).default('direct'),
    ldap: LdapIdentityProviderConfigurationSchema,
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
export type EnterpriseGlueConfigBundleV1Alpha1 = z.infer<typeof EnterpriseGlueConfigBundleV1Alpha1Schema>;
export type EnterpriseGlueConfigBundleV1Beta1 = z.infer<typeof EnterpriseGlueConfigBundleV1Beta1Schema>;
export type NormalizedEnterpriseGlueConfigBundle = z.infer<typeof NormalizedEnterpriseGlueConfigBundleSchema>;
export type ConfigBundleContractMetadata = z.infer<typeof ConfigBundleContractMetadataSchema>;
export type ConfigBundleContractWarning = z.infer<typeof ConfigBundleContractWarningSchema>;
export type ConfigBundleRequest = z.infer<typeof ConfigBundleRequestSchema>;
export type ConfigBundleV1Beta1Request = Omit<ConfigBundleRequest, 'bundle'> & {
  bundle: z.input<typeof EnterpriseGlueConfigBundleV1Beta1Schema>;
};
export type ConfigBundleRemoteImportRequest = z.infer<typeof ConfigBundleRemoteImportRequestSchema>;
export type ConfigBundleCiProvenance = z.infer<typeof ConfigBundleCiProvenanceSchema>;
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
export type GovernanceOwnershipOperation = z.infer<typeof GovernanceOwnershipOperationSchema>;
export type GovernanceOwnershipAcknowledgement = z.infer<typeof GovernanceOwnershipAcknowledgementSchema>;
export type GovernanceOwnershipRequest = z.infer<typeof GovernanceOwnershipRequestSchema>;
export type GovernanceOwnershipState = z.infer<typeof GovernanceOwnershipStateSchema>;
export type GovernanceOwnershipPreviewResponse = z.infer<typeof GovernanceOwnershipPreviewResponseSchema>;
export type GovernanceOwnershipApplyRequest = z.infer<typeof GovernanceOwnershipApplyRequestSchema>;
export type GovernanceOwnershipReceipt = z.infer<typeof GovernanceOwnershipReceiptSchema>;
export type ConfigBundleIdentityReplayTask = z.infer<typeof ConfigBundleIdentityReplayTaskSchema>;
export type ConfigBundleRuntimeReconciliationTask = z.infer<typeof ConfigBundleRuntimeReconciliationTaskSchema>;
export type ConfigRole = z.infer<typeof ConfigRoleSchema>;
export type ConfigIdentityProvider = z.infer<typeof ConfigIdentityProviderSchema>;
export type ConfigIdentityMapping = z.infer<typeof ConfigIdentityMappingSchema>;
export type ConfigEngineTenantMapping = z.infer<typeof ConfigEngineTenantMappingSchema>;
export type ConfigEngineBackstopMapping = z.infer<typeof ConfigEngineBackstopMappingSchema>;
export type ConfigEngineReference = z.infer<typeof ConfigEngineReferenceSchema>;
export type ConfigEngineSetReference = z.infer<typeof ConfigEngineSetReferenceSchema>;
export type ConfigGroupReference = z.infer<typeof ConfigGroupReferenceSchema>;
export type ConfigRoleReference = z.infer<typeof ConfigRoleReferenceSchema>;
export type ConfigProjectReference = z.infer<typeof ConfigProjectReferenceSchema>;
