import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authenticateToken = vi.hoisted(() => vi.fn());
const execute = vi.hoisted(() => vi.fn());
const decommission = vi.hoisted(() => vi.fn());
const logAudit = vi.hoisted(() => vi.fn());

vi.mock('@enterpriseglue/shared/services/platform-admin/ServiceAccountService.js', () => ({
  SERVICE_ACCOUNT_TOKEN_PREFIX: 'egsa',
  ServiceAccountScopes: { DEPLOYMENT_EXECUTE: 'deployment:execute', TENANT_LIFECYCLE: 'tenant:lifecycle' },
  serviceAccountService: { authenticateToken },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/ManagedEngineWorkloadRegistrationService.js', () => ({
  managedEngineWorkloadRegistrationService: { execute, decommission },
}));
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({ logAudit }));

import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import router from '@enterpriseglue/backend-host/modules/tenancy/routes/tenants.js';

const endpoint = '/api/workloads/tenants/tenant-alpha/managed-engines';
const operationId = 'managed-engine-operation-0001';
const body = {
  operationId,
  engineRef: 'managed-alpha-01',
  displayName: 'Alpha managed Operaton',
  baseUrl: `http://egme-${'a'.repeat(40)}.managed.svc.cluster.local:8081/engine-rest`,
  credentials: { type: 'basic', username: 'engine-user', password: 'private-password' },
};
const receipt = {
  payload: {
    schemaVersion: 'managed-engine-workload-receipt.enterpriseglue.io/v1' as const,
    issuer: 'shard-a', audience: 'cloud-control-plane', operationId,
    actorId: 'service-account-cloud-worker', tenantId: 'tenant-alpha', engineId: 'engine-01',
    engineRef: 'managed-alpha-01', enginePath: '/t/alpha/engines', state: 'registered' as const,
    action: 'register' as const,
    revision: 1 as const, correlationId: 'correlation-managed-0001',
    requestHash: 'a'.repeat(64), idempotencyKeyHash: 'b'.repeat(64), issuedAt: 1,
  },
  signature: { algorithm: 'ES256' as const, keyId: 'key-1', value: 'signature' },
  idempotent: false,
};

