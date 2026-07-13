/**
 * Google OAuth Authentication Service
 * Handles OAuth flow, token validation, and user provisioning for Google SSO
 */

import { OAuth2Client } from 'google-auth-library';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { ssoClaimsMappingService, type SsoClaims } from './platform-admin/SsoClaimsMappingService.js';
import { authzGroupService } from './platform-admin/AuthzGroupService.js';
import { ssoNormalizedIdentityService } from './platform-admin/SsoNormalizedIdentityService.js';
import { ssoProviderService } from './platform-admin/SsoProviderService.js';
import { ssoSyncDiagnosticsService, type SsoSyncCounts } from './platform-admin/SsoSyncDiagnosticsService.js';

/**
 * Google user info from ID token
 */
export interface GoogleUserInfo {
  sub: string;           // Subject (unique user identifier)
  email: string;         // User's email
  email_verified: boolean;
  name?: string;         // Full name
  given_name?: string;   // First name
  family_name?: string;  // Last name
  picture?: string;      // Profile picture URL
  hd?: string;           // Hosted domain (for Google Workspace)
}

/**
 * Check if Google auth is configured (via database or env)
 */
export async function isGoogleAuthEnabled(): Promise<boolean> {
  // Check database first
  const provider = await ssoProviderService.getProviderByType('google');
  if (provider?.enabled && provider.clientId && provider.clientSecretEnc) {
    return true;
  }
  
  // Fallback to env vars
  return !!(
    config.googleClientId &&
    config.googleClientSecret &&
    config.googleRedirectUri
  );
}

/**
 * Get Google OAuth client configuration
 */
async function getGoogleConfig(): Promise<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}> {
  // Check database first
  const provider = await ssoProviderService.getProviderByType('google');
  if (provider?.enabled && provider.clientId && provider.clientSecretEnc) {
    return {
      clientId: provider.clientId,
      clientSecret: provider.clientSecretEnc, // Already decrypted by service
      redirectUri: provider.callbackUrl || `${config.frontendUrl}/api/auth/google/callback`,
    };
  }
  
  // Fallback to env vars
  if (!config.googleClientId || !config.googleClientSecret || !config.googleRedirectUri) {
    throw new Error('Google OAuth is not configured');
  }
  
  return {
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: config.googleRedirectUri,
  };
}

/**
 * Create Google OAuth2 client
 */
async function getGoogleClient(): Promise<OAuth2Client> {
  const googleConfig = await getGoogleConfig();
  
  return new OAuth2Client(
    googleConfig.clientId,
    googleConfig.clientSecret,
    googleConfig.redirectUri
  );
}

/**
 * Generate authorization URL to initiate OAuth flow
 */
export async function getGoogleAuthorizationUrl(state?: string): Promise<string> {
  const client = await getGoogleClient();
  
  const scopes = [
    'openid',
    'profile',
    'email',
  ];
  
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state: state || generateId(),
    prompt: 'select_account',
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeGoogleCodeForTokens(code: string) {
  const client = await getGoogleClient();
  
  const { tokens } = await client.getToken(code);
  
  if (!tokens.id_token) {
    throw new Error('No ID token received from Google');
  }
  
  // Verify the ID token
  const googleConfig = await getGoogleConfig();
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: googleConfig.clientId,
  });
  
  const payload = ticket.getPayload();
  
  if (!payload) {
    throw new Error('Failed to get payload from Google ID token');
  }
  
  return {
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    payload: payload as GoogleUserInfo,
  };
}

/**
 * Extract user info from Google ID token payload
 */
export function extractGoogleUserInfo(payload: any): GoogleUserInfo {
  const email = payload.email;
  
  if (!email) {
    throw new Error('Email not found in Google token claims');
  }
  
  return {
    sub: payload.sub,
    email: email.toLowerCase(),
    email_verified: payload.email_verified,
    name: payload.name,
    given_name: payload.given_name,
    family_name: payload.family_name,
    picture: payload.picture,
    hd: payload.hd, // Hosted domain for Google Workspace
  };
}

