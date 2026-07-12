import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ApiClientService, ApiClientScopes } from '@enterpriseglue/shared/services/platform-admin/ApiClientService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('ApiClientService', () => {
  let rows: any[];
  let repo: any;
  let service: ApiClientService;

  beforeEach(() => {
    rows = [];
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
    (getDataSource as any).mockResolvedValue({ getRepository: () => repo });
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

  it('rejects tokens without the required scope', async () => {
    const created = await service.createClient({ name: 'Engine registration', scopes: [ApiClientScopes.ENGINE_REGISTER] });
    rows[0].scopesJson = JSON.stringify([]);

    await expect(service.authenticateToken(created.token, ApiClientScopes.ENGINE_REGISTER))
      .rejects
      .toThrow('API client missing required scope');
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
});
