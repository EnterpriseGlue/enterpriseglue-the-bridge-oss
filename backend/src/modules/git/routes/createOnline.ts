/**
 * Create Online Project Route
 * Handles the complete flow: validate credentials -> check duplicate -> create remote repo -> create local project
 */

import { Router, Request, Response } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { z } from 'zod';
import { asyncHandler, AppError, Errors } from '@shared/middleware/errorHandler.js';
import { requireAuth } from '@shared/middleware/auth.js';
import { validateBody } from '@shared/middleware/validate.js';
import { getDataSource } from '@shared/db/data-source.js';
import { Project } from '@shared/db/entities/Project.js';
import { GitRepository } from '@shared/db/entities/GitRepository.js';
import { GitProvider } from '@shared/db/entities/GitProvider.js';
import { ProjectMember } from '@shared/db/entities/ProjectMember.js';
import { ProjectMemberRole } from '@shared/db/entities/ProjectMemberRole.js';
import { generateId } from '@shared/utils/id.js';
import { logger } from '@shared/utils/logger.js';
import { credentialService } from '@shared/services/git/CredentialService.js';
import { remoteGitService } from '@shared/services/git/RemoteGitService.js';
import { vcsService } from '@shared/services/versioning/index.js';

const router = Router();

interface CreateOnlineRequest {
  projectName: string;
  providerId: string;
  repositoryName: string;
  namespace?: string;
  isPrivate?: boolean;
  description?: string;
  // Auth - either token or use saved credentials
  token?: string;
}

const createOnlineSchema = z.object({
  projectName: z.unknown(),
  providerId: z.unknown(),
  repositoryName: z.unknown(),
  namespace: z.unknown().optional(),
  isPrivate: z.boolean().optional(),
  description: z.string().optional(),
  token: z.string().optional(),
});

const checkRepoExistsSchema = z.object({
  providerId: z.unknown(),
  repositoryName: z.unknown(),
  namespace: z.unknown().optional(),
  token: z.unknown().optional(),
});

/**
 * POST /git-api/create-online
 * Create a project with remote repository
 * 
 * Flow:
 * 1. Validate credentials
 * 2. Check for duplicate repository name
 * 3. Create repository on remote provider
 * 4. Create local project
 * 5. Initialize VCS
 * 6. Link repository to project
 */
