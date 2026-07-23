import { z } from 'zod';
import { toTimestamp, nullToUndefined } from '@enterpriseglue/shared/utils/schema-helpers.js';

export const EngineTypeSchema = z.enum(['ion', 'operaton', 'camunda7']);
export type EngineType = z.infer<typeof EngineTypeSchema>;
export const EngineAuthTypeSchema = z.enum(['none', 'basic', 'bearer', 'oauth2-client-credentials']);
export type EngineAuthType = z.infer<typeof EngineAuthTypeSchema>;
export const EngineConnectionModeSchema = z.enum(['direct', 'customer_sidecar']);
export type EngineConnectionMode = z.infer<typeof EngineConnectionModeSchema>;
export const EngineCapabilityStatusSchema = z.enum(['unknown', 'in_sync', 'mismatch']);
export type EngineCapabilityStatus = z.infer<typeof EngineCapabilityStatusSchema>;

export const EngineTenancyModeSchema = z.enum(['dedicated', 'shared']);
export const EngineTenantMappingStrategySchema = z.enum(['engine_tenant_id', 'deployment_target', 'explicit']);
export const EngineTenantResolutionStatusSchema = z.enum(['ready', 'incomplete', 'conflict', 'migration_required']);
export const RuntimeResourceTenantResolutionStatusSchema = z.enum(['resolved', 'unmapped', 'conflict', 'stale']);
export const EngineTenantMappingSourceSchema = z.enum(['manual', 'api', 'external', 'config', 'system']);
export const EngineTenantMappingOwnershipModeSchema = z.enum([
  'manual',
  'config_warn',
  'config_locked',
  'external_managed',
]);

/**
 * A tenant reference declares how a trusted service must resolve tenancy. An
 * id reference is still subject to caller authorization; parsing it is never
 * sufficient authorization to use it.
 */
export const EngineTenantReferenceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('request_context') }).strict(),
  z.object({ type: z.literal('default') }).strict(),
  z.object({
    type: z.literal('key'),
    key: z.string().min(1).max(160).regex(
      /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/,
      'Use a stable lowercase tenant key',
    ),
  }).strict(),
  z.object({ type: z.literal('id'), id: z.string().min(1).max(255) }).strict(),
]);

const DedicatedEngineTenancyConfigurationSchema = z.object({
  mode: z.literal('dedicated'),
  tenantRef: EngineTenantReferenceSchema.optional(),
}).strict();

const SharedEngineTenancyConfigurationSchema = z.object({
  mode: z.literal('shared'),
  mappingStrategy: EngineTenantMappingStrategySchema,
  unmappedPolicy: z.literal('deny').default('deny'),
}).strict();

export const EngineTenancyConfigurationSchema = z.discriminatedUnion('mode', [
  DedicatedEngineTenancyConfigurationSchema,
  SharedEngineTenancyConfigurationSchema,
]);

export const EngineTenancyErrorCodeSchema = z.enum([
  'ENGINE_TENANCY_UNRESOLVED',
  'ENGINE_TENANCY_CONFLICT',
  'ENGINE_TENANCY_TRANSITION_REQUIRED',
  'ENGINE_TENANCY_PREVIEW_STALE',
  'ENGINE_TENANCY_PREVIEW_EXPIRED',
  'ENGINE_TENANCY_ACKNOWLEDGEMENT_REQUIRED',
  'ENGINE_SHARED_REQUIRES_RESOURCE_AWARE',
  'ENGINE_TENANT_MAPPING_NOT_FOUND',
  'ENGINE_TENANT_MAPPING_VERSION_CONFLICT',
  'ENGINE_TENANT_REFERENCE_FORBIDDEN',
  'RUNTIME_RESOURCE_TENANT_UNRESOLVED',
]);

export const EngineTenancyErrorResponseSchema = z.object({
  error: z.string(),
  code: EngineTenancyErrorCodeSchema,
  field: z.string().optional(),
}).strict();

