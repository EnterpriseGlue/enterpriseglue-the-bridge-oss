import { z } from 'zod';

const WorkloadOperationIdSchema = z.string()
  .min(16)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Use a stable workload operation identifier');

const ManagedEngineBaseUrlSchema = z.string().min(1).max(2048).url().superRefine((value, ctx) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    ctx.addIssue({ code: 'custom', message: 'Managed engine URLs must use HTTP or HTTPS' });
  }
  if (url.username || url.password) {
    ctx.addIssue({ code: 'custom', message: 'Managed engine URLs must not include embedded credentials' });
  }
});

export const ManagedEngineWorkloadRegistrationRequestSchema = z.object({
  operationId: WorkloadOperationIdSchema,
  engineRef: z.string().min(1).max(255).regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    'Use a stable managed engine reference',
  ),
  displayName: z.string().trim().min(1).max(255),
  baseUrl: ManagedEngineBaseUrlSchema,
  credentials: z.object({
    type: z.literal('basic'),
    username: z.string().min(1).max(255),
    password: z.string().min(1).max(4096),
  }).strict(),
}).strict();

export const ManagedEngineWorkloadDecommissionRequestSchema = z.object({
  operationId: WorkloadOperationIdSchema,
  engineRef: z.string().min(1).max(255).regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    'Use a stable managed engine reference',
  ),
}).strict();

const ManagedEngineWorkloadReceiptCommonShape = {
  schemaVersion: z.literal('managed-engine-workload-receipt.enterpriseglue.io/v1'),
  issuer: z.string().min(1),
  audience: z.string().min(1),
  operationId: WorkloadOperationIdSchema,
  actorId: z.string().min(1),
  tenantId: z.string().min(1).max(160),
  engineRef: z.string().min(1).max(255),
  enginePath: z.string().startsWith('/t/'),
  revision: z.literal(1),
  correlationId: z.string().min(8).max(160),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKeyHash: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAt: z.number().int().positive(),
};

export const ManagedEngineWorkloadReceiptPayloadSchema = z.discriminatedUnion('state', [
  z.object({
    ...ManagedEngineWorkloadReceiptCommonShape,
    engineId: z.string().min(1),
    action: z.literal('register'),
    state: z.literal('registered'),
  }).strict(),
  z.object({
    ...ManagedEngineWorkloadReceiptCommonShape,
    engineId: z.string().min(1),
    action: z.literal('decommission'),
    state: z.literal('decommissioned'),
  }).strict(),
  z.object({
    ...ManagedEngineWorkloadReceiptCommonShape,
    engineId: z.null(),
    action: z.literal('decommission'),
    state: z.literal('absent'),
  }).strict(),
]);

export const SignedManagedEngineWorkloadReceiptSchema = z.object({
  payload: ManagedEngineWorkloadReceiptPayloadSchema,
  signature: z.object({
    algorithm: z.literal('ES256'),
    keyId: z.string().min(1).max(160),
    value: z.string().min(1),
  }).strict(),
  idempotent: z.boolean(),
}).strict();

export type ManagedEngineWorkloadRegistrationRequest = z.infer<typeof ManagedEngineWorkloadRegistrationRequestSchema>;
export type ManagedEngineWorkloadDecommissionRequest = z.infer<typeof ManagedEngineWorkloadDecommissionRequestSchema>;
export type ManagedEngineWorkloadReceiptPayload = z.infer<typeof ManagedEngineWorkloadReceiptPayloadSchema>;
export type SignedManagedEngineWorkloadReceipt = z.infer<typeof SignedManagedEngineWorkloadReceiptSchema>;
