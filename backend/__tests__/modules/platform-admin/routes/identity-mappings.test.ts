import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import identityMappingsRouter from '../../../../../packages/backend-host/src/modules/platform-admin/routes/identity-mappings.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';

const service = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), test: vi.fn(), previewStoredSnapshots: vi.fn() }));
const groups = vi.hoisted(() => ({ createGroup: vi.fn() }));
const permissions = vi.hoisted(() => ({ assignRole: vi.fn() }));
const dataSource = vi.hoisted(() => ({ transaction: vi.fn() }));
const requestContext = vi.hoisted(() => ({ tenantId: 'tenant-1' as string | null }));
const resourceRepository = vi.hoisted(() => ({ findOne: vi.fn() }));
const mappingRepository = vi.hoisted(() => ({ findOne: vi.fn() }));
vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { userId: 'admin-1' }; req.tenant = requestContext.tenantId ? { tenantId: requestContext.tenantId } : undefined; next(); } }));
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
    requestContext.tenantId = 'tenant-1';
    service.list.mockResolvedValue([mapping]); service.create.mockResolvedValue(mapping); service.update.mockResolvedValue(mapping); service.remove.mockResolvedValue(undefined); service.test.mockResolvedValue({ matches: true, entitlements: [{ type: 'group', externalId: 'ops' }] }); service.previewStoredSnapshots.mockResolvedValue({ scanned: 3, matches: 2, nonMatches: 1, failed: 0, truncated: false, latestSnapshotAt: 123, warnings: ['stored_snapshots_only'] });
    resourceRepository.findOne.mockResolvedValue({ tenantId: 'tenant-default' });
    mappingRepository.findOne.mockResolvedValue({ ...mapping, tenantId: 'tenant-1', ownershipMode: 'manual' });
    groups.createGroup.mockResolvedValue({ id: 'group-1' }); permissions.assignRole.mockResolvedValue({ id: 'assignment-1', warnings: [] }); dataSource.transaction.mockImplementation(async (callback: (manager: object) => Promise<unknown>) => callback({
      transaction: true,
      getRepository: vi.fn((entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepository : resourceRepository),
    }));
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
  it.each([
    ['engine', 'engine-1'],
    ['engine_set', 'engine-set-1'],
    ['engine_runtime_resource', 'runtime-resource-1'],
    ['engine_runtime_resource_set', 'runtime-resource-set-1'],
  ] as const)('atomically provisions a new group, mapping, and %s-scoped assignment', async (resourceType, resourceId) => {
    const response = await request(app).post('/api/identity/mappings/provision-access').send({ providerKey: 'identity.oidc.main', newGroup: { key: 'group.operators', name: 'Operators' }, entitlementType: 'group', externalId: 'ops', matchOperator: 'exact', roleId: 'system.engine.operator', resourceType, resourceId });
    expect(response.status).toBe(201);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(groups.createGroup).toHaveBeenCalledWith(expect.objectContaining({ key: 'group.operators', name: 'Operators', tenantId: 'tenant-1' }), expect.objectContaining({ transaction: true }));
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ targetGroupKey: 'group.operators' }), 'tenant-1', expect.objectContaining({ transaction: true }));
    expect(permissions.assignRole).toHaveBeenCalledWith(expect.objectContaining({
      principalType: 'group',
      principalId: 'group-1',
      resourceType,
      resourceId,
      source: 'sso',
      sourceRef: 'identity_mapping:mapping-1',
    }), expect.objectContaining({ transaction: true }));
    expect(response.body).toEqual(expect.objectContaining({ mapping, assignment: { id: 'assignment-1', warnings: [] }, createdGroup: { id: 'group-1' } }));
  });
  it('grants additional mapping access with SSO lineage instead of the generic manual endpoint', async () => {
    const response = await request(app).post('/api/identity/mappings/mapping-1/access').send({
      roleId: 'system.engine.operator',
      resourceType: 'engine',
      resourceId: 'engine-1',
    });
    expect(response.status).toBe(201);
    expect(permissions.assignRole).toHaveBeenCalledWith(expect.objectContaining({
      principalType: 'group',
      principalId: 'group-1',
      source: 'sso',
      sourceRef: 'identity_mapping:mapping-1',
    }), expect.objectContaining({ transaction: true }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.mapping.grant_access' }));
  });
  it('derives a selected dedicated engine tenant when platform settings have no request tenant', async () => {
    requestContext.tenantId = null;
    const response = await request(app).post('/api/identity/mappings/provision-access').send({ providerKey: 'identity.oidc.main', newGroup: { key: 'group.operators', name: 'Operators' }, entitlementType: 'group', externalId: 'ops', matchOperator: 'exact', roleId: 'system.engine.operator', resourceType: 'engine', resourceId: 'engine-1' });
    expect(response.status).toBe(201);
    expect(groups.createGroup).toHaveBeenCalledWith(expect.objectContaining({ tenantId: null }), expect.anything());
    expect(service.create).toHaveBeenCalledWith(expect.anything(), null, expect.anything());
    expect(resourceRepository.findOne).toHaveBeenCalledWith({ where: { id: 'engine-1' }, select: ['tenantId'] });
    expect(permissions.assignRole).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-default', resourceType: 'engine', resourceId: 'engine-1' }), expect.anything());
  });
  it('atomically provisions platform-scoped group access without a synthetic resource id', async () => {
    const response = await request(app).post('/api/identity/mappings/provision-access').send({ providerKey: 'identity.oidc.main', newGroup: { key: 'group.admins', name: 'Administrators' }, entitlementType: 'group', externalId: 'admins', matchOperator: 'exact', roleId: 'system.platform.admin', resourceType: 'platform' });
    expect(response.status).toBe(201);
    expect(permissions.assignRole).toHaveBeenCalledWith(expect.objectContaining({ principalType: 'group', roleId: 'system.platform.admin', resourceType: 'platform', resourceId: null }), expect.objectContaining({ transaction: true }));
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