describe('managed engine workload registration route', () => {
  const app = express().use(express.json()).use(router).use(errorHandler);

  beforeEach(() => {
    authenticateToken.mockResolvedValue({
      id: 'service-account-cloud-worker', scopes: ['tenant:lifecycle'], isActive: true,
    });
    execute.mockResolvedValue(receipt);
    decommission.mockResolvedValue({
      ...receipt,
      payload: { ...receipt.payload, operationId: 'managed-engine-decommission-0001', action: 'decommission', state: 'decommissioned' },
    });
    logAudit.mockResolvedValue(undefined);
  });

  afterEach(() => vi.clearAllMocks());

  it('requires the scoped workload identity and returns only the signed host receipt', async () => {
    const response = await request(app).post(endpoint)
      .auth('egsa_service-account-cloud-worker_secret', { type: 'bearer' })
      .set('idempotency-key', operationId)
      .set('x-correlation-id', 'correlation-managed-0001')
      .send(body);

    expect(response.status).toBe(201);
    expect(response.body).toEqual(receipt);
    expect(JSON.stringify(response.body)).not.toContain(body.credentials.username);
    expect(JSON.stringify(response.body)).not.toContain(body.credentials.password);
    expect(authenticateToken).toHaveBeenCalledExactlyOnceWith(
      'egsa_service-account-cloud-worker_secret',
      'tenant:lifecycle',
    );
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      actorId: 'service-account-cloud-worker',
      tenantId: 'tenant-alpha',
      idempotencyKey: operationId,
      correlationId: 'correlation-managed-0001',
      request: body,
    });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-alpha', resourceId: 'engine-01',
      details: expect.not.objectContaining({ credentials: expect.anything(), password: expect.anything() }),
    }));
  });

  it('returns 200 for an exact replay receipt', async () => {
    execute.mockResolvedValue({ ...receipt, idempotent: true });
    const response = await request(app).post(endpoint)
      .auth('egsa_service-account-cloud-worker_secret', { type: 'bearer' })
      .set('idempotency-key', operationId)
      .set('x-correlation-id', 'correlation-managed-0001')
      .send(body);
    expect(response.status).toBe(200);
  });

  it.each([
    ['browser bearer', 'browser-session-token'],
    ['API client bearer', 'egapi_client_secret'],
  ])('rejects %s before registration', async (_label, token) => {
    const response = await request(app).post(endpoint)
      .auth(token, { type: 'bearer' })
      .set('idempotency-key', operationId)
      .set('x-correlation-id', 'correlation-managed-0001')
      .send(body);
    expect(response.status).toBe(401);
    expect(authenticateToken).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['missing idempotency key', (call: request.Test) => call.set('x-correlation-id', 'correlation-managed-0001'), body],
    ['missing correlation ID', (call: request.Test) => call.set('idempotency-key', operationId), body],
    ['unknown request field', (call: request.Test) => call.set('idempotency-key', operationId).set('x-correlation-id', 'correlation-managed-0001'), { ...body, engineType: 'operaton' }],
  ])('rejects $label before registration', async (_label, configure, requestBody) => {
    const call = request(app).post(endpoint).auth('egsa_service-account-cloud-worker_secret', { type: 'bearer' });
    const response = await configure(call).send(requestBody);
    expect(response.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('binds decommission to the path engine reference and workload identity', async () => {
    const decommissionBody = { operationId: 'managed-engine-decommission-0001', engineRef: body.engineRef };
    const response = await request(app)
      .post(`${endpoint}/${body.engineRef}/decommission`)
      .auth('egsa_service-account-cloud-worker_secret', { type: 'bearer' })
      .set('idempotency-key', decommissionBody.operationId)
      .set('x-correlation-id', 'correlation-decommission-0001')
      .send(decommissionBody);
    expect(response.status).toBe(200);
    expect(response.body.payload).toMatchObject({ action: 'decommission', state: 'decommissioned' });
    expect(decommission).toHaveBeenCalledExactlyOnceWith({
      actorId: 'service-account-cloud-worker', tenantId: 'tenant-alpha',
      idempotencyKey: decommissionBody.operationId, correlationId: 'correlation-decommission-0001',
      request: decommissionBody,
    });
  });

  it('returns and audits a signed absent result without fabricating an engine id', async () => {
    const decommissionBody = { operationId: 'managed-engine-decommission-absent-0001', engineRef: body.engineRef };
    decommission.mockResolvedValue({
      ...receipt,
      payload: {
        ...receipt.payload,
        operationId: decommissionBody.operationId,
        engineId: null,
        action: 'decommission',
        state: 'absent',
      },
    });

    const response = await request(app)
      .post(`${endpoint}/${body.engineRef}/decommission`)
      .auth('egsa_service-account-cloud-worker_secret', { type: 'bearer' })
      .set('idempotency-key', decommissionBody.operationId)
      .set('x-correlation-id', 'correlation-decommission-absent-0001')
      .send(decommissionBody);

    expect(response.status).toBe(200);
    expect(response.body.payload).toMatchObject({ state: 'absent', engineId: null });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      resourceId: body.engineRef,
      details: expect.objectContaining({ state: 'absent', credentialsRetired: false }),
    }));
  });

  it('rejects a mismatched decommission engine reference before the service', async () => {
    const response = await request(app)
      .post(`${endpoint}/${body.engineRef}/decommission`)
      .auth('egsa_service-account-cloud-worker_secret', { type: 'bearer' })
      .set('idempotency-key', 'managed-engine-decommission-0002')
      .set('x-correlation-id', 'correlation-decommission-0002')
      .send({ operationId: 'managed-engine-decommission-0002', engineRef: 'managed-other' });
    expect(response.status).toBe(400);
    expect(decommission).not.toHaveBeenCalled();
  });
});
