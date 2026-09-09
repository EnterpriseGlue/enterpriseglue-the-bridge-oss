import { z } from 'zod';

export const ReleaseEffectReleaseIdSchema = z.string().min(1).max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const ReleaseEffectCohortEpochSchema = z.coerce.number().int().positive()
  .max(Number.MAX_SAFE_INTEGER);

export const ReleaseEffectCohortMutationRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();

export const ReleaseEffectSourceStatusSchema = z.object({
  sourceId: z.string().min(1).max(160),
  owner: z.enum(['api', 'worker', 'api-and-worker']),
  settlementRequired: z.boolean(),
  coverage: z.enum(['authoritative', 'uncovered', 'observation_only']),
  durableTables: z.array(z.string().min(1).max(160)).max(32),
  admissionBoundary: z.string().min(1).max(1024),
  settlementBasis: z.string().min(1).max(1024),
  outstanding: z.number().int().nonnegative().nullable(),
  reasonCode: z.enum(['settled', 'outstanding', 'uncovered', 'observation_only']),
}).strict();

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const ReleaseEffectSettlementStatusSchema = z.object({
  schemaVersion: z.literal('release-effect-settlement.enterpriseglue.io/v1'),
  releaseId: ReleaseEffectReleaseIdSchema,
  cohortEpoch: ReleaseEffectCohortEpochSchema,
  state: z.enum(['open', 'closing', 'settled']),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  inventoryVersion: z.string().min(1).max(160),
  configuredInventoryVersion: z.literal('release-effect-inventory.enterpriseglue.io/v1'),
  inventorySha256: hash,
  configuredInventorySha256: hash,
  inventoryComplete: z.boolean(),
  releaseAssignmentsOutstanding: z.number().int().nonnegative(),
  coveredSourcesSettled: z.boolean(),
  settled: z.boolean(),
  eligibleForShutdown: z.boolean(),
  openedAt: timestamp,
  closedAt: timestamp.nullable(),
  settledAt: timestamp.nullable(),
  updatedAt: timestamp,
  sources: z.array(ReleaseEffectSourceStatusSchema).min(1).max(100),
}).strict();

export type ReleaseEffectSettlementStatus = z.infer<typeof ReleaseEffectSettlementStatusSchema>;
