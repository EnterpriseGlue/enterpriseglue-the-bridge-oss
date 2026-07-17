/**
 * Authentication types
 */

export type {
  ApiError,
  ChangePasswordRequest,
  CreateUserRequest,
  CreateUserResponse,
  ForgotPasswordRequest,
  LoginRequest,
  LoginResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  ResetPasswordRequest,
  ResetPasswordWithTokenRequest,
  UpdateUserRequest,
  User,
  VerifyResetTokenResponse,
} from '@enterpriseglue/shared/contracts/auth.js';

// The browser permission snapshot is an authorization API response. Keep it
// tied to the same Zod-derived contract used by the backend route and OpenAPI
// rather than the older general authentication contracts barrel.
export type {
  CurrentUserPermissions,
  EffectiveResourcePermissions,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
