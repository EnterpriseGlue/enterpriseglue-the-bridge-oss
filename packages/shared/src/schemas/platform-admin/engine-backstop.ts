import { z } from 'zod';

/** The narrow Camunda 7 subset that v1 backstop synchronization can write. */
export const EngineBackstopResourceKindSchema = z.enum(['process_definition', 'decision_definition']);
export const EngineBackstopDispositionSchema = z.enum(['proposed', 'manual_required', 'blocked']);
export const EngineBackstopReasonCodeSchema = z.enum([
  'exact_group_read_projected',
  'engine_type_not_supported',
  'principal_not_group',
  'group_mapping_missing',
  'group_mapping_ambiguous',
  'assignment_expired',
  'permission_mapping_not_supported',
  'scope_not_resource_specific',
  'runtime_resource_inactive',
  'runtime_resource_unresolved_tenant',
  'runtime_resource_cross_tenant',
  'runtime_resource_kind_not_supported',
  'runtime_resource_key_missing',
]);

export const EngineBackstopGroupMappingInputSchema = z.object({
  authzGroupId: z.string().min(1).max(255),
  /** Sensitive native identity value; detail-only and encrypted before storage. */
  nativeGroupId: z.string().min(1).max(255),
  isActive: z.boolean(),
}).strict();

export const EngineBackstopNativeGroupReferenceSchema = z.string().regex(/^camunda-group-[a-f0-9]{24}$/);

/** Safe mapping view: the Camunda group ID is intentionally absent. */
export const EngineBackstopGroupMappingSummarySchema = z.object({
  id: z.string().min(1).max(255),
  tenantId: z.string().min(1).max(255).nullable(),
  engineId: z.string().min(1).max(255),
  authzGroupId: z.string().min(1).max(255),
  nativeGroupReference: EngineBackstopNativeGroupReferenceSchema,
  source: z.enum(['manual', 'config']),
  ownershipMode: z.enum(['manual', 'config_locked', 'config_warn']),
  isActive: z.boolean(),
  createdById: z.string().min(1).max(255).nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
}).strict();

/** Native group values are write-only through the public mapping contract. */
export const EngineBackstopGroupMappingWriteSchema = z.object({
  authzGroupId: z.string().min(1).max(255),
  nativeGroupId: z.string().min(1).max(255),
  isActive: z.boolean().default(true),
}).strict();

export const EngineBackstopGroupMappingWriteRequestSchema = z.object({
  mappings: z.array(EngineBackstopGroupMappingWriteSchema).min(1).max(1_000),
}).strict();

export const EngineBackstopGroupMappingWriteResponseSchema = z.object({
  mappings: z.array(EngineBackstopGroupMappingSummarySchema).max(1_000),
}).strict();

/** A fully resolved assignment candidate supplied by the persistence adapter. */
export const EngineBackstopProjectionCandidateSchema = z.object({
  sourceAssignmentId: z.string().min(1).max(255),
  tenantId: z.string().min(1).max(255).nullable(),
  principal: z.object({
    type: z.enum(['group', 'user', 'api_client', 'service_account']),
    id: z.string().min(1).max(255),
  }).strict(),
  permissionIds: z.array(z.string().min(1).max(255)).min(1).max(128),
  expiresAt: z.number().int().nonnegative().nullable(),
  resource: z.object({
    engineId: z.string().min(1).max(255),
    kind: z.string().min(1).max(128),
    key: z.string().max(255),
    tenantId: z.string().min(1).max(255).nullable(),
    isActive: z.boolean(),
    tenantResolutionStatus: z.enum(['resolved', 'unmapped', 'conflict', 'stale']),
  }).nullable(),
}).strict();

export const EngineBackstopProjectionContextSchema = z.object({
  engineId: z.string().min(1).max(255),
  engineType: z.string().min(1).max(128),
  tenancyMode: z.enum(['dedicated', 'shared']),
  tenantId: z.string().min(1).max(255).nullable(),
  mappings: z.array(EngineBackstopGroupMappingInputSchema).max(10_000),
  candidates: z.array(EngineBackstopProjectionCandidateSchema).max(50_000),
}).strict();

export const EngineBackstopClassificationSchema = z.object({
  sourceAssignmentId: z.string().min(1).max(255),
  principalType: z.enum(['group', 'user', 'api_client', 'service_account']),
  disposition: EngineBackstopDispositionSchema,
  reasonCodes: z.array(EngineBackstopReasonCodeSchema).min(1),
  resourceKind: EngineBackstopResourceKindSchema.nullable(),
  resourceKey: z.string().max(255).nullable(),
  /** Present only in protected detail; summaries replace this with an opaque reference. */
  nativeGroupId: z.string().min(1).max(255).nullable(),
  camundaResourceType: z.union([z.literal(6), z.literal(10)]).nullable(),
  permissions: z.array(z.literal('READ')),
}).strict();

