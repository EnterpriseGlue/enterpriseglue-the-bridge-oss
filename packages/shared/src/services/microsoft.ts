/**
 * Microsoft Entra ID (Azure AD) Authentication Service
 * Handles OAuth flow, token validation, and user provisioning
 */

import * as msalNode from '@azure/msal-node';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { ssoClaimsMappingService, type SsoClaims } from './platform-admin/SsoClaimsMappingService.js';
import { authzGroupService } from './platform-admin/AuthzGroupService.js';
import { ssoAssignmentMappingService } from './platform-admin/SsoAssignmentMappingService.js';
import { ssoGroupMappingService } from './platform-admin/SsoGroupMappingService.js';
import { ssoNormalizedIdentityService } from './platform-admin/SsoNormalizedIdentityService.js';
import { ssoSyncDiagnosticsService, type SsoSyncCounts } from './platform-admin/SsoSyncDiagnosticsService.js';
import { externalIdentityService } from './platform-admin/ExternalIdentityService.js';

const LEGACY_MICROSOFT_EXTERNAL_PROVIDER_ID = 'legacy:microsoft';

/**
 * Microsoft user info from ID token
 */
export interface MicrosoftUserInfo {
  oid: string;              // Object ID (unique user identifier)
  email: string;            // User's email
  name?: string;            // Full name
  given_name?: string;      // First name
  family_name?: string;     // Last name
  preferred_username?: string; // Username (usually email)
  tid: string;              // Tenant ID
  groups?: string[];        // Group memberships (if requested)
  roles?: string[];         // App roles (if configured)
}

type AuthorizationUrlRequest = Record<string, any>;
type AuthorizationCodeRequest = Record<string, any>;
type ConfidentialClientApplication = any;

// @azure/msal-node v5 supports ESM natively — no createRequire needed

/**
 * Check if Microsoft Entra ID is configured
 */
export function isMicrosoftAuthEnabled(): boolean {
  return !!(
    config.microsoftClientId &&
    config.microsoftClientSecret &&
    config.microsoftTenantId &&
    config.microsoftRedirectUri
  );
}

/**
 * Create MSAL confidential client application
 */
function getMsalClient(): ConfidentialClientApplication {
  if (!isMicrosoftAuthEnabled()) {
    throw new Error('Microsoft Entra ID is not configured');
  }

  return new msalNode.ConfidentialClientApplication({
    auth: {
      clientId: config.microsoftClientId!,
      authority: `https://login.microsoftonline.com/${config.microsoftTenantId}`,
      clientSecret: config.microsoftClientSecret!,
    },
    system: {
      loggerOptions: {
        loggerCallback: (level: number, message: string, containsPii: boolean) => {
          if (containsPii) return;
          if (config.nodeEnv === 'development') {
            logger.info(`[MSAL] ${message}`);
          }
        },
        piiLoggingEnabled: false,
        logLevel: config.nodeEnv === 'development' ? 3 : 1, // 3 = Verbose in dev, 1 = Error in prod
      },
    },
  });
}

/**
 * Generate authorization URL to initiate OAuth flow
 * User will be redirected to this URL to sign in with Microsoft
 */
export async function getAuthorizationUrl(state?: string): Promise<string> {
  const msalClient = getMsalClient();

  const authCodeUrlParameters: AuthorizationUrlRequest = {
    scopes: ['openid', 'profile', 'email', 'User.Read'],
    redirectUri: config.microsoftRedirectUri!,
    state: state || generateId(), // CSRF protection
    prompt: 'select_account', // Let user choose account
  };

  return await msalClient.getAuthCodeUrl(authCodeUrlParameters);
}

/**
 * Exchange authorization code for tokens
 * This happens after user authenticates and Microsoft redirects back
 */
export async function exchangeCodeForTokens(code: string) {
  const msalClient = getMsalClient();

  const tokenRequest: AuthorizationCodeRequest = {
    code,
    scopes: ['openid', 'profile', 'email', 'User.Read'],
    redirectUri: config.microsoftRedirectUri!,
  };

  const response = await msalClient.acquireTokenByCode(tokenRequest);

  if (!response || !response.idToken || !response.account) {
    throw new Error('Failed to acquire tokens from Microsoft');
  }

  return {
    idToken: response.idToken,
    accessToken: response.accessToken,
    account: response.account,
    idTokenClaims: response.idTokenClaims as MicrosoftUserInfo,
  };
}

