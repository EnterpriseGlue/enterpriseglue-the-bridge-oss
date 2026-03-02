/**
 * OAuth Service
 * Handles OAuth 2.0 flows for Git providers
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitProvider } from '@enterpriseglue/shared/db/entities/GitProvider.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { decrypt, safeDecrypt } from '@enterpriseglue/shared/services/encryption.js';
import crypto from 'crypto';

// OAuth URLs for each provider
const OAUTH_CONFIG: Record<string, {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  userInfoUrl?: string;
}> = {
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:user', 'user:email'],
    userInfoUrl: 'https://api.github.com/user',
  },
  gitlab: {
    authUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    scopes: ['api', 'read_user', 'read_repository', 'write_repository'],
    userInfoUrl: 'https://gitlab.com/api/v4/user',
  },
  bitbucket: {
    authUrl: 'https://bitbucket.org/site/oauth2/authorize',
    tokenUrl: 'https://bitbucket.org/site/oauth2/access_token',
    scopes: ['repository', 'repository:write', 'account'],
    userInfoUrl: 'https://api.bitbucket.org/2.0/user',
  },
  'azure-devops': {
    authUrl: 'https://app.vssps.visualstudio.com/oauth2/authorize',
    tokenUrl: 'https://app.vssps.visualstudio.com/oauth2/token',
    scopes: ['vso.code_write', 'vso.project'],
  },
};

// Store state tokens temporarily (in production, use Redis or DB)
const stateTokens = new Map<string, { userId: string; providerId: string; expiresAt: number }>();

export interface OAuthStartResult {
  authUrl: string;
  state: string;
}

export interface OAuthTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType: string;
  scope?: string;
}

class OAuthService {
  /**
   * Generate OAuth authorization URL
   */
  async startOAuthFlow(
    userId: string,
    providerId: string,
    redirectUri: string
  ): Promise<OAuthStartResult> {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(GitProvider);

    // Get provider config
    const provider = await providerRepo.findOneBy({ id: providerId });

    if (!provider) {
      throw new Error('Provider not found');
    }

    if (!provider.supportsOAuth) {
      throw new Error('Provider does not support OAuth');
    }

    if (!provider.oauthClientId) {
      throw new Error('OAuth not configured for this provider');
    }

    // Get OAuth config for provider type
    const oauthConfig = OAUTH_CONFIG[provider.type];
    if (!oauthConfig) {
      throw new Error(`OAuth not supported for provider type: ${provider.type}`);
    }

    // Generate state token
    const state = crypto.randomBytes(32).toString('hex');
    
    // Store state for verification (expires in 10 minutes)
    stateTokens.set(state, {
      userId,
      providerId,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    // Clean up expired states
    this.cleanupExpiredStates();

    // Build authorization URL
    const authUrl = provider.oauthAuthUrl || oauthConfig.authUrl;
    const scopes = provider.oauthScopes?.split(',') || oauthConfig.scopes;
    
    const params = new URLSearchParams({
      client_id: provider.oauthClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
    });

    // Azure DevOps uses different parameter names
    if (provider.type === 'azure-devops') {
      params.set('response_type', 'Assertion');
    }

    logger.info('Started OAuth flow', { userId, providerId, providerType: provider.type });

    return {
      authUrl: `${authUrl}?${params.toString()}`,
      state,
    };
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(
    code: string,
    state: string,
    redirectUri: string
  ): Promise<{ userId: string; providerId: string; tokens: OAuthTokenResult }> {
    // Verify state
    const stateData = stateTokens.get(state);
    if (!stateData) {
      throw new Error('Invalid or expired state token');
    }

    if (stateData.expiresAt < Date.now()) {
      stateTokens.delete(state);
      throw new Error('State token expired');
    }

    // Remove used state
    stateTokens.delete(state);

    const { userId, providerId } = stateData;
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(GitProvider);

    // Get provider config
    const provider = await providerRepo.findOneBy({ id: providerId });

    if (!provider) {
      throw new Error('Provider not found');
    }
    const oauthConfig = OAUTH_CONFIG[provider.type];

    if (!provider.oauthClientId || !provider.oauthClientSecret) {
      throw new Error('OAuth not configured for this provider');
    }

    // Decrypt client secret
    const clientSecret = safeDecrypt(provider.oauthClientSecret);

    // Exchange code for tokens
    const tokenUrl = provider.oauthTokenUrl || oauthConfig.tokenUrl;
    
    const body = new URLSearchParams({
      client_id: provider.oauthClientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    // Azure DevOps uses different parameters
    if (provider.type === 'azure-devops') {
      body.set('assertion', code);
      body.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('OAuth token exchange failed', { providerId, error });
      throw new Error('Failed to exchange authorization code');
    }

    const data = await response.json();

    // Handle different response formats
    const tokens: OAuthTokenResult = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope,
    };

    logger.info('OAuth token exchange successful', { userId, providerId });

    return { userId, providerId, tokens };
  }

  /**
   * Refresh an OAuth token
   */
  async refreshToken(
    providerId: string,
    refreshToken: string
  ): Promise<OAuthTokenResult> {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(GitProvider);

    const provider = await providerRepo.findOneBy({ id: providerId });

    if (!provider) {
      throw new Error('Provider not found');
    }
    const oauthConfig = OAUTH_CONFIG[provider.type];

    if (!provider.oauthClientId || !provider.oauthClientSecret) {
      throw new Error('OAuth not configured for this provider');
    }

    const clientSecret = safeDecrypt(provider.oauthClientSecret);
    const tokenUrl = provider.oauthTokenUrl || oauthConfig.tokenUrl;

    const body = new URLSearchParams({
      client_id: provider.oauthClientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error('Failed to refresh token');
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope,
    };
  }

  /**
   * Get OAuth configuration for a provider
   */
  async getOAuthConfig(providerId: string): Promise<{
    supportsOAuth: boolean;
    isConfigured: boolean;
    scopes: string[];
  }> {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(GitProvider);

    const provider = await providerRepo.findOneBy({ id: providerId });

    if (!provider) {
      throw new Error('Provider not found');
    }
    const oauthConfig = OAUTH_CONFIG[provider.type];

    return {
      supportsOAuth: provider.supportsOAuth && !!oauthConfig,
      isConfigured: !!(provider.oauthClientId && provider.oauthClientSecret),
      scopes: provider.oauthScopes?.split(',') || oauthConfig?.scopes || [],
    };
  }

  /**
   * Clean up expired state tokens
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, data] of stateTokens.entries()) {
      if (data.expiresAt < now) {
        stateTokens.delete(state);
      }
    }
  }
}

export const oauthService = new OAuthService();
