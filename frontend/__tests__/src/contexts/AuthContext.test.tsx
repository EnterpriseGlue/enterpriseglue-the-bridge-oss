import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider } from '@src/contexts/AuthContext';
import { useAuth } from '@src/shared/hooks/useAuth';
import { USER_KEY } from '@src/constants/storageKeys';

vi.mock('@src/services/auth', () => ({
  authService: {
    setAccessToken: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    getMe: vi.fn().mockRejectedValue(new Error('Not authenticated')),
    getMyPermissions: vi.fn().mockResolvedValue({
      userId: 'user-1',
      tenantId: null,
      platform: [],
      projects: [],
      engines: [],
      authorizationVersion: 'test-authz-v1',
      generatedAt: 123,
    }),
    refreshToken: vi.fn(),
    resetPassword: vi.fn(),
    changePassword: vi.fn(),
  },
}));

vi.mock('@src/shared/hooks/useActivityMonitor', () => ({
  useActivityMonitor: vi.fn(),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('AuthProvider', () => {
  beforeEach(async () => {
    const { authService } = await import('@src/services/auth');
    window.history.replaceState({}, '', '/');
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(authService.getMe).mockRejectedValue(new Error('Not authenticated'));
    vi.mocked(authService.getMyPermissions).mockResolvedValue({
      userId: 'user-1',
      tenantId: null,
      platform: [],
      projects: [],
      engines: [],
      authorizationVersion: 'test-authz-v1',
      generatedAt: 123,
    });
    vi.mocked(authService.refreshToken).mockRejectedValue(new Error('Not authenticated'));
  });

  it.each([
    '/signup',
    '/signup/',
    '/invite/token',
    '/t/alpha/invite/token',
  ])('does not probe or restore a user session on sessionless enrollment route %s', async (path) => {
    const { authService } = await import('@src/services/auth');
    window.history.replaceState({}, '', path);
    localStorage.setItem(USER_KEY, JSON.stringify({ id: 'stale-user' }));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(authService.getMe).not.toHaveBeenCalled();
    expect(authService.refreshToken).not.toHaveBeenCalled();
    expect(authService.getMyPermissions).not.toHaveBeenCalled();
    expect(localStorage.getItem(USER_KEY)).toBeNull();
  });

  it.each([
    '/login',
    '/t/alpha/login',
    '/admin-recovery',
    '/t/alpha/admin-recovery',
    '/verify-email',
    '/t/alpha/verify-email',
    '/forgot-password',
    '/t/alpha/forgot-password',
    '/password-reset',
    '/t/alpha/password-reset',
    '/resend-verification',
    '/t/alpha/resend-verification',
  ])('restores a valid cookie session on public authentication route %s', async (path) => {
    const { authService } = await import('@src/services/auth');
    window.history.replaceState({}, '', path);
    const cookieUser = {
      id: 'cookie-user',
      email: 'cookie@example.com',
      platformRole: 'user' as const,
      isActive: true,
      isEmailVerified: true,
      mustResetPassword: false,
      createdAt: 123,
    };
    vi.mocked(authService.getMe).mockResolvedValue(cookieUser);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(authService.getMe).toHaveBeenCalledTimes(1);
    expect(authService.refreshToken).not.toHaveBeenCalled();
    expect(authService.getMyPermissions).toHaveBeenCalledTimes(1);
    expect(result.current.user).toEqual(cookieUser);
    expect(result.current.isAuthenticated).toBe(true);
    expect(JSON.parse(localStorage.getItem(USER_KEY) ?? 'null')).toEqual(cookieUser);
  });

  it.each(['/signup-history', '/reset-password', '/t/alpha/reset-password'])(
    'keeps exact public-route boundaries and validates the protected route %s',
    async (path) => {
      const { authService } = await import('@src/services/auth');
      window.history.replaceState({}, '', path);

      const refreshedUser = {
        id: 'user-after-refresh',
        email: 'refreshed@example.com',
        platformRole: 'user' as const,
        isActive: true,
        isEmailVerified: true,
        mustResetPassword: false,
        createdAt: 123,
      };
      vi.mocked(authService.getMe)
        .mockRejectedValueOnce(new Error('Expired access session'))
        .mockResolvedValueOnce(refreshedUser);
      vi.mocked(authService.refreshToken).mockResolvedValue({ expiresIn: 3600 });

      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(authService.getMe).toHaveBeenCalledTimes(2);
      expect(authService.refreshToken).toHaveBeenCalledTimes(1);
      expect(authService.getMyPermissions).toHaveBeenCalledTimes(1);
      expect(result.current.user).toEqual(refreshedUser);
      expect(result.current.isAuthenticated).toBe(true);
    },
  );

  it('initializes without error', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('loads current user permissions and exposes permission helpers', async () => {
    const { authService } = await import('@src/services/auth');
    (authService.getMe as any).mockResolvedValue({ id: 'user-1', email: 'test@example.com' });
    (authService.getMyPermissions as any).mockResolvedValue({
      userId: 'user-1',
      tenantId: null,
      platform: ['platform:user:manage'],
      projects: [{ resourceId: 'project-1', permissions: ['project:files:create'] }],
      engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'] }],
      authorizationVersion: 'test-authz-v1',
      generatedAt: 123,
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasPlatformPermission('platform:user:manage')).toBe(true);
    expect(result.current.hasProjectPermission('project-1', 'project:files:create')).toBe(true);
    expect(result.current.hasAnyEnginePermission(['engine:instance:view'])).toBe(true);
    expect(result.current.hasEnginePermission('engine-1', 'engine:instance:view')).toBe(true);
    expect(result.current.hasAnyScopedEnginePermission('engine-1', ['engine:edit', 'engine:instance:view'])).toBe(true);
  });

  it('logs out and clears storage', async () => {
    const { authService } = await import('@src/services/auth');
    (authService.logout as any).mockResolvedValue({ message: 'Logged out successfully', federatedLogoutUrl: null });
    (authService.getMe as any).mockResolvedValue({ id: 'user-1', email: 'test@example.com' });

    localStorage.setItem(USER_KEY, JSON.stringify({ id: 'user-1' }));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(localStorage.getItem(USER_KEY)).toBeNull();
  });

  it('syncs authenticated user state from storage events across tabs', async () => {
    const { authService } = await import('@src/services/auth');
    (authService.getMe as any).mockRejectedValue(new Error('Not authenticated'));
    (authService.refreshToken as any).mockRejectedValue(new Error('Not authenticated'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const syncedUser = { id: 'user-2', email: 'synced@example.com' };

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: USER_KEY,
        newValue: JSON.stringify(syncedUser),
      }));
    });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user?.email).toBe('synced@example.com');
    });
  });
});
