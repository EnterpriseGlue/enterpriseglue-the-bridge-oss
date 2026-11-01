import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userDirectoryApi } from '@src/api/platform-admin/userDirectory';
import { apiClient } from '@src/shared/api/client';
vi.mock('@src/shared/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
const user = { id: 'u/1', email: 'user@fixture.invalid', firstName: null, lastName: null, displayName: 'Fixture', status: 'active',
  platformRole: 'user', bootstrapAccess: 'user', authenticationSources: ['local'], provisioningSource: 'none', provisioningDirectoryKey: null,
  lastSignInAt: null, lastProvisionedAt: null, provisioningHealth: 'not_applicable' };
const identity = { user, linkedIdentities: [], fieldOwnership: [], recoveryAdministrator: false };

describe('user directory transport contracts', () => {
  beforeEach(() => vi.resetAllMocks());
  it('validates the explicit presentation preset and keeps the legacy wire field only as compatibility data', async () => {
    const result = { items: [user], total: 1, limit: 50, offset: 0 };
    vi.mocked(apiClient.get).mockResolvedValue(result);
    expect(await userDirectoryApi.list()).toEqual(result);
    expect(apiClient.get).toHaveBeenCalledWith('/api/users/directory', {});
  });
  it.each([undefined, 'superuser'])('rejects a missing/unknown canonical access preset %s', async bootstrapAccess => {
    vi.mocked(apiClient.get).mockResolvedValue({ items: [{ ...user, platformRole: 'admin', bootstrapAccess }], total: 1, limit: 50, offset: 0 });
    await expect(userDirectoryApi.list()).rejects.toThrow();
  });
  it('encodes the requested user ID and validates identity ownership', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(identity);
    expect(await userDirectoryApi.identityContext('u/1')).toEqual(identity);
    expect(apiClient.get).toHaveBeenCalledWith('/api/users/u%2F1/identity-context');
    await expect(userDirectoryApi.identityContext('another')).rejects.toThrow('does not match');
  });
  it.each(['effectiveAccess', 'sessions', 'audit'] as const)('rejects a mismatched %s record', async method => {
    const payload = method === 'effectiveAccess' ? { userId: 'other', platformRole: 'user', bootstrapAccess: 'user', lineage: [], evaluatedAt: 1 }
      : method === 'sessions' ? { userId: 'other', sessions: [] } : { userId: 'other', events: [] };
    vi.mocked(apiClient.get).mockResolvedValue(payload);
    await expect(userDirectoryApi[method]('u/1')).rejects.toThrow('does not match');
  });
  it.each(['deactivate', 'reactivate', 'revokeSessions'] as const)('binds %s acknowledgement to the original user', async method => {
    const result = { userId: 'u/1', status: 'deactivated', authSessionVersion: 2, changedAt: 3 };
    vi.mocked(apiClient.post).mockResolvedValueOnce(result).mockResolvedValueOnce({ ...result, userId: 'other' });
    expect(await userDirectoryApi[method]('u/1', 'Reviewed reason')).toEqual(result);
    expect(apiClient.post).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/users\/u%2F1\//), { reason: 'Reviewed reason' });
    await expect(userDirectoryApi[method]('u/1', 'Reviewed reason')).rejects.toThrow('does not match');
  });
});
