export type PlatformRole = 'admin' | 'developer' | 'user';

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  platformRole: PlatformRole;
  capabilities?: UserCapabilities;
  isActive: boolean;
  mustResetPassword: boolean;
  createdAt: number;
  lastLoginAt?: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  accessToken: string;
  expiresIn: number;
}

export interface ResetPasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface CreateUserRequest {
  email: string;
  firstName?: string;
  lastName?: string;
  platformRole?: PlatformRole;
  sendEmail?: boolean;
}

export interface CreateUserResponse {
  user: User;
  temporaryPassword?: string;
  emailSent: boolean;
  emailError?: string;
}

export interface UpdateUserRequest {
  firstName?: string;
  lastName?: string;
  platformRole?: PlatformRole;
  isActive?: boolean;
}

export interface ApiError {
  error: string;
  details?: any;
}

export interface UserCapabilities {
  canViewAdminMenu: boolean;
  canAccessAdminRoutes: boolean;
  canManageUsers: boolean;
  canViewAuditLogs: boolean;
  canManagePlatformSettings: boolean;
  canViewMissionControl: boolean;
  canManageTenants: boolean;
}
