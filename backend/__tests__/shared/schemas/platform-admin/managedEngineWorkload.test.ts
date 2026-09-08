import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('managed engine workload contracts', () => {
  const request = {
    operationId: 'managed-engine-operation-0001',
    engineRef: 'managed-alpha-01',
    displayName: 'Alpha managed Operaton',
    baseUrl: `http://egme-${'a'.repeat(40)}.managed.svc.cluster.local:8081/engine-rest`,
    credentials: { type: 'basic', username: 'engine-user', password: 'private-password' },
  };

  it('accepts only the bounded basic-auth workload command', async () => {
    const { ManagedEngineWorkloadRegistrationRequestSchema, ManagedEngineWorkloadDecommissionRequestSchema } = await import(
      '@enterpriseglue/shared/schemas/platform-admin/managed-engine-workload.js'
    );
    expect(ManagedEngineWorkloadRegistrationRequestSchema.parse(request)).toEqual(request);
    expect(ManagedEngineWorkloadRegistrationRequestSchema.safeParse({ ...request, type: 'operaton' }).success).toBe(false);
    expect(ManagedEngineWorkloadRegistrationRequestSchema.safeParse({
      ...request, credentials: { type: 'bearer', token: 'secret' },
    }).success).toBe(false);
    expect(ManagedEngineWorkloadRegistrationRequestSchema.safeParse({
      ...request, baseUrl: `http://user:password@egme-${'a'.repeat(40)}.managed.svc.cluster.local:8081/engine-rest`,
    }).success).toBe(false);
    expect(ManagedEngineWorkloadDecommissionRequestSchema.parse({
      operationId: 'managed-engine-decommission-0001', engineRef: request.engineRef,
    })).toEqual({ operationId: 'managed-engine-decommission-0001', engineRef: request.engineRef });
  });

  it('keeps the signed response secret-free and publishes the exact workload-only OpenAPI operation', async () => {
    const { SignedManagedEngineWorkloadReceiptSchema } = await import(
      '@enterpriseglue/shared/schemas/platform-admin/managed-engine-workload.js'
    );
    const receipt = SignedManagedEngineWorkloadReceiptSchema.parse({
      payload: {
        schemaVersion: 'managed-engine-workload-receipt.enterpriseglue.io/v1',
        issuer: 'shard-a', audience: 'cloud-control-plane', operationId: request.operationId,
        actorId: 'service-account-1', tenantId: 'tenant-alpha', engineId: 'engine-01',
        engineRef: request.engineRef, enginePath: '/t/alpha/engines', action: 'register', state: 'registered', revision: 1,
        correlationId: 'correlation-managed-0001', requestHash: 'a'.repeat(64),
        idempotencyKeyHash: 'b'.repeat(64), issuedAt: 1,
      },
      signature: { algorithm: 'ES256', keyId: 'key-1', value: 'signature' },
      idempotent: false,
    });
    expect(receipt.payload).not.toHaveProperty('credentials');
    expect(receipt.payload).not.toHaveProperty('baseUrl');
    expect(receipt.payload).not.toHaveProperty('username');
    expect(SignedManagedEngineWorkloadReceiptSchema.safeParse({
      ...receipt,
      payload: {
        ...receipt.payload,
        action: 'decommission', state: 'absent', engineId: null,
      },
    }).success).toBe(true);
    expect(SignedManagedEngineWorkloadReceiptSchema.safeParse({
      ...receipt,
      payload: { ...receipt.payload, state: 'absent' },
    }).success).toBe(false);

    const operation = generateOpenApi().paths?.['/api/workloads/tenants/{tenantId}/managed-engines']?.post;
    expect(operation?.['x-enterpriseglue-authz']).toMatchObject({
      actionId: 'platform.tenants.workload.managed-engines.register',
      permission: 'platform:tenants:manage',
      resourceResolver: 'platform.self',
      risk: 'critical',
    });
    expect(operation?.requestBody).toBeDefined();
    expect(operation?.responses?.['200']).toBeDefined();
    expect(operation?.responses?.['201']).toBeDefined();
    expect(operation?.responses?.['401']).toBeDefined();
    expect(operation?.responses?.['409']).toBeDefined();
    const decommission = generateOpenApi().paths?.['/api/workloads/tenants/{tenantId}/managed-engines/{engineRef}/decommission']?.post;
    expect(decommission?.['x-enterpriseglue-authz']).toMatchObject({
      actionId: 'platform.tenants.workload.managed-engines.decommission',
      permission: 'platform:tenants:manage',
      risk: 'critical',
    });
    expect(decommission?.responses?.['200']).toBeDefined();
  });
});
