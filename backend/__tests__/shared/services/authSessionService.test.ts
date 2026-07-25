import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { authSessionService } from '@enterpriseglue/shared/services/AuthSessionService.js';
import { generateAccessToken, generateRefreshToken } from '@enterpriseglue/shared/utils/jwt.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/utils/jwt.js', () => ({ generateAccessToken: vi.fn(() => 'access-token'), generateRefreshToken: vi.fn(() => 'refresh-token') }));
vi.mock('@enterpriseglue/shared/utils/id.js', () => ({ generateId: vi.fn(() => 'session-1') }));
describe('authSessionService', () => {
  const insert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    insert.mockResolvedValue(undefined);
    (getDataSource as any).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === RefreshToken) return { insert };
      throw new Error('Unexpected repository');
    }});
  });

  it('persists provider lineage for a renewable provider-neutral session', async () => {
    await expect(authSessionService.issue({ id: 'user-1', email: 'person@example.test' }, {
      identityProviderId: 'provider-1', userAgent: 'test-agent', ipAddress: '127.0.0.1',
    })).resolves.toEqual(expect.objectContaining({ accessToken: 'access-token', refreshToken: 'refresh-token' }));

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'session-1', userId: 'user-1', identityProviderId: 'provider-1', revokedAt: null,
      deviceInfo: JSON.stringify({ userAgent: 'test-agent', ip: '127.0.0.1' }),
    }));
  });

  it('keeps local sessions unscoped when no provider lineage is supplied', async () => {
    await authSessionService.issue({ id: 'user-1', email: 'person@example.test' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ identityProviderId: null }));
  });

  it('preserves the current session version in newly issued provider sessions', async () => {
    const user = { id: 'user-1', email: 'person@example.test', authSessionVersion: 7 };

    await authSessionService.issue(user, { identityProviderId: 'provider-1' });

    expect(generateAccessToken).toHaveBeenCalledWith(user);
    expect(generateRefreshToken).toHaveBeenCalledWith(user);
  });
});