/**
 * Extract user info from Microsoft ID token claims
 */
export function extractUserInfo(idTokenClaims: any): MicrosoftUserInfo {
  const email = idTokenClaims.email || idTokenClaims.preferred_username || idTokenClaims.upn;

  if (!email) {
    throw new Error('Email not found in Microsoft token claims');
  }

  return {
    oid: idTokenClaims.oid,
    email: email.toLowerCase(),
    name: idTokenClaims.name,
    given_name: idTokenClaims.given_name,
    family_name: idTokenClaims.family_name,
    preferred_username: idTokenClaims.preferred_username,
    tid: idTokenClaims.tid,
  };
}

async function syncMicrosoftAuthorizationForUser(
  manager: any,
  userId: string,
  userInfo: MicrosoftUserInfo,
  ssoClaims: SsoClaims,
  resolvedPlatformRole: 'admin' | 'user'
): Promise<SsoSyncCounts> {
  const baselineMembership = await authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager, userId);
  const legacyRoleMembership = await authzGroupService.syncLegacySsoPlatformAdministratorMembershipWithManager(
    manager,
    userId,
    'microsoft',
    resolvedPlatformRole
  );
  const normalizedIdentitySync = await ssoNormalizedIdentityService.upsertIdentityWithManager(manager, {
    providerId: 'microsoft',
    providerType: 'microsoft',
    providerSubject: userInfo.oid,
    subjectClaim: 'oid',
    providerTenantId: userInfo.tid,
    userId,
    email: userInfo.email,
    displayName: userInfo.name || null,
    firstName: userInfo.given_name || null,
    lastName: userInfo.family_name || null,
    claims: ssoClaims,
  });
  const groupSync = await ssoGroupMappingService.syncMembershipsForUserWithManager(manager, userId, ssoClaims, 'microsoft');
  const assignmentSync = await ssoAssignmentMappingService.syncAssignmentsForUserWithManager(manager, userId, ssoClaims, 'microsoft');
  return {
    groupMembershipsCreated: groupSync.created + (normalizedIdentitySync.groupMembershipsCreated || 0) + (baselineMembership.created ? 1 : 0) + (legacyRoleMembership.created ? 1 : 0),
    groupMembershipsUpdated: groupSync.updated,
    groupMembershipsRemoved: groupSync.removed + (normalizedIdentitySync.groupMembershipsRemoved || 0) + (legacyRoleMembership.removed ? 1 : 0),
    assignmentsCreated: assignmentSync.created,
    assignmentsUpdated: assignmentSync.updated,
    assignmentsRemoved: assignmentSync.removed,
  };
}

/**
 * Create or update user from Microsoft authentication
 * Just-In-Time (JIT) provisioning with SSO claims-based role mapping
 */
