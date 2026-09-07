import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import { TenantReleaseWorkAssignmentRequestSchema, TenantReleaseWorkAssignmentResponseSchema } from '@enterpriseglue/shared/schemas/platform-admin/tenant.js';
import { TenantWorkloadReceiptPayloadSchema } from '@enterpriseglue/shared/schemas/platform-admin/tenant.js';
import {
  SignedTenantReleaseActivationReceiptSchema, TenantReleaseActivationInputSchema, TenantReleaseActivationRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/tenant-release-activation.js';

const request = { releaseId: 'host-release', assignmentEpoch: 3 };
const response = { schemaVersion: 'tenant-release-work-assignment.enterpriseglue.io/v1', tenantId: 'tenant-a', ...request, updatedEvents: 0, updatedSchedules: 0, idempotent: true };

describe('tenant release assignment version negotiation', () => {
  it('publishes the optional precondition and both response contracts in generated OpenAPI', () => {
    const operation = generateOpenApi().paths?.['/api/workloads/tenants/{tenantId}/release-assignment']?.put;
    const serialized = JSON.stringify(operation);
    expect(serialized).toContain('expectedPlacementEpoch');
    expect(serialized).toContain('tenant-release-work-assignment.enterpriseglue.io/v1');
    expect(serialized).toContain('tenant-release-work-assignment.enterpriseglue.io/v2');
    expect(serialized).toContain('tenantStatus');
    expect(serialized).toContain('placementEpoch');
  });
  it('preserves legacy request and response shapes', () => {
    expect(TenantReleaseWorkAssignmentRequestSchema.parse(request)).toEqual(request);
    expect(TenantReleaseWorkAssignmentResponseSchema.parse(response)).toEqual(response);
  });
  it('accepts explicit conditional activation and requires all v2 proof fields', () => {
    expect(TenantReleaseWorkAssignmentRequestSchema.parse({ ...request, expectedPlacementEpoch: 7 }).expectedPlacementEpoch).toBe(7);
    const v2 = { ...response, schemaVersion: 'tenant-release-work-assignment.enterpriseglue.io/v2', tenantStatus: 'active', placementEpoch: 7 };
    expect(TenantReleaseWorkAssignmentResponseSchema.parse(v2)).toEqual(v2);
    for (const field of ['tenantStatus', 'placementEpoch']) {
      const incomplete: Record<string, unknown> = { ...v2 };
      delete incomplete[field];
      expect(TenantReleaseWorkAssignmentResponseSchema.safeParse(incomplete).success).toBe(false);
    }
    expect(TenantReleaseWorkAssignmentResponseSchema.safeParse({ ...v2, tenantStatus: 'suspended' }).success).toBe(false);
    expect(TenantReleaseWorkAssignmentResponseSchema.safeParse({ ...v2, schemaVersion: response.schemaVersion }).success).toBe(false);
  });
  it.each([0, -1, 1.5, '7', null, Number.MAX_SAFE_INTEGER + 1])('rejects invalid placement preconditions: %s', (expectedPlacementEpoch) => {
    expect(TenantReleaseWorkAssignmentRequestSchema.safeParse({ ...request, expectedPlacementEpoch }).success).toBe(false);
  });
  it('rejects unknown request fields so misspelled preconditions cannot downgrade to legacy activation', () => {
    expect(TenantReleaseWorkAssignmentRequestSchema.safeParse({ ...request, expectedPlacementVersion: 7 }).success).toBe(false);
  });
});

describe('durable tenant release activation operation contract', () => {
  const input = { tenantId: 'tenant-a', releaseId: 'host-release', assignmentEpoch: 3, expectedPlacementEpoch: 7,
    idempotencyKey: 'release-activation-request-001', correlationId: 'activation-001' };
  const receipt = {
    payload: {
      schemaVersion: 'tenant-release-activation-receipt.enterpriseglue.io/v1', issuer: 'shard-a', audience: 'control-plane',
      operationId: 'operation-1', command: 'assign_release', actorId: 'tenant-release-controller', tenantId: 'tenant-a',
      releaseId: 'host-release', assignmentEpoch: 3, placementEpoch: 7, correlationId: 'activation-001',
      requestHash: 'a'.repeat(64), idempotencyKeyHash: 'b'.repeat(64), issuedAt: 1,
    }, signature: { algorithm: 'ES256', keyId: 'key-1', value: 'A'.repeat(86) },
  };

  it('publishes the POST body, immutable headers and signed response in OpenAPI', () => {
    const operation = generateOpenApi().paths?.['/api/workloads/tenants/{tenantId}/release-assignment-operations']?.post;
    const serialized = JSON.stringify(operation);
    expect(operation).toBeDefined();
    for (const field of ['idempotency-key', 'x-correlation-id', 'expectedPlacementEpoch',
      'tenant-release-activation-receipt.enterpriseglue.io/v1', 'assign_release', 'tenant-release-controller']) {
      expect(serialized).toContain(field);
    }
  });

  it('keeps the developer example aligned with the executable schemas', () => {
    const example = JSON.parse(readFileSync(new URL(
      '../../../../../docs/examples/tenant-release-activation-operation.json', import.meta.url,
    ), 'utf8'));
    expect(example.request.method).toBe('POST');
    expect(TenantReleaseActivationInputSchema.parse({
      tenantId: 'tenant-a', ...example.request.body,
      idempotencyKey: example.request.headers['idempotency-key'],
      correlationId: example.request.headers['x-correlation-id'],
    })).toBeDefined();
    expect(SignedTenantReleaseActivationReceiptSchema.parse(example.response)).toEqual(example.response);
  });

  it('keeps the activation receipt separate from the unchanged lifecycle v1 contract', () => {
    expect(TenantReleaseActivationRequestSchema.parse({ releaseId: input.releaseId,
      assignmentEpoch: input.assignmentEpoch, expectedPlacementEpoch: input.expectedPlacementEpoch })).toEqual({
      releaseId: input.releaseId, assignmentEpoch: 3, expectedPlacementEpoch: 7,
    });
    expect(TenantReleaseActivationInputSchema.parse(input)).toEqual(input);
    expect(SignedTenantReleaseActivationReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(TenantWorkloadReceiptPayloadSchema.safeParse(receipt.payload).success).toBe(false);
  });

  it.each([
    { ...input, expectedPlacementEpoch: undefined },
    { ...input, assignmentEpoch: Number.MAX_SAFE_INTEGER + 1 },
    { ...input, idempotencyKey: 'contains a space and is invalid' },
    { ...input, correlationId: 'bad/path' },
    { ...input, retry: true },
  ])('rejects incomplete, unsafe or expanded activation intent', (candidate) => {
    expect(TenantReleaseActivationInputSchema.safeParse(candidate).success).toBe(false);
  });
});