export const EngineBackstopDesiredGrantSchema = z.object({
  nativeGroupId: z.string().min(1).max(255),
  resourceKind: EngineBackstopResourceKindSchema,
  resourceKey: z.string().min(1).max(255),
  camundaResourceType: z.union([z.literal(6), z.literal(10)]),
  permissions: z.tuple([z.literal('READ')]),
  sourceAssignmentIds: z.array(z.string().min(1).max(255)).min(1),
}).strict();

export const EngineBackstopProjectionSchema = z.object({
  classifications: z.array(EngineBackstopClassificationSchema),
  desiredGrants: z.array(EngineBackstopDesiredGrantSchema),
}).strict();

export const EngineBackstopSyncRunStatusSchema = z.enum([
  'previewed', 'queued', 'running', 'succeeded', 'failed', 'rolled_back', 'out_of_sync',
]);

/** Safe receipt form; neither native IDs nor exact resource keys are exposed. */
export const EngineBackstopSanitizedClassificationSchema = z.object({
  sourceAssignmentReference: z.string().regex(/^backstop-assignment-[a-f0-9]{24}$/),
  disposition: EngineBackstopDispositionSchema,
  reasonCodes: z.array(EngineBackstopReasonCodeSchema).min(1),
  principalType: z.enum(['group', 'user', 'api_client', 'service_account']),
  nativeGroupReference: EngineBackstopNativeGroupReferenceSchema.nullable(),
  resourceKind: EngineBackstopResourceKindSchema.nullable(),
  resourceReference: z.string().regex(/^backstop-resource-[a-f0-9]{24}$/).nullable(),
  camundaResourceType: z.union([z.literal(6), z.literal(10)]).nullable(),
  permissions: z.array(z.literal('READ')),
}).strict();

export const EngineBackstopSyncRunSummarySchema = z.object({
  id: z.string().min(1).max(255),
  engineId: z.string().min(1).max(255),
  tenantId: z.string().min(1).max(255).nullable(),
  status: EngineBackstopSyncRunStatusSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  desiredHash: z.string().regex(/^[a-f0-9]{64}$/),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  catalogVersion: z.string().min(1).max(128),
  capability: z.record(z.string(), z.boolean()),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  classifications: z.array(EngineBackstopSanitizedClassificationSchema).max(50_000),
  rollbackOfRunId: z.string().min(1).max(255).nullable(),
  /** Links a read-only native observation to the apply run that owns its IDs. */
  observedOfRunId: z.string().min(1).max(255).nullable(),
  detailedSnapshotAvailable: z.boolean(),
  detailedSnapshotExpiresAt: z.number().int().nullable(),
  completedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
}).strict();

export const EngineBackstopSyncRunHistorySchema = z.object({
  runs: z.array(EngineBackstopSyncRunSummarySchema).max(100),
}).strict();

export const EngineBackstopSyncApplyRequestSchema = z.object({
  desiredHash: z.string().regex(/^[a-f0-9]{64}$/),
  acknowledgeDirectIdentityBoundary: z.literal(true),
}).strict();

export const EngineBackstopSyncRollbackRequestSchema = z.object({
  acknowledgeOwnedGrantDeletion: z.literal(true),
}).strict();

export type EngineBackstopGroupMappingInput = z.infer<typeof EngineBackstopGroupMappingInputSchema>;
export type EngineBackstopGroupMappingSummary = z.infer<typeof EngineBackstopGroupMappingSummarySchema>;
export type EngineBackstopGroupMappingWrite = z.infer<typeof EngineBackstopGroupMappingWriteSchema>;
export type EngineBackstopGroupMappingWriteRequest = z.infer<typeof EngineBackstopGroupMappingWriteRequestSchema>;
export type EngineBackstopGroupMappingWriteResponse = z.infer<typeof EngineBackstopGroupMappingWriteResponseSchema>;
export type EngineBackstopProjectionCandidate = z.infer<typeof EngineBackstopProjectionCandidateSchema>;
export type EngineBackstopProjectionContext = z.infer<typeof EngineBackstopProjectionContextSchema>;
export type EngineBackstopClassification = z.infer<typeof EngineBackstopClassificationSchema>;
export type EngineBackstopDesiredGrant = z.infer<typeof EngineBackstopDesiredGrantSchema>;
export type EngineBackstopProjection = z.infer<typeof EngineBackstopProjectionSchema>;
export type EngineBackstopSanitizedClassification = z.infer<typeof EngineBackstopSanitizedClassificationSchema>;
export type EngineBackstopSyncRunStatus = z.infer<typeof EngineBackstopSyncRunStatusSchema>;
export type EngineBackstopSyncRunSummary = z.infer<typeof EngineBackstopSyncRunSummarySchema>;
export type EngineBackstopSyncRunHistory = z.infer<typeof EngineBackstopSyncRunHistorySchema>;
export type EngineBackstopSyncApplyRequest = z.infer<typeof EngineBackstopSyncApplyRequestSchema>;
export type EngineBackstopSyncRollbackRequest = z.infer<typeof EngineBackstopSyncRollbackRequestSchema>;
