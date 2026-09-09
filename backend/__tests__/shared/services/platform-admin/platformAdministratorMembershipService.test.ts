import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getPlatformDatabaseCapability } from '@enterpriseglue/shared/services/platform-database-context.js';
import { claimActivePlatformAdministratorMembership, PLATFORM_ADMINISTRATORS_GROUP_ID } from '@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js';

const originalMode = config.tenancyMode;
describe('password-verified administrator membership claim scope', () => {
  const repo = { find: vi.fn(), update: vi.fn() };
  const manager = { getRepository: () => repo } as unknown as EntityManager;
  const membership = { id: 'membership-1', tenantId: null, groupId: PLATFORM_ADMINISTRATORS_GROUP_ID, userId: 'user-1', source: 'manual', sourceRef: 'manual-platform-administrator', expiresAt: null, createdById: null, createdAt: 100, updatedAt: 200 };
  beforeEach(() => {
    vi.resetAllMocks();
    config.tenancyMode = 'pooled';
    repo.find.mockImplementation(async () => {
      expect(getPlatformDatabaseCapability()).toEqual({ kind: 'authenticated-account', userId: 'user-1' });
      return [membership];
    });
    repo.update.mockImplementation(async () => {
      expect(getPlatformDatabaseCapability()).toEqual({ kind: 'administrator-recovery-claim', userId: 'user-1', membershipId: 'membership-1', source: 'manual', sourceRef: 'manual-platform-administrator', expiresAt: null, createdById: null, createdAt: '100', updatedAt: '200' });
      return { affected: 1 };
    });
  });
  afterEach(() => { config.tenancyMode = originalMode; });

  it('binds the no-op claim to the complete existing membership snapshot', async () => {
    await expect(claimActivePlatformAdministratorMembership('user-1', manager, 300)).resolves.toBe(true);
    expect(repo.update).toHaveBeenCalledWith({ id: 'membership-1', updatedAt: 200 }, { updatedAt: 200 });
    expect(getPlatformDatabaseCapability()).toBeUndefined();
  });
  it.each([
    { expiresAt: 299 }, { userId: 'other' }, { tenantId: 'tenant-a' }, { groupId: 'other-group' },
  ])('does not claim a membership outside the active global target: %j', async override => {
    repo.find.mockResolvedValue([{ ...membership, ...override }]);
    await expect(claimActivePlatformAdministratorMembership('user-1', manager, 300)).resolves.toBe(false);
    expect(repo.update).not.toHaveBeenCalled();
    expect(getPlatformDatabaseCapability()).toBeUndefined();
  });
  it('does not authorize recovery when concurrent removal defeats the claim', async () => {
    repo.update.mockResolvedValue({ affected: 0 });
    await expect(claimActivePlatformAdministratorMembership('user-1', manager, 300)).resolves.toBe(false);
    expect(getPlatformDatabaseCapability()).toBeUndefined();
  });
  it('revokes claim authority when the database rejects the no-op update', async () => {
    repo.update.mockRejectedValue(new Error('database rejected claim'));
    await expect(claimActivePlatformAdministratorMembership('user-1', manager, 300)).rejects.toThrow('database rejected claim');
    expect(getPlatformDatabaseCapability()).toBeUndefined();
  });
  it('preserves single-mode no-op claims without adding a global capability', async () => {
    config.tenancyMode = 'single';
    repo.find.mockResolvedValue([membership]);
    repo.update.mockImplementation(async () => {
      expect(getPlatformDatabaseCapability()).toBeUndefined();
      return { affected: 1 };
    });
    await expect(claimActivePlatformAdministratorMembership('user-1', manager, 300)).resolves.toBe(true);
  });
});
