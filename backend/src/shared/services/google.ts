/**
 * Google OAuth Authentication Service
 * Handles OAuth flow, token validation, and user provisioning for Google SSO
 */

import { OAuth2Client } from 'google-auth-library';
import { logger } from '@shared/utils/logger.js';
import { config } from '@shared/config/index.js';
import { getDataSource } from '@shared/db/data-source.js';
import { User } from '@shared/db/entities/User.js';
import { generateId } from '@shared/utils/id.js';
import { ssoClaimsMappingService, type SsoClaims } from './platform-admin/SsoClaimsMappingService.js';
import { ssoProviderService } from './platform-admin/SsoProviderService.js';

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

/**
 * Create or update user from Google authentication
 * Just-In-Time (JIT) provisioning with SSO claims-based role mapping
 */
export async function provisionGoogleUser(userInfo: GoogleUserInfo) {
  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
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
  
  // Check if user exists by googleId
  const existingByGoogleId = await userRepo.findOneBy({ googleId: userInfo.sub });
  
  if (existingByGoogleId) {
    // User exists - update profile and last login
    const user = existingByGoogleId;
    const currentRole = user.platformRole || 'user';
    const platformRole = currentRole === 'admin' ? 'admin' : resolvedRole;
    
    await userRepo.update({ id: user.id }, {
      email: userInfo.email,
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
  
  // Check if user exists by email
  const existingByEmail = await userRepo.findOneBy({ email: userInfo.email });
  
  if (existingByEmail) {
    // Email exists but not linked to Google - link the accounts
    const user = existingByEmail;
    const currentRole = user.platformRole || 'user';
    const platformRole = currentRole === 'admin' ? 'admin' : resolvedRole;
    
    await userRepo.update({ id: user.id }, {
      authProvider: 'google',
      googleId: userInfo.sub,
      firstName: userInfo.given_name || user.firstName,
      lastName: userInfo.family_name || user.lastName,
      platformRole,
      lastLoginAt: now,
      updatedAt: now,
      mustResetPassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    
    return {
      ...user,
      authProvider: 'google',
      googleId: userInfo.sub,
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
    authProvider: 'google',
    passwordHash: null,
    googleId: userInfo.sub,
    firstName: userInfo.given_name || null,
    lastName: userInfo.family_name || null,
    platformRole: resolvedRole,
    isActive: true,
    mustResetPassword: false,
    failedLoginAttempts: 0,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  });
  
  const newUser = await userRepo.findOneBy({ id: userId });
  return newUser;
}
