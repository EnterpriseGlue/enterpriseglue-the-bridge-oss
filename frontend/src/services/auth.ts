/**
 * Authentication API service
 * Handles all authentication-related API calls
 * Now with automatic token refresh on 401 errors
 */

import { apiClient } from '../shared/api/client';
import { parseApiError, getErrorMessageFromResponse } from '../shared/api/apiErrorUtils';
import { ACCESS_TOKEN_KEY } from '../constants/storageKeys';
import type {
  LoginRequest,
  LoginResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  ResetPasswordRequest,
  ForgotPasswordRequest,
  ResetPasswordWithTokenRequest,
  VerifyResetTokenResponse,
  ChangePasswordRequest,
  CreateUserRequest,
  CreateUserResponse,
  UpdateUserRequest,
  User,
} from '../shared/types/auth';

const API_BASE_URL = '/api';


class AuthService {
  private accessToken: string | null = null;

  /**
   * Set access token for authenticated requests
   */
  setAccessToken(token: string | null) {
    this.accessToken = token;
    // Also update localStorage for the interceptor
    if (token) {
      localStorage.setItem(ACCESS_TOKEN_KEY, token);
    }
  }

  /**
   * Login with email and password
   */
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    try {
      return await apiClient.post<LoginResponse>(
        `${API_BASE_URL}/auth/login`,
        credentials,
        { headers: { Authorization: '' } }
      );
    } catch (error) {
      const parsed = parseApiError(error, 'Unable to reach the authentication service.')
      const rawMessage = parsed.message || ''
      const isNetworkError =
        rawMessage.includes('Failed to fetch') ||
        rawMessage.includes('NetworkError') ||
        rawMessage.includes('Load failed') ||
        rawMessage.includes('ECONNREFUSED')

      const message = isNetworkError
        ? 'Unable to reach the authentication service. Please check that the backend and database are running.'
        : rawMessage ||
          'Unable to reach the authentication service. Please check that the backend and database are running.'
      throw new Error(message)
    }
  }

  /**
   * Logout and revoke refresh token
   */
  async logout(refreshToken?: string): Promise<void> {
    await apiClient.post(`${API_BASE_URL}/auth/logout`, { refreshToken });
  }

  /**
   * Refresh access token
   */
  async refreshToken(request: RefreshTokenRequest): Promise<RefreshTokenResponse> {
    return apiClient.post<RefreshTokenResponse>(
      `${API_BASE_URL}/auth/refresh`,
      request,
      { headers: { Authorization: '' } }
    );
  }

  /**
   * Get current user profile
   */
  async getMe(): Promise<User> {
    return apiClient.get<User>(`${API_BASE_URL}/auth/me`, undefined, {
      credentials: 'include', // Send HTTP-only cookies for Microsoft auth
    });
  }

  /**
   * Reset password (first login)
   */
  async resetPassword(request: ResetPasswordRequest): Promise<void> {
    await apiClient.post(`${API_BASE_URL}/auth/reset-password`, request);
  }

  /**
   * Request a password reset email
   */
  async forgotPassword(request: ForgotPasswordRequest): Promise<void> {
    await apiClient.post(`${API_BASE_URL}/auth/forgot-password`, request);
  }

  /**
   * Verify a reset token before showing reset form
   */
  async verifyResetToken(token: string): Promise<VerifyResetTokenResponse> {
    return apiClient.get<VerifyResetTokenResponse>(`${API_BASE_URL}/auth/verify-reset-token`, { token });
  }

  /**
   * Reset password with token
   */
  async resetPasswordWithToken(request: ResetPasswordWithTokenRequest): Promise<void> {
    await apiClient.post(`${API_BASE_URL}/auth/reset-password-with-token`, request);
  }

  /**
   * Change password
   */
  async changePassword(request: ChangePasswordRequest): Promise<void> {
    await apiClient.post(`${API_BASE_URL}/auth/change-password`, request);
  }

  /**
   * List all users (admin only)
   */
  async listUsers(): Promise<User[]> {
    return apiClient.get<User[]>(`${API_BASE_URL}/users`);
  }

  /**
   * Create new user (admin only)
   */
  async createUser(request: CreateUserRequest): Promise<CreateUserResponse> {
    return apiClient.post<CreateUserResponse>(`${API_BASE_URL}/users`, request);
  }

  /**
   * Get user by ID (admin only)
   */
  async getUser(id: string): Promise<User> {
    return apiClient.get<User>(`${API_BASE_URL}/users/${id}`);
  }

  /**
   * Update user (admin only)
   */
  async updateUser(id: string, request: UpdateUserRequest): Promise<User> {
    return apiClient.put<User>(`${API_BASE_URL}/users/${id}`, request);
  }

  /**
   * Delete user (admin only)
   */
  async deleteUser(id: string): Promise<void> {
    await apiClient.delete(`${API_BASE_URL}/users/${id}`);
  }

  /**
   * Unlock user account (admin only)
   */
  async unlockUser(id: string): Promise<void> {
    await apiClient.post(`${API_BASE_URL}/users/${id}/unlock`);
  }
}

export const authService = new AuthService();
