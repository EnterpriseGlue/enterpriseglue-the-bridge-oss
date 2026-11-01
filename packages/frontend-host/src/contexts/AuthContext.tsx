import React, { createContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authService } from '../services/auth';
import { useActivityMonitor } from '../shared/hooks/useActivityMonitor';
import { ApiError } from '../shared/api/client';
import type { User, LoginRequest, LoginResponse, ResetPasswordRequest, ChangePasswordRequest, CurrentUserPermissions } from '../shared/types/auth';
import { USER_KEY } from '../constants/storageKeys';
import { getPublicAuthRoutePolicy } from '../utils/publicAuthRoute';
import { permissionSnapshotMatchesSession } from './authSessionPermissions';
import {
  hasAnyEnginePermission as snapshotHasAnyEnginePermission,
  hasAnyPlatformPermission as snapshotHasAnyPlatformPermission,
  hasAnyProjectPermission as snapshotHasAnyProjectPermission,
  hasAnyScopedEnginePermission as snapshotHasAnyScopedEnginePermission,
  hasEnginePermission as snapshotHasEnginePermission,
  hasPlatformPermission as snapshotHasPlatformPermission,
  hasProjectPermission as snapshotHasProjectPermission,
} from '../shared/auth/permissions';

/**
 * Authentication Context
 * Manages user authentication state and provides auth methods
 */

export interface AuthContextValue {
  user: User | null;
  permissions: CurrentUserPermissions | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Changes when the browser authentication session is replaced or cleared. */
  sessionRevision?: number;
  login: (credentials: LoginRequest) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  resetPassword: (request: ResetPasswordRequest) => Promise<void>;
  changePassword: (request: ChangePasswordRequest) => Promise<void>;
  refreshUser: () => Promise<void>;
  setAuthenticatedUser: (user: User | null) => void;
  refreshPermissions: () => Promise<CurrentUserPermissions | null>;
  hasPlatformPermission: (permission: string) => boolean;
  hasAnyPlatformPermission: (permissions: string[]) => boolean;
  hasProjectPermission: (projectId: string | null | undefined, permission: string) => boolean;
  hasAnyProjectPermission: (projectId: string | null | undefined, permissions: string[]) => boolean;
  hasAnyEnginePermission: (permissions: string[]) => boolean;
  hasEnginePermission: (engineId: string | null | undefined, permission: string) => boolean;
  hasAnyScopedEnginePermission: (engineId: string | null | undefined, permissions: string[]) => boolean;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

const readStoredUser = (raw: string | null): User | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
};

