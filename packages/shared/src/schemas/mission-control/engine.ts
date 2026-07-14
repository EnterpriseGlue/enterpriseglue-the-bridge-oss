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

export const ExternalEngineCapabilitiesSchema = z.object({
  operations: z.array(z.string()).optional(),
  supportLevel: z.string().nullable().optional(),
  compatibilityProfile: z.string().nullable().optional(),
}).passthrough();
export type ExternalEngineCapabilities = z.infer<typeof ExternalEngineCapabilitiesSchema>;

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
  deploymentIntegration: z.enum(['enterpriseglue_proxy', 'direct_engine']).optional(),
  metadataDiscoveryEnabled: z.boolean().optional(),
  deploymentDiscoveryEnabled: z.boolean().optional(),
  reconciliationIntervalSeconds: z.number().int().min(60).max(86400).optional(),
  pipelineReceiptEnabled: z.boolean().optional(),
});

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
export type EngineHealth = z.infer<typeof EngineHealthSchema>;
