/**
 * Microsoft Entra ID (Azure AD) Authentication Service
 * Handles OAuth flow, token validation, and user provisioning
 */

import { createRequire } from 'node:module';
import { logger } from '@shared/utils/logger.js';
import { config } from '@shared/config/index.js';
import { getDataSource } from '@shared/db/data-source.js';
import { User } from '@shared/db/entities/User.js';
import { generateId } from '@shared/utils/id.js';
import { ssoClaimsMappingService, type SsoClaims } from './platform-admin/SsoClaimsMappingService.js';

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

const require = createRequire(import.meta.url);
const msalNode = require('@azure/msal-node');

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

/**
 * Create or update user from Microsoft authentication
 * Just-In-Time (JIT) provisioning with SSO claims-based role mapping
 */
export async function provisionMicrosoftUser(userInfo: MicrosoftUserInfo) {
  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
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

  // Check if user exists by entraId
  const existingByEntraId = await userRepo.findOneBy({ entraId: userInfo.oid });

  if (existingByEntraId) {
    // User exists - update profile and last login
    const user = existingByEntraId;
    // Use SSO-resolved role, but don't downgrade admins (manual admin override persists)
    const currentRole = user.platformRole || 'user';
    const platformRole = currentRole === 'admin' ? 'admin' : resolvedRole;
    
    await userRepo.update({ id: user.id }, {
      email: userInfo.email,
      entraEmail: userInfo.email,
      firstName: userInfo.given_name || user.firstName,
      lastName: userInfo.family_name || user.lastName,
      platformRole,
      lastLoginAt: now,
      updatedAt: now,
    });

    return {
      ...user,
      email: userInfo.email,
      platformRole,
      firstName: userInfo.given_name || user.firstName,
      lastName: userInfo.family_name || user.lastName,
    };
  }

  // Check if user exists by email (might be migrating local user to Microsoft)
  const existingByEmail = await userRepo.findOneBy({ email: userInfo.email });

  if (existingByEmail) {
    // Email exists but not linked to Microsoft account - link the accounts
    const user = existingByEmail;
    // Use SSO-resolved role, but don't downgrade admins
    const currentRole = user.platformRole || 'user';
    const platformRole = currentRole === 'admin' ? 'admin' : resolvedRole;
    
    await userRepo.update({ id: user.id }, {
      authProvider: 'microsoft',
      entraId: userInfo.oid,
      entraEmail: userInfo.email,
      firstName: userInfo.given_name || user.firstName,
      lastName: userInfo.family_name || user.lastName,
      platformRole,
      lastLoginAt: now,
      updatedAt: now,
      // Clear password-related fields since they're using Microsoft now
      mustResetPassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    return {
      ...user,
      authProvider: 'microsoft',
      entraId: userInfo.oid,
      platformRole,
      firstName: userInfo.given_name || user.firstName,
      lastName: userInfo.family_name || user.lastName,
    };
  }

  // New user - create account with SSO-resolved role
  const userId = generateId();
  
  await userRepo.insert({
    id: userId,
    email: userInfo.email,
    authProvider: 'microsoft',
    passwordHash: null, // Microsoft users don't have passwords
    entraId: userInfo.oid,
    entraEmail: userInfo.email,
    firstName: userInfo.given_name || null,
    lastName: userInfo.family_name || null,
    platformRole: resolvedRole,
    isActive: true,
    mustResetPassword: false, // Microsoft handles password policy
    failedLoginAttempts: 0,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  });

  const newUser = await userRepo.findOneBy({ id: userId });
  return newUser;
}
