import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import { TenantReleaseWorkAssignmentRequestSchema, TenantReleaseWorkAssignmentResponseSchema } from '@enterpriseglue/shared/schemas/platform-admin/tenant.js';

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
