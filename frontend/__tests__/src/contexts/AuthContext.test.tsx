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
});
