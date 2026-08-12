import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitProvider } from '@enterpriseglue/shared/db/entities/GitProvider.js';
import { GitRepository } from '@enterpriseglue/shared/db/entities/GitRepository.js';
import { GitCredential } from '@enterpriseglue/shared/db/entities/GitCredential.js';
import { gitProviderService } from '@enterpriseglue/shared/services/git/GitProviderService.js';
import { adminConfigObjectOwnershipService } from '@enterpriseglue/shared/services/platform-admin/AdminConfigObjectOwnershipService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/encryption.js', () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  isEncrypted: vi.fn(() => false),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/AdminConfigObjectOwnershipService.js', () => ({
  adminConfigObjectOwnershipService: { claimManualMutation: vi.fn() },
}));

describe('GitProviderService', () => {
  const mockProviderFind = vi.fn();
  const mockProviderFindOneBy = vi.fn();
  const mockProviderUpdate = vi.fn();
  const mockRepoQb = {
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    getRawMany: vi.fn().mockResolvedValue([]),
  };
  const mockCredQb = {
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    getRawMany: vi.fn().mockResolvedValue([]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const dataSource = {
      getRepository: (entity: unknown) => {
        if (entity === GitProvider) return {
          find: mockProviderFind,
          findOneBy: mockProviderFindOneBy,
          update: mockProviderUpdate,
        };
        if (entity === GitRepository) return {
          createQueryBuilder: () => mockRepoQb,
        };
        if (entity === GitCredential) return {
          createQueryBuilder: () => mockCredQb,
        };
        throw new Error(`Unexpected entity: ${entity}`);
      },
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      ...dataSource,
      transaction: (work: (manager: typeof dataSource) => unknown) => work(dataSource),
    });
    (adminConfigObjectOwnershipService.claimManualMutation as unknown as Mock).mockResolvedValue(undefined);
  });

  describe('listActive', () => {
    it('returns mapped active providers', async () => {
      mockProviderFind.mockResolvedValue([
        {
          id: 'p1', name: 'GitHub', type: 'github',
          baseUrl: 'https://github.com', apiUrl: 'https://api.github.com',
          customBaseUrl: null, customApiUrl: null,
          supportsOAuth: true, supportsPAT: true, isActive: true,
        },
      ]);

      const result = await gitProviderService.listActive();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'p1', name: 'GitHub', type: 'github',
        baseUrl: 'https://github.com', apiUrl: 'https://api.github.com',
        supportsOAuth: true, supportsPAT: true,
      });
    });

    it('uses custom URLs when set', async () => {
      mockProviderFind.mockResolvedValue([
        {
          id: 'p1', name: 'GitHub Enterprise', type: 'github',
          baseUrl: 'https://github.com', apiUrl: 'https://api.github.com',
          customBaseUrl: 'https://ghe.corp.com', customApiUrl: 'https://ghe.corp.com/api/v3',
          supportsOAuth: true, supportsPAT: true, isActive: true,
        },
      ]);

      const result = await gitProviderService.listActive();

      expect(result[0].baseUrl).toBe('https://ghe.corp.com');
      expect(result[0].apiUrl).toBe('https://ghe.corp.com/api/v3');
    });

    it('returns empty array when no active providers', async () => {
      mockProviderFind.mockResolvedValue([]);
      const result = await gitProviderService.listActive();
      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('returns provider with effective URLs', async () => {
      mockProviderFindOneBy.mockResolvedValue({
        id: 'p1', name: 'GitHub', type: 'github',
        baseUrl: 'https://github.com', apiUrl: 'https://api.github.com',
        customBaseUrl: null, customApiUrl: null,
      });

      const result = await gitProviderService.getById('p1');

      expect(result.effectiveBaseUrl).toBe('https://github.com');
      expect(result.effectiveApiUrl).toBe('https://api.github.com');
    });

    it('throws when provider not found', async () => {
      mockProviderFindOneBy.mockResolvedValue(null);

      await expect(gitProviderService.getById('nonexistent'))
        .rejects.toThrow();
    });
  });

  describe('listAllWithUsage', () => {
    it('includes connection counts per provider', async () => {
      mockProviderFind.mockResolvedValue([
        { id: 'p1', name: 'GitHub', type: 'github' },
      ]);
      mockRepoQb.getRawMany.mockResolvedValue([
        { providerId: 'p1', projectConnectionsCount: '3' },
      ]);
      mockCredQb.getRawMany.mockResolvedValue([
        { providerId: 'p1', gitConnectionsCount: '2' },
      ]);

      const result = await gitProviderService.listAllWithUsage();

      expect(result).toHaveLength(1);
      expect(result[0].projectConnectionsCount).toBe(3);
      expect(result[0].gitConnectionsCount).toBe(2);
      expect(result[0].hasProjectConnections).toBe(true);
      expect(result[0].hasGitConnections).toBe(true);
    });

    it('defaults counts to 0 for providers with no connections', async () => {
      mockProviderFind.mockResolvedValue([
        { id: 'p2', name: 'GitLab', type: 'gitlab' },
      ]);
      mockRepoQb.getRawMany.mockResolvedValue([]);
      mockCredQb.getRawMany.mockResolvedValue([]);

      const result = await gitProviderService.listAllWithUsage();

      expect(result[0].projectConnectionsCount).toBe(0);
      expect(result[0].gitConnectionsCount).toBe(0);
      expect(result[0].hasProjectConnections).toBe(false);
      expect(result[0].hasGitConnections).toBe(false);
    });
  });

  describe('update', () => {
    it('updates provider and returns refreshed entity', async () => {
      mockProviderFindOneBy
        .mockResolvedValueOnce({ id: 'p1', name: 'GitHub' })
        .mockResolvedValueOnce({ id: 'p1', name: 'GitHub', isActive: false });
      mockProviderUpdate.mockResolvedValue({ affected: 1 });

      const result = await gitProviderService.update('p1', { isActive: false });

      expect(mockProviderUpdate).toHaveBeenCalledWith(
        { id: 'p1' },
        expect.objectContaining({ isActive: false }),
      );
      expect(result?.isActive).toBe(false);
    });

    it('throws when provider not found', async () => {
      mockProviderFindOneBy.mockResolvedValue(null);

      await expect(gitProviderService.update('nonexistent', { isActive: true }))
        .rejects.toThrow();
    });

    it('rejects invalid custom base URL', async () => {
      mockProviderFindOneBy.mockResolvedValue({ id: 'p1' });

      await expect(gitProviderService.update('p1', { customBaseUrl: 'not-a-url' }))
        .rejects.toThrow('Custom Git base URL must be a valid URL');
    });

    it('rejects invalid custom API URL', async () => {
      mockProviderFindOneBy.mockResolvedValue({ id: 'p1' });

      await expect(gitProviderService.update('p1', { customApiUrl: 'ftp://bad' }))
        .rejects.toThrow('Custom Git API URL must use HTTPS');
    });
  });
});
