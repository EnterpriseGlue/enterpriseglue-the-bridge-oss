import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ApiClientService, ApiClientScopes } from '@enterpriseglue/shared/services/platform-admin/ApiClientService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('ApiClientService', () => {
  let rows: any[];
  let ownershipRows: any[];
  let repo: any;
  let ownershipRepo: any;
  let service: ApiClientService;

  beforeEach(() => {
    rows = [];
    ownershipRows = [];
    repo = {
      find: vi.fn().mockImplementation(() => [...rows].sort((left, right) => right.createdAt - left.createdAt)),
      insert: vi.fn().mockImplementation((row) => {
        rows.push({ ...row });
        return Promise.resolve({});
      }),
      findOneBy: vi.fn().mockImplementation((where) => Promise.resolve(rows.find((row) => row.id === where.id) || null)),
      update: vi.fn().mockImplementation((where, updates) => {
        const row = rows.find((item) => item.id === where.id);
        if (row) Object.assign(row, updates);
        return Promise.resolve({});
      }),
    };
    ownershipRepo = {
      find: vi.fn().mockImplementation(() => Promise.resolve([...ownershipRows])),
      findOneBy: vi.fn().mockImplementation((where) => Promise.resolve(ownershipRows.find((row) => row.objectType === where.objectType && row.objectId === where.objectId && (where.active === undefined || row.active === where.active)) || null)),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const manager = { getRepository: (entity: { name?: string }) => entity.name === 'AdminConfigObjectOwnership' ? ownershipRepo : repo };
    (getDataSource as any).mockResolvedValue({
      ...manager,
      transaction: (callback: (store: typeof manager) => unknown) => callback(manager),
    });
    service = new ApiClientService();
    vi.clearAllMocks();
  });

  it('creates API clients and returns the token only with the create response', async () => {
    const result = await service.createClient({
      name: 'Engine registration',
      scopes: [ApiClientScopes.ENGINE_REGISTER],
      createdById: 'admin-1',
    });

    expect(result.token).toMatch(/^egac_[0-9a-f-]+_[A-Za-z0-9_-]+$/);
    expect(result.client).toMatchObject({
      name: 'Engine registration',
      scopes: [ApiClientScopes.ENGINE_REGISTER],
      isActive: true,
      createdById: 'admin-1',
    });
    expect(rows[0].secretHash).not.toContain(result.token);

    const listed = await service.listClients();
    expect(listed[0]).not.toHaveProperty('secretHash');
    expect(listed[0]).not.toHaveProperty('token');
  });

  it('normalizes PostgreSQL bigint timestamps before returning API-client views', async () => {
    const created = await service.createClient({ name: 'Timestamp client' });
    rows[0].createdAt = '1700000000000';
    rows[0].updatedAt = '1700000000100';
    rows[0].lastUsedAt = '1700000000200';
    rows[0].revokedAt = '1700000000300';

    await expect(service.listClients()).resolves.toEqual([
      expect.objectContaining({
        id: created.client.id,
        createdAt: 1700000000000,
        updatedAt: 1700000000100,
        lastUsedAt: 1700000000200,
        revokedAt: 1700000000300,
      }),
    ]);
  });

  it('normalizes default scopes and rejects blank names or unsupported scopes', async () => {
    const defaulted = await service.createClient({ name: '  Default client  ', scopes: [' ', ApiClientScopes.ENGINE_REGISTER, ApiClientScopes.ENGINE_REGISTER] });

    expect(defaulted.client).toMatchObject({
      name: 'Default client',
      scopes: [ApiClientScopes.ENGINE_REGISTER],
      createdById: null,
    });
    await expect(service.createClient({ name: 'Empty scope list', scopes: [' '] }))
      .resolves.toMatchObject({ client: { scopes: [ApiClientScopes.ENGINE_REGISTER] } });
    rows[0].scopesJson = '{not-json';
    rows[1].scopesJson = null;
    rows.push({ ...rows[1], id: 'non-array-scopes', scopesJson: '{}' });
    await expect(service.listClients()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: defaulted.client.id, scopes: [] }),
    ]));
    await expect(service.createClient({ name: '   ' })).rejects.toThrow('API client name is required');
    await expect(service.createClient({ name: 'Invalid scope', scopes: ['not:a:scope'] }))
      .rejects.toThrow('Unsupported API client scope: not:a:scope');
  });

  it('authenticates scoped tokens and records last use', async () => {
    const created = await service.createClient({ name: 'Engine registration', scopes: [ApiClientScopes.ENGINE_REGISTER] });

    const authenticated = await service.authenticateToken(created.token, ApiClientScopes.ENGINE_REGISTER);

    expect(authenticated.id).toBe(created.client.id);
    expect(authenticated.lastUsedAt).toEqual(expect.any(Number));
    expect(repo.update).toHaveBeenCalledWith({ id: created.client.id }, expect.objectContaining({
      lastUsedAt: expect.any(Number),
    }));
  });

  it('supports deployment execution scoped tokens', async () => {
    const created = await service.createClient({
      name: 'Deployment automation',
      scopes: [ApiClientScopes.DEPLOYMENT_EXECUTE],
    });

    await expect(service.authenticateToken(created.token, ApiClientScopes.DEPLOYMENT_EXECUTE))
      .resolves
      .toMatchObject({
        id: created.client.id,
        scopes: [ApiClientScopes.DEPLOYMENT_EXECUTE],
      });
  });

  it('supports configuration bundle scoped tokens', async () => {
    const created = await service.createClient({
      name: 'Configuration automation',
      scopes: [ApiClientScopes.CONFIG_BUNDLE_MANAGE],
    });

    await expect(service.authenticateToken(created.token, ApiClientScopes.CONFIG_BUNDLE_MANAGE))
      .resolves
      .toMatchObject({
        id: created.client.id,
        scopes: [ApiClientScopes.CONFIG_BUNDLE_MANAGE],
      });
  });

  it('supports least-privilege identity provisioning tokens', async () => {
    const created = await service.createClient({
      name: 'Identity provisioning automation',
      scopes: [ApiClientScopes.IDENTITY_PROVISIONING_MANAGE],
    });

    await expect(service.authenticateToken(created.token, ApiClientScopes.IDENTITY_PROVISIONING_MANAGE))
      .resolves
      .toMatchObject({
        id: created.client.id,
        scopes: [ApiClientScopes.IDENTITY_PROVISIONING_MANAGE],
      });
  });

  it('rejects tokens without the required scope', async () => {
    const created = await service.createClient({ name: 'Engine registration', scopes: [ApiClientScopes.ENGINE_REGISTER] });
    rows[0].scopesJson = JSON.stringify([]);

    await expect(service.authenticateToken(created.token, ApiClientScopes.ENGINE_REGISTER))
      .rejects
      .toThrow('API client missing required scope');
  });

  it('fails closed for malformed, unknown, invalid-secret, and malformed-scope tokens', async () => {
    await expect(service.authenticateToken('wrong_prefix', ApiClientScopes.ENGINE_REGISTER))
      .rejects.toThrow('Invalid API client token');
    await expect(service.authenticateToken('egac_only-id', ApiClientScopes.ENGINE_REGISTER))
      .rejects.toThrow('Invalid API client token');
    await expect(service.authenticateToken('egac_unknown_secret', ApiClientScopes.ENGINE_REGISTER))
      .rejects.toThrow('Invalid API client token');

    const created = await service.createClient({ name: 'Engine registration' });
    await expect(service.authenticateToken(`${created.token}x`, ApiClientScopes.ENGINE_REGISTER))
      .rejects.toThrow('Invalid API client token');
    rows[0].scopesJson = '{not-json';
    await expect(service.authenticateToken(created.token, ApiClientScopes.ENGINE_REGISTER))
      .rejects.toThrow('API client missing required scope');
  });

  it('does not treat engine registration scope as deployment execution scope', async () => {
    const created = await service.createClient({ name: 'Engine registration', scopes: [ApiClientScopes.ENGINE_REGISTER] });

    await expect(service.authenticateToken(created.token, ApiClientScopes.DEPLOYMENT_EXECUTE))
      .rejects
      .toThrow('API client missing required scope');
  });

  it('revokes and blocks API clients', async () => {
    const created = await service.createClient({ name: 'Engine registration', scopes: [ApiClientScopes.ENGINE_REGISTER] });

    await service.revokeClient(created.client.id);

    expect(rows[0].isActive).toBe(false);
    await expect(service.authenticateToken(created.token, ApiClientScopes.ENGINE_REGISTER))
      .rejects
      .toThrow('Invalid API client token');
  });

  it('rotates client secrets', async () => {
    const created = await service.createClient({ name: 'Engine registration', scopes: [ApiClientScopes.ENGINE_REGISTER] });

    const rotated = await service.rotateClient(created.client.id);

    expect(rotated.client.id).toBe(created.client.id);
    expect(rotated.token).not.toBe(created.token);
    await expect(service.authenticateToken(created.token, ApiClientScopes.ENGINE_REGISTER))
      .rejects
      .toThrow('Invalid API client token');
    await expect(service.authenticateToken(rotated.token, ApiClientScopes.ENGINE_REGISTER))
      .resolves
      .toMatchObject({ id: created.client.id });
  });

  it('rejects unknown or revoked client rotation and revocation', async () => {
    await expect(service.rotateClient('missing')).rejects.toThrow('API client');
    await expect(service.revokeClient('missing')).rejects.toThrow('API client');

    const created = await service.createClient({ name: 'Engine registration' });
    await service.revokeClient(created.client.id);
    await expect(service.rotateClient(created.client.id)).rejects.toThrow('Cannot rotate a revoked API client');
  });

  it('exposes configuration provenance and rejects locked rotation and revocation', async () => {
    const created = await service.createClient({ name: 'Configured client' });
    ownershipRows.push({
      id: 'ownership-1', objectType: 'api_client', objectId: created.client.id,
      configKey: 'api-client.configured', sourceRef: 'config_bundle:platform.production',
      ownershipMode: 'config_locked', driftStatus: 'in_sync', active: true, generation: 1,
    });

    await expect(service.listClients()).resolves.toEqual([
      expect.objectContaining({
        id: created.client.id,
        configKey: 'api-client.configured',
        sourceRef: 'config_bundle:platform.production',
        ownershipMode: 'config_locked',
        driftStatus: 'in_sync',
      }),
    ]);
    await expect(service.rotateClient(created.client.id)).rejects.toThrow('managed by configuration');
    await expect(service.revokeClient(created.client.id)).rejects.toThrow('managed by configuration');
    expect(repo.update).not.toHaveBeenCalledWith({ id: created.client.id }, expect.objectContaining({ isActive: false }));
  });
});
