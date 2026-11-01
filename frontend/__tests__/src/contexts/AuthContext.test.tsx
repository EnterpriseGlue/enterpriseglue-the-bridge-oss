import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@src/contexts/AuthContext';
import { useAuth } from '@src/shared/hooks/useAuth';
import { ApiError } from '@src/shared/api/client';
import { USER_KEY } from '@src/constants/storageKeys';
import { getBrowserSessionRevision } from '@src/utils/browserSession';

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

let queryClient: QueryClient;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>{children}</AuthProvider>
  </QueryClientProvider>
);

describe('AuthProvider', () => {
  beforeEach(async () => {
    const { authService } = await import('@src/services/auth');
    window.history.replaceState({}, '', '/');
    localStorage.clear();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

  it('clears all old-session caches across A to logout to B on the same engine', async () => {
    const { authService } = await import('@src/services/auth');
    const userA = { id: 'user-a', email: 'a@example.com', session: { principal: { type: 'user', id: 'user-a' }, tenant: { id: 'tenant-1' } } } as any;
    const userB = { id: 'user-b', email: 'b@example.com', session: { principal: { type: 'user', id: 'user-b' }, tenant: { id: 'tenant-1' } } } as any;
    vi.mocked(authService.getMe).mockResolvedValue(userA);
    vi.mocked(authService.logout).mockResolvedValue({ message: 'Logged out successfully', federatedLogoutUrl: null });
    vi.mocked(authService.login).mockResolvedValue({ user: userB, expiresIn: 3600 });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user?.id).toBe('user-a'));

    const runtimeKey = ['mission-control', 'instances', 'engine-1'];
    const selectorKey = ['engines-selector', 'user-a:tenant-1:tenant-1'];
    queryClient.setQueryData(runtimeKey, [{ id: 'private-to-a' }]);
    queryClient.setQueryData(selectorKey, [{ id: 'engine-1' }]);
    queryClient.setQueryData(['notifications'], { unreadCount: 1 });

    await act(async () => result.current.logout());
    expect(queryClient.getQueryData(runtimeKey)).toBeUndefined();
    expect(queryClient.getQueryData(selectorKey)).toBeUndefined();
    expect(queryClient.getQueryData(['notifications'])).toBeUndefined();

    // A late old-session cache entry must also be removed when B becomes the
    // authenticated principal, even though both principals use engine-1.
    queryClient.setQueryData(runtimeKey, [{ id: 'late-private-to-a' }]);
    await act(async () => { await result.current.login({ email: 'b@example.com', password: 'Password1!' }); });

    expect(result.current.user?.id).toBe('user-b');
    expect(queryClient.getQueryData(runtimeKey)).toBeUndefined();
    expect(queryClient.getQueryData(['notifications'])).toBeUndefined();
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('authentication response ownership', () => {
  const a = { id: 'a', email: 'a@fixture.invalid', session: { principal: { type: 'user', id: 'a' }, tenant: { id: 'tenant-a' } } } as any;
  const b = { id: 'b', email: 'b@fixture.invalid', session: { principal: { type: 'user', id: 'b' }, tenant: { id: 'tenant-b' } } } as any;
  const permissions = (user: any) => ({ userId: user.id, tenantId: user.session.tenant.id, platform: [], projects: [], engines: [], authorizationVersion: 'fixture', generatedAt: 123 });
  beforeEach(async () => {
    const { authService } = await import('@src/services/auth');
    window.history.replaceState({}, '', '/'); localStorage.clear(); vi.resetAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(authService.getMe).mockResolvedValue(a);
    vi.mocked(authService.getMyPermissions).mockResolvedValue(permissions(a));
    vi.mocked(authService.logout).mockResolvedValue({ message: 'Logged out', federatedLogoutUrl: null });
  });
  const storage = (user: any) => {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user)); else localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: USER_KEY, newValue: user ? JSON.stringify(user) : null }));
  };

  it.each(['success', 'unauthorized', 'unverified'] as const)('ignores stale getMe %s after a storage switch', async outcome => {
    const { authService } = await import('@src/services/auth');
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const old = deferred<any>(); vi.mocked(authService.getMe).mockReturnValueOnce(old.promise);
    let pending!: Promise<void>; act(() => { pending = result.current.refreshUser(); });
    act(() => storage(b));
    await act(async () => {
      if (outcome === 'unauthorized') old.reject(new ApiError(401, 'Unauthorized', 'expired'));
      else old.resolve(outcome === 'unverified' ? { ...a, isEmailVerified: false } : a);
      await pending;
    });
    expect(result.current.user).toEqual(b);
    expect(JSON.parse(localStorage.getItem(USER_KEY)!)).toEqual(b);
  });

  it.each(['replacement', 'authorization', 'unavailable'] as const)('discards cached private data after %s while the account ID stays the same', async change => {
    const { authService } = await import('@src/services/auth');
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.permissions?.userId).toBe(a.id));
    const key = ['mission-control', 'private-data', 'same-engine'];
    queryClient.setQueryData(key, { value: 'old-authority' });
    if (change === 'replacement') act(() => result.current.setAuthenticatedUser({ ...a }));
    else {
      if (change === 'unavailable') vi.mocked(authService.getMyPermissions).mockRejectedValueOnce(new Error('Unavailable'));
      else vi.mocked(authService.getMyPermissions).mockResolvedValueOnce({ ...permissions(a), authorizationVersion: 'revised' });
      await act(async () => { await result.current.refreshPermissions(); });
    }
    expect(queryClient.getQueryData(key)).toBeUndefined();
  });

  it('keeps cached data through a same-authority permission refresh', async () => {
    const { authService } = await import('@src/services/auth');
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.permissions?.userId).toBe(a.id));
    const key = ['mission-control', 'private-data', 'same-engine'];
    queryClient.setQueryData(key, { value: 'current-authority' });
    vi.mocked(authService.getMyPermissions).mockResolvedValueOnce({ ...permissions(a), generatedAt: 999 });
    await act(async () => { await result.current.refreshPermissions(); });
    expect(queryClient.getQueryData(key)).toEqual({ value: 'current-authority' });
  });

  it('discards cache when action availability changes without a role-version change', async () => {
    const { authService } = await import('@src/services/auth');
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.permissions?.userId).toBe(a.id));
    queryClient.setQueryData(['private'], 'old availability');
    vi.mocked(authService.getMyPermissions).mockResolvedValueOnce({ ...permissions(a), platformActionAvailability: { allowedActions: [], restrictions: {} } });
    await act(async () => { await result.current.refreshPermissions(); });
    expect(queryClient.getQueryData(['private'])).toBeUndefined();
  });

  it('advances the transport fence for same-account replacement, storage ABA and provider unmount', async () => {
    const { result, unmount } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let revision = getBrowserSessionRevision();
    act(() => result.current.setAuthenticatedUser({ ...a }));
    expect(getBrowserSessionRevision()).toBeGreaterThan(revision);
    revision = getBrowserSessionRevision();
    act(() => { storage(b); storage(a); });
    expect(getBrowserSessionRevision()).toBeGreaterThan(revision);
    revision = getBrowserSessionRevision();
    unmount();
    expect(getBrowserSessionRevision()).toBeGreaterThan(revision);
  });

  it.each(['success', 'failure'] as const)('keeps new permissions after old permission %s', async outcome => {
    const { authService } = await import('@src/services/auth');
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const old = deferred<any>();
    vi.mocked(authService.getMyPermissions).mockReturnValueOnce(old.promise).mockResolvedValue(permissions(b));
    let pending!: Promise<unknown>; act(() => { pending = result.current.refreshPermissions(); });
    act(() => result.current.setAuthenticatedUser(b));
    await waitFor(() => expect(result.current.permissions?.userId).toBe('b'));
    await act(async () => { if (outcome === 'failure') old.reject(new Error('old')); else old.resolve(permissions(a)); await pending; });
    expect(result.current.permissions).toEqual(permissions(b));
  });

  it('rejects an old A completion after A to B to A', async () => {
    const { authService } = await import('@src/services/auth');
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const old = deferred<any>(); vi.mocked(authService.getMe).mockReturnValueOnce(old.promise);
    let pending!: Promise<void>; act(() => { pending = result.current.refreshUser(); });
    const revision = result.current.sessionRevision!;
    act(() => result.current.setAuthenticatedUser(b));
    act(() => result.current.setAuthenticatedUser({ ...a, firstName: 'new A' }));
    await act(async () => { old.resolve({ ...a, firstName: 'old A' }); await pending; });
    expect(result.current.user?.firstName).toBe('new A');
    expect(result.current.sessionRevision).toBeGreaterThan(revision);
  });

  it('only accepts the latest same-session permission request', async () => {
    const { authService } = await import('@src/services/auth');
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const old = deferred<any>(); vi.mocked(authService.getMyPermissions).mockReturnValueOnce(old.promise);
    let pending!: Promise<unknown>; act(() => { pending = result.current.refreshPermissions(); });
    const newer = { ...permissions(a), generatedAt: 999 };
    vi.mocked(authService.getMyPermissions).mockResolvedValueOnce(newer);
    await act(async () => { await result.current.refreshPermissions(); old.resolve(permissions(a)); await pending; });
    expect(result.current.permissions).toEqual(newer);
  });

  it('does not resurrect a session after logout starts', async () => {
    const { authService } = await import('@src/services/auth');
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const old = deferred<any>(), logout = deferred<any>();
    vi.mocked(authService.getMe).mockReturnValueOnce(old.promise); vi.mocked(authService.logout).mockReturnValueOnce(logout.promise);
    let pending!: Promise<void>, leaving!: Promise<void>;
    act(() => { pending = result.current.refreshUser(); leaving = result.current.logout(); });
    expect(result.current.user).toBeNull();
    act(() => result.current.setAuthenticatedUser(b));
    await act(async () => { old.resolve(a); logout.resolve({ message: 'done' }); await Promise.all([pending, leaving]); });
    expect(result.current.user).toEqual(b);
  });

  it('ignores an initial bootstrap failure after a new session arrives', async () => {
    const { authService } = await import('@src/services/auth');
    const old = deferred<any>(); vi.mocked(authService.getMe).mockReturnValueOnce(old.promise);
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => storage(b));
    await act(async () => old.reject(new Error('old bootstrap')));
    expect(result.current.user).toEqual(b);
    expect(authService.refreshToken).not.toHaveBeenCalled();
  });

  it('ignores an old login response after another sign-in', async () => {
    const { authService } = await import('@src/services/auth');
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const old = deferred<any>(); vi.mocked(authService.login).mockReturnValueOnce(old.promise);
    let pending!: Promise<unknown>; act(() => { pending = result.current.login({ email: a.email, password: 'fixture' }).catch(error => error); });
    act(() => result.current.setAuthenticatedUser(b));
    await act(async () => { old.resolve({ user: a }); expect(await pending).toBeInstanceOf(Error); });
    expect(result.current.user).toEqual(b);
  });
});