function authenticatedSessionScope(user: User | null): string | null {
  if (!user) return null;
  const principalId = user.session?.principal?.id || user.id;
  const tenantId = user.session?.tenant?.id || 'root';
  return `${principalId}:${tenantId}`;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<CurrentUserPermissions | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const sessionScopeRef = useRef<string | null>(null);
  const currentUserRef = useRef<User | null>(null);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const permissionsRequestRef = useRef(0);
  const userRequestRef = useRef(0);
  const [sessionRevision, setSessionRevision] = useState(0);

  const invalidateSession = useCallback(() => {
    generationRef.current += 1;
    permissionsRequestRef.current += 1;
    userRequestRef.current += 1;
    if (mountedRef.current) setPermissions(null);
    if (mountedRef.current) setSessionRevision(generationRef.current);
    return generationRef.current;
  }, []);
  const isCurrentSession = useCallback((generation: number) => (
    mountedRef.current && generationRef.current === generation
  ), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const clearPreviousSessionRuntimeState = useCallback((nextUser: User | null) => {
    const nextScope = authenticatedSessionScope(nextUser);
    if (sessionScopeRef.current === nextScope) return;
    sessionScopeRef.current = nextScope;

    // Cached responses throughout the application can contain principal- and
    // tenant-filtered resources or action decisions under many feature-owned
    // key prefixes. Cancel first so an in-flight response from the old session
    // cannot repopulate state after the rare authentication-scope transition.
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient]);

  const persistUser = useCallback((nextUser: User | null) => {
    if (authenticatedSessionScope(currentUserRef.current) !== authenticatedSessionScope(nextUser)) invalidateSession();
    currentUserRef.current = nextUser;
    clearPreviousSessionRuntimeState(nextUser);
    setUser(nextUser);
    setPermissions((currentPermissions) =>
      permissionSnapshotMatchesSession(nextUser, currentPermissions) ? currentPermissions : null,
    );
    try {
      if (nextUser) {
        localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
      } else {
        localStorage.removeItem(USER_KEY);
      }
    } catch {
    }
  }, [clearPreviousSessionRuntimeState, invalidateSession]);

  const refreshPermissions = useCallback(async (): Promise<CurrentUserPermissions | null> => {
    const generation = generationRef.current;
    const request = ++permissionsRequestRef.current;
    const isCurrent = () => isCurrentSession(generation) && request === permissionsRequestRef.current;
    try {
      const nextPermissions = await authService.getMyPermissions();
      if (!isCurrent()) return null;
      const accepted = permissionSnapshotMatchesSession(currentUserRef.current, nextPermissions) ? nextPermissions : null;
      setPermissions(accepted);
      return accepted;
    } catch {
      if (isCurrent()) setPermissions(null);
      return null;
    }
  }, [isCurrentSession]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== USER_KEY && event.key !== null) return;
      const nextUser = readStoredUser(event.key === null ? null : event.newValue);
      invalidateSession();
      currentUserRef.current = nextUser;
      clearPreviousSessionRuntimeState(nextUser);
      setUser(nextUser);
      setPermissions(null);
      setIsLoading(false);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [clearPreviousSessionRuntimeState, invalidateSession]);

  /**
   * Load user from localStorage and validate token
   * Also supports cookie-based auth (Microsoft OAuth)
   */
  const clearAuth = useCallback(() => {
    invalidateSession();
    persistUser(null);
    setIsLoading(false);
  }, [invalidateSession, persistUser]);

  useEffect(() => {
    // StrictMode remounts and explicit session changes invalidate every await.
    const generation = generationRef.current;
    const request = ++userRequestRef.current;
    const isCurrent = () => isCurrentSession(generation) && request === userRequestRef.current;
    const initAuth = async () => {
      let acceptedGeneration: number | null = null;
      if (getPublicAuthRoutePolicy(window.location.pathname)?.skipSessionBootstrap) {
        if (isCurrent()) clearAuth();
        return;
      }
      try {
        let nextUser: User;
        try {
          nextUser = await authService.getMe();
        } catch {
          if (!isCurrent()) return;
          await authService.refreshToken();
          if (!isCurrent()) return;
          nextUser = await authService.getMe();
        }
        if (!isCurrent()) return;
        if (nextUser?.isEmailVerified === false) {
          clearAuth();
          return;
        }
        persistUser(nextUser);
        // persistUser may advance the session generation on initial identity.
        acceptedGeneration = generationRef.current;
        await refreshPermissions();
      } catch {
        if (isCurrent()) clearAuth();
      } finally {
        if (acceptedGeneration !== null ? isCurrentSession(acceptedGeneration) : isCurrent()) setIsLoading(false);
      }
    };
    void initAuth();
  }, [clearAuth, isCurrentSession, persistUser, refreshPermissions]);

  const setAuthenticatedUser = useCallback((nextUser: User | null) => {
    if (!nextUser) {
      clearAuth();
      return;
    }
    invalidateSession();
    persistUser(nextUser);
    setIsLoading(false);
    void refreshPermissions();
  }, [clearAuth, invalidateSession, persistUser, refreshPermissions]);

  /**
   * Login with email and password
   */
  const login = useCallback(async (credentials: LoginRequest) => {
    const generation = invalidateSession();
    const response = await authService.login(credentials);
    if (!isCurrentSession(generation)) throw new Error('Authentication changed while sign-in was pending');
    const requiresVerification =
      response?.emailVerificationRequired || response?.user?.isEmailVerified === false;

    if (requiresVerification) {
      clearAuth();
      return response;
    }

    // Store user info locally (tokens are in httpOnly cookies set by the server)
    persistUser(response.user);
    const acceptedGeneration = generationRef.current;
    await refreshPermissions();
    if (!isCurrentSession(acceptedGeneration)) throw new Error('Authentication changed while sign-in was pending');
    setIsLoading(false);
    return response;
  }, [clearAuth, invalidateSession, isCurrentSession, persistUser, refreshPermissions]);

  /**
   * Logout and clear session
   */
  const logout = useCallback(async () => {
    clearAuth();
    const generation = generationRef.current;
    let federatedLogoutUrl: string | null = null;
    try {
      const response = await authService.logout();
      if (!isCurrentSession(generation)) return;
      federatedLogoutUrl = response?.federatedLogoutUrl || null;
    } catch (error) {
      console.error('Logout error:', error);
    }
    if (!isCurrentSession(generation)) return;
    if (federatedLogoutUrl) {
      try {
        const target = new URL(federatedLogoutUrl);
        if (target.protocol === 'https:' || (import.meta.env.DEV && target.protocol === 'http:')) window.location.assign(target.toString());
      } catch {
        console.error('Identity provider returned an invalid logout URL');
      }
    }
  }, [clearAuth, isCurrentSession]);

  /**
   * Reset password (first login)
   */
  const resetPassword = useCallback(async (request: ResetPasswordRequest) => {
    const generation = generationRef.current;
    const targetUser = currentUserRef.current;
    await authService.resetPassword(request);

    if (targetUser && isCurrentSession(generation)) {
      const updatedUser = {
        ...targetUser,
        firstName: request.firstName ?? targetUser.firstName,
        lastName: request.lastName ?? targetUser.lastName,
        mustResetPassword: false,
      };
      persistUser(updatedUser);
    }
  }, [isCurrentSession, persistUser]);

  /**
   * Change password
   */
  const changePassword = useCallback(async (request: ChangePasswordRequest) => {
    await authService.changePassword(request);
  }, []);

  /**
   * Refresh user data from server
   */
  const refreshUser = useCallback(async () => {
    const generation = generationRef.current;
    const request = ++userRequestRef.current;
    const isCurrent = () => isCurrentSession(generation) && request === userRequestRef.current;
    try {
      const nextUser = await authService.getMe();
      if (!isCurrent()) return;
      if (nextUser?.isEmailVerified === false) {
        clearAuth();
        return;
      }
      persistUser(nextUser);
      await refreshPermissions();
    } catch (error) {
      if (!isCurrent()) return;
      console.error('Failed to refresh user:', error);
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) clearAuth();
      throw error;
    }
  }, [clearAuth, isCurrentSession, persistUser, refreshPermissions]);

  const activePermissions = permissionSnapshotMatchesSession(user, permissions) ? permissions : null;

  const hasPlatformPermission = useCallback((permission: string) =>
    snapshotHasPlatformPermission(activePermissions, permission), [activePermissions]);

  const hasAnyPlatformPermission = useCallback((permissionList: string[]) =>
    snapshotHasAnyPlatformPermission(activePermissions, permissionList), [activePermissions]);

  const hasProjectPermission = useCallback((projectId: string | null | undefined, permission: string) =>
    snapshotHasProjectPermission(activePermissions, projectId, permission), [activePermissions]);

  const hasAnyProjectPermission = useCallback((projectId: string | null | undefined, permissionList: string[]) =>
    snapshotHasAnyProjectPermission(activePermissions, projectId, permissionList), [activePermissions]);

  const hasAnyEnginePermission = useCallback((permissionList: string[]) =>
    snapshotHasAnyEnginePermission(activePermissions, permissionList), [activePermissions]);

  const hasEnginePermission = useCallback((engineId: string | null | undefined, permission: string) =>
    snapshotHasEnginePermission(activePermissions, engineId, permission), [activePermissions]);

  const hasAnyScopedEnginePermission = useCallback((engineId: string | null | undefined, permissionList: string[]) =>
    snapshotHasAnyScopedEnginePermission(activePermissions, engineId, permissionList), [activePermissions]);

  /**
   * Proactive token refresh - check every minute and refresh if needed
   * This prevents the token from expiring while the user is actively using the app
   */
  useEffect(() => {
    if (!user) return;

    const generation = generationRef.current;
    const proactiveRefresh = async () => {
      if (!isCurrentSession(generation)) return;
      try {
        await authService.refreshToken();
      } catch (error) {
        if (!isCurrentSession(generation)) return;
        console.error('Proactive token refresh failed:', error);
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          await logout();
        }
      }
    };

    // Refresh token every 10 minutes to keep the session alive
    const interval = setInterval(proactiveRefresh, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user, logout, isCurrentSession, sessionRevision]);

  /**
   * Inactivity-based auto-logout
   * Logs out user after 60 minutes of inactivity
   */
  useActivityMonitor({
    timeoutMs: 60 * 60 * 1000, // 60 minutes
    onInactive: () => {
      console.log('User inactive for 60 minutes - logging out');
      logout();
    },
    enabled: !!user, // Only monitor when user is logged in
  });

  const value: AuthContextValue = {
    user,
    permissions: activePermissions,
    isAuthenticated: !!user,
    isLoading,
    sessionRevision,
    login,
    logout,
    resetPassword,
    changePassword,
    refreshUser,
    setAuthenticatedUser,
    refreshPermissions,
    hasPlatformPermission,
    hasAnyPlatformPermission,
    hasProjectPermission,
    hasAnyProjectPermission,
    hasAnyEnginePermission,
    hasEnginePermission,
    hasAnyScopedEnginePermission,
  };

  // Show loading state while initializing
  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--color-bg-secondary)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '40px',
            height: '40px',
            margin: '0 auto var(--spacing-4)',
            border: '3px solid #e0e0e0',
            borderTopColor: '#0f62fe',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-14)' }}>
            Loading...
          </p>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
