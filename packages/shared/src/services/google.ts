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
import { externalIdentityService } from './platform-admin/ExternalIdentityService.js';

const LEGACY_GOOGLE_EXTERNAL_PROVIDER_ID = 'legacy:google';

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

function selectedProviderId(providerId?: string | null): string | null {
  const normalized = providerId?.trim();
  return normalized || null;
}

function reconciliationProviderId(providerId?: string | null): string {
  return selectedProviderId(providerId) || 'google';
}

function externalIdentityProviderId(providerId?: string | null): string {
  return selectedProviderId(providerId) || LEGACY_GOOGLE_EXTERNAL_PROVIDER_ID;
}

/**
 * Check if Google auth is configured (via database or env)
 */
export async function isGoogleAuthEnabled(providerId?: string): Promise<boolean> {
  try {
    await getGoogleConfig(providerId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Google OAuth configuration. A selected legacy provider record is
 * authoritative: it must be an enabled Google record with its own secret;
 * environment fallback remains only for the provider-neutral compatibility
 * route that did not select a persisted provider.
 */
async function getGoogleConfig(providerId?: string): Promise<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}> {
  const selectedId = selectedProviderId(providerId);
  if (selectedId) {
    const provider = await ssoProviderService.getProviderWithSecrets(selectedId);
    if (!provider || provider.type !== 'google' || !provider.enabled || !provider.clientId || !provider.clientSecretEnc) {
      throw new Error('Selected Google OAuth provider is not configured');
    }
    return {
      clientId: provider.clientId,
      clientSecret: provider.clientSecretEnc,
      redirectUri: provider.callbackUrl || `${config.frontendUrl}/api/auth/google/callback`,
    };
  }

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
async function getGoogleClient(providerId?: string): Promise<OAuth2Client> {
  const googleConfig = await getGoogleConfig(providerId);
  
  return new OAuth2Client(
    googleConfig.clientId,
    googleConfig.clientSecret,
    googleConfig.redirectUri
  );
}

/**
 * Generate authorization URL to initiate OAuth flow
 */
export async function getGoogleAuthorizationUrl(state?: string, providerId?: string): Promise<string> {
  const client = await getGoogleClient(providerId);
  
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
export async function exchangeGoogleCodeForTokens(code: string, providerId?: string) {
  const client = await getGoogleClient(providerId);
  
  const { tokens } = await client.getToken(code);
  
  if (!tokens.id_token) {
    throw new Error('No ID token received from Google');
  }
  
  // Verify the ID token
  const googleConfig = await getGoogleConfig(providerId);
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
  resolvedPlatformRole: 'admin' | 'user',
  providerId: string,
): Promise<SsoSyncCounts> {
  const baselineMembership = await authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager, userId);
  const legacyRoleMembership = await authzGroupService.syncLegacySsoPlatformAdministratorMembershipWithManager(
    manager,
    userId,
    providerId,
    resolvedPlatformRole
  );
  const normalizedIdentitySync = await ssoNormalizedIdentityService.upsertIdentityWithManager(manager, {
    providerId,
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
export async function provisionGoogleUser(userInfo: GoogleUserInfo, selectedId?: string) {
  const dataSource = await getDataSource();
  const now = Date.now();
  const providerId = reconciliationProviderId(selectedId);
  const externalProviderId = externalIdentityProviderId(selectedId);
  
  // Resolve platform role from SSO claims
  const ssoClaims: SsoClaims = {
    email: userInfo.email,
    groups: [], // Google doesn't provide groups in basic OAuth
    roles: [],
    hd: userInfo.hd, // Can map based on hosted domain
  };
  const resolvedRole = await ssoClaimsMappingService.resolveRoleFromClaims(ssoClaims, providerId);
  
  logger.info('[Google Auth] SSO claims role resolution:', {
    resolvedRole: Boolean(resolvedRole),
    hostedDomainPresent: Boolean(userInfo.hd),
  });

  const runId = await ssoSyncDiagnosticsService.startRun({
    providerId,
    trigger: 'login',
    details: { hostedDomainPresent: Boolean(userInfo.hd) },
  });
  let syncCounts: SsoSyncCounts = {};

  try {
    const result = await dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const providerLinkedUserId = await externalIdentityService.getActiveLinkedUserIdWithManager(manager, {
        providerId: externalProviderId,
        subjectId: userInfo.sub,
      });
      // A selected persisted legacy provider takes ownership on successful
      // login, but accounts linked before provider selection used the shared
      // compatibility namespace. Preserve that account continuity once.
      const legacyLinkedUserId = !providerLinkedUserId && externalProviderId !== LEGACY_GOOGLE_EXTERNAL_PROVIDER_ID
        ? await externalIdentityService.getActiveLinkedUserIdWithManager(manager, {
          providerId: LEGACY_GOOGLE_EXTERNAL_PROVIDER_ID,
          subjectId: userInfo.sub,
        })
        : null;
      const linkedUserId = providerLinkedUserId || legacyLinkedUserId;
      const existingByExternalIdentity = linkedUserId ? await userRepo.findOneBy({ id: linkedUserId }) : null;
      if (linkedUserId && !existingByExternalIdentity) throw new Error('External identity references a missing user account');
      const existingByGoogleId = existingByExternalIdentity ? null : await userRepo.findOneBy({ googleId: userInfo.sub });
      const existingUser = existingByExternalIdentity || existingByGoogleId;

      if (existingUser) {
        const user = existingUser;
        await userRepo.update({ id: user.id }, {
          email: userInfo.email,
          firstName: userInfo.given_name || user.firstName,
          lastName: userInfo.family_name || user.lastName,
          lastLoginAt: now,
          updatedAt: now,
        });
        await externalIdentityService.upsertWithManager(manager, {
          providerId: externalProviderId,
          providerType: 'google',
          subjectId: userInfo.sub,
          directoryTenantId: userInfo.hd || null,
          userId: user.id,
          emailHint: userInfo.email,
          now,
        });
        syncCounts = await syncGoogleAuthorizationForUser(manager, user.id, userInfo, ssoClaims, resolvedRole, providerId);
        return { ...user, email: userInfo.email, firstName: userInfo.given_name || user.firstName, lastName: userInfo.family_name || user.lastName };
      }

      const existingByEmail = await userRepo.findOneBy({ email: userInfo.email });
      if (existingByEmail) {
        const user = existingByEmail;
        if (!userInfo.email_verified || (!user.isEmailVerified && user.authProvider !== 'google')) {
          throw new Error('Verified local email is required before linking a Google identity');
        }
        await userRepo.update({ id: user.id }, {
          authProvider: 'google',
          firstName: userInfo.given_name || user.firstName,
          lastName: userInfo.family_name || user.lastName,
          lastLoginAt: now, updatedAt: now,
          mustResetPassword: false, failedLoginAttempts: 0, lockedUntil: null,
        });
        await externalIdentityService.upsertWithManager(manager, {
          providerId: externalProviderId,
          providerType: 'google',
          subjectId: userInfo.sub,
          directoryTenantId: userInfo.hd || null,
          userId: user.id,
          emailHint: userInfo.email,
          now,
        });
        syncCounts = await syncGoogleAuthorizationForUser(manager, user.id, userInfo, ssoClaims, resolvedRole, providerId);
        return { ...user, authProvider: 'google', firstName: userInfo.given_name || user.firstName, lastName: userInfo.family_name || user.lastName };
      }

      const userId = generateId();
      await userRepo.insert({
        id: userId, email: userInfo.email, authProvider: 'google', passwordHash: null, googleId: null,
        firstName: userInfo.given_name || null, lastName: userInfo.family_name || null,
        isActive: true, mustResetPassword: false, failedLoginAttempts: 0, createdAt: now, updatedAt: now, lastLoginAt: now,
      });
      const newUser = await userRepo.findOneBy({ id: userId });
      await externalIdentityService.upsertWithManager(manager, {
        providerId: externalProviderId,
        providerType: 'google',
        subjectId: userInfo.sub,
        directoryTenantId: userInfo.hd || null,
        userId,
        emailHint: userInfo.email,
        now,
      });
      syncCounts = await syncGoogleAuthorizationForUser(manager, userId, userInfo, ssoClaims, resolvedRole, providerId);
      return newUser;
    });

    await ssoSyncDiagnosticsService.completeRun(runId, { providerId, userId: result?.id ?? null, ...syncCounts, details: {} });
    return result;
  } catch (error) {
    await ssoSyncDiagnosticsService.failRun(runId, error, { providerId, details: {} });
    throw error;
  }
}
