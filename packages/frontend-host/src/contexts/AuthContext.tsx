import React, { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authService } from '../services/auth';
import { useActivityMonitor } from '../shared/hooks/useActivityMonitor';
import { ApiError } from '../shared/api/client';
import type { User, LoginRequest, LoginResponse, ResetPasswordRequest, ChangePasswordRequest, CurrentUserPermissions } from '../shared/types/auth';
import { USER_KEY } from '../constants/storageKeys';
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

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<CurrentUserPermissions | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const persistUser = useCallback((nextUser: User | null) => {
    setUser(nextUser);
    try {
      if (nextUser) {
        localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
      } else {
        setPermissions(null);
        localStorage.removeItem(USER_KEY);
      }
    } catch {
    }
  }, []);

  const refreshPermissions = useCallback(async (): Promise<CurrentUserPermissions | null> => {
    try {
      const nextPermissions = await authService.getMyPermissions();
      setPermissions(nextPermissions);
      return nextPermissions;
    } catch {
      setPermissions(null);
      return null;
    }
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== USER_KEY) return;
      setUser(readStoredUser(event.newValue));
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  /**
   * Load user from localStorage and validate token
   * Also supports cookie-based auth (Microsoft OAuth)
   */
  useEffect(() => {
    const initAuth = async () => {
      try {
        // Try to fetch user - httpOnly cookies are sent automatically
        const user = await authService.getMe();
        if (user?.isEmailVerified === false) {
          clearAuth();
          return;
        }
        persistUser(user);
        await refreshPermissions();
      } catch (error) {
        // No valid session (401) or network error - try refresh
        try {
          await authService.refreshToken();
          const user = await authService.getMe();
          if (user?.isEmailVerified === false) {
            clearAuth();
            return;
          }
          persistUser(user);
          await refreshPermissions();
        } catch {
          // No valid session, user needs to login
          clearAuth();
        }
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  /**
   * Clear authentication data
   */
  const clearAuth = useCallback(() => {
    persistUser(null);
  }, [persistUser]);

  const setAuthenticatedUser = useCallback((nextUser: User | null) => {
    if (!nextUser) {
      clearAuth();
      return;
    }
    setUser(nextUser);
    setPermissions(null);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    void refreshPermissions();
  }, [clearAuth, refreshPermissions]);

  /**
   * Login with email and password
   */
  const login = useCallback(async (credentials: LoginRequest) => {
    const response = await authService.login(credentials);
    const requiresVerification =
      response?.emailVerificationRequired || response?.user?.isEmailVerified === false;

    if (requiresVerification) {
      clearAuth();
      return response;
    }

    // Store user info locally (tokens are in httpOnly cookies set by the server)
    persistUser(response.user);
    await refreshPermissions();

    return response;
  }, [clearAuth, persistUser, refreshPermissions]);

  /**
   * Logout and clear session
   */
  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      clearAuth();
    }
  }, [clearAuth]);

  /**
   * Reset password (first login)
   */
  const resetPassword = useCallback(async (request: ResetPasswordRequest) => {
    await authService.resetPassword(request);

    // Update user must_reset_password flag
    if (user) {
      const updatedUser = {
        ...user,
        firstName: request.firstName ?? user.firstName,
        lastName: request.lastName ?? user.lastName,
        mustResetPassword: false,
      };
      persistUser(updatedUser);
    }
  }, [persistUser, user]);

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
    try {
      const user = await authService.getMe();
      if (user?.isEmailVerified === false) {
        clearAuth();
        return;
      }
      persistUser(user);
      await refreshPermissions();
    } catch (error) {
      console.error('Failed to refresh user:', error);
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        clearAuth();
      }
      throw error;
    }
  }, [clearAuth, persistUser, refreshPermissions]);

  const hasPlatformPermission = useCallback((permission: string) =>
    snapshotHasPlatformPermission(permissions, permission), [permissions]);

  const hasAnyPlatformPermission = useCallback((permissionList: string[]) =>
    snapshotHasAnyPlatformPermission(permissions, permissionList), [permissions]);

  const hasProjectPermission = useCallback((projectId: string | null | undefined, permission: string) =>
    snapshotHasProjectPermission(permissions, projectId, permission), [permissions]);

  const hasAnyProjectPermission = useCallback((projectId: string | null | undefined, permissionList: string[]) =>
    snapshotHasAnyProjectPermission(permissions, projectId, permissionList), [permissions]);

  const hasAnyEnginePermission = useCallback((permissionList: string[]) =>
    snapshotHasAnyEnginePermission(permissions, permissionList), [permissions]);

  const hasEnginePermission = useCallback((engineId: string | null | undefined, permission: string) =>
    snapshotHasEnginePermission(permissions, engineId, permission), [permissions]);

  const hasAnyScopedEnginePermission = useCallback((engineId: string | null | undefined, permissionList: string[]) =>
    snapshotHasAnyScopedEnginePermission(permissions, engineId, permissionList), [permissions]);

  /**
   * Proactive token refresh - check every minute and refresh if needed
   * This prevents the token from expiring while the user is actively using the app
   */
  useEffect(() => {
    if (!user) return;

    const proactiveRefresh = async () => {
      try {
        await authService.refreshToken();
      } catch (error) {
        console.error('Proactive token refresh failed:', error);
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          await logout();
        }
      }
    };

    // Refresh token every 10 minutes to keep the session alive
    const interval = setInterval(proactiveRefresh, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user, logout]);

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
    permissions,
    isAuthenticated: !!user,
    isLoading,
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