export async function provisionMicrosoftUser(userInfo: MicrosoftUserInfo) {
  const dataSource = await getDataSource();
  const now = Date.now();

  // Resolve platform role from SSO claims (groups, roles, email domain)
  const ssoClaims: SsoClaims = {
    email: userInfo.email,
    groups: userInfo.groups || [],
    roles: userInfo.roles || [],
  };
  const resolvedRole = await ssoClaimsMappingService.resolveRoleFromClaims(ssoClaims, 'microsoft');

  logger.info('[Microsoft Auth] SSO claims role resolution:', {
    email: userInfo.email,
    groups: userInfo.groups,
    roles: userInfo.roles,
    resolvedRole,
  });

  const runId = await ssoSyncDiagnosticsService.startRun({
    providerId: 'microsoft',
    trigger: 'login',
    details: {
      email: userInfo.email,
      groupsCount: ssoClaims.groups?.length ?? 0,
      rolesCount: ssoClaims.roles?.length ?? 0,
    },
  });
  let syncCounts: SsoSyncCounts = {};

  try {
    const result = await dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const linkedUserId = await externalIdentityService.getActiveLinkedUserIdWithManager(manager, {
        providerId: LEGACY_MICROSOFT_EXTERNAL_PROVIDER_ID,
        subjectId: userInfo.oid,
      });
      const existingByExternalIdentity = linkedUserId ? await userRepo.findOneBy({ id: linkedUserId }) : null;
      if (linkedUserId && !existingByExternalIdentity) throw new Error('External identity references a missing user account');

      // The old column remains a one-release fallback for installations that
      // have not yet run the ExternalIdentity backfill migration.
      const existingByEntraId = existingByExternalIdentity ? null : await userRepo.findOneBy({ entraId: userInfo.oid });
      const existingUser = existingByExternalIdentity || existingByEntraId;

      if (existingUser) {
        // User exists - update profile and last login. The persisted platform
        // role remains compatibility data; SSO authorization is group-backed.
        const user = existingUser;
        await userRepo.update({ id: user.id }, {
          email: userInfo.email,
          entraEmail: userInfo.email,
          firstName: userInfo.given_name || user.firstName,
          lastName: userInfo.family_name || user.lastName,
          lastLoginAt: now,
          updatedAt: now,
        });

        await externalIdentityService.upsertWithManager(manager, {
          providerId: LEGACY_MICROSOFT_EXTERNAL_PROVIDER_ID,
          providerType: 'microsoft',
          subjectId: userInfo.oid,
          directoryTenantId: userInfo.tid,
          userId: user.id,
          emailHint: userInfo.email,
          now,
        });

        syncCounts = await syncMicrosoftAuthorizationForUser(manager, user.id, userInfo, ssoClaims, resolvedRole);

        return {
          ...user,
          email: userInfo.email,
          firstName: userInfo.given_name || user.firstName,
          lastName: userInfo.family_name || user.lastName,
        };
      }

      // Check if user exists by email (might be migrating local user to Microsoft)
      const existingByEmail = await userRepo.findOneBy({ email: userInfo.email });

      if (existingByEmail) {
        // Email exists but not linked to Microsoft account - link the accounts
        const user = existingByEmail;
        await userRepo.update({ id: user.id }, {
          authProvider: 'microsoft',
          entraEmail: userInfo.email,
          firstName: userInfo.given_name || user.firstName,
          lastName: userInfo.family_name || user.lastName,
          lastLoginAt: now,
          updatedAt: now,
          // Clear password-related fields since they're using Microsoft now
          mustResetPassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
        });

        await externalIdentityService.upsertWithManager(manager, {
          providerId: LEGACY_MICROSOFT_EXTERNAL_PROVIDER_ID,
          providerType: 'microsoft',
          subjectId: userInfo.oid,
          directoryTenantId: userInfo.tid,
          userId: user.id,
          emailHint: userInfo.email,
          now,
        });

        syncCounts = await syncMicrosoftAuthorizationForUser(manager, user.id, userInfo, ssoClaims, resolvedRole);

        return {
          ...user,
          authProvider: 'microsoft',
          firstName: userInfo.given_name || user.firstName,
          lastName: userInfo.family_name || user.lastName,
        };
      }

      // New users retain the non-authoritative compatibility default. The SSO
      // claim result below is synchronized to a source-managed group.
      const userId = generateId();

      await userRepo.insert({
        id: userId,
        email: userInfo.email,
        authProvider: 'microsoft',
        passwordHash: null, // Microsoft users don't have passwords
        entraId: null,
        entraEmail: null,
        firstName: userInfo.given_name || null,
        lastName: userInfo.family_name || null,
        platformRole: 'user',
        isActive: true,
        mustResetPassword: false, // Microsoft handles password policy
        failedLoginAttempts: 0,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      });

      const newUser = await userRepo.findOneBy({ id: userId });
      await externalIdentityService.upsertWithManager(manager, {
        providerId: LEGACY_MICROSOFT_EXTERNAL_PROVIDER_ID,
        providerType: 'microsoft',
        subjectId: userInfo.oid,
        directoryTenantId: userInfo.tid,
        userId,
        emailHint: userInfo.email,
        now,
      });
      syncCounts = await syncMicrosoftAuthorizationForUser(manager, userId, userInfo, ssoClaims, resolvedRole);
      return newUser;
    });

    await ssoSyncDiagnosticsService.completeRun(runId, {
      providerId: 'microsoft',
      userId: result?.id ?? null,
      ...syncCounts,
      details: {
        email: userInfo.email,
      },
    });
    return result;
  } catch (error) {
    await ssoSyncDiagnosticsService.failRun(runId, error, {
      providerId: 'microsoft',
      details: {
        email: userInfo.email,
      },
    });
    throw error;
  }
}
