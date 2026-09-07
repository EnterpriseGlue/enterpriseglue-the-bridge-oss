import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@enterpriseglue/shared/config/index.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { tenantReleaseWorkAssignmentService } from '@enterpriseglue/shared/services/platform-admin/TenantReleaseWorkAssignmentService.js';
import { tenantReleaseActivationService } from '@enterpriseglue/shared/services/platform-admin/TenantReleaseActivationService.js';
import router from '@enterpriseglue/backend-host/modules/tenancy/routes/tenants.js';

const originalToken = config.tenantReleaseControllerToken;
const token = 'test-only-release-controller';
const endpoint = '/api/workloads/tenants/tenant-a/release-assignment';
const body = { releaseId: 'release-a', assignmentEpoch: 3, expectedPlacementEpoch: 7 };
const proof = {
  schemaVersion: 'tenant-release-work-assignment.enterpriseglue.io/v2' as const,
  tenantId: 'tenant-a', releaseId: 'release-a', assignmentEpoch: 3,
  tenantStatus: 'active' as const, placementEpoch: 7, updatedEvents: 0, updatedSchedules: 0, idempotent: true,
};
const activationEndpoint = '/api/workloads/tenants/tenant-a/release-assignment-operations';
const activationBody = { releaseId: 'release-a', assignmentEpoch: 3, expectedPlacementEpoch: 7 };
const activationReceipt = {
  payload: {
    schemaVersion: 'tenant-release-activation-receipt.enterpriseglue.io/v1' as const,
    issuer: 'shard-a', audience: 'control-plane', operationId: 'operation-1', command: 'assign_release' as const,
    actorId: 'tenant-release-controller' as const, tenantId: 'tenant-a', releaseId: 'release-a',
    assignmentEpoch: 3, placementEpoch: 7, correlationId: 'activation-001',
    requestHash: 'a'.repeat(64), idempotencyKeyHash: 'b'.repeat(64), issuedAt: 1,
  },
  signature: { algorithm: 'ES256' as const, keyId: 'key-1', value: 'A'.repeat(86) },
};

describe('controller release assignment HTTP contract', () => {
  const app = express().use(express.json()).use(router).use(errorHandler);
  beforeEach(() => { config.tenantReleaseControllerToken = token; });
  afterEach(() => { config.tenantReleaseControllerToken = originalToken; vi.restoreAllMocks(); });

  it('forwards the placement precondition and retains the v2 proof with no-store', async () => {
    const assign = vi.spyOn(tenantReleaseWorkAssignmentService, 'assign').mockResolvedValue(proof);
    const res = await request(app).put(endpoint).auth(token, { type: 'bearer' }).send(body);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual(proof);
    expect(assign).toHaveBeenCalledExactlyOnceWith({ tenantId: 'tenant-a', ...body });
  });

  it.each([undefined, 'egsa_not-a-release-controller', 'incorrect'])('denies a non-controller bearer %s', async (credential) => {
    const assign = vi.spyOn(tenantReleaseWorkAssignmentService, 'assign');
    const call = request(app).put(endpoint);
    if (credential) call.auth(credential, { type: 'bearer' });
    const res = await call.send(body);
    expect(res.status).toBe(401);
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([{ ...body, expectedPlacementEpoch: '7' }, { ...body, ignoredPrecondition: 7 }])('rejects malformed or unknown preconditions', async (input) => {
    const assign = vi.spyOn(tenantReleaseWorkAssignmentService, 'assign');
    const res = await request(app).put(endpoint).auth(token, { type: 'bearer' }).send(input);
    expect(res.status).toBe(400);
    expect(assign).not.toHaveBeenCalled();
  });

  it('forwards immutable operation headers and returns the signed receipt unchanged', async () => {
    const execute = vi.spyOn(tenantReleaseActivationService, 'execute').mockResolvedValue(activationReceipt);
    const res = await request(app).post(activationEndpoint).auth(token, { type: 'bearer' })
      .set('idempotency-key', 'release-activation-request-001').set('x-correlation-id', 'activation-001')
      .send(activationBody);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual(activationReceipt);
    expect(execute).toHaveBeenCalledExactlyOnceWith({ tenantId: 'tenant-a', ...activationBody,
      idempotencyKey: 'release-activation-request-001', correlationId: 'activation-001' });
  });

  it.each([
    { label: 'missing idempotency key', mutate: (call: request.Test) => call.set('x-correlation-id', 'activation-001') },
    { label: 'missing correlation ID', mutate: (call: request.Test) => call.set('idempotency-key', 'release-activation-request-001') },
    { label: 'query parameter', mutate: (call: request.Test) => call.query({ retry: 'true' }).set('idempotency-key', 'release-activation-request-001').set('x-correlation-id', 'activation-001') },
  ])('rejects $label before activation execution', async ({ mutate }) => {
    const execute = vi.spyOn(tenantReleaseActivationService, 'execute');
    const res = await mutate(request(app).post(activationEndpoint).auth(token, { type: 'bearer' })).send(activationBody);
    expect(res.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires the dedicated controller credential for activation operations', async () => {
    const execute = vi.spyOn(tenantReleaseActivationService, 'execute');
    const res = await request(app).post(activationEndpoint)
      .set('idempotency-key', 'release-activation-request-001').set('x-correlation-id', 'activation-001')
      .send(activationBody);
    expect(res.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });
});
