/**
 * Git Credential Service
 * Manages user credentials for Git providers (PAT and OAuth)
 */

import { getDataSource } from '@shared/db/data-source.js';
import { GitCredential } from '@shared/db/entities/GitCredential.js';
import { GitProvider } from '@shared/db/entities/GitProvider.js';
import { In } from 'typeorm';
import { generateId } from '@shared/utils/id.js';
import { logger } from '@shared/utils/logger.js';
import { encrypt, decrypt, safeDecrypt } from '@shared/services/encryption.js';
import { remoteGitService } from './RemoteGitService.js';

export interface StoredCredential {
  id: string;
  userId: string;
  providerId: string;
  providerName: string;
  providerType: string;
  name?: string; // User-defined connection name
  authType: 'pat' | 'oauth';
  providerUsername?: string;
  expiresAt?: number;
  scopes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SaveCredentialOptions {
  userId: string;
  providerId: string;
  name?: string; // User-defined connection name
  authType: 'pat' | 'oauth';
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string;
}

class CredentialService {
  /**
   * Save or update credentials for a user/provider
   */
  async saveCredential(options: SaveCredentialOptions): Promise<StoredCredential> {
    const dataSource = await getDataSource();
    const credRepo = dataSource.getRepository(GitCredential);
    const providerRepo = dataSource.getRepository(GitProvider);
    const now = Date.now();

    // Validate the token by getting user info
    let providerUserId: string | undefined;
    let providerUsername: string | undefined;
    
    try {
      const client = await remoteGitService.getClient(options.providerId, options.accessToken);
      await client.validateCredentials();
      
      const user = await client.getCurrentUser();
      providerUserId = user.id;
      providerUsername = user.username;
      logger.info('Validated credentials for user', { providerUsername, providerUserId });
    } catch (error: any) {
      const detail = error?.message || String(error);
      logger.error('Failed to validate credentials', { providerId: options.providerId, detail });
      throw new Error(detail);
    }

    // Encrypt tokens
    const encryptedAccessToken = encrypt(options.accessToken);
    const encryptedRefreshToken = options.refreshToken ? encrypt(options.refreshToken) : null;

    // Check if credential already exists
    const existing = await credRepo.findOneBy({
      userId: options.userId,
      providerId: options.providerId,
    });

    let credentialId: string;

    // Generate default name if not provided
    const connectionName = options.name || (providerUsername ? `${providerUsername}` : undefined);

    if (existing) {
      // Update existing
      credentialId = existing.id;
      try {
        await credRepo.update({ id: credentialId }, {
          name: connectionName,
          authType: options.authType,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt: options.expiresAt || null,
          scopes: options.scopes || null,
          providerUserId,
          providerUsername,
          updatedAt: now,
        });
      } catch (dbError) {
        // Fallback: columns may not exist yet, update without them
        logger.warn('Failed to update with provider info columns, trying without', { dbError });
        await credRepo.update({ id: credentialId }, {
          authType: options.authType,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt: options.expiresAt || null,
          scopes: options.scopes || null,
          updatedAt: now,
        });
      }
      
      logger.info('Updated git credentials', { userId: options.userId, providerId: options.providerId, providerUsername });
    } else {
      // Create new
      credentialId = generateId();
      try {
        await credRepo.insert({
          id: credentialId,
          userId: options.userId,
          providerId: options.providerId,
          name: connectionName,
          authType: options.authType,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenType: 'Bearer',
          expiresAt: options.expiresAt || null,
          scopes: options.scopes || null,
          providerUserId,
          providerUsername,
          createdAt: now,
          updatedAt: now,
        });
      } catch (dbError) {
        // Fallback: columns may not exist yet, insert without them
        logger.warn('Failed to insert with provider info columns, trying without', { dbError });
        await credRepo.insert({
          id: credentialId,
          userId: options.userId,
          providerId: options.providerId,
          authType: options.authType,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenType: 'Bearer',
          expiresAt: options.expiresAt || null,
          scopes: options.scopes || null,
          createdAt: now,
          updatedAt: now,
        });
      }
      
      logger.info('Created git credentials', { userId: options.userId, providerId: options.providerId, providerUsername });
    }

    // Get provider info for response
    const provider = await providerRepo.findOneBy({ id: options.providerId });

    return {
      id: credentialId,
      userId: options.userId,
      providerId: options.providerId,
      providerName: provider?.name || 'Unknown',
      providerType: provider?.type || 'unknown',
      name: connectionName,
      authType: options.authType,
      providerUsername,
      expiresAt: options.expiresAt,
      scopes: options.scopes,
      createdAt: existing ? Number(existing.createdAt) : now,
      updatedAt: now,
    };
  }

