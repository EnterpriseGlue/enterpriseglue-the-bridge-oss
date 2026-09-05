import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@enterpriseglue/shared/config/index.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { tenantReleaseWorkAssignmentService } from '@enterpriseglue/shared/services/platform-admin/TenantReleaseWorkAssignmentService.js';
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
});
