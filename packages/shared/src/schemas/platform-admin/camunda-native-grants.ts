import { z } from 'zod';

/**
 * The read-only subset returned by Camunda 7's Authorization REST endpoint.
 * This schema is also the accepted shape for a customer-supplied export. It is
 * intentionally narrow: imports never accept endpoint, credential, or other
 * connection configuration from an export.
 */
export const CamundaNativeAuthorizationSchema = z.object({
  id: z.string().min(1).max(255),
  /** Camunda 7: 0 = global, 1 = grant, 2 = revoke. */
  type: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  permissions: z.array(z.string().min(1).max(128)).min(1).max(128),
  userId: z.string().min(1).max(255).nullable().optional(),
  groupId: z.string().min(1).max(255).nullable().optional(),
  /** Camunda sends a numeric resource type; named values are accepted for signed exports. */
  resourceType: z.union([z.number().int().min(0).max(10_000), z.string().min(1).max(128)]),
  resourceId: z.string().min(1).max(1_024).nullable().optional(),
}).strict();

export const CamundaNativeAuthorizationExportSchema = z.object({
  apiVersion: z.literal('enterpriseglue.ai/camunda7-native-authorizations/v1'),
  authorizations: z.array(CamundaNativeAuthorizationSchema).max(5_000),
}).strict();

export const CamundaNativeGrantSourceKindSchema = z.enum(['live_api', 'customer_export']);
export const CamundaNativeGrantResourceKindSchema = z.enum(['process_definition', 'decision_definition']);
export const CamundaNativeGrantDispositionSchema = z.enum(['proposed', 'approval_required', 'manual_required', 'blocked']);

/** Reason codes are stable API values, not display text. */
export const CamundaNativeGrantReasonCodeSchema = z.enum([
  'group_grant_process_definition',
  'group_grant_decision_definition',
  'broad_resource_acknowledgement_required',
  'user_identity_mapping_required',
  'global_authorization_not_convertible',
  'revoke_authorization_not_convertible',
  'missing_group_principal',
  'unsupported_resource_type',
  'permission_mapping_not_supported',
  'missing_resource_id',
  'runtime_resource_inventory_required',
  'runtime_resource_not_found',
  'runtime_resource_ambiguous',
  'runtime_resource_unresolved_tenant',
]);

export const CamundaNativeGrantRuntimeResourceSchema = z.object({
  resourceKind: CamundaNativeGrantResourceKindSchema,
  resourceKey: z.string().min(1).max(255),
  runtimeTenantId: z.string().max(255).nullable().optional(),
  isActive: z.boolean(),
  tenantResolutionStatus: z.enum(['resolved', 'unmapped', 'conflict']).optional(),
}).strict();

export const CamundaNativeGrantClassificationSchema = z.object({
  sourceAuthorizationId: z.string().min(1).max(255),
  disposition: CamundaNativeGrantDispositionSchema,
  reasonCodes: z.array(CamundaNativeGrantReasonCodeSchema).min(1),
  principal: z.object({
    type: z.enum(['group', 'user', 'global']),
    /** Present only for group candidates. User IDs must not be exposed in ordinary responses. */
    groupId: z.string().min(1).max(255).optional(),
  }).strict(),
  resourceKind: CamundaNativeGrantResourceKindSchema.nullable(),
  resourceId: z.string().max(1_024).nullable(),
  runtimeTenantId: z.string().max(255).nullable(),
  mappedActionIds: z.array(z.string().min(1).max(255)),
}).strict();

/** Safe to retain and return to ordinary migration-history readers. */
export const CamundaNativeGrantSanitizedClassificationSchema = z.object({
  sourceAuthorizationRef: z.string().regex(/^camunda-auth-[a-f0-9]{24}$/),
  disposition: CamundaNativeGrantDispositionSchema,
  reasonCodes: z.array(CamundaNativeGrantReasonCodeSchema).min(1),
  principalType: z.enum(['group', 'user', 'global']),
  /** An opaque correlation reference, never a native group name. */
  groupReference: z.string().regex(/^camunda-group-[a-f0-9]{24}$/).nullable(),
  resourceKind: CamundaNativeGrantResourceKindSchema.nullable(),
  /** An opaque correlation reference, never a native resource key. */
  resourceReference: z.string().regex(/^camunda-resource-[a-f0-9]{24}$/).nullable(),
  mappedActionIds: z.array(z.string().min(1).max(255)),
}).strict();

export const CamundaNativeGrantImportRunStatusSchema = z.enum(['previewed', 'draft_generated', 'applied', 'rolled_back', 'failed']);
export const CamundaNativeGrantImportRunSummarySchema = z.object({
  id: z.string().min(1).max(255),
  engineId: z.string().min(1).max(255),
  tenantId: z.string().min(1).max(255).nullable(),
  sourceKind: CamundaNativeGrantSourceKindSchema,
  status: CamundaNativeGrantImportRunStatusSchema,
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  mappingCatalogVersion: z.string().min(1).max(128),
  inventoryTruncated: z.boolean(),
  normalizedCounts: z.record(z.string(), z.number().int().nonnegative()),
  classifications: z.array(CamundaNativeGrantSanitizedClassificationSchema),
  draftHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  appliedConfigBundleRunId: z.string().min(1).max(255).nullable(),
  rollbackConfigBundleRunId: z.string().min(1).max(255).nullable(),
  rolledBackAt: z.number().int().nullable(),
  detailedSnapshotAvailable: z.boolean(),
  detailedSnapshotExpiresAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
}).strict();

export type CamundaNativeAuthorization = z.infer<typeof CamundaNativeAuthorizationSchema>;
export type CamundaNativeAuthorizationExport = z.infer<typeof CamundaNativeAuthorizationExportSchema>;
export type CamundaNativeGrantSourceKind = z.infer<typeof CamundaNativeGrantSourceKindSchema>;
export type CamundaNativeGrantResourceKind = z.infer<typeof CamundaNativeGrantResourceKindSchema>;
export type CamundaNativeGrantDisposition = z.infer<typeof CamundaNativeGrantDispositionSchema>;
export type CamundaNativeGrantReasonCode = z.infer<typeof CamundaNativeGrantReasonCodeSchema>;
export type CamundaNativeGrantRuntimeResource = z.infer<typeof CamundaNativeGrantRuntimeResourceSchema>;
export type CamundaNativeGrantClassification = z.infer<typeof CamundaNativeGrantClassificationSchema>;
export type CamundaNativeGrantSanitizedClassification = z.infer<typeof CamundaNativeGrantSanitizedClassificationSchema>;
export type CamundaNativeGrantImportRunStatus = z.infer<typeof CamundaNativeGrantImportRunStatusSchema>;
export type CamundaNativeGrantImportRunSummary = z.infer<typeof CamundaNativeGrantImportRunSummarySchema>;