  /**
   * Get credential for a user/provider
   */
  async getCredential(userId: string, providerId: string): Promise<StoredCredential | null> {
    const dataSource = await getDataSource();
    const credRepo = dataSource.getRepository(GitCredential);
    const providerRepo = dataSource.getRepository(GitProvider);

    // Get credential
    const credential = await credRepo.findOneBy({ userId, providerId });

    if (!credential) return null;

    // Get provider
    const provider = await providerRepo.findOneBy({ id: providerId });

    return {
      id: credential.id,
      userId: credential.userId,
      providerId: credential.providerId,
      providerName: provider?.name || 'Unknown',
      providerType: provider?.type || 'unknown',
      authType: credential.authType as 'pat' | 'oauth',
      providerUsername: credential.providerUsername || undefined,
      expiresAt: credential.expiresAt ? Number(credential.expiresAt) : undefined,
      scopes: credential.scopes || undefined,
      createdAt: Number(credential.createdAt),
      updatedAt: Number(credential.updatedAt),
    };
  }

  /**
   * Get decrypted access token for a user/provider
   * Automatically refreshes OAuth tokens if expired and refresh token is available
   */
  async getAccessToken(userId: string, providerId: string): Promise<string | null> {
    const dataSource = await getDataSource();
    const credRepo = dataSource.getRepository(GitCredential);

    const credential = await credRepo.findOne({
      where: { userId, providerId },
      select: ['id', 'accessToken', 'refreshToken', 'expiresAt', 'authType'],
    });

    if (!credential) return null;

    const { id, accessToken, refreshToken, expiresAt, authType } = credential;

    // Check if token is expired
    if (expiresAt && Number(expiresAt) < Date.now()) {
      // Try to refresh if we have a refresh token and it's OAuth
      if (refreshToken && authType === 'oauth') {
        logger.info('Access token expired, attempting refresh', { userId, providerId });
        
        const refreshed = await this.refreshAccessToken(id, providerId, refreshToken);
        if (refreshed) {
          return refreshed;
        }
      }
      
      logger.warn('Access token expired and cannot be refreshed', { userId, providerId });
      return null;
    }

    try {
      return decrypt(accessToken);
    } catch (decryptError) {
      logger.error('Failed to decrypt access token – the ENCRYPTION_KEY may have changed since this credential was saved. Re-save the Git connection to fix.', { userId, providerId, error: decryptError });
      return null;
    }
  }

  /**
   * Refresh an OAuth access token using the refresh token
   */
  async refreshAccessToken(credentialId: string, providerId: string, encryptedRefreshToken: string): Promise<string | null> {
    try {
      const dataSource = await getDataSource();
      const providerRepo = dataSource.getRepository(GitProvider);
      const credRepo = dataSource.getRepository(GitCredential);
      
      // Get provider details
      const provider = await providerRepo.findOneBy({ id: providerId });

      if (!provider) {
        logger.error('Provider not found for token refresh', { providerId });
        return null;
      }

      const refreshToken = decrypt(encryptedRefreshToken);

      // Call provider-specific refresh endpoint
      let newTokens: { accessToken: string; refreshToken?: string; expiresIn?: number } | null = null;

      switch (provider.type) {
        case 'github':
          newTokens = await this.refreshGitHubToken(provider, refreshToken);
          break;
        case 'gitlab':
          newTokens = await this.refreshGitLabToken(provider, refreshToken);
          break;
        case 'azure-devops':
          newTokens = await this.refreshAzureDevOpsToken(provider, refreshToken);
          break;
        case 'bitbucket':
          newTokens = await this.refreshBitbucketToken(provider, refreshToken);
          break;
        default:
          logger.warn('Token refresh not implemented for provider type', { providerType: provider.type });
          return null;
      }

      if (!newTokens) {
        logger.warn('Failed to refresh token', { providerId });
        return null;
      }

      // Update stored credentials with new tokens
      const now = Date.now();
      const expiresAt = newTokens.expiresIn ? now + (newTokens.expiresIn * 1000) : null;

      await credRepo.update({ id: credentialId }, {
        accessToken: encrypt(newTokens.accessToken),
        refreshToken: newTokens.refreshToken ? encrypt(newTokens.refreshToken) : encryptedRefreshToken,
        expiresAt,
        updatedAt: now,
      });

      logger.info('Successfully refreshed access token', { credentialId });
      return newTokens.accessToken;
    } catch (error) {
      logger.error('Failed to refresh access token', { credentialId, error });
      return null;
    }
  }

