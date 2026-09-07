import { z } from 'zod';

const identity = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const epoch = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);

export const TenantReleaseActivationRequestSchema = z.object({
  releaseId: z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  assignmentEpoch: epoch,
  expectedPlacementEpoch: epoch,
}).strict();

export const TenantReleaseActivationInputSchema = TenantReleaseActivationRequestSchema.extend({
  tenantId: identity,
  correlationId: identity.min(8),
  idempotencyKey: z.string().min(16).max(200).regex(/^[\x21-\x7e]+$/),
}).strict();

export const TenantReleaseActivationReceiptPayloadSchema = z.object({
  schemaVersion: z.literal('tenant-release-activation-receipt.enterpriseglue.io/v1'),
  issuer: z.string().min(1).max(512),
  audience: z.string().min(1).max(512),
  operationId: identity,
  command: z.literal('assign_release'),
  actorId: z.literal('tenant-release-controller'),
  tenantId: identity,
  releaseId: TenantReleaseActivationRequestSchema.shape.releaseId,
  assignmentEpoch: epoch,
  placementEpoch: epoch,
  correlationId: identity.min(8),
  requestHash: hash,
  idempotencyKeyHash: hash,
  issuedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

export const SignedTenantReleaseActivationReceiptSchema = z.object({
  payload: TenantReleaseActivationReceiptPayloadSchema,
  signature: z.object({
    algorithm: z.literal('ES256'),
    keyId: identity,
    value: z.string().length(86).regex(/^[A-Za-z0-9_-]+$/),
  }).strict(),
}).strict();

export type TenantReleaseActivationInput = z.infer<typeof TenantReleaseActivationInputSchema>;
export type TenantReleaseActivationReceiptPayload = z.infer<typeof TenantReleaseActivationReceiptPayloadSchema>;
export type SignedTenantReleaseActivationReceipt = z.infer<typeof SignedTenantReleaseActivationReceiptSchema>;
