import { describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ExternalIdentity } from '@enterpriseglue/shared/db/entities/index.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { SsoNormalizedIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoNormalizedIdentity.js';
import { externalIdentityKey, externalIdentityService } from '@enterpriseglue/shared/services/platform-admin/ExternalIdentityService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

describe('externalIdentityService', () => {
  it('links two providers to the same user through distinct canonical identity keys', async () => {
    const records = new Map<string, any>();
    const repo = {
      findOne: vi.fn(async ({ where }: any) => records.get(where.identityKey) || null),
      insert: vi.fn(async (record: any) => { records.set(record.identityKey, record); }),
      update: vi.fn(),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === ExternalIdentity) return repo;
      throw new Error('Unexpected repository');
    }});

    const first = await externalIdentityService.upsert({ tenantId: 'tenant-a', providerId: 'oidc-a', providerType: 'oidc', subjectId: 'subject-a', userId: 'user-1', now: 100 });
    const second = await externalIdentityService.upsert({ tenantId: 'tenant-a', providerId: 'oidc-b', providerType: 'oidc', subjectId: 'subject-b', userId: 'user-1', now: 101 });

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(first.id).not.toBe(second.id);
    expect(repo.insert).toHaveBeenNthCalledWith(1, expect.objectContaining({ providerId: 'oidc-a', userId: 'user-1' }));
    expect(repo.insert).toHaveBeenNthCalledWith(2, expect.objectContaining({ providerId: 'oidc-b', userId: 'user-1' }));
    expect(Array.from(records.keys())).toEqual([
      externalIdentityKey({ tenantId: 'tenant-a', providerId: 'oidc-a', subjectId: 'subject-a' }),
      externalIdentityKey({ tenantId: 'tenant-a', providerId: 'oidc-b', subjectId: 'subject-b' }),
    ]);
  });

  it('uses a tenant/provider/subject identity key and updates the same external account link', async () => {
    const findOne = vi.fn().mockResolvedValue({ id: 'identity-1', userId: 'user-1', status: 'active' });
    const update = vi.fn().mockResolvedValue(undefined);
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === ExternalIdentity) return { findOne, update, insert: vi.fn() };
      throw new Error('Unexpected repository');
    }});
    const result = await externalIdentityService.upsert({ tenantId: 'tenant-a', providerId: 'oidc-1', providerType: 'oidc', subjectId: 'sub-1', userId: 'user-1', now: 100 });
    expect(result).toEqual({ id: 'identity-1', created: false });
    expect(findOne).toHaveBeenCalledWith({ where: { identityKey: externalIdentityKey({ tenantId: 'tenant-a', providerId: 'oidc-1', subjectId: 'sub-1' }) } });
    expect(update).toHaveBeenCalledWith({ id: 'identity-1' }, expect.objectContaining({ userId: 'user-1', status: 'active', lastSeenAt: 100 }));
  });

  it('fails closed instead of reassigning an external subject to another user', async () => {
    const findOne = vi.fn().mockResolvedValue({ id: 'identity-1', userId: 'user-1', status: 'active' });
    const update = vi.fn();
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === ExternalIdentity) return { findOne, update, insert: vi.fn() };
      throw new Error('Unexpected repository');
    }});

    await expect(externalIdentityService.upsert({ tenantId: 'tenant-a', providerId: 'oidc-1', providerType: 'oidc', subjectId: 'sub-1', userId: 'user-2' }))
      .rejects.toThrow('already linked to a different user account');
    expect(update).not.toHaveBeenCalled();
  });

  it('recovers a concurrent first login without allowing the external subject to move users', async () => {
    const findOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'identity-1', userId: 'user-1', status: 'active' });
    const update = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockRejectedValue(new Error('duplicate key'));
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === ExternalIdentity) return { findOne, update, insert };
      throw new Error('Unexpected repository');
    }});

    await expect(externalIdentityService.upsert({
      tenantId: 'tenant-a', providerId: 'oidc-1', providerType: 'oidc', subjectId: 'sub-1', userId: 'user-1', now: 100,
    })).resolves.toEqual({ id: 'identity-1', created: false });

    expect(update).toHaveBeenCalledWith({ id: 'identity-1' }, expect.objectContaining({ userId: 'user-1', lastSeenAt: 100 }));
  });

  it('fails closed when a concurrent first login discovers a link for another user', async () => {
    const findOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'identity-1', userId: 'user-2', status: 'active' });
    const update = vi.fn();
    const insert = vi.fn().mockRejectedValue(new Error('duplicate key'));
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === ExternalIdentity) return { findOne, update, insert };
      throw new Error('Unexpected repository');
    }});

    await expect(externalIdentityService.upsert({
      tenantId: 'tenant-a', providerId: 'oidc-1', providerType: 'oidc', subjectId: 'sub-1', userId: 'user-1', now: 100,
    })).rejects.toThrow('already linked to a different user account');
    expect(update).not.toHaveBeenCalled();
  });

  it('does not automatically reactivate an explicitly unlinked identity', async () => {
    const findOne = vi.fn().mockResolvedValue({ id: 'identity-1', userId: 'user-1', status: 'unlinked' });
    const update = vi.fn();
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === ExternalIdentity) return { findOne, update, insert: vi.fn() };
      throw new Error('Unexpected repository');
    }});

    await expect(externalIdentityService.upsert({
      providerId: 'oidc-a', providerType: 'oidc', subjectId: 'subject-a', userId: 'user-1',
    })).rejects.toThrow('requires administrator relinking');
    expect(update).not.toHaveBeenCalled();
  });

  it('unlinks only the selected provider identity and revokes its memberships and refresh sessions', async () => {
    const identityUpdate = vi.fn().mockResolvedValue({ affected: 1 });
    const membershipDelete = vi.fn().mockResolvedValue({ affected: 2 });
    const normalizedUpdate = vi.fn().mockResolvedValue({ affected: 1 });
    const refreshUpdate = vi.fn().mockResolvedValue({ affected: 3 });
    const manager = { getRepository: (entity: unknown) => {
      if (entity === ExternalIdentity) return {
        findOne: vi.fn().mockResolvedValue({ id: 'identity-a', userId: 'user-1', providerId: 'oidc-a' }),
        update: identityUpdate,
      };
      if (entity === IdentityEntitlementMapping) return { find: vi.fn().mockResolvedValue([{ id: 'mapping-a', providerId: 'oidc-a' }]) };
      if (entity === AuthzGroupMembership) return { delete: membershipDelete };
      if (entity === SsoNormalizedIdentity) return { update: normalizedUpdate };
      if (entity === RefreshToken) return { update: refreshUpdate };
      throw new Error('Unexpected repository');
    }};
    (getDataSource as unknown as Mock).mockResolvedValue({
      transaction: (callback: (providedManager: typeof manager) => unknown) => callback(manager),
    });

    await expect(externalIdentityService.unlink({
      tenantId: 'tenant-a', providerId: 'oidc-a', subjectId: 'subject-a', userId: 'user-1', now: 200,
    })).resolves.toEqual({
      identityId: 'identity-a',
      providerManagedMembershipsRemoved: 2,
      normalizedIdentitiesMarked: 1,
      providerRefreshSessionsRevoked: 3,
    });

    expect(membershipDelete).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      userId: 'user-1',
      source: 'identity_provider',
    }));
    expect(membershipDelete.mock.calls[0][0].sourceRef.value).toEqual([
      'identity_provider:oidc-a:mapping:mapping-a', 'identity_mapping:mapping-a',
    ]);
    expect(normalizedUpdate).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', providerId: 'oidc-a', providerSubject: 'subject-a', userId: 'user-1',
    }), expect.objectContaining({ providerStatus: 'unlinked' }));
    expect(refreshUpdate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', identityProviderId: 'oidc-a',
    }), { revokedAt: 200 });
    expect(identityUpdate).toHaveBeenCalledWith({ id: 'identity-a' }, { status: 'unlinked', updatedAt: 200 });
  });

  it('refuses to unlink an identity owned by another user', async () => {
    const identityUpdate = vi.fn();
    const manager = { getRepository: (entity: unknown) => {
      if (entity === ExternalIdentity) return {
        findOne: vi.fn().mockResolvedValue({ id: 'identity-a', userId: 'user-2' }),
        update: identityUpdate,
      };
      throw new Error('Unexpected repository');
    }};
    (getDataSource as unknown as Mock).mockResolvedValue({
      transaction: (callback: (providedManager: typeof manager) => unknown) => callback(manager),
    });

    await expect(externalIdentityService.unlink({
      providerId: 'oidc-a', subjectId: 'subject-a', userId: 'user-1',
    })).rejects.toThrow('linked to a different user account');
    expect(identityUpdate).not.toHaveBeenCalled();
  });
});
