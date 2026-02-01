import React, { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authService } from '../services/auth';
import { shouldRefreshToken } from '../utils/jwtHelper';
import { useActivityMonitor } from '../shared/hooks/useActivityMonitor';
import type { User, LoginRequest, LoginResponse, ResetPasswordRequest, ChangePasswordRequest } from '../shared/types/auth';
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY } from '../constants/storageKeys';

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
        const storedToken = localStorage.getItem(ACCESS_TOKEN_KEY);
        const storedUser = localStorage.getItem(USER_KEY);

        if (storedToken && storedUser) {
          let storedUserData: User | null = null;
          try {
            storedUserData = JSON.parse(storedUser) as User;
          } catch {
            storedUserData = null;
          }

          if (storedUserData?.isEmailVerified === false || !storedUserData) {
            clearAuth();
            return;
          }

          // Set token for API calls
          authService.setAccessToken(storedToken);

          // Verify token is still valid by fetching user
          try {
            const user = await authService.getMe();
            if (user?.isEmailVerified === false) {
              clearAuth();
              return;
            }
            setUser(user);
            localStorage.setItem(USER_KEY, JSON.stringify(user));
          } catch (error) {
            // Token invalid, try to refresh
            const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
            if (refreshToken) {
              try {
                const refreshResponse = await authService.refreshToken({ refreshToken });
                authService.setAccessToken(refreshResponse.accessToken);
                localStorage.setItem(ACCESS_TOKEN_KEY, refreshResponse.accessToken);

                // Fetch user again
                const user = await authService.getMe();
                if (user?.isEmailVerified === false) {
                  clearAuth();
                  return;
                }
                setUser(user);
                localStorage.setItem(USER_KEY, JSON.stringify(user));
              } catch {
                // Refresh failed, clear everything
                clearAuth();
              }
            } else {
              clearAuth();
            }
          }
        } else {
          // No localStorage token, but might have HTTP-only cookies from Microsoft auth
          // Try to fetch user - cookies will be sent automatically
          try {
            const user = await authService.getMe();
            if (user?.isEmailVerified === false) {
              clearAuth();
              return;
            }
            setUser(user);
            localStorage.setItem(USER_KEY, JSON.stringify(user));
          } catch (error) {
            // No valid session, user needs to login (expected when not logged in)
            // Suppress 401 errors in console as they're normal
            clearAuth();
          }
        }
      } catch (error) {
        console.error('Failed to initialize auth:', error);
        clearAuth();
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
    authService.setAccessToken(null);
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
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

    // Store tokens and user
    authService.setAccessToken(response.accessToken);
    localStorage.setItem(ACCESS_TOKEN_KEY, response.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, response.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(response.user));

    setUser(response.user);

    return response;
  }, [clearAuth]);

  /**
   * Logout and clear session
   */
  const logout = useCallback(async () => {
    try {
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (refreshToken) {
        await authService.logout(refreshToken);
      }
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

    const checkAndRefreshToken = async () => {
      const token = localStorage.getItem(ACCESS_TOKEN_KEY);
      if (!token) return;

      // Check if token should be refreshed (within 5 minutes of expiry)
      if (shouldRefreshToken(token)) {
        const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
        if (!refreshToken) {
          await logout();
          return;
        }

        try {
          const response = await authService.refreshToken({ refreshToken });
          authService.setAccessToken(response.accessToken);
          localStorage.setItem(ACCESS_TOKEN_KEY, response.accessToken);
          console.log('Token refreshed proactively');
        } catch (error) {
          console.error('Proactive token refresh failed:', error);
          await logout();
        }
      }
    };

    // Check immediately
    checkAndRefreshToken();

    // Then check every minute
    const interval = setInterval(checkAndRefreshToken, 60000); // 1 minute

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
