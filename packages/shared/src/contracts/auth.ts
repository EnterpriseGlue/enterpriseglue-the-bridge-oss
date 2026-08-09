export type PlatformRole = 'admin' | 'user';

export type LegacyPlatformRole = PlatformRole | 'developer';

export function normalizePlatformRole(role?: string | null): PlatformRole {
  return role === 'admin' ? 'admin' : 'user';
}

export type AdminUserStatus = 'active' | 'inactive' | 'pending';

/**
 * Identity bound to the current authenticated request. This is intentionally
 * separate from the persisted user profile: a user may have a different
 * tenant scope on a subsequent request.
 */
export interface AuthenticatedSessionContext {
  principal: {
    type: 'user';
    id: string;
  };
  tenant: {
    id: string | null;
  };
}

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  platformRole: PlatformRole;
  capabilities?: UserCapabilities;
  authProvider?: string;
  isActive: boolean;
  isEmailVerified: boolean;
  mustResetPassword: boolean;
  createdAt: number;
  lastLoginAt?: number;
  adminStatus?: AdminUserStatus;
  failedLoginAttempts?: number;
  lockedUntil?: number | null;
  /** Present on responses produced by an authenticated session endpoint. */
  session?: AuthenticatedSessionContext;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  accessToken?: string;
  refreshToken?: string;
  expiresIn: number;
  emailVerificationRequired?: boolean;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  accessToken?: string;
  expiresIn: number;
}

export interface ResetPasswordRequest {
  currentPassword: string;
  newPassword: string;
  firstName?: string;
  lastName?: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordWithTokenRequest {
  token: string;
  newPassword: string;
}

export interface VerifyResetTokenResponse {
  valid: boolean;
  error?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface CreateUserRequest {
  email: string;
  firstName?: string;
  lastName?: string;
  /** Canonical user-management access selection. */
  role?: PlatformRole;
  /** @deprecated Use `role`; retained for older API clients only. */
  platformRole?: PlatformRole;
  sendEmail?: boolean;
}

export interface CreateUserResponse {
  user: User;
  inviteUrl?: string;
  oneTimePassword?: string;
  emailSent: boolean;
  emailError?: string;
}

export interface UpdateUserRequest {
  firstName?: string;
  lastName?: string;
  /** Canonical user-management access selection. */
  role?: PlatformRole;
  /** @deprecated Use `role`; retained for older API clients only. */
  platformRole?: PlatformRole;
  isActive?: boolean;
}

export interface ApiError {
  error: string;
  details?: any;
}

export interface EffectiveResourcePermissions {
  resourceId: string;
  permissions: string[];
}

export interface EffectiveEngineResourcePermissions extends EffectiveResourcePermissions {
  /** Coarse runtime-navigation permissions; never contains resource keys or tenant lineage. */
  runtimePermissions: string[];
}

export interface CurrentUserPermissions {
  userId: string;
  /** Request-derived tenant context for this evaluated snapshot. */
  tenantId: string | null;
  platform: string[];
  projects: EffectiveResourcePermissions[];
  engines: EffectiveEngineResourcePermissions[];
  authorizationVersion?: string;
  generatedAt: number;
}

export interface UserCapabilities {
  canViewAdminMenu: boolean;
  canAccessAdminRoutes: boolean;
  canManageUsers: boolean;
  canViewAuditLogs: boolean;
  canManagePlatformSettings: boolean;
  canViewMissionControl: boolean;
  canManageTenants: boolean;
  canManagePlatformEmail: boolean;
  canManageSsoProviders: boolean;
  canManagePlatformBranding: boolean;
  canManageTenantDomains: boolean;
  canManageTenantUsers: boolean;
  canManageTenantBranding: boolean;
  canManageTenantEmailTemplates: boolean;
  canViewTenantAudit: boolean;
  canManageTenantSso: boolean;
  canManageProject: boolean;
  canManageEngine: boolean;
  canInviteProjectMembers: boolean;
  canInviteEngineMembers: boolean;
}