  /**
   * Refresh GitHub OAuth token
   */
  private async refreshGitHubToken(
    provider: GitProvider,
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number } | null> {
    try {
      // GitHub OAuth apps with refresh tokens use this endpoint
      const clientId = provider.oauthClientId;
      const clientSecret = provider.oauthClientSecret ? decrypt(provider.oauthClientSecret) : null;

      if (!clientId || !clientSecret) {
        logger.error('GitHub OAuth credentials not configured');
        return null;
      }

      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });

      if (!response.ok) {
        logger.error('GitHub token refresh failed', { status: response.status });
        return null;
      }

      const data = await response.json() as any;
      
      if (data.error) {
        logger.error('GitHub token refresh error', { error: data.error });
        return null;
      }

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
      };
    } catch (error) {
      logger.error('GitHub token refresh exception', { error });
      return null;
    }
  }

  /**
   * Refresh GitLab OAuth token
   */
  private async refreshGitLabToken(
    provider: GitProvider,
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number } | null> {
    try {
      const clientId = provider.oauthClientId;
      const clientSecret = provider.oauthClientSecret ? decrypt(provider.oauthClientSecret) : null;
      const baseUrl = provider.customBaseUrl || provider.baseUrl || 'https://gitlab.com';

      if (!clientId || !clientSecret) {
        logger.error('GitLab OAuth credentials not configured');
        return null;
      }

      const response = await fetch(`${baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });

      if (!response.ok) {
        logger.error('GitLab token refresh failed', { status: response.status });
        return null;
      }

      const data = await response.json() as any;

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
      };
    } catch (error) {
      logger.error('GitLab token refresh exception', { error });
      return null;
    }
  }

  /**
   * Refresh Azure DevOps OAuth token
   */
  private async refreshAzureDevOpsToken(
    provider: GitProvider,
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number } | null> {
    try {
      const clientId = provider.oauthClientId;
      const clientSecret = provider.oauthClientSecret ? decrypt(provider.oauthClientSecret) : null;

      if (!clientId) {
        logger.error('Azure DevOps OAuth credentials not configured');
        return null;
      }

      const params = new URLSearchParams({
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: clientSecret || '',
        grant_type: 'refresh_token',
        assertion: refreshToken,
        redirect_uri: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/git/oauth/callback`,
      });

      const response = await fetch('https://app.vssps.visualstudio.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });

      if (!response.ok) {
        logger.error('Azure DevOps token refresh failed', { status: response.status });
        return null;
      }

      const data = await response.json() as any;

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
      };
    } catch (error) {
      logger.error('Azure DevOps token refresh exception', { error });
      return null;
    }
  }

  /**
   * Refresh Bitbucket OAuth token
   */
  private async refreshBitbucketToken(
    provider: GitProvider,
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number } | null> {
    try {
      const clientId = provider.oauthClientId;
      const clientSecret = provider.oauthClientSecret ? decrypt(provider.oauthClientSecret) : null;

      if (!clientId || !clientSecret) {
        logger.error('Bitbucket OAuth credentials not configured');
        return null;
      }

      const response = await fetch('https://bitbucket.org/site/oauth2/access_token', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });

      if (!response.ok) {
        logger.error('Bitbucket token refresh failed', { status: response.status });
        return null;
      }

      const data = await response.json() as any;

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
      };
    } catch (error) {
      logger.error('Bitbucket token refresh exception', { error });
      return null;
    }
  }

  /**
   * List all credentials for a user
   * Optimized: Uses batch queries to avoid N+1
   */
  async listCredentials(userId: string): Promise<StoredCredential[]> {
    const dataSource = await getDataSource();
    const credRepo = dataSource.getRepository(GitCredential);
    const providerRepo = dataSource.getRepository(GitProvider);

    // Get credentials
    const credentialsResult = await credRepo.findBy({ userId });

    if (credentialsResult.length === 0) {
      return [];
    }

    // Get all unique provider IDs
    const providerIds = [...new Set(credentialsResult.map((c) => c.providerId))];

    // Batch fetch all providers at once
    const providersResult = await providerRepo.findBy({ id: In(providerIds) });
    
    // Build a map of providers by ID
    const providerMap = new Map<string, GitProvider>();
    for (const p of providersResult) {
      providerMap.set(p.id, p);
    }

    // Map results - don't fetch usernames in loop, use stored values only
    // Username is fetched and stored during saveCredential(), not on list
    const credentials: StoredCredential[] = credentialsResult.map((credential) => {
      const provider = providerMap.get(credential.providerId);
      return {
        id: credential.id,
        userId: credential.userId,
        providerId: credential.providerId,
        providerName: provider?.name || 'Unknown',
        providerType: provider?.type || 'unknown',
        name: credential.name || undefined,
        authType: credential.authType as 'pat' | 'oauth',
        providerUsername: credential.providerUsername || undefined,
        expiresAt: credential.expiresAt ? Number(credential.expiresAt) : undefined,
        scopes: credential.scopes || undefined,
        createdAt: Number(credential.createdAt),
        updatedAt: Number(credential.updatedAt),
      };
    });

    return credentials;
  }

  /**
   * Rename a credential
   */
  async renameCredential(userId: string, credentialId: string, name: string): Promise<boolean> {
    const dataSource = await getDataSource();
    const credRepo = dataSource.getRepository(GitCredential);

    try {
      await credRepo.update({ id: credentialId, userId }, { name, updatedAt: Date.now() });
      logger.info('Renamed git credential', { userId, credentialId, name });
      return true;
    } catch (error: any) {
      logger.error('Failed to rename credential', { userId, credentialId, error: error.message });
      return false;
    }
  }

  /**
   * Delete credential for a user/provider
   */
  async deleteCredential(userId: string, providerId: string): Promise<boolean> {
    const dataSource = await getDataSource();
    const credRepo = dataSource.getRepository(GitCredential);

    await credRepo.delete({ userId, providerId });

    logger.info('Deleted git credentials', { userId, providerId });
    return true;
  }

  /**
   * Check if user has valid credentials for a provider
   */
  async hasValidCredentials(userId: string, providerId: string): Promise<boolean> {
    const token = await this.getAccessToken(userId, providerId);
    if (!token) return false;

    try {
      const client = await remoteGitService.getClient(providerId, token);
      return await client.validateCredentials();
    } catch {
      return false;
    }
  }

  /**
   * Get available namespaces (user + organizations) for a credential
   */
  async getNamespaces(userId: string, credentialId: string): Promise<{ name: string; type: 'user' | 'organization'; avatarUrl?: string }[]> {
    const dataSource = await getDataSource();
    const credRepo = dataSource.getRepository(GitCredential);

    // Get the credential
    const credential = await credRepo.findOneBy({ id: credentialId, userId });

    if (!credential) {
      throw new Error('Credential not found');
    }

    // Decrypt the token
    let token: string;
    try {
      token = decrypt(credential.accessToken);
    } catch {
      throw new Error('Failed to decrypt credential – the ENCRYPTION_KEY may have changed. Please re-save this Git connection.');
    }

    // Get the client and fetch namespaces
    const client = await remoteGitService.getClient(credential.providerId, token);
    return await client.getNamespaces();
  }
}

export const credentialService = new CredentialService();