async function syncGoogleAuthorizationForUser(
  manager: any,
  userId: string,
  userInfo: GoogleUserInfo,
  ssoClaims: SsoClaims,
  resolvedPlatformRole: 'admin' | 'user'
): Promise<SsoSyncCounts> {
  const baselineMembership = await authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager, userId);
  const legacyRoleMembership = await authzGroupService.syncLegacySsoPlatformAdministratorMembershipWithManager(
    manager,
    userId,
    'google',
    resolvedPlatformRole
  );
  const normalizedIdentitySync = await ssoNormalizedIdentityService.upsertIdentityWithManager(manager, {
    providerId: 'google',
    providerType: 'google',
    providerSubject: userInfo.sub,
    subjectClaim: 'sub',
    providerTenantId: userInfo.hd || null,
    userId,
    email: userInfo.email,
    displayName: userInfo.name || null,
    firstName: userInfo.given_name || null,
    lastName: userInfo.family_name || null,
    claims: ssoClaims,
  });
  return {
    groupMembershipsCreated: (normalizedIdentitySync.groupMembershipsCreated || 0) + (baselineMembership.created ? 1 : 0) + (legacyRoleMembership.created ? 1 : 0),
    groupMembershipsRemoved: (normalizedIdentitySync.groupMembershipsRemoved || 0) + (legacyRoleMembership.removed ? 1 : 0),
  };
}

/**
 * Create or update user from Google authentication
 * Just-In-Time (JIT) provisioning with SSO claims-based role mapping
 */
export async function provisionGoogleUser(userInfo: GoogleUserInfo) {
  const dataSource = await getDataSource();
  const now = Date.now();
  
  // Resolve platform role from SSO claims
  const ssoClaims: SsoClaims = {
    email: userInfo.email,
    groups: [], // Google doesn't provide groups in basic OAuth
    roles: [],
    hd: userInfo.hd, // Can map based on hosted domain
  };
  const resolvedRole = await ssoClaimsMappingService.resolveRoleFromClaims(ssoClaims, 'google');
  
  logger.info('[Google Auth] SSO claims role resolution:', {
    email: userInfo.email,
    hd: userInfo.hd,
    resolvedRole,
  });

  const runId = await ssoSyncDiagnosticsService.startRun({
    providerId: 'google',
    trigger: 'login',
    details: { email: userInfo.email, hostedDomain: userInfo.hd || null },
  });
  let syncCounts: SsoSyncCounts = {};

  try {
    const result = await dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const existingByGoogleId = await userRepo.findOneBy({ googleId: userInfo.sub });

      if (existingByGoogleId) {
        const user = existingByGoogleId;
        const platformRole = user.platformRole === 'admin' || resolvedRole === 'admin' ? 'admin' : 'user';
        await userRepo.update({ id: user.id }, {
          email: userInfo.email,
          firstName: userInfo.given_name || user.firstName,
          lastName: userInfo.family_name || user.lastName,
          lastLoginAt: now,
          updatedAt: now,
        });
        syncCounts = await syncGoogleAuthorizationForUser(manager, user.id, userInfo, ssoClaims, resolvedRole);
        return { ...user, email: userInfo.email, platformRole, firstName: userInfo.given_name || user.firstName, lastName: userInfo.family_name || user.lastName };
      }

      const existingByEmail = await userRepo.findOneBy({ email: userInfo.email });
      if (existingByEmail) {
        const user = existingByEmail;
        const platformRole = user.platformRole === 'admin' || resolvedRole === 'admin' ? 'admin' : 'user';
        await userRepo.update({ id: user.id }, {
          authProvider: 'google', googleId: userInfo.sub,
          firstName: userInfo.given_name || user.firstName,
          lastName: userInfo.family_name || user.lastName,
          lastLoginAt: now, updatedAt: now,
          mustResetPassword: false, failedLoginAttempts: 0, lockedUntil: null,
        });
        syncCounts = await syncGoogleAuthorizationForUser(manager, user.id, userInfo, ssoClaims, resolvedRole);
        return { ...user, authProvider: 'google', googleId: userInfo.sub, platformRole, firstName: userInfo.given_name || user.firstName, lastName: userInfo.family_name || user.lastName };
      }

      const userId = generateId();
      await userRepo.insert({
        id: userId, email: userInfo.email, authProvider: 'google', passwordHash: null, googleId: userInfo.sub,
        firstName: userInfo.given_name || null, lastName: userInfo.family_name || null, platformRole: 'user',
        isActive: true, mustResetPassword: false, failedLoginAttempts: 0, createdAt: now, updatedAt: now, lastLoginAt: now,
      });
      const newUser = await userRepo.findOneBy({ id: userId });
      syncCounts = await syncGoogleAuthorizationForUser(manager, userId, userInfo, ssoClaims, resolvedRole);
      return newUser ? { ...newUser, platformRole: resolvedRole } : newUser;
    });

    await ssoSyncDiagnosticsService.completeRun(runId, { providerId: 'google', userId: result?.id ?? null, ...syncCounts, details: { email: userInfo.email } });
    return result;
  } catch (error) {
    await ssoSyncDiagnosticsService.failRun(runId, error, { providerId: 'google', details: { email: userInfo.email } });
    throw error;
  }
}
