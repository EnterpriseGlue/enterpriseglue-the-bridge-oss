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
      platform: [],
      projects: [],
      engines: [],
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
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

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
      platform: ['platform:user:manage'],
      projects: [{ resourceId: 'project-1', permissions: ['project:files:create'] }],
      engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'] }],
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
    (authService.logout as any).mockResolvedValue(undefined);
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
