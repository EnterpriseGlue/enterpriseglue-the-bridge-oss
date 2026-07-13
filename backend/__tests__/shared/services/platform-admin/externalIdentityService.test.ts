import { describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ExternalIdentity } from '@enterpriseglue/shared/db/entities/index.js';
import { externalIdentityKey, externalIdentityService } from '@enterpriseglue/shared/services/platform-admin/ExternalIdentityService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

describe('externalIdentityService', () => {
  it('uses a tenant/provider/subject identity key and updates the same external account link', async () => {
    const findOne = vi.fn().mockResolvedValue({ id: 'identity-1', userId: 'user-1' });
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
    const findOne = vi.fn().mockResolvedValue({ id: 'identity-1', userId: 'user-1' });
    const update = vi.fn();
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === ExternalIdentity) return { findOne, update, insert: vi.fn() };
      throw new Error('Unexpected repository');
    }});

    await expect(externalIdentityService.upsert({ tenantId: 'tenant-a', providerId: 'oidc-1', providerType: 'oidc', subjectId: 'sub-1', userId: 'user-2' }))
      .rejects.toThrow('already linked to a different user account');
    expect(update).not.toHaveBeenCalled();
  });
});
