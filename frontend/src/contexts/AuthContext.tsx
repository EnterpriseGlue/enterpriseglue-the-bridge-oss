import React, { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authService } from '../services/auth';
import { useActivityMonitor } from '../shared/hooks/useActivityMonitor';
import type { User, LoginRequest, LoginResponse, ResetPasswordRequest, ChangePasswordRequest } from '../shared/types/auth';
import { USER_KEY } from '../constants/storageKeys';

/**
 * Authentication Context
 * Manages user authentication state and provides auth methods
 */

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginRequest) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  resetPassword: (request: ResetPasswordRequest) => Promise<void>;
  changePassword: (request: ChangePasswordRequest) => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}


export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
        setUser(user);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      } catch (error) {
        // No valid session (401) or network error - try refresh
        try {
          await authService.refreshToken();
          const user = await authService.getMe();
          if (user?.isEmailVerified === false) {
            clearAuth();
            return;
          }
          setUser(user);
          localStorage.setItem(USER_KEY, JSON.stringify(user));
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
    setUser(null);
    localStorage.removeItem(USER_KEY);
  }, []);

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
    localStorage.setItem(USER_KEY, JSON.stringify(response.user));

    setUser(response.user);

    return response;
  }, [clearAuth]);

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
      const updatedUser = { ...user, mustResetPassword: false };
      setUser(updatedUser);
      localStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
    }
  }, [user]);

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
      setUser(user);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (error) {
      console.error('Failed to refresh user:', error);
      throw error;
    }
  }, []);

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
        await logout();
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
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
    resetPassword,
    changePassword,
    refreshUser,
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
