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
  let repo: any;
  let service: ServiceAccountService;

  beforeEach(() => {
    rows = [];
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
    (getDataSource as any).mockResolvedValue({ getRepository: () => repo });
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
});
