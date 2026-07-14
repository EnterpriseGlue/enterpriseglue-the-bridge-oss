import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import identityMappingsRouter from '../../../../../packages/backend-host/src/modules/platform-admin/routes/identity-mappings.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';

const service = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), test: vi.fn(), previewStoredSnapshots: vi.fn() }));
const groups = vi.hoisted(() => ({ createGroup: vi.fn() }));
const permissions = vi.hoisted(() => ({ assignRole: vi.fn() }));
const dataSource = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { userId: 'admin-1' }; req.tenant = { tenantId: 'tenant-1' }; next(); } }));
vi.mock('@enterpriseglue/shared/middleware/requireAction.js', () => ({ requireAction: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js', () => ({ identityEntitlementMappingService: service }));
vi.mock('@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js', () => ({ authzGroupService: groups }));
vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({ permissionService: permissions }));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn(async () => dataSource) }));
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({ logAudit: vi.fn() }));

const mapping = { id: 'mapping-1', providerId: 'provider-1', providerKey: 'identity.oidc.main', targetGroupId: 'group-1', targetGroupKey: 'group.operators', entitlementType: 'group', externalId: 'ops', matchOperator: 'exact', syncMode: 'authoritative', isActive: true, configKey: null, sourceRef: null };

describe('identity mapping routes', () => {
  let app: express.Application;
  beforeEach(() => {
    vi.clearAllMocks();
    service.list.mockResolvedValue([mapping]); service.create.mockResolvedValue(mapping); service.update.mockResolvedValue(mapping); service.remove.mockResolvedValue(undefined); service.test.mockResolvedValue({ matches: true, entitlements: [{ type: 'group', externalId: 'ops' }] }); service.previewStoredSnapshots.mockResolvedValue({ scanned: 3, matches: 2, nonMatches: 1, failed: 0, truncated: false, latestSnapshotAt: 123, warnings: ['stored_snapshots_only'] });
    groups.createGroup.mockResolvedValue({ id: 'group-1' }); permissions.assignRole.mockResolvedValue({ id: 'assignment-1', warnings: [] }); dataSource.transaction.mockImplementation(async (callback: (manager: object) => Promise<unknown>) => callback({ transaction: true }));
    app = express(); app.use(express.json({ limit: '512kb' })); app.use(identityMappingsRouter); app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode || 500).json({ error: error.message }));
  });
  it('lists tenant-scoped provider-neutral mappings', async () => {
    const response = await request(app).get('/api/identity/mappings');
    expect(response.status).toBe(200); expect(service.list).toHaveBeenCalledWith('tenant-1');
  });
  it('creates and audits an entitlement-to-group mapping', async () => {
    const response = await request(app).post('/api/identity/mappings').send({ providerKey: 'identity.oidc.main', targetGroupKey: 'group.operators', entitlementType: 'group', externalId: 'ops', matchOperator: 'exact' });
    expect(response.status).toBe(201); expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ providerKey: 'identity.oidc.main' }), 'tenant-1'); expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.mapping.create' }));
  });
  it('accepts authenticated identity mappings for explicit provider defaults', async () => {
    const response = await request(app).post('/api/identity/mappings').send({ providerKey: 'identity.oidc.main', targetGroupKey: 'authenticated-users', entitlementType: 'authenticated', externalId: 'authenticated', matchOperator: 'exact' });
    expect(response.status).toBe(201); expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ entitlementType: 'authenticated', externalId: 'authenticated' }), 'tenant-1');
  });
  it('rejects OAuth scopes as human identity-mapping sources', async () => {
    const response = await request(app).post('/api/identity/mappings').send({ providerKey: 'identity.oidc.main', targetGroupKey: 'group.operators', entitlementType: 'scope', externalId: 'engines.read', matchOperator: 'exact' });
    expect(response.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });
  it('atomically provisions a new group, mapping, and scoped assignment', async () => {
    const response = await request(app).post('/api/identity/mappings/provision-access').send({ providerKey: 'identity.oidc.main', newGroup: { key: 'group.operators', name: 'Operators' }, entitlementType: 'group', externalId: 'ops', matchOperator: 'exact', roleId: 'system.engine.operator', resourceType: 'engine', resourceId: 'engine-1' });
    expect(response.status).toBe(201);
    expect(groups.createGroup).toHaveBeenCalledWith(expect.objectContaining({ key: 'group.operators', name: 'Operators', tenantId: 'tenant-1' }), { transaction: true });
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ targetGroupKey: 'group.operators' }), 'tenant-1', { transaction: true });
    expect(permissions.assignRole).toHaveBeenCalledWith(expect.objectContaining({ principalType: 'group', principalId: 'group-1', resourceType: 'engine', resourceId: 'engine-1' }), { transaction: true });
    expect(response.body).toEqual(expect.objectContaining({ mapping, assignment: { id: 'assignment-1', warnings: [] }, createdGroup: { id: 'group-1' } }));
  });
  it('atomically provisions platform-scoped group access without a synthetic resource id', async () => {
    const response = await request(app).post('/api/identity/mappings/provision-access').send({ providerKey: 'identity.oidc.main', newGroup: { key: 'group.admins', name: 'Administrators' }, entitlementType: 'group', externalId: 'admins', matchOperator: 'exact', roleId: 'system.platform.admin', resourceType: 'platform' });
    expect(response.status).toBe(201);
    expect(permissions.assignRole).toHaveBeenCalledWith(expect.objectContaining({ principalType: 'group', roleId: 'system.platform.admin', resourceType: 'platform', resourceId: null }), { transaction: true });
  });
  it('requires exactly one existing or new target group for transactional provisioning', async () => {
    const response = await request(app).post('/api/identity/mappings/provision-access').send({ providerKey: 'identity.oidc.main', targetGroupKey: 'group.operators', newGroup: { key: 'group.other', name: 'Other' }, entitlementType: 'group', externalId: 'ops', matchOperator: 'exact', roleId: 'system.engine.operator', resourceType: 'engine', resourceId: 'engine-1' });
    expect(response.status).toBe(400);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
  it('tests claims without persisting memberships', async () => {
    const response = await request(app).post('/api/identity/mappings/test').send({ providerKey: 'identity.oidc.main', entitlementType: 'group', externalId: 'ops', matchOperator: 'exact', claims: { sub: 'user-1', groups: ['ops'] } });
    expect(response.status).toBe(200); expect(service.test).toHaveBeenCalledWith(expect.objectContaining({ claims: expect.any(Object) }), 'tenant-1');
  });
  it('rejects oversized identity test payloads before evaluating claims', async () => {
    const response = await request(app).post('/api/identity/mappings/test').send({
      providerKey: 'identity.oidc.main', entitlementType: 'group', externalId: 'ops', matchOperator: 'exact',
      claims: { oversized: 'x'.repeat(300 * 1024) },
    });
    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: 'Request payload exceeds the allowed size',
      code: 'PAYLOAD_TOO_LARGE',
      maxBytes: 256 * 1024,
    });
    expect(service.test).not.toHaveBeenCalled();
  });
  it('previews stored snapshot coverage without requesting identity details', async () => {
    const response = await request(app).post('/api/identity/mappings/stored-snapshot-preview').send({ providerKey: 'identity.oidc.main', entitlementType: 'group', externalId: 'ops', matchOperator: 'exact' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ scanned: 3, matches: 2, nonMatches: 1 }));
    expect(response.body).not.toHaveProperty('identities');
    expect(service.previewStoredSnapshots).toHaveBeenCalledWith(expect.objectContaining({ providerKey: 'identity.oidc.main' }), 'tenant-1');
  });
});
