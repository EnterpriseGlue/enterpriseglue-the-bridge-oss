import { Router, Request, Response } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { z } from 'zod';
import { logger } from '@shared/utils/logger.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { validateBody, validateParams } from '@shared/middleware/validate.js';
import { requireAuth } from '@shared/middleware/auth.js';
import { requirePermission } from '@shared/middleware/requirePermission.js';
import { getDataSource } from '@shared/db/data-source.js';
import { GitProvider } from '@shared/db/entities/GitProvider.js';
import { GitRepository } from '@shared/db/entities/GitRepository.js';
import { GitCredential } from '@shared/db/entities/GitCredential.js';
import { remoteGitService } from '@shared/services/git/RemoteGitService.js';
import { credentialService } from '@shared/services/git/CredentialService.js';
import { encrypt as encryptSecret, isEncrypted as isEncryptedValue } from '@shared/services/encryption.js';
import { PlatformPermissions } from '@shared/services/platform-admin/permissions.js';

const router = Router();

// Validation schemas
const providerIdSchema = z.object({
  id: z.string().min(1),
});

const updateProviderSchema = z.object({
  isActive: z.boolean().optional(),
  customBaseUrl: z.string().url().nullable().optional(),
  customApiUrl: z.string().url().nullable().optional(),
  oauthClientId: z.string().nullable().optional(),
  oauthClientSecret: z.string().nullable().optional(),
  oauthScopes: z.string().nullable().optional(),
  displayOrder: z.number().int().optional(),
});

/**
 * GET /git-api/providers
 * List all active Git providers
 */
router.get('/git-api/providers', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource();
  const providerRepo = dataSource.getRepository(GitProvider);

  // Query all active providers
  const providers = await providerRepo.find({
    where: { isActive: true },
    order: { displayOrder: 'ASC', name: 'ASC' },
  });

  // Return providers with effective URLs (custom or default)
  const providersWithEffectiveUrls = providers.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    baseUrl: p.customBaseUrl || p.baseUrl, // Use custom if set, otherwise default
    apiUrl: p.customApiUrl || p.apiUrl, // Use custom if set, otherwise default
    supportsOAuth: p.supportsOAuth,
    supportsPAT: p.supportsPAT,
  }));

  res.json(providersWithEffectiveUrls);
}));

/**
 * GET /git-api/providers/:id
 * Get a specific Git provider
 */
router.get('/git-api/providers/:id', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const dataSource = await getDataSource();
  const providerRepo = dataSource.getRepository(GitProvider);

  const provider = await providerRepo.findOneBy({ id });

  if (!provider) {
    throw Errors.providerNotFound();
  }

  res.json({
    ...provider,
    effectiveBaseUrl: provider.customBaseUrl || provider.baseUrl,
    effectiveApiUrl: provider.customApiUrl || provider.apiUrl,
  });
}));

/**
 * GET /git-api/admin/providers
 * List ALL Git providers (admin only) - including inactive ones
 *
 * NOTE: We must run requireAuth before requirePlatformAdmin so that
 * req.user is populated from the JWT, exactly like the platform admin API
 * router does with `router.use(requireAuth, requirePlatformAdmin);`.
 */
router.get('/git-api/admin/providers', apiLimiter, requireAuth, requirePermission({ permission: PlatformPermissions.GIT_PROVIDER_MANAGE }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource();
  const providerRepo = dataSource.getRepository(GitProvider);
  const gitRepoRepo = dataSource.getRepository(GitRepository);
  const credentialRepo = dataSource.getRepository(GitCredential);

  const [providers, repoCounts, credentialCounts] = await Promise.all([
    providerRepo.find({
      order: { displayOrder: 'ASC', name: 'ASC' },
    }),
    gitRepoRepo.createQueryBuilder('r')
      .select('r.providerId', 'providerId')
      .addSelect('COUNT(*)', 'projectConnectionsCount')
      .groupBy('r.providerId')
      .getRawMany(),
    credentialRepo.createQueryBuilder('c')
      .select('c.providerId', 'providerId')
      .addSelect('COUNT(*)', 'gitConnectionsCount')
      .groupBy('c.providerId')
      .getRawMany(),
  ]);

  const repoCountMap = new Map<string, number>();
  for (const row of repoCounts) {
    repoCountMap.set(row.providerId, Number(row.projectConnectionsCount || 0));
  }

  const credentialCountMap = new Map<string, number>();
  for (const row of credentialCounts) {
    credentialCountMap.set(row.providerId, Number(row.gitConnectionsCount || 0));
  }

  const providersWithUsage = providers.map((p: any) => {
    const projectConnectionsCount = repoCountMap.get(p.id) || 0;
    const gitConnectionsCount = credentialCountMap.get(p.id) || 0;

    return {
      ...p,
      projectConnectionsCount,
      gitConnectionsCount,
      hasProjectConnections: projectConnectionsCount > 0,
      hasGitConnections: gitConnectionsCount > 0,
    };
  });

  res.json(providersWithUsage);
}));