export const EngineTenancyDiagnosticsSchema = z.object({
  mode: EngineTenancyModeSchema,
  tenantId: z.string().nullable(),
  mappingStrategy: EngineTenantMappingStrategySchema.nullable(),
  mappingVersion: z.number().int().nonnegative(),
  resolutionStatus: EngineTenantResolutionStatusSchema,
  lastReconciledAt: z.number().nullable(),
  mappedResourceCount: z.number().int().nonnegative().default(0),
  unmappedResourceCount: z.number().int().nonnegative().default(0),
  conflictingResourceCount: z.number().int().nonnegative().default(0),
}).strict();

export const EngineTenancyTopologyStateSchema = z.object({
  mode: EngineTenancyModeSchema,
  tenantId: z.string().nullable(),
  mappingStrategy: EngineTenantMappingStrategySchema.nullable(),
  mappingVersion: z.number().int().nonnegative(),
  resolutionStatus: EngineTenantResolutionStatusSchema,
  runtimeAccessScope: z.enum(['engine_wide', 'resource_aware']),
}).strict();

export const EngineTenancyTransitionAcknowledgementSchema = z.enum([
  'acknowledge_topology_change',
  'acknowledge_mapping_deactivation',
  'acknowledge_resource_quarantine',
  'acknowledge_access_change',
]);

export const EngineTenancyTransitionKindSchema = z.enum([
  'dedicated_to_shared',
  'shared_to_dedicated',
  'shared_strategy_change',
  'dedicated_tenant_move',
]);

