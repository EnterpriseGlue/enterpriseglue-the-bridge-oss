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

export type EngineBackstopGroupMappingInput = z.infer<typeof EngineBackstopGroupMappingInputSchema>;
export type EngineBackstopProjectionCandidate = z.infer<typeof EngineBackstopProjectionCandidateSchema>;
export type EngineBackstopProjectionContext = z.infer<typeof EngineBackstopProjectionContextSchema>;
export type EngineBackstopClassification = z.infer<typeof EngineBackstopClassificationSchema>;
export type EngineBackstopDesiredGrant = z.infer<typeof EngineBackstopDesiredGrantSchema>;
export type EngineBackstopProjection = z.infer<typeof EngineBackstopProjectionSchema>;
