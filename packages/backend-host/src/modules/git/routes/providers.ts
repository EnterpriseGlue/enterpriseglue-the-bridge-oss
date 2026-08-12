import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { z } from 'zod';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitProvider.js';
import {
  GitProviderDetailSchema,
  GitProviderRepositorySchema,
  GitProviderSummarySchema,
} from '@enterpriseglue/shared/schemas/git/repository.js';
import { GitRepository } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitRepository.js';
import { GitCredential } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitCredential.js';
import { remoteGitService } from '@enterpriseglue/shared/services/git/RemoteGitService.js';
import { credentialService } from '@enterpriseglue/shared/services/git/CredentialService.js';
import { gitProviderService } from '@enterpriseglue/shared/services/git/GitProviderService.js';
import {
  adminConfigObjectOwnershipService,
  adminConfigOwnershipFields,
} from '@enterpriseglue/shared/services/platform-admin/AdminConfigObjectOwnershipService.js';
import {
  GitProviderAdminSummarySchema,
  GitProviderAdminUpdateResponseSchema,
  UpdateGitProviderRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/git-provider.js';

const router = Router();

// Validation schemas
const providerIdSchema = z.object({
  id: z.string().min(1),
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

  res.json(GitProviderSummarySchema.array().parse(providersWithEffectiveUrls));
}));

/**
 * GET /git-api/providers/:id
 * Get a specific Git provider
 */
router.get('/git-api/providers/:id', apiLimiter, requireAuth, validateParams(providerIdSchema), asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const dataSource = await getDataSource();
  const providerRepo = dataSource.getRepository(GitProvider);

  const provider = await providerRepo.findOneBy({ id });

  if (!provider) {
    throw Errors.providerNotFound();
  }

  res.json(GitProviderDetailSchema.parse({
    id: provider.id,
    name: provider.name,
    type: provider.type,
    baseUrl: provider.customBaseUrl || provider.baseUrl,
    apiUrl: provider.customApiUrl || provider.apiUrl,
    supportsOAuth: provider.supportsOAuth,
    supportsPAT: provider.supportsPAT,
    effectiveBaseUrl: provider.customBaseUrl || provider.baseUrl,
    effectiveApiUrl: provider.customApiUrl || provider.apiUrl,
    isActive: provider.isActive,
  }));
}));

/**
 * GET /git-api/admin/providers
 * List ALL Git providers (admin only) - including inactive ones
 *
 * NOTE: We must run requireAuth before requireAction so req.user is
 * populated from the JWT before evaluating platform Git provider permissions.
 */
router.get('/git-api/admin/providers', apiLimiter, requireAuth, requireAction('platform.git.providers.manage', { resourceResolver: 'platform.self' }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource();
  const providerRepo = dataSource.getRepository(GitProvider);
  const gitRepoRepo = dataSource.getRepository(GitRepository);
  const credentialRepo = dataSource.getRepository(GitCredential);

  const [providers, repoCounts, credentialCounts, ownershipRows] = await Promise.all([
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
    adminConfigObjectOwnershipService.listForObjectType(dataSource, 'git_provider'),
  ]);
  const ownershipById = new Map(ownershipRows.map((row) => [row.objectId, row]));

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
      ...adminConfigOwnershipFields(ownershipById.get(p.id)),
    };
  });

  res.json(GitProviderAdminSummarySchema.array().parse(providersWithUsage));
}));

/**
 * PUT /git-api/admin/providers/:id
 * Update Git provider configuration (admin only)
 *
 * Same middleware order as GET: requireAuth first, then requireAction.
 */
router.put('/git-api/admin/providers/:id', apiLimiter, requireAuth, requireAction('platform.git.providers.manage', { resourceResolver: 'platform.self' }), validateParams(providerIdSchema), validateBody(UpdateGitProviderRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const {
    isActive,
    customBaseUrl,
    customApiUrl,
    oauthClientId,
    oauthClientSecret,
    oauthScopes,
    displayOrder,
  } = req.body;

  const updated = await gitProviderService.update(id, {
    isActive,
    customBaseUrl,
    customApiUrl,
    oauthClientId,
    oauthClientSecret,
    oauthScopes,
    displayOrder,
  });

  const dataSource = await getDataSource();
  const ownership = await adminConfigObjectOwnershipService.findForObject(dataSource, 'git_provider', id);
  res.json(GitProviderAdminUpdateResponseSchema.parse({ ...updated, ...adminConfigOwnershipFields(ownership) }));
}));

/**
 * GET /git-api/providers/:id/repos
 * List repositories from a Git provider for the authenticated user
 */
router.get('/git-api/providers/:id/repos', apiLimiter, requireAuth, validateParams(providerIdSchema), asyncHandler(async (req: Request, res: Response) => {
  const providerId = String(req.params.id);
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
    
    res.json(GitProviderRepositorySchema.array().parse(repoList));
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
