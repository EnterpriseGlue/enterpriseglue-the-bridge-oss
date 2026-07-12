import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authService } from '@src/services/auth';
import { apiClient } from '@src/shared/api/client';

// Test fixture tokens — not real secrets (CWE-547)
const TEST_ACCESS_TOKEN = `test-access-${Date.now()}`;
const TEST_REFRESH_TOKEN = `test-refresh-${Date.now()}`;
const TEST_NEW_TOKEN = `test-new-${Date.now()}`;

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('authService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs in user', async () => {
    (apiClient.post as any).mockResolvedValue({
      accessToken: TEST_ACCESS_TOKEN,
      refreshToken: TEST_REFRESH_TOKEN,
      user: { id: 'user-1', email: 'test@example.com' },
    });

    const result = await authService.login({ email: 'test@example.com', password: 'Pass123!' });
    expect(result.accessToken).toBe(TEST_ACCESS_TOKEN);
    expect(apiClient.post).toHaveBeenCalledWith('/api/auth/login', expect.any(Object), expect.any(Object));
  });

  it('refreshes token', async () => {
    (apiClient.post as any).mockResolvedValue({ accessToken: TEST_NEW_TOKEN });

    const result = await authService.refreshToken({ refreshToken: TEST_REFRESH_TOKEN });
    expect(result.accessToken).toBe(TEST_NEW_TOKEN);
  });

  it('gets current user', async () => {
    (apiClient.get as any).mockResolvedValue({ id: 'user-1', email: 'test@example.com' });

    const result = await authService.getMe();
    expect(result.id).toBe('user-1');
  });

  it('gets current user effective permissions', async () => {
    (apiClient.get as any).mockResolvedValue({
      userId: 'user-1',
      platform: ['platform:authz:check'],
      projects: [{ resourceId: 'project-1', permissions: ['project:files:view'] }],
      engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'] }],
      generatedAt: 123,
    });

    const result = await authService.getMyPermissions();

    expect(result.platform).toContain('platform:authz:check');
    expect(apiClient.get).toHaveBeenCalledWith('/api/authz/me/permissions', undefined, {
      credentials: 'include',
    });
  });

  it('lists users', async () => {
    (apiClient.get as any).mockResolvedValue([{ id: 'user-1' }]);

    const result = await authService.listUsers();
    expect(result).toHaveLength(1);
  });

  it('creates user', async () => {
    (apiClient.post as any).mockResolvedValue({ user: { id: 'user-1' } });

    const result = await authService.createUser({
      email: 'new@example.com',
      firstName: 'New',
      lastName: 'User',
      platformRole: 'user',
    });
    expect(result.user.id).toBe('user-1');
  });

  it('deletes user', async () => {
    (apiClient.delete as any).mockResolvedValue(undefined);

    await authService.deleteUser('user-1');
    expect(apiClient.delete).toHaveBeenCalledWith('/api/users/user-1');
  });
});
