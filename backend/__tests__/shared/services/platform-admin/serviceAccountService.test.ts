import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  ServiceAccountScopes,
  ServiceAccountService,
} from '@enterpriseglue/shared/services/platform-admin/ServiceAccountService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('ServiceAccountService', () => {
  let rows: any[];
  let ownershipRows: any[];
  let repo: any;
  let ownershipRepo: any;
  let service: ServiceAccountService;

  beforeEach(() => {
    rows = [];
    ownershipRows = [];
    repo = {
      find: vi.fn().mockImplementation(({ where }: { where?: Record<string, unknown> } = {}) => {
        const filtered = where?.isActive === true ? rows.filter((row) => row.isActive) : rows;
        return [...filtered].sort((left, right) => right.createdAt - left.createdAt);
      }),
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
    service = new ServiceAccountService();
    vi.clearAllMocks();
  });

  it('creates service accounts and returns the token only with the create response', async () => {
    const result = await service.createServiceAccount({
      name: 'Release service',
      description: 'Release automation',
      scopes: [ServiceAccountScopes.DEPLOYMENT_EXECUTE],
      createdById: 'admin-1',
    });

    expect(result.token).toMatch(/^egsa_[0-9a-f-]+_[A-Za-z0-9_-]+$/);
    expect(result.account).toMatchObject({
      name: 'Release service',
      description: 'Release automation',
      scopes: [ServiceAccountScopes.DEPLOYMENT_EXECUTE],
      isActive: true,
      createdById: 'admin-1',
    });
    expect(rows[0].secretHash).not.toContain(result.token);

    const listed = await service.listServiceAccounts();
    expect(listed[0]).not.toHaveProperty('secretHash');
    expect(listed[0]).not.toHaveProperty('token');
  });

  it('normalizes PostgreSQL bigint timestamps before returning service-account views', async () => {
    const created = await service.createServiceAccount({ name: 'Timestamp account' });
    rows[0].createdAt = '1700000000000';
    rows[0].updatedAt = '1700000000100';
    rows[0].lastUsedAt = '1700000000200';
    rows[0].revokedAt = '1700000000300';

    await expect(service.listServiceAccounts()).resolves.toEqual([
      expect.objectContaining({
        id: created.account.id,
        createdAt: 1700000000000,
        updatedAt: 1700000000100,
        lastUsedAt: 1700000000200,
        revokedAt: 1700000000300,
      }),
    ]);
  });

  it('normalizes default values and lists inactive accounts only when requested', async () => {
    const created = await service.createServiceAccount({
      name: '  Release service  ',
      description: '   ',
      scopes: [' ', ServiceAccountScopes.DEPLOYMENT_EXECUTE, ServiceAccountScopes.DEPLOYMENT_EXECUTE],
    });
    rows.push({ ...rows[0], id: 'inactive', isActive: false, createdAt: rows[0].createdAt + 1 });

    expect(created.account).toMatchObject({
      name: 'Release service',
      description: null,
      scopes: [ServiceAccountScopes.DEPLOYMENT_EXECUTE],
      createdById: null,
    });
    await expect(service.createServiceAccount({ name: 'Empty scope list', scopes: [' '] }))
      .resolves.toMatchObject({ account: { scopes: [ServiceAccountScopes.DEPLOYMENT_EXECUTE] } });
    rows[0].scopesJson = '{not-json';
    rows[1].scopesJson = null;
    rows[2].scopesJson = '{}';
    await expect(service.listServiceAccounts()).resolves.toHaveLength(2);
    await expect(service.listServiceAccounts({ includeInactive: true })).resolves.toHaveLength(3);
    await expect(service.createServiceAccount({ name: '   ' })).rejects.toThrow('Service account name is required');
    await expect(service.createServiceAccount({ name: 'Invalid scope', scopes: ['engine:register'] }))
      .rejects.toThrow('Unsupported service account scope: engine:register');
  });

  it('authenticates scoped service-account tokens and records last use', async () => {
    const created = await service.createServiceAccount({ name: 'Release service' });

    const authenticated = await service.authenticateToken(created.token, ServiceAccountScopes.DEPLOYMENT_EXECUTE);

    expect(authenticated.id).toBe(created.account.id);
    expect(authenticated.lastUsedAt).toEqual(expect.any(Number));
    expect(repo.update).toHaveBeenCalledWith({ id: created.account.id }, expect.objectContaining({
      lastUsedAt: expect.any(Number),
    }));
  });

  it('rejects tokens without the required scope', async () => {
    const created = await service.createServiceAccount({ name: 'Release service' });
    rows[0].scopesJson = JSON.stringify([]);

    await expect(service.authenticateToken(created.token, ServiceAccountScopes.DEPLOYMENT_EXECUTE))
      .rejects
      .toThrow('Service account missing required scope');
  });

  it('fails closed for malformed, unknown, missing-secret, invalid-secret, and malformed-scope tokens', async () => {
    await expect(service.authenticateToken('wrong_prefix', ServiceAccountScopes.DEPLOYMENT_EXECUTE))
      .rejects.toThrow('Invalid service account token');
    await expect(service.authenticateToken('egsa_only-id', ServiceAccountScopes.DEPLOYMENT_EXECUTE))
      .rejects.toThrow('Invalid service account token');
    await expect(service.authenticateToken('egsa_unknown_secret', ServiceAccountScopes.DEPLOYMENT_EXECUTE))
      .rejects.toThrow('Invalid service account token');

    const created = await service.createServiceAccount({ name: 'Release service' });
    rows[0].scopesJson = '{not-json';
    await expect(service.authenticateToken(created.token, ServiceAccountScopes.DEPLOYMENT_EXECUTE))
      .rejects.toThrow('Service account missing required scope');
    rows[0].secretHash = null;
    await expect(service.authenticateToken(created.token, ServiceAccountScopes.DEPLOYMENT_EXECUTE))
      .rejects.toThrow('Invalid service account token');
    rows[0].secretHash = '$2b$10$invalid';
    await expect(service.authenticateToken(created.token, ServiceAccountScopes.DEPLOYMENT_EXECUTE))
      .rejects.toThrow('Invalid service account token');
  });

  it('revokes and blocks service accounts', async () => {
    const created = await service.createServiceAccount({ name: 'Release service' });

    await service.revokeServiceAccount(created.account.id);

    expect(rows[0].isActive).toBe(false);
    await expect(service.authenticateToken(created.token, ServiceAccountScopes.DEPLOYMENT_EXECUTE))
      .rejects
      .toThrow('Invalid service account token');
  });

  it('rotates service-account tokens', async () => {
    const created = await service.createServiceAccount({ name: 'Release service' });

    const rotated = await service.rotateServiceAccountToken(created.account.id);

    expect(rotated.account.id).toBe(created.account.id);
    expect(rotated.token).not.toBe(created.token);
    await expect(service.authenticateToken(created.token, ServiceAccountScopes.DEPLOYMENT_EXECUTE))
      .rejects
      .toThrow('Invalid service account token');
    await expect(service.authenticateToken(rotated.token, ServiceAccountScopes.DEPLOYMENT_EXECUTE))
      .resolves
      .toMatchObject({ id: created.account.id });
  });

  it('repairs legacy nullable rotation fields and handles unknown or already-revoked accounts', async () => {
    await expect(service.rotateServiceAccountToken('missing')).rejects.toThrow('Service account');
    await expect(service.revokeServiceAccount('missing')).rejects.toThrow('Service account');

    const created = await service.createServiceAccount({ name: 'Release service' });
    rows[0].tokenPrefix = null;
    rows[0].scopesJson = null;
    const rotated = await service.rotateServiceAccountToken(created.account.id);
    expect(rotated.account.tokenPrefix).toBe(`egsa_${created.account.id.slice(0, 8)}`);
    expect(rotated.account.scopes).toEqual([ServiceAccountScopes.DEPLOYMENT_EXECUTE]);

    await service.revokeServiceAccount(created.account.id);
    await expect(service.rotateServiceAccountToken(created.account.id)).rejects.toThrow('Cannot rotate a revoked service account');
    const updateCount = repo.update.mock.calls.length;
    await service.revokeServiceAccount(created.account.id);
    expect(repo.update).toHaveBeenCalledTimes(updateCount);
  });

  it('exposes configuration provenance and rejects locked rotation and revocation', async () => {
    const created = await service.createServiceAccount({ name: 'Configured service account' });
    ownershipRows.push({
      id: 'ownership-1', objectType: 'service_account', objectId: created.account.id,
      configKey: 'service-account.configured', sourceRef: 'config_bundle:platform.production',
      ownershipMode: 'config_locked', driftStatus: 'in_sync', active: true, generation: 1,
    });

    await expect(service.listServiceAccounts()).resolves.toEqual([
      expect.objectContaining({
        id: created.account.id,
        configKey: 'service-account.configured',
        sourceRef: 'config_bundle:platform.production',
        ownershipMode: 'config_locked',
        driftStatus: 'in_sync',
      }),
    ]);
    await expect(service.rotateServiceAccountToken(created.account.id)).rejects.toThrow('managed by configuration');
    await expect(service.revokeServiceAccount(created.account.id)).rejects.toThrow('managed by configuration');
    expect(repo.update).not.toHaveBeenCalledWith({ id: created.account.id }, expect.objectContaining({ isActive: false }));
  });
});
