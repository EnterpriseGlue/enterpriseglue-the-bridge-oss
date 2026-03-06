/**
 * Git Credentials Routes
 * Handles PAT and OAuth credential management
 */

import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { z } from 'zod';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js';
import { credentialService } from '@enterpriseglue/shared/services/git/CredentialService.js';
import { oauthService } from '@enterpriseglue/shared/services/git/OAuthService.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitProvider } from '@enterpriseglue/shared/db/entities/GitProvider.js';

const router = Router();

// Validation schemas
const saveCredentialSchema = z.object({
  providerId: z.string().min(1),
  token: z.string().min(1),
  name: z.string().optional(),
});

const renameCredentialSchema = z.object({
  name: z.string().min(1),
});

const credentialIdParamsSchema = z.object({
  credentialId: z.string().min(1),
});

const providerIdParamsSchema = z.object({
  providerId: z.string().min(1),
});

// Store pending OAuth provider redirects temporarily.
// In production, this should live in a shared store (e.g. Redis).
const pendingOAuthProviderByUser = new Map<string, { providerId: string; expiresAt: number }>();

function cleanupPendingOAuthProviderByUser(): void {
  const now = Date.now();
  for (const [userId, data] of pendingOAuthProviderByUser.entries()) {
    if (data.expiresAt <= now) pendingOAuthProviderByUser.delete(userId);
  }
}

function getAllowedOAuthHosts(providerType: string, oauthAuthUrl?: string | null): string[] {
  const hosts: string[] = [];

  const addHost = (urlStr?: string | null) => {
    if (!urlStr) return;
    try {
      const u = new URL(urlStr);
      if (u.hostname) hosts.push(u.hostname);
    } catch {
      // ignore
    }
  };

  addHost(oauthAuthUrl);

  const t = String(providerType || '').toLowerCase();
  if (t === 'github') hosts.push('github.com');
  if (t === 'gitlab') hosts.push('gitlab.com');
  if (t === 'bitbucket') hosts.push('bitbucket.org');
  if (t === 'azure-devops') hosts.push('visualstudio.com');

  return Array.from(new Set(hosts.filter(Boolean)));
}

function parseProviderId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(v)) return null;
  return v;
}

/**
 * GET /git-api/credentials
 * List all credentials for the current user
 */
router.get('/git-api/credentials', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const credentials = await credentialService.listCredentials(userId);
  res.json(credentials);
}));

/**
 * GET /git-api/credentials/:providerId
 * Get credential for a specific provider
 */
router.get('/git-api/credentials/:providerId', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const providerId = String(req.params.providerId);
  
  const credential = await credentialService.getCredential(userId, providerId);
  
  if (!credential) {
    throw Errors.notFound('Credentials');
  }
  
  res.json(credential);
}));

/**
 * POST /git-api/credentials
 * Save a Personal Access Token
 */
router.post('/git-api/credentials', apiLimiter, requireAuth, validateBody(saveCredentialSchema), asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { providerId, token, name } = req.body;
  
  const credential = await credentialService.saveCredential({
    userId,
    providerId,
    name, // Optional connection name
    authType: 'pat',
    accessToken: token,
  });
  
  res.status(201).json(credential);
}));

/**
 * PATCH /git-api/credentials/:credentialId
 * Rename a credential
 */
router.patch('/git-api/credentials/:credentialId', apiLimiter, requireAuth, validateParams(credentialIdParamsSchema), validateBody(renameCredentialSchema), asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const credentialId = String(req.params.credentialId);
  const { name } = req.body;
  
  const success = await credentialService.renameCredential(userId, credentialId, name);
  
  if (!success) {
    throw Errors.notFound('Credential');
  }
  
  res.json({ success: true });
}));

/**
 * DELETE /git-api/credentials/:providerId
 * Delete credentials for a provider
 */
router.delete('/git-api/credentials/:providerId', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const providerId = String(req.params.providerId);
  
  await credentialService.deleteCredential(userId, providerId);
  res.status(204).send();
}));

/**
 * GET /git-api/credentials/:providerId/validate
 * Check if credentials are valid
 */
router.get('/git-api/credentials/:providerId/validate', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const providerId = String(req.params.providerId);
  
  const isValid = await credentialService.hasValidCredentials(userId, providerId);
  res.json({ valid: isValid });
}));

/**
 * GET /git-api/credentials/:credentialId/namespaces
 * Get available namespaces (user + organizations) for a credential
 */
router.get('/git-api/credentials/:credentialId/namespaces', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const credentialId = String(req.params.credentialId);
  
  const namespaces = await credentialService.getNamespaces(userId, credentialId);
  res.json(namespaces);
}));