router.post('/git-api/create-online', apiLimiter, requireAuth, validateBody(createOnlineSchema), asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const {
    projectName,
    providerId,
    repositoryName,
    namespace,
    isPrivate = true,
    description,
    token,
  } = req.body as CreateOnlineRequest;

  if (typeof projectName !== 'string') {
    throw Errors.validation('Project name is required');
  }
  const projectNameTrim = projectName.trim();
  if (!projectNameTrim) {
    throw Errors.validation('Project name is required');
  }
  if (typeof providerId !== 'string' || !providerId) {
    throw Errors.validation('Provider is required');
  }
  if (typeof repositoryName !== 'string') {
    throw Errors.validation('Repository name is required');
  }
  const repositoryNameTrim = repositoryName.trim();
  if (!repositoryNameTrim) {
    throw Errors.validation('Repository name is required');
  }

  const dataSource = await getDataSource();
  const gitProviderRepo = dataSource.getRepository(GitProvider);
  const projectRepo = dataSource.getRepository(Project);
  const projectMemberRepo = dataSource.getRepository(ProjectMember);
  const projectMemberRoleRepo = dataSource.getRepository(ProjectMemberRole);
  const gitRepoRepo = dataSource.getRepository(GitRepository);

  // Get provider info
  const provider = await gitProviderRepo.findOneBy({ id: providerId });
  if (!provider) {
    throw Errors.providerNotFound();
  }

  // Get access token - either from request or saved credentials
  let accessToken: string | undefined = typeof token === 'string' ? token : undefined;
  if (!accessToken) {
    const savedToken = await credentialService.getAccessToken(userId, providerId);
    accessToken = savedToken || undefined;
  }
  
  if (!accessToken) {
    throw Errors.noCredentials('No credentials available. Please connect to the provider first or provide a token.');
  }

  try {
    // Step 1: Validate credentials
    logger.info('Validating credentials', { userId, providerId });
    const client = await remoteGitService.getClient(providerId, accessToken);
    const isValid = await client.validateCredentials();
    
    if (!isValid) {
      throw Errors.invalidCredentials('Invalid credentials. Please check your token or reconnect.');
    }

    // Step 2: Check for duplicate repository
    logger.info('Checking for duplicate repository', { repositoryName, namespace });
    const namespaceStr: string | undefined =
      typeof namespace === 'string' && namespace.trim() ? namespace.trim() : undefined;
    const fullRepoName = namespaceStr ? `${namespaceStr}/${repositoryNameTrim}` : repositoryNameTrim;
    
    const existingRepo = await client.getRepository(fullRepoName);
    if (existingRepo) {
      throw Errors.duplicate('Repository', 'repositoryName');
    }

    // Step 3: Create repository on remote provider
    logger.info('Creating remote repository', { repositoryName, namespace, isPrivate });
    const remoteRepo = await client.createRepository({
      name: repositoryNameTrim,
      organization: namespaceStr,
      description: description || `${projectNameTrim} - Created by Starbase`,
      private: isPrivate,
      autoInit: true,
    });

    logger.info('Remote repository created', { repoId: remoteRepo.id, fullName: remoteRepo.fullName });

    // Step 4: Create local project
    const projectId = generateId();
    const now = Date.now();
    
    await projectRepo.insert({
      id: projectId,
      name: projectNameTrim,
      ownerId: userId,
      createdAt: Math.floor(now / 1000),
      updatedAt: Math.floor(now / 1000),
    });

    await projectMemberRepo.createQueryBuilder()
      .insert()
      .values({
        id: generateId(),
        projectId,
        userId,
        role: 'owner',
        invitedById: null,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .orIgnore()
      .execute();

    await projectMemberRoleRepo.createQueryBuilder()
      .insert()
      .values({
        projectId,
        userId,
        role: 'owner',
        createdAt: now,
      })
      .orIgnore()
      .execute();

    logger.info('Local project created', { projectId, projectName });

    // Step 5: Initialize VCS
    try {
      const mainBranch = await vcsService.initProject(projectId, userId);
      await vcsService.setupRemoteSync(projectId, mainBranch.id, remoteRepo.cloneUrl, remoteRepo.defaultBranch);
      logger.info('VCS initialized', { projectId, branchId: mainBranch.id });
    } catch (vcsError) {
      logger.error('VCS initialization failed (non-fatal)', { projectId, error: vcsError });
      // Continue - VCS is not critical for project creation
    }

    // Step 6: Link repository to project
    const repoId = generateId();
    await gitRepoRepo.delete({ projectId });
    await gitRepoRepo.insert({
      id: repoId,
      projectId,
      providerId,
      connectedByUserId: userId,
      remoteUrl: remoteRepo.cloneUrl,
      namespace: namespaceStr || null,
      repositoryName: remoteRepo.name,
      defaultBranch: remoteRepo.defaultBranch,
      lastCommitSha: null,
      lastSyncAt: null,
      clonePath: `vcs://${projectId}`,
      createdAt: now,
      updatedAt: now,
    });

    logger.info('Repository linked to project', { projectId, repoId, remoteUrl: remoteRepo.cloneUrl });

    // Save token if provided (for future operations)
    if (token) {
      try {
        await credentialService.saveCredential({
          userId,
          providerId,
          authType: 'pat',
          accessToken: token,
        });
        logger.info('Token saved for future use', { userId, providerId });
      } catch (saveError) {
        logger.warn('Failed to save token (non-fatal)', { error: saveError });
      }
    }

    // Return success
    res.status(201).json({
      project: {
        id: projectId,
        name: projectNameTrim,
      },
      repository: {
        id: repoId,
        name: remoteRepo.name,
        fullName: remoteRepo.fullName,
        url: remoteRepo.htmlUrl,
        cloneUrl: remoteRepo.cloneUrl,
        private: remoteRepo.private,
      },
    });

  } catch (error: any) {
    if (error instanceof AppError) throw error;
    logger.error('Create online project failed', { userId, providerId, error });
    
    // Handle specific error types
    if (error.message?.includes('already exists')) {
      throw Errors.duplicate('Repository', 'repositoryName');
    }
    
    if (error.message?.includes('authentication') || error.message?.includes('credentials')) {
      throw Errors.authFailed('Authentication failed. Please check your credentials.');
    }

    throw Errors.internal(error.message || 'Failed to create project');
  }
}));

/**
 * POST /git-api/check-repo-exists
 * Check if a repository name already exists
 */
router.post('/git-api/check-repo-exists', apiLimiter, requireAuth, validateBody(checkRepoExistsSchema), asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { providerId, repositoryName, namespace, token } = req.body;

  if (typeof providerId !== 'string' || typeof repositoryName !== 'string') {
    throw Errors.validation('providerId and repositoryName are required');
  }
  const repositoryNameTrim = repositoryName.trim();
  if (!providerId || !repositoryNameTrim) {
    throw Errors.validation('providerId and repositoryName are required');
  }

  // Get access token
  let accessToken = typeof token === 'string' ? token : undefined;
  if (!accessToken) {
    accessToken = (await credentialService.getAccessToken(userId, providerId)) || undefined;
  }
  
  if (!accessToken) {
    throw Errors.unauthorized('No valid credentials available');
  }

  try {
    const client = await remoteGitService.getClient(providerId, accessToken);
    const namespaceStr: string | undefined =
      typeof namespace === 'string' && namespace.trim() ? namespace.trim() : undefined;
    const fullRepoName = namespaceStr ? `${namespaceStr}/${repositoryNameTrim}` : repositoryNameTrim;
    const existingRepo = await client.getRepository(fullRepoName);
    
    res.json({ 
      exists: !!existingRepo,
      repository: existingRepo ? {
        name: existingRepo.name,
        fullName: existingRepo.fullName,
        url: existingRepo.htmlUrl,
      } : null
    });
  } catch (error: any) {
    // If we get a 404, the repo doesn't exist
    if (error.status === 404) {
      return res.json({ exists: false, repository: null });
    }
    throw error;
  }
}));

export default router;
