/**
 * Clone from Git Routes
 * Handles cloning repositories from remote Git providers
 */

import { Router, Request, Response } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { requireAuth } from '@shared/middleware/auth.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { validateBody } from '@shared/middleware/validate.js';
import { getDataSource } from '@shared/db/data-source.js';
import { Project } from '@shared/db/entities/Project.js';
import { File } from '@shared/db/entities/File.js';
import { Folder } from '@shared/db/entities/Folder.js';
import { GitRepository } from '@shared/db/entities/GitRepository.js';
import { GitProvider } from '@shared/db/entities/GitProvider.js';
import { ProjectMember } from '@shared/db/entities/ProjectMember.js';
import { ProjectMemberRole } from '@shared/db/entities/ProjectMemberRole.js';
import { logger } from '@shared/utils/logger.js';
import { createGitProviderClient, detectProviderFromUrl } from '@shared/services/git/providers/index.js';
import { credentialService } from '@shared/services/git/CredentialService.js';
import { vcsService } from '@shared/services/versioning/index.js';
import { generateId, unixTimestamp } from '@shared/utils/id.js';

const router = Router();

const repoInfoSchema = z.object({
  providerId: z.string(),
  repoUrl: z.string(),
});

type RepoInfoBody = z.infer<typeof repoInfoSchema>;

const cloneSchema = z.object({
  providerId: z.string(),
  repoUrl: z.string(),
  branch: z.string().optional(),
  projectName: z.string().optional(),
});

type CloneBody = z.infer<typeof cloneSchema>;

// Git provider types
type GitProviderType = 'github' | 'gitlab' | 'azure-devops' | 'bitbucket';

/**
 * POST /git-api/repo-info
 * Get repository info (branches, default branch) before cloning
 */
router.post('/git-api/repo-info', apiLimiter, requireAuth, validateBody(repoInfoSchema), asyncHandler(async (req: Request, res: Response) => {
  const { providerId, repoUrl } = req.body as RepoInfoBody;
  const userId = req.user!.userId;

  if (typeof providerId !== 'string' || typeof repoUrl !== 'string') {
    throw Errors.validation('providerId and repoUrl are required');
  }

  const providerIdStr = providerId.trim();
  const repoUrlStr = repoUrl.trim();
  if (!providerIdStr || !repoUrlStr) {
    throw Errors.validation('providerId and repoUrl are required');
  }

  const dataSource = await getDataSource();
  const providerRepo = dataSource.getRepository(GitProvider);

  // Get provider info
  const provider = await providerRepo.findOneBy({ id: providerIdStr });

  if (!provider) {
    throw Errors.providerNotFound();
  }

  // Get access token for this provider
  const accessToken = await credentialService.getAccessToken(userId, providerIdStr);
  if (!accessToken) {
    throw Errors.unauthorized('No credentials found for this provider. Please connect your account first.');
  }

  try {
    // Create provider client
    const client = createGitProviderClient(
      provider.type as GitProviderType,
      { 
        token: accessToken,
        organization: provider.type === 'azure-devops' ? provider.baseUrl?.split('/').pop() : undefined
      },
      { host: provider.baseUrl || undefined }
    );

    // Get repository info
    const repoInfo = await client.getRepository(repoUrlStr);
    if (!repoInfo) {
      throw Errors.notFound('Repository or access denied');
    }

    // Get branches
    const branches = await client.getBranches(repoUrlStr);

    res.json({
      name: repoInfo.name,
      fullName: repoInfo.fullName,
      defaultBranch: repoInfo.defaultBranch,
      branches: branches.map(b => ({
        name: b.name,
        isDefault: b.isDefault,
      })),
    });
  } catch (error: any) {
    logger.error('Failed to get repo info', { providerId: providerIdStr, repoUrl: repoUrlStr, error });
    throw Errors.internal(error.message || 'Failed to get repository info');
  }
}));

/**
 * POST /git-api/clone
 * Clone a repository and create a new project
 */
