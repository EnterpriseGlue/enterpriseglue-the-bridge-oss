import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import identityMappingsRouter from '../../../../../packages/backend-host/src/modules/platform-admin/routes/identity-mappings.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';

const service = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), test: vi.fn(), previewStoredSnapshots: vi.fn() }));
vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { userId: 'admin-1' }; req.tenant = { tenantId: 'tenant-1' }; next(); } }));
vi.mock('@enterpriseglue/shared/middleware/requireAction.js', () => ({ requireAction: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js', () => ({ identityEntitlementMappingService: service }));
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({ logAudit: vi.fn() }));

const mapping = { id: 'mapping-1', providerId: 'provider-1', providerKey: 'identity.oidc.main', targetGroupId: 'group-1', targetGroupKey: 'group.operators', entitlementType: 'group', externalId: 'ops', matchOperator: 'exact', syncMode: 'authoritative', isActive: true, configKey: null, sourceRef: null };

describe('identity mapping routes', () => {
  let app: express.Application;
  beforeEach(() => {
    vi.clearAllMocks();
    service.list.mockResolvedValue([mapping]); service.create.mockResolvedValue(mapping); service.update.mockResolvedValue(mapping); service.remove.mockResolvedValue(undefined); service.test.mockResolvedValue({ matches: true, entitlements: [{ type: 'group', externalId: 'ops' }] }); service.previewStoredSnapshots.mockResolvedValue({ scanned: 3, matches: 2, nonMatches: 1, failed: 0, truncated: false, latestSnapshotAt: 123, warnings: ['stored_snapshots_only'] });
    app = express(); app.use(express.json()); app.use(identityMappingsRouter); app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode || 500).json({ error: error.message }));
  });
  it('lists tenant-scoped provider-neutral mappings', async () => {
    const response = await request(app).get('/api/identity/mappings');
    expect(response.status).toBe(200); expect(service.list).toHaveBeenCalledWith('tenant-1');
  });
  it('creates and audits an entitlement-to-group mapping', async () => {
    const response = await request(app).post('/api/identity/mappings').send({ providerKey: 'identity.oidc.main', targetGroupKey: 'group.operators', entitlementType: 'group', externalId: 'ops', matchOperator: 'exact' });
    expect(response.status).toBe(201); expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ providerKey: 'identity.oidc.main' }), 'tenant-1'); expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.mapping.create' }));
  });
  it('tests claims without persisting memberships', async () => {
    const response = await request(app).post('/api/identity/mappings/test').send({ providerKey: 'identity.oidc.main', entitlementType: 'group', externalId: 'ops', matchOperator: 'exact', claims: { sub: 'user-1', groups: ['ops'] } });
    expect(response.status).toBe(200); expect(service.test).toHaveBeenCalledWith(expect.objectContaining({ claims: expect.any(Object) }), 'tenant-1');
  });
  it('previews stored snapshot coverage without requesting identity details', async () => {
    const response = await request(app).post('/api/identity/mappings/stored-snapshot-preview').send({ providerKey: 'identity.oidc.main', entitlementType: 'group', externalId: 'ops', matchOperator: 'exact' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ scanned: 3, matches: 2, nonMatches: 1 }));
    expect(response.body).not.toHaveProperty('identities');
    expect(service.previewStoredSnapshots).toHaveBeenCalledWith(expect.objectContaining({ providerKey: 'identity.oidc.main' }), 'tenant-1');
  });
});