export const EngineTenancyTransitionEffectsSchema = z.object({
  roleAssignments: z.number().int().nonnegative(),
  tenantMappings: z.number().int().nonnegative(),
  runtimeResources: z.number().int().nonnegative(),
  engineSetMemberships: z.number().int().nonnegative(),
  deploymentTargets: z.number().int().nonnegative(),
  deploymentReceipts: z.number().int().nonnegative(),
  visibility: z.object({
    becomeVisible: z.number().int().nonnegative(),
    becomeHidden: z.number().int().nonnegative(),
    becomeUnmapped: z.number().int().nonnegative(),
    becomeConflicting: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export const EngineTenancyTransitionPreviewRequestSchema = z.object({
  tenancy: EngineTenancyConfigurationSchema,
}).strict();

export const EngineTenancyTransitionPreviewResponseSchema = z.object({
  engineId: z.string(),
  kind: EngineTenancyTransitionKindSchema,
  current: EngineTenancyTopologyStateSchema,
  proposed: EngineTenancyTopologyStateSchema,
  effects: EngineTenancyTransitionEffectsSchema,
  requiredAcknowledgements: z.array(EngineTenancyTransitionAcknowledgementSchema),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  previewExpiresAt: z.number().int().positive(),
}).strict();

export const EngineTenancyTransitionApplyRequestSchema = z.object({
  tenancy: EngineTenancyConfigurationSchema,
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  previewExpiresAt: z.number().int().positive(),
  acknowledgements: z.array(EngineTenancyTransitionAcknowledgementSchema),
}).strict();

export const EngineTenancyTransitionApplyResponseSchema = z.object({
  applied: z.literal(true),
  appliedAt: z.number().int().positive(),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  transition: EngineTenancyTransitionPreviewResponseSchema,
}).strict();

export const EngineTenancyClassificationStatusSchema = z.enum([
  'classified',
  'ready_for_apply',
  'requires_review',
  'conflict',
]);

export const EngineTenancyClassificationRowSchema = z.object({
  engineId: z.string(),
  engineName: z.string(),
  status: EngineTenancyClassificationStatusSchema,
  reason: z.string(),
  current: EngineTenancyTopologyStateSchema,
  proposed: EngineTenancyConfigurationSchema.nullable(),
}).strict();

export const EngineTenancyClassificationReportSchema = z.object({
  generatedAt: z.number().int().positive(),
  defaultTenantId: z.string(),
  totals: z.object({
    engines: z.number().int().nonnegative(),
    classified: z.number().int().nonnegative(),
    readyForApply: z.number().int().nonnegative(),
    requiresReview: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
  }).strict(),
  rows: z.array(EngineTenancyClassificationRowSchema),
}).strict();

export const EngineTenantMappingSchema = z.object({
  id: z.string(),
  engineId: z.string(),
  externalTenantId: z.string(),
  enterpriseTenantId: z.string(),
  strategy: EngineTenantMappingStrategySchema,
  source: EngineTenantMappingSourceSchema,
  sourceRef: z.string(),
  ownershipMode: EngineTenantMappingOwnershipModeSchema,
  sourceHash: z.string().nullable(),
  lastAppliedAt: z.number().nullable(),
  isActive: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).strict();

export const ExternalEngineTenantMappingUpsertSchema = z.object({
  externalTenantId: z.string().max(255).default(''),
  tenantRef: EngineTenantReferenceSchema,
  strategy: EngineTenantMappingStrategySchema,
  sourceRef: z.string().min(1).max(500),
  active: z.boolean().default(true),
}).strict();

export const ExternalEngineTenantMappingsUpsertRequestSchema = z.object({
  expectedMappingVersion: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().default(false),
  atomic: z.literal(true).default(true),
  mappings: z.array(ExternalEngineTenantMappingUpsertSchema).min(1).max(500),
}).strict();

export const ExternalEngineTenantMappingUpsertResultSchema = z.object({
  index: z.number().int().nonnegative(),
  status: z.enum(['created', 'updated', 'deactivated', 'noop', 'rejected']),
  mappingId: z.string().nullable(),
  code: z.string().nullable(),
}).strict();

export const ExternalEngineTenantMappingsUpsertResponseSchema = z.object({
  engineId: z.string(),
  externalId: z.string(),
  dryRun: z.boolean(),
  mappingVersion: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  deactivated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  results: z.array(ExternalEngineTenantMappingUpsertResultSchema),
  diagnostics: EngineTenancyDiagnosticsSchema,
}).strict();

export type EngineTenancyMode = z.infer<typeof EngineTenancyModeSchema>;
export type EngineTenantMappingStrategy = z.infer<typeof EngineTenantMappingStrategySchema>;
export type EngineTenantMappingSource = z.infer<typeof EngineTenantMappingSourceSchema>;
export type EngineTenantMappingOwnershipMode = z.infer<typeof EngineTenantMappingOwnershipModeSchema>;
export type EngineTenantReference = z.infer<typeof EngineTenantReferenceSchema>;
export type EngineTenancyConfiguration = z.infer<typeof EngineTenancyConfigurationSchema>;
export type EngineTenancyErrorCode = z.infer<typeof EngineTenancyErrorCodeSchema>;
export type EngineTenancyDiagnostics = z.infer<typeof EngineTenancyDiagnosticsSchema>;
export type EngineTenancyTopologyState = z.infer<typeof EngineTenancyTopologyStateSchema>;
export type EngineTenancyTransitionAcknowledgement = z.infer<typeof EngineTenancyTransitionAcknowledgementSchema>;
export type EngineTenancyTransitionKind = z.infer<typeof EngineTenancyTransitionKindSchema>;
export type EngineTenancyTransitionEffects = z.infer<typeof EngineTenancyTransitionEffectsSchema>;
export type EngineTenancyTransitionPreviewRequest = z.input<typeof EngineTenancyTransitionPreviewRequestSchema>;
export type EngineTenancyTransitionPreviewResponse = z.infer<typeof EngineTenancyTransitionPreviewResponseSchema>;
export type EngineTenancyTransitionApplyRequest = z.input<typeof EngineTenancyTransitionApplyRequestSchema>;
export type EngineTenancyTransitionApplyResponse = z.infer<typeof EngineTenancyTransitionApplyResponseSchema>;
export type EngineTenancyClassificationRow = z.infer<typeof EngineTenancyClassificationRowSchema>;
export type EngineTenancyClassificationReport = z.infer<typeof EngineTenancyClassificationReportSchema>;
export type EngineTenantMapping = z.infer<typeof EngineTenantMappingSchema>;
export type ExternalEngineTenantMappingsUpsertRequest = z.input<typeof ExternalEngineTenantMappingsUpsertRequestSchema>;
export type ExternalEngineTenantMappingsUpsertResponse = z.infer<typeof ExternalEngineTenantMappingsUpsertResponseSchema>;

export const EndpointAuthenticationPolicyMessages = [
  'Credentialless endpoint authentication is allowed only for customer-sidecar engines',
  'Credentialless customer-sidecar endpoints are disabled by platform policy',
] as const;

export const EndpointAuthenticationPolicyErrorSchema = z.object({
  error: z.enum(EndpointAuthenticationPolicyMessages),
  code: z.literal('VALIDATION_ERROR'),
});

export const EngineTransportDiagnosticsSchema = z.object({
  connectionMode: EngineConnectionModeSchema,
  upstreamHop: z.enum(['enterpriseglue_to_engine', 'enterpriseglue_to_sidecar']),
  endpointAuthentication: EngineAuthTypeSchema,
  downstreamAuthentication: z.enum(['not_applicable', 'customer_managed']),
  attempts: z.number().int().min(1).max(2).optional(),
  timeoutMs: z.number().int().min(100).max(60_000).optional(),
});

/**
 * Query dimensions that a BPMN engine adapter must describe explicitly.  They
 * are deliberately separate from mutation operations: resource-aware
 * authorization needs to know whether a stable runtime lineage can be pushed
 * to the upstream engine before a collection is read.
 */
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
export type EngineRuntimeQueryCapabilities = z.infer<typeof EngineRuntimeQueryCapabilitiesSchema>;

export const ExternalEngineCapabilitiesSchema = z.object({
  operations: z.array(z.string()).optional(),
  queryCapabilities: EngineRuntimeQueryCapabilitiesSchema.optional(),
  supportLevel: z.string().nullable().optional(),
  compatibilityProfile: z.string().nullable().optional(),
}).passthrough();
export type ExternalEngineCapabilities = z.infer<typeof ExternalEngineCapabilitiesSchema>;

/**
 * Capabilities EnterpriseGlue provides for a registered engine adapter. This
 * is distinct from optional capabilities reported by an external registry.
 */
export const EngineCapabilitiesSchema = z.object({
  type: EngineTypeSchema,
  compatibilityProfile: z.literal('camunda7-rest'),
  supportLevel: z.enum(['certified', 'compatible']),
  operations: z.array(z.string()),
  queryCapabilities: EngineRuntimeQueryCapabilitiesSchema,
});

const EngineRegistrationFieldsSchema = z.object({
  name: z.string().min(1).max(255),
  baseUrl: z.string().min(1).url(),
  type: EngineTypeSchema,
  externalId: z.string().min(1).max(255).nullable().optional(),
  labels: z.record(z.string().min(1).max(128), z.string().max(512)).optional(),
  authType: EngineAuthTypeSchema.optional(),
  connectionMode: EngineConnectionModeSchema,
  username: z.string().nullable().optional(),
  passwordEnc: z.string().nullable().optional(),
  oauthTokenUrl: z.string().url().nullable().optional(),
  oauthScopes: z.string().nullable().optional(),
  oauthAudience: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  environmentTagId: z.string().nullable().optional(),
  runtimeAccessScope: z.enum(['engine_wide', 'resource_aware']).optional(),
  tenancy: EngineTenancyConfigurationSchema.optional(),
  deploymentIntegration: z.enum(['enterpriseglue_proxy', 'direct_engine']).optional(),
  metadataDiscoveryEnabled: z.boolean().optional(),
  deploymentDiscoveryEnabled: z.boolean().optional(),
  reconciliationIntervalSeconds: z.number().int().min(60).max(86400).optional(),
  pipelineReceiptEnabled: z.boolean().optional(),
}).strict();

export const CreateEngineRequestSchema = EngineRegistrationFieldsSchema.extend({
  type: EngineTypeSchema.default('ion'),
  connectionMode: EngineConnectionModeSchema.default('direct'),
});
export const UpdateEngineRequestSchema = EngineRegistrationFieldsSchema.partial();
export const ExternalEngineRegistrationRequestSchema = EngineRegistrationFieldsSchema.extend({
  type: EngineTypeSchema.default('ion'),
  connectionMode: EngineConnectionModeSchema.default('direct'),
  externalId: z.string().min(1).max(255),
  externalSystemId: z.string().min(1).nullable().optional(),
  managementMode: z.enum(['external_managed', 'hybrid']).optional(),
  fieldOwnership: z.record(z.string().min(1).max(128), z.enum(['manual', 'external'])).optional(),
  lifecycleStatus: z.enum(['active', 'disabled', 'stale']).optional(),
  capabilities: ExternalEngineCapabilitiesSchema.optional(),
  testConnection: z.boolean().optional(),
});

export const ExternalEngineDecommissionRequestSchema = z.object({
  externalId: z.string().min(1).max(255),
  externalSystemId: z.string().min(1).nullable().optional(),
  reason: z.string().max(2000).nullable().optional(),
}).strict();

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
export type ExternalEngineCapabilityDiagnostics = z.infer<typeof ExternalEngineCapabilityDiagnosticsSchema>;

export function normalizeEngineType(value: unknown): EngineType {
  const parsed = EngineTypeSchema.safeParse(value ?? 'camunda7');
  return parsed.success ? parsed.data : 'camunda7';
}

function normalizeEngineLabels(labels: unknown, labelsJson: string | null | undefined): Record<string, string> {
  if (labels && typeof labels === 'object' && !Array.isArray(labels)) {
    return Object.fromEntries(
      Object.entries(labels)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
  }
  if (!labelsJson) return {};
  try {
    const parsed = JSON.parse(labelsJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
  } catch {
    return {};
  }
}

function normalizeFieldOwnership(value: unknown, fieldOwnershipJson: string | null | undefined): Record<string, 'manual' | 'external'> {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : (() => {
        if (!fieldOwnershipJson) return null;
        try {
          return JSON.parse(fieldOwnershipJson);
        } catch {
          return null;
        }
      })();

  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input)
      .filter((entry): entry is [string, 'manual' | 'external'] => entry[1] === 'manual' || entry[1] === 'external')
  );
}

function normalizeExternalEngineCapabilities(value: unknown, capabilitiesJson: string | null | undefined): ExternalEngineCapabilities | null {
  const parsed = ExternalEngineCapabilitiesSchema.nullable().safeParse(value ?? null);
  if (parsed.success && parsed.data) return parsed.data;
  if (!capabilitiesJson) return null;
  try {
    const fromJson = JSON.parse(capabilitiesJson);
    const jsonParsed = ExternalEngineCapabilitiesSchema.safeParse(fromJson);
    return jsonParsed.success ? jsonParsed.data : null;
  } catch {
    return null;
  }
}

// Raw schema - matches TypeORM Engine entity
export const EngineSchemaRaw = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  type: z.string().nullable(),
  authType: z.string().nullable(),
  username: z.string().nullable(),
  passwordEnc: z.string().nullable(),
  oauthTokenUrl: z.string().nullable().optional(),
  oauthScopes: z.string().nullable().optional(),
  oauthAudience: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  labelsJson: z.string().nullable().optional(),
  registrationSource: z.string().nullable().optional(),
  sourceRef: z.string().nullable().optional(),
  configKey: z.string().nullable().optional(),
  sourceHash: z.string().nullable().optional(),
  lastAppliedAt: z.number().nullable().optional(),
  ownershipMode: z.enum(['manual', 'config_warn', 'config_locked']).nullable().optional(),
  externalSystemId: z.string().nullable().optional(),
  managementMode: z.string().nullable().optional(),
  fieldOwnership: z.record(z.string(), z.enum(['manual', 'external'])).optional(),
  fieldOwnershipJson: z.string().nullable().optional(),
  driftStatus: z.string().nullable().optional(),
  lifecycleStatus: z.string().nullable().optional(),
  lastExternalSyncAt: z.number().nullable().optional(),
  capabilitiesJson: z.string().nullable().optional(),
  reportedCapabilities: ExternalEngineCapabilitiesSchema.nullable().optional(),
  capabilityStatus: EngineCapabilityStatusSchema.or(z.string()).nullable().optional(),
  capabilityDiagnostics: ExternalEngineCapabilityDiagnosticsSchema.optional(),
  runtimeAccessScope: z.enum(['engine_wide', 'resource_aware']).optional(),
  tenancyMode: EngineTenancyModeSchema.optional(),
  tenantId: z.string().nullable().optional(),
  tenantMappingStrategy: EngineTenantMappingStrategySchema.nullable().optional(),
  tenantMappingVersion: z.number().int().nonnegative().optional(),
  tenantResolutionStatus: EngineTenantResolutionStatusSchema.optional(),
  lastTenantReconciledAt: z.number().nullable().optional(),
  deploymentIntegration: z.enum(['enterpriseglue_proxy', 'direct_engine']).optional(),
  metadataDiscoveryEnabled: z.boolean().optional(),
  deploymentDiscoveryEnabled: z.boolean().optional(),
  reconciliationIntervalSeconds: z.number().int().positive().optional(),
  lastMetadataReconciledAt: z.number().nullable().optional(),
  lastMetadataReconciliationStatus: z.enum(['succeeded', 'failed']).nullable().optional(),
  pipelineReceiptEnabled: z.boolean().optional(),
  connectionMode: EngineConnectionModeSchema.optional(),
  externalUpdatedAt: z.number().nullable().optional(),
  active: z.boolean().nullable(),
  version: z.string().nullable(),
  ownerId: z.string().nullable().optional(),
  delegateId: z.string().nullable().optional(),
  environmentTagId: z.string().nullable().optional(),
  environmentLocked: z.boolean().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Engine schema - transformed from Raw (for API responses)
export const EngineSchema = EngineSchemaRaw.transform((e) => ({
  id: e.id,
  name: e.name,
  baseUrl: e.baseUrl,
  type: normalizeEngineType(e.type),
  authType: e.authType as EngineAuthType | undefined,
  username: nullToUndefined(e.username),
  passwordEnc: undefined,
  hasCredential: Boolean(e.passwordEnc),
  oauthTokenUrl: nullToUndefined(e.oauthTokenUrl ?? null),
  oauthScopes: nullToUndefined(e.oauthScopes ?? null),
  oauthAudience: nullToUndefined(e.oauthAudience ?? null),
  externalId: nullToUndefined(e.externalId ?? null),
  labels: normalizeEngineLabels(e.labels, e.labelsJson),
  registrationSource: nullToUndefined(e.registrationSource ?? null),
  sourceRef: nullToUndefined(e.sourceRef ?? null),
  configKey: nullToUndefined(e.configKey ?? null),
  sourceHash: nullToUndefined(e.sourceHash ?? null),
  lastAppliedAt: e.lastAppliedAt ?? undefined,
  ownershipMode: nullToUndefined(e.ownershipMode ?? null),
  externalSystemId: nullToUndefined(e.externalSystemId ?? null),
  managementMode: nullToUndefined(e.managementMode ?? null),
  fieldOwnership: normalizeFieldOwnership(e.fieldOwnership, e.fieldOwnershipJson),
  driftStatus: nullToUndefined(e.driftStatus ?? null),
  lifecycleStatus: nullToUndefined(e.lifecycleStatus ?? null),
  lastExternalSyncAt: e.lastExternalSyncAt ?? undefined,
  reportedCapabilities: normalizeExternalEngineCapabilities(e.reportedCapabilities, e.capabilitiesJson),
  capabilityStatus: nullToUndefined(e.capabilityStatus ?? null),
  capabilityDiagnostics: e.capabilityDiagnostics,
  runtimeAccessScope: e.runtimeAccessScope || 'engine_wide',
  tenancyMode: e.tenancyMode || 'dedicated',
  tenantId: e.tenantId ?? null,
  tenantMappingStrategy: e.tenantMappingStrategy ?? null,
  tenantMappingVersion: e.tenantMappingVersion ?? 0,
  tenantResolutionStatus: e.tenantResolutionStatus || (e.tenantId ? 'ready' : 'migration_required'),
  lastTenantReconciledAt: e.lastTenantReconciledAt ?? null,
  deploymentIntegration: e.deploymentIntegration || 'enterpriseglue_proxy',
  metadataDiscoveryEnabled: e.metadataDiscoveryEnabled !== false,
  deploymentDiscoveryEnabled: e.deploymentDiscoveryEnabled !== false,
  reconciliationIntervalSeconds: e.reconciliationIntervalSeconds || 300,
  lastMetadataReconciledAt: e.lastMetadataReconciledAt ?? undefined,
  lastMetadataReconciliationStatus: e.lastMetadataReconciliationStatus ?? undefined,
  pipelineReceiptEnabled: e.pipelineReceiptEnabled !== false,
  connectionMode: e.connectionMode || 'direct',
  externalUpdatedAt: e.externalUpdatedAt ?? undefined,
  active: Boolean(e.active),
  version: nullToUndefined(e.version),
  createdAt: toTimestamp(e.createdAt),
  updatedAt: toTimestamp(e.updatedAt),
}));

/**
 * Sanitized engine inventory response. It is intentionally separate from the
 * persistence-shaped EngineSchema: credentials remain write-only, while the
 * evaluator-derived role is display metadata only and never a grant source.
 *
 * Passthrough preserves legacy display metadata while callers migrate to the
 * declared fields. It must not be used to accept an engine write payload.
 */
export const AccessibleEngineSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string().optional(),
  type: EngineTypeSchema.nullable().optional(),
  authType: EngineAuthTypeSchema.nullable().optional(),
  username: z.string().nullable().optional(),
  passwordEnc: z.null().optional(),
  hasCredential: z.boolean().optional(),
  oauthTokenUrl: z.string().nullable().optional(),
  oauthScopes: z.string().nullable().optional(),
  oauthAudience: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  registrationSource: z.string().nullable().optional(),
  sourceRef: z.string().nullable().optional(),
  configKey: z.string().nullable().optional(),
  sourceHash: z.string().nullable().optional(),
  lastAppliedAt: z.number().nullable().optional(),
  ownershipMode: z.enum(['manual', 'config_warn', 'config_locked']).nullable().optional(),
  externalSystemId: z.string().nullable().optional(),
  managementMode: z.string().nullable().optional(),
  fieldOwnership: z.record(z.string(), z.enum(['manual', 'external'])).optional(),
  driftStatus: z.string().nullable().optional(),
  lifecycleStatus: z.string().nullable().optional(),
  lastExternalSyncAt: z.number().nullable().optional(),
  reportedCapabilities: ExternalEngineCapabilitiesSchema.nullable().optional(),
  capabilityStatus: EngineCapabilityStatusSchema.nullable().optional(),
  capabilityDiagnostics: ExternalEngineCapabilityDiagnosticsSchema.optional(),
  capabilities: EngineCapabilitiesSchema.optional(),
  runtimeAccessScope: z.enum(['engine_wide', 'resource_aware']).optional(),
  tenancyMode: EngineTenancyModeSchema.optional(),
  tenantMappingStrategy: EngineTenantMappingStrategySchema.nullable().optional(),
  tenantMappingVersion: z.number().int().nonnegative().optional(),
  tenantResolutionStatus: EngineTenantResolutionStatusSchema.optional(),
  lastTenantReconciledAt: z.number().nullable().optional(),
  deploymentIntegration: z.enum(['enterpriseglue_proxy', 'direct_engine']).optional(),
  metadataDiscoveryEnabled: z.boolean().optional(),
  deploymentDiscoveryEnabled: z.boolean().optional(),
  reconciliationIntervalSeconds: z.number().int().positive().optional(),
  lastMetadataReconciledAt: z.number().nullable().optional(),
  lastMetadataReconciliationStatus: z.enum(['succeeded', 'failed']).nullable().optional(),
  pipelineReceiptEnabled: z.boolean().optional(),
  connectionMode: EngineConnectionModeSchema.optional(),
  externalUpdatedAt: z.number().nullable().optional(),
  active: z.boolean().nullable().optional(),
  version: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  delegateId: z.string().nullable().optional(),
  /**
   * Accountable contacts are governance metadata only. Authorization is
   * determined by canonical role assignments and action evaluation.
   */
  governance: z.object({
    accountableOwnerId: z.string().nullable(),
    delegateId: z.string().nullable(),
  }).optional(),
  environmentTagId: z.string().nullable().optional(),
  environmentLocked: z.boolean().nullable().optional(),
  tenantId: z.string().nullable().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
  myRole: z.enum(['owner', 'delegate', 'operator', 'deployer']).nullable().optional(),
}).passthrough();
export type EngineGovernance = NonNullable<z.infer<typeof AccessibleEngineSummarySchema>['governance']>;

/**
 * The default collection is safe for runtime engine selectors and therefore
 * hides shared engines until at least one resolved runtime resource is
 * visible. Administrative inventory surfaces may request manageable shared
 * rows; the authorization resolver still requires engine edit permission.
 */
export const EngineInventoryQuerySchema = z.object({
  includeManageableShared: z.enum(['true', 'false']).optional(),
}).strict();

export const EngineInsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  type: EngineTypeSchema.optional(),
  authType: EngineAuthTypeSchema.optional(),
  connectionMode: EngineConnectionModeSchema.optional(),
  username: z.string().optional(),
  passwordEnc: z.string().optional(),
  oauthTokenUrl: z.string().url().optional(),
  oauthScopes: z.string().optional(),
  oauthAudience: z.string().optional(),
  externalId: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  externalSystemId: z.string().optional(),
  managementMode: z.enum(['manual', 'external_managed', 'hybrid']).optional(),
  fieldOwnership: z.record(z.string(), z.enum(['manual', 'external'])).optional(),
  lifecycleStatus: z.enum(['active', 'disabled', 'stale', 'decommissioned']).optional(),
  capabilitiesJson: z.string().nullable().optional(),
  reportedCapabilities: ExternalEngineCapabilitiesSchema.nullable().optional(),
  capabilityStatus: EngineCapabilityStatusSchema.optional(),
  capabilityDiagnostics: ExternalEngineCapabilityDiagnosticsSchema.optional(),
  tenancyMode: EngineTenancyModeSchema.optional(),
  tenantId: z.string().nullable().optional(),
  tenantMappingStrategy: EngineTenantMappingStrategySchema.nullable().optional(),
  tenantMappingVersion: z.number().int().nonnegative().optional(),
  tenantResolutionStatus: EngineTenantResolutionStatusSchema.optional(),
  lastTenantReconciledAt: z.number().nullable().optional(),
  active: z.boolean().optional(),
  version: z.string().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

// Raw schema - matches TypeORM EngineHealth entity
export const EngineHealthSchemaRaw = z.object({
  id: z.string(),
  engineId: z.string(),
  status: z.string(),
  latencyMs: z.number().nullable(),
  message: z.string().nullable(),
  checkedAt: z.number(),
});

// Engine health schemas
export const EngineHealthSchema = EngineHealthSchemaRaw.transform((h) => ({
  id: h.id,
  engineId: h.engineId,
  status: h.status as 'connected' | 'disconnected' | 'unknown',
  latencyMs: h.latencyMs ?? undefined,
  message: h.message ?? undefined,
  checkedAt: Number(h.checkedAt ?? 0),
}));

/**
 * Runtime health and explicit connection-test response. Stored health rows do
 * not necessarily include the optional live version or transport diagnostic.
 */
export const EngineConnectionHealthResponseSchema = z.object({
  id: z.string().optional(),
  engineId: z.string().optional(),
  status: z.enum(['connected', 'disconnected', 'unknown']),
  latencyMs: z.number().nullable().optional(),
  message: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  checkedAt: z.number(),
  transport: EngineTransportDiagnosticsSchema.optional(),
});

export const EngineHealthInsertSchema = z.object({
  id: z.string().uuid().optional(),
  engineId: z.string().uuid(),
  status: z.enum(['connected', 'disconnected', 'unknown']),
  latencyMs: z.number().optional(),
  message: z.string().optional(),
  checkedAt: z.number().optional(),
});

// Types
export type Engine = z.infer<typeof EngineSchema>;
export type CreateEngineRequest = z.infer<typeof CreateEngineRequestSchema>;
export type UpdateEngineRequest = z.infer<typeof UpdateEngineRequestSchema>;
export type AccessibleEngineSummary = z.infer<typeof AccessibleEngineSummarySchema>;
export type EngineCapabilities = z.infer<typeof EngineCapabilitiesSchema>;
export type EngineHealth = z.infer<typeof EngineHealthSchema>;
export type EngineConnectionHealthResponse = z.infer<typeof EngineConnectionHealthResponseSchema>;