// ============ OAuth Routes ============

/**
 * GET /git-api/oauth/:providerId/config
 * Get OAuth configuration for a provider
 */
router.get('/git-api/oauth/:providerId/config', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const providerId = String(req.params.providerId);
  
  const oauthConfig = await oauthService.getOAuthConfig(providerId);
  res.json(oauthConfig);
}));

/**
 * GET /git-api/oauth/:providerId/authorize
 * Start OAuth flow - returns authorization URL
 */
router.get('/git-api/oauth/:providerId/authorize', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const providerId = String(req.params.providerId);
  
  // Build redirect URI
  const baseUrl = config.frontendUrl;
  const redirectUri = `${baseUrl}/git/oauth/callback`;
  
  const result = await oauthService.startOAuthFlow(userId, providerId, redirectUri);
  
  res.json({
    authUrl: result.authUrl,
    state: result.state,
  });
}));

router.get('/git-api/oauth/:providerId/authorize/redirect', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const safeProviderId = parseProviderId(String(req.params.providerId));
  if (!safeProviderId) {
    throw Errors.validation('Invalid providerId');
  }

  // Store provider id server-side to avoid passing HTTP params into the external redirect handler.
  const userId = req.user!.userId;
  pendingOAuthProviderByUser.set(userId, {
    providerId: safeProviderId,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  cleanupPendingOAuthProviderByUser();

  return res.redirect('/git-api/oauth/authorize/redirect');
}));

router.get('/git-api/oauth/authorize/redirect', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const pending = pendingOAuthProviderByUser.get(userId);
  pendingOAuthProviderByUser.delete(userId);
  cleanupPendingOAuthProviderByUser();

  if (!pending || pending.expiresAt <= Date.now()) {
    throw Errors.validation('Missing provider');
  }

  const providerId = pending.providerId;

  const dataSource = await getDataSource();
  const providerRepo = dataSource.getRepository(GitProvider);
  const provider = await providerRepo.findOneBy({ id: providerId });
  if (!provider) {
    throw Errors.providerNotFound();
  }

  const baseUrl = config.frontendUrl;
  const redirectUri = `${baseUrl}/git/oauth/callback`;

  const result = await oauthService.startOAuthFlow(userId, providerId, redirectUri);

  const allowedHosts = getAllowedOAuthHosts(String(provider.type), provider.oauthAuthUrl);
  let safeUrl: string | null = null;
  try {
    const u = new URL(result.authUrl);
    if ((u.protocol === 'https:' || u.protocol === 'http:') && allowedHosts.includes(u.hostname)) {
      safeUrl = u.toString();
    }
  } catch {
    safeUrl = null;
  }

  if (!safeUrl) throw Errors.internal('Invalid authorization URL');
  return res.redirect(safeUrl);
}));

/**
 * POST /git-api/oauth/callback
 * Handle OAuth callback - exchange code for tokens
 */
router.post('/git-api/oauth/callback', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { code, state } = req.body;
  
  if (!code || !state) {
    throw Errors.validation('code and state are required');
  }
  
  // Build redirect URI (must match the one used in authorize)
  const baseUrl = config.frontendUrl;
  const redirectUri = `${baseUrl}/git/oauth/callback`;
  
  // Exchange code for tokens
  const { userId, providerId, tokens } = await oauthService.exchangeCode(code, state, redirectUri);
  
  // Verify the user making the request matches the state
  if (userId !== req.user!.userId) {
    throw Errors.forbidden('User mismatch');
  }
  
  // Calculate expiration time
  const expiresAt = tokens.expiresIn 
    ? Date.now() + tokens.expiresIn * 1000 
    : undefined;
  
  // Save credentials
  const credential = await credentialService.saveCredential({
    userId,
    providerId,
    authType: 'oauth',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt,
    scopes: tokens.scope,
  });
  
  res.json(credential);
}));

/**
 * POST /git-api/oauth/:providerId/refresh
 * Refresh OAuth token
 */
router.post('/git-api/oauth/:providerId/refresh', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const providerId = String(req.params.providerId);
  
  // Get current credential
  const credential = await credentialService.getCredential(userId, providerId);
  
  if (!credential || credential.authType !== 'oauth') {
    throw Errors.validation('OAuth credentials not found');
  }
  
  // Get refresh token (need to fetch from DB with decryption)
  // For now, return error - full implementation would refresh the token
  throw Errors.validation('Token refresh not yet implemented');
}));

export default router;