/**
 * PUT /git-api/admin/providers/:id
 * Update Git provider configuration (admin only)
 *
 * Same middleware order as GET: requireAuth first, then requirePlatformAdmin.
 */
router.put('/git-api/admin/providers/:id', apiLimiter, requireAuth, requirePermission({ permission: PlatformPermissions.GIT_PROVIDER_MANAGE }), asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    isActive,
    customBaseUrl,
    customApiUrl,
    oauthClientId,
    oauthClientSecret,
    oauthScopes,
    displayOrder,
  } = req.body;

  const dataSource = await getDataSource();
  const providerRepo = dataSource.getRepository(GitProvider);

  // Check if provider exists
  const existing = await providerRepo.findOneBy({ id });

  if (!existing) {
    throw Errors.providerNotFound();
  }

  // Validate custom URLs if provided
  if (customBaseUrl && !customBaseUrl.startsWith('http')) {
    throw Errors.validation('Custom base URL must start with http:// or https://');
  }
  if (customApiUrl && !customApiUrl.startsWith('http')) {
    throw Errors.validation('Custom API URL must start with http:// or https://');
  }

  // Build update object with only provided fields
  const updates: any = {
    updatedAt: Date.now(),
  };

  if (isActive !== undefined) updates.isActive = isActive;
  if (customBaseUrl !== undefined) updates.customBaseUrl = customBaseUrl || null;
  if (customApiUrl !== undefined) updates.customApiUrl = customApiUrl || null;
  if (oauthClientId !== undefined) updates.oauthClientId = oauthClientId || null;
  if (oauthClientSecret !== undefined) {
    if (!oauthClientSecret) {
      updates.oauthClientSecret = null;
    } else {
      updates.oauthClientSecret = isEncryptedValue(oauthClientSecret)
        ? oauthClientSecret
        : encryptSecret(oauthClientSecret);
    }
  }
  if (oauthScopes !== undefined) updates.oauthScopes = oauthScopes || null;
  if (displayOrder !== undefined) updates.displayOrder = displayOrder;

  // Update provider
  await providerRepo.update({ id }, updates);

  // Return updated provider
  const updated = await providerRepo.findOneBy({ id });

  res.json(updated);
}));

/**
 * GET /git-api/providers/:id/repos
 * List repositories from a Git provider for the authenticated user
 */
router.get('/git-api/providers/:id/repos', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id: providerId } = req.params;
  const userId = req.user?.userId;
  
  if (!userId) {
    throw Errors.unauthorized('User not authenticated');
  }
  
  // Get decrypted access token for this user/provider
  const accessToken = await credentialService.getAccessToken(userId, providerId);
  
  if (!accessToken) {
    throw Errors.validation('No credentials found for this provider. Please connect first.');
  }
  
  try {
    const client = await remoteGitService.getClient(providerId, accessToken);
    const repos = await client.listRepositories({ limit: 100 });
    
    // Map to simpler format for frontend
    const repoList = repos.map(r => ({
      name: r.name,
      fullName: r.fullName,
      url: r.cloneUrl,
      isPrivate: r.private,
    }));
    
    res.json(repoList);
  } catch (error: any) {
    logger.error('Failed to list repos from provider:', error);
    
    // Provide helpful error messages
    // Use 422 (Unprocessable Entity) for Git credential issues to avoid confusing with session auth (401)
    const errorMsg = error.message || '';
    if (errorMsg.includes('Bad credentials') || errorMsg.includes('401')) {
      return res.status(422).json({ 
        error: 'Bad credentials - your saved token is invalid or expired. Please reconnect with a new token.',
        code: 'INVALID_TOKEN'
      });
    }
    if (errorMsg.includes('rate limit') || errorMsg.includes('403')) {
      return res.status(429).json({ 
        error: 'API rate limit exceeded. Please try again later.',
        code: 'RATE_LIMITED'
      });
    }
    if (errorMsg.includes('scope') || errorMsg.includes('permission')) {
      return res.status(422).json({ 
        error: 'Token does not have sufficient permissions. Required scope: repo',
        code: 'INSUFFICIENT_SCOPE'
      });
    }
    
    throw Errors.internal(error.message || 'Failed to list repositories');
  }
}));

export default router;