router.post('/git-api/clone', apiLimiter, requireAuth, validateBody(cloneSchema), asyncHandler(async (req: Request, res: Response) => {
  const { providerId, repoUrl, branch: requestedBranch, projectName } = req.body as CloneBody;
  const userId = req.user!.userId;

  if (typeof providerId !== 'string' || typeof repoUrl !== 'string') {
    throw Errors.validation('providerId and repoUrl are required');
  }

  const providerIdStr = providerId.trim();
  const repoUrlStr = repoUrl.trim();
  if (!providerIdStr || !repoUrlStr) {
    throw Errors.validation('providerId and repoUrl are required');
  }

  if (!(await vcsService.ensureInitialized())) {
    return res.status(503).json({ error: 'VCS service unavailable' });
  }

  const dataSource = await getDataSource();
  const gitProviderRepo = dataSource.getRepository(GitProvider);
  const projectRepo = dataSource.getRepository(Project);
  const projectMemberRepo = dataSource.getRepository(ProjectMember);
  const projectMemberRoleRepo = dataSource.getRepository(ProjectMemberRole);
  const folderRepo = dataSource.getRepository(Folder);
  const fileRepo = dataSource.getRepository(File);
  const gitRepoRepo = dataSource.getRepository(GitRepository);

  // Get provider info
  const provider = await gitProviderRepo.findOneBy({ id: providerIdStr });

  if (!provider) {
    throw Errors.providerNotFound();
  }

  // Get access token
  const accessToken = await credentialService.getAccessToken(userId, providerIdStr);
  if (!accessToken) {
    throw Errors.unauthorized('No credentials found for this provider');
  }

  try {
    // Create provider client
    const client = createGitProviderClient(
      provider.type as GitProviderType,
      { 
        token: accessToken,
        organization: provider.type === 'azure-devops' ? provider.baseUrl?.split('/').pop() : undefined
      },
      { host: provider.baseUrl || undefined }
    );

    // Get repository info
    const repoInfo = await client.getRepository(repoUrlStr);
    if (!repoInfo) {
      throw Errors.notFound('Repository');
    }

    // Use requested branch or default to repo's default branch
    const branch = (typeof requestedBranch === 'string' && requestedBranch.trim())
      ? requestedBranch.trim()
      : (repoInfo.defaultBranch || 'main');

    // Determine project name
    const finalProjectName = (typeof projectName === 'string' && projectName.trim())
      ? projectName.trim()
      : repoInfo.name;

    // Create project
    const projectId = randomUUID();
    const now = unixTimestamp();

    await projectRepo.insert({
      id: projectId,
      name: finalProjectName,
      ownerId: userId,
      createdAt: now,
      updatedAt: now,
    });

    const membershipNow = Date.now();
    await projectMemberRepo.createQueryBuilder()
      .insert()
      .values({
        id: generateId(),
        projectId,
        userId,
        role: 'owner',
        invitedById: null,
        joinedAt: membershipNow,
        createdAt: membershipNow,
        updatedAt: membershipNow,
      })
      .orIgnore()
      .execute();

    await projectMemberRoleRepo.createQueryBuilder()
      .insert()
      .values({
        projectId,
        userId,
        role: 'owner',
        createdAt: membershipNow,
      })
      .orIgnore()
      .execute();

    logger.info('Created project for clone', { projectId, projectName: finalProjectName });

    // Get file tree from remote
    const tree = await client.getTree(repoUrlStr, branch);
    const allFileEntries = tree.filter(t => t.type === 'blob');
    const folderEntries = tree.filter(t => t.type === 'tree');

    // Filter to only .bpmn and .dmn files
    const fileEntries = allFileEntries.filter(f => 
      f.path.endsWith('.bpmn') || f.path.endsWith('.dmn')
    );

    logger.info('Filtered files', { 
      total: allFileEntries.length, 
      bpmnDmn: fileEntries.length,
      skipped: allFileEntries.length - fileEntries.length
    });

    // Determine which folders are needed (contain .bpmn/.dmn files directly or in subfolders)
    const neededFolderPaths = new Set<string>();
    for (const file of fileEntries) {
      const pathParts = file.path.split('/');
      // Add all parent folders for this file
      for (let i = 1; i < pathParts.length; i++) {
        neededFolderPaths.add(pathParts.slice(0, i).join('/'));
      }
    }

    // Filter folders to only those needed
    const relevantFolders = folderEntries.filter(f => neededFolderPaths.has(f.path));

    // Create folder structure
    const folderMap = new Map<string, string>(); // path -> folderId

    // Sort folders by depth to create parents first
    const sortedFolders = relevantFolders.sort((a, b) => 
      a.path.split('/').length - b.path.split('/').length
    );

    for (const folder of sortedFolders) {
      const pathParts = folder.path.split('/');
      const folderName = pathParts[pathParts.length - 1];
      const parentPath = pathParts.slice(0, -1).join('/');
      const parentId = parentPath ? folderMap.get(parentPath) : null;

      const folderId = randomUUID();
      await folderRepo.insert({
        id: folderId,
        projectId,
        parentFolderId: parentId || null,
        name: folderName,
        createdAt: now,
        updatedAt: now,
      });

      folderMap.set(folder.path, folderId);
    }

    logger.info('Created folders', { projectId, count: sortedFolders.length });

    // Fetch and create files
    let filesImported = 0;
    const batchSize = 10; // Fetch files in batches to avoid rate limits

    for (let i = 0; i < fileEntries.length; i += batchSize) {
      const batch = fileEntries.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (fileEntry) => {
        try {
          const fileContent = await client.getFile(repoUrlStr, branch, fileEntry.path);
          if (!fileContent) return;

          const pathParts = fileEntry.path.split('/');
          const fileName = pathParts[pathParts.length - 1];
          const parentPath = pathParts.slice(0, -1).join('/');
          const folderId = parentPath ? folderMap.get(parentPath) : null;

          // Determine file type from extension first, then content
          const ext = fileName.split('.').pop()?.toLowerCase();
          let fileType = 'other';
          
          // Try extension-based detection first
          if (ext === 'bpmn') {
            fileType = 'bpmn';
          } else if (ext === 'dmn') {
            fileType = 'dmn';
          } else if (ext === 'form') {
            fileType = 'form';
          } else {
            // Fall back to content-based detection
            const content = fileContent.content || '';
            if (content.includes('bpmn:definitions') || 
                content.includes('xmlns:bpmn')) {
              fileType = 'bpmn';
            } else if (content.includes('xmlns="https://www.omg.org/spec/DMN') || 
                       content.includes('xmlns:dmn')) {
              fileType = 'dmn';
            }
          }
          
          logger.info('File type detection', { fileName, ext, fileType, contentBased: ext !== fileType });

          const fileId = randomUUID();
          await fileRepo.insert({
            id: fileId,
            projectId,
            folderId: folderId || null,
            name: fileName,
            type: fileType,
            xml: fileContent.content,
            createdAt: now,
            updatedAt: now,
          });

          filesImported++;
        } catch (error) {
          logger.warn('Failed to import file', { path: fileEntry.path, error });
        }
      }));
    }

    logger.info('Imported files', { projectId, count: filesImported });

    // Initialize VCS for this project
    const mainBranch = await vcsService.initProject(projectId, userId);
    
    // Set up remote sync
    await vcsService.setupRemoteSync(projectId, mainBranch.id, repoUrlStr, branch);

    // Store repository metadata
    const repositoryId = generateId();
    // Extract namespace (owner) from fullName (e.g., "haryselman/ing-demo" -> "haryselman")
    const namespace = repoInfo.fullName?.includes('/') 
      ? repoInfo.fullName.split('/')[0] 
      : null;
    await gitRepoRepo.insert({
      id: repositoryId,
      projectId,
      providerId: providerIdStr,
      connectedByUserId: userId,
      remoteUrl: repoUrlStr,
      namespace,
      repositoryName: repoInfo.name,
      defaultBranch: branch,
      lastCommitSha: null,
      lastSyncAt: Date.now(),
      clonePath: `vcs://${projectId}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Create initial commit with all imported files
    if (filesImported > 0) {
      try {
        // Get user's branch and commit
        const userBranch = await vcsService.getUserBranch(projectId, userId);
        
        // Get all files for this project
        const projectFiles = await fileRepo.find({
          where: { projectId },
        });

        // Save each file to VCS working_files
        for (const file of projectFiles) {
          await vcsService.saveFile(
            userBranch.id,
            projectId,
            null,
            file.name,
            file.type,
            file.xml,
            file.folderId
          );
        }

        // Create initial commit - mark as remote since it came from Git
        await vcsService.commit(
          userBranch.id,
          userId,
          `Initial import from ${repoInfo.fullName}`,
          { isRemote: true }
        );

        // Merge to main
        await vcsService.mergeToMain(userBranch.id, projectId, userId);

        logger.info('Created initial VCS commit', { projectId });
      } catch (error) {
        logger.warn('Failed to create initial VCS commit', { projectId, error });
      }
    }

    res.status(201).json({
      projectId,
      projectName: finalProjectName,
      filesImported,
      foldersCreated: sortedFolders.length,
      repositoryId,
    });
  } catch (error: any) {
    logger.error('Failed to clone repository', { providerId: providerIdStr, repoUrl: repoUrlStr, error });
    throw Errors.internal(error.message || 'Failed to clone repository');
  }
}));

export default router;
