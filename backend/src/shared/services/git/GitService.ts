/**
 * Git Service - Database-only Version Control
 * 
 * This service manages Git repository metadata and integrates with the VCS service
 * for database-only version control. No physical git folders are created.
 */

import { getDataSource } from '@shared/db/data-source.js';
import { GitRepository } from '@shared/db/entities/GitRepository.js';
import { GitDeployment } from '@shared/db/entities/GitDeployment.js';
import { GitAuditLog } from '@shared/db/entities/GitAuditLog.js';
import { generateId } from '@shared/utils/id.js';
import { logger } from '@shared/utils/logger.js';
import { vcsService } from '@shared/services/versioning/index.js';
import { remoteGitService } from './RemoteGitService.js';
import { credentialService } from './CredentialService.js';
import { platformSettingsService } from '@shared/services/platform-admin/PlatformSettingsService.js';

export interface RepositoryInfo {
  id: string;
  projectId: string;
  providerId: string;
  remoteUrl: string;
  defaultBranch: string;
  lastCommitSha: string | null;
  clonePath: string;
}

export class GitService {
  private vcsInitialized = false;

  constructor() {
    // VCS will be initialized on first use
  }

  /**
   * Ensure VCS tables are initialized
   */
  private async ensureVcsInitialized(): Promise<void> {
    if (!this.vcsInitialized) {
      try {
        await getDataSource();
        this.vcsInitialized = true;
      } catch (error) {
        logger.warn('VCS tables initialization failed, will retry on next operation', { error });
      }
    }
  }

  /**
   * Initialize a new Git repository for a project (database-only)
   * Creates VCS branch structure and stores remote URL for future sync
   */
  async initRepository(
    projectId: string,
    providerId: string,
    remoteUrl: string,
    userId: string,
    namespace?: string
  ): Promise<RepositoryInfo> {
    const startTime = Date.now();
    const repositoryId = generateId();
    
    try {
      // Ensure VCS tables are ready
      await this.ensureVcsInitialized();
      
      // Extract repository name from URL
      const repositoryName = this.extractRepoNameFromUrl(remoteUrl);
      
      // Initialize VCS for this project (creates main branch)
      const mainBranch = await vcsService.initProject(projectId, userId);
      
      // Set up remote sync configuration
      await vcsService.setupRemoteSync(projectId, mainBranch.id, remoteUrl, 'main');

      // Store repository metadata in main database
      const repo = {
        id: repositoryId,
        projectId,
        providerId,
        connectedByUserId: userId,
        remoteUrl,
        namespace: namespace || null,
        repositoryName,
        defaultBranch: 'main',
        lastCommitSha: null,
        lastSyncAt: null,
        clonePath: `vcs://${projectId}`, // Virtual path - data is in VCS schema
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const dataSource = await getDataSource();
      const repoRepo = dataSource.getRepository(GitRepository);
      await repoRepo.insert(repo);

      // Audit log
      await this.logOperation({
        repositoryId,
        userId,
        operation: 'init',
        status: 'success',
        duration: Date.now() - startTime,
      });

      logger.info('Repository initialized (VCS)', { projectId, repositoryId, branchId: mainBranch.id });

      return {
        id: repositoryId,
        projectId,
        providerId,
        remoteUrl,
        defaultBranch: 'main',
        lastCommitSha: null,
        clonePath: `vcs://${projectId}`,
      };
    } catch (error) {
      logger.error('Failed to initialize repository', { projectId, error });
      
      await this.logOperation({
        userId,
        operation: 'init',
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        details: `projectId: ${projectId}`,
        duration: Date.now() - startTime,
      });

      throw error;
    }
  }

  /**
   * Clone an existing repository (database-only)
   * TODO: Implement using Git provider API to fetch files
   */
  async cloneRepository(
    projectId: string,
    providerId: string,
    remoteUrl: string,
    userId: string,
    namespace?: string
  ): Promise<RepositoryInfo> {
    const startTime = Date.now();
    const repositoryId = generateId();

    try {
      await this.ensureVcsInitialized();
      
      const repositoryName = this.extractRepoNameFromUrl(remoteUrl);
      
      // Initialize VCS for this project
      const mainBranch = await vcsService.initProject(projectId, userId);
      
      // Set up remote sync
      await vcsService.setupRemoteSync(projectId, mainBranch.id, remoteUrl, 'main');

      // Store repository metadata
      const repo = {
        id: repositoryId,
        projectId,
        providerId,
        connectedByUserId: userId,
        remoteUrl,
        namespace: namespace || null,
        repositoryName,
        defaultBranch: 'main',
        lastCommitSha: null,
        lastSyncAt: Date.now(),
        clonePath: `vcs://${projectId}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const dataSource = await getDataSource();
      const repoRepo = dataSource.getRepository(GitRepository);
      await repoRepo.insert(repo);

      // Pull files from remote repository (only .bpmn and .dmn files)
      try {
        const accessToken = await credentialService.getAccessToken(userId, providerId);
        if (accessToken) {
          const repoFullName = namespace ? `${namespace}/${repositoryName}` : repositoryName;
          const pullResult = await remoteGitService.pullFromRemote(
            projectId,
            userId,
            providerId,
            accessToken,
            {
              repo: repoFullName,
              branch: 'main',
              patterns: ['**/*.bpmn', '**/*.dmn'],
            }
          );
          logger.info('Pulled files from remote', { projectId, repositoryId, filesCount: pullResult.filesCount });
        } else {
          logger.warn('No access token for provider, skipping file pull', { projectId, providerId });
        }
      } catch (pullError) {
        logger.warn('Failed to pull files from remote', { projectId, remoteUrl, error: pullError });
        // Don't fail the whole clone operation if pull fails
      }

      await this.logOperation({
        repositoryId,
        userId,
        operation: 'clone',
        status: 'success',
        duration: Date.now() - startTime,
      });

      return {
        id: repositoryId,
        projectId,
        providerId,
        remoteUrl,
        defaultBranch: 'main',
        lastCommitSha: null,
        clonePath: `vcs://${projectId}`,
      };
    } catch (error) {
      logger.error('Failed to clone repository', { projectId, remoteUrl, error });
      
      await this.logOperation({
        userId,
        operation: 'clone',
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        details: `projectId: ${projectId}, remoteUrl: ${remoteUrl}`,
        duration: Date.now() - startTime,
      });

      throw error;
    }
  }

  /**
   * Get repository info for a project
   */
  async getRepository(projectId: string): Promise<RepositoryInfo | null> {
    const dataSource = await getDataSource();
    const repoRepo = dataSource.getRepository(GitRepository);
    const repo = await repoRepo.findOneBy({ projectId });

    if (!repo) return null;
    return {
      id: repo.id,
      projectId: repo.projectId,
      providerId: repo.providerId,
      remoteUrl: repo.remoteUrl,
      defaultBranch: repo.defaultBranch,
      lastCommitSha: repo.lastCommitSha,
      clonePath: repo.clonePath,
    };
  }

  /**
   * Extract repository name from URL
   */
  private extractRepoNameFromUrl(url: string): string {
    const match = url.match(/\/([^\/]+?)(\.git)?$/);
    return match ? match[1] : 'repository';
  }

  /**
   * Deploy project (commit VCS + push to remote)
   * Creates a VCS checkpoint before push and keeps VCS in sync
   */
  async deployProject(options: {
    projectId: string;
    message: string;
    userId: string;
    environment?: string;
    createTag?: boolean;
    tagName?: string;
  }): Promise<{ deploymentId: string; commitSha: string; tag?: string; filesChanged: number; vcsCommitId?: string }> {
    const startTime = Date.now();

    await this.ensureVcsInitialized();

    const dataSource = await getDataSource();
    const repoRepo = dataSource.getRepository(GitRepository);
    const deploymentRepo = dataSource.getRepository(GitDeployment);

    const repo = await repoRepo.findOneBy({ projectId: options.projectId });

    if (!repo) {
      throw new Error('Project is not connected to Git');
    }

    const platformSettings = await platformSettingsService.get();
    let accessToken = await credentialService.getAccessToken(options.userId, repo.providerId);
    if (!accessToken && platformSettings.gitProjectTokenSharingEnabled && repo.connectedByUserId) {
      const connectedByUserId = String(repo.connectedByUserId);
      if (connectedByUserId && connectedByUserId !== options.userId) {
        accessToken = await credentialService.getAccessToken(connectedByUserId, repo.providerId);
      }
    }

    if (!accessToken) {
      throw new Error('No Git credentials found for this provider');
    }

    const repoFullName = repo.namespace ? `${repo.namespace}/${repo.repositoryName}` : repo.repositoryName;
    const branch = repo.defaultBranch || 'main';

    // Pre-flight: verify token can access the repository before doing expensive work
    const client = await remoteGitService.getClient(repo.providerId, accessToken);
    await client.getBranches(repoFullName);

    // Always create VCS checkpoint before deploy to ensure consistency
    let vcsCommitId: string | undefined;
    try {
      const mainBranch = await vcsService.getMainBranch(options.projectId);
      if (mainBranch) {
        // Commit current state to VCS before pushing
        const vcsCommit = await vcsService.commit(
          mainBranch.id,
          options.userId,
          `Pre-deploy checkpoint: ${options.message}`,
          { isRemote: false, source: 'deploy' }
        );
        vcsCommitId = vcsCommit.id;
        logger.info('Created VCS checkpoint before deploy', { projectId: options.projectId, vcsCommitId });
      }
    } catch (e) {
      // Log warning but continue - we still want to push
      logger.warn('Failed to create VCS checkpoint before deploy', { projectId: options.projectId, error: e });
    }

    // Push to remote - includes userId so pushToRemote can update VCS after push
    const pushResult = await remoteGitService.pushToRemote(options.projectId, repo.providerId, accessToken, {
      repo: repoFullName,
      branch,
      message: options.message,
      patterns: ['**/*.bpmn', '**/*.dmn'],
      userId: options.userId, // Pass userId for VCS commit after push
    });

    const commitSha = pushResult.commit?.sha || repo.lastCommitSha || '';

    const now = Date.now();
    const deploymentId = generateId();

    // Create Git tag if requested
    let createdTag: string | null = null;
    if (options.createTag && commitSha) {
      const tagName = options.tagName || `deploy-${Date.now()}`;
      try {
        const client = await remoteGitService.getClient(repo.providerId, accessToken);
        await client.createTag(repoFullName, tagName, commitSha, options.message);
        createdTag = tagName;
        logger.info('Created Git tag', { projectId: options.projectId, tag: tagName, commitSha });
      } catch (tagError) {
        logger.warn('Failed to create Git tag', { projectId: options.projectId, tag: tagName, error: tagError });
      }
    }

    await deploymentRepo.insert({
      id: deploymentId,
      projectId: options.projectId,
      repositoryId: repo.id,
      commitSha,
      commitMessage: options.message,
      tag: createdTag,
      deployedBy: options.userId,
      deployedAt: now,
      environment: options.environment ?? null,
      status: 'success',
      errorMessage: null,
      filesChanged: pushResult.pushedFilesCount + pushResult.deletionsCount,
      metadata: JSON.stringify({
        providerId: repo.providerId,
        repo: repoFullName,
        branch,
        createTagRequested: !!options.createTag,
        tagNameRequested: options.tagName ?? null,
        pushedFilesCount: pushResult.pushedFilesCount,
        deletionsCount: pushResult.deletionsCount,
        skippedFilesCount: pushResult.skippedFilesCount,
        totalFilesCount: pushResult.totalFilesCount,
        usedRemoteTree: pushResult.usedRemoteTree,
        vcsCommitId,
      }),
    } as any);

    // Note: git_repositories sync metadata is now updated by pushToRemote

    await this.logOperation({
      repositoryId: repo.id,
      userId: options.userId,
      operation: 'deploy',
      status: 'success',
      duration: Date.now() - startTime,
      details: JSON.stringify({
        projectId: options.projectId,
        commitSha,
        environment: options.environment ?? null,
        vcsCommitId,
      }),
    });

    return {
      deploymentId,
      commitSha,
      tag: createdTag || undefined,
      filesChanged: pushResult.pushedFilesCount + pushResult.deletionsCount,
      vcsCommitId,
    };
  }

  /**
   * Rollback to a specific commit
   * TODO: Implement using VCS service
   */
  async rollbackToCommit(projectId: string, commitSha: string, userId: string): Promise<void> {
    throw new Error('Rollback not yet implemented in VCS mode');
  }

  /**
   * Get commit history for a project
   */
  async getCommitHistory(
    projectId: string,
    userId: string,
    limit: number = 50
  ): Promise<{ all: Array<{ oid: string; commit: { message: string; author: { name: string; email: string; timestamp: number } } }> }> {
    const dataSource = await getDataSource();
    const repoRepo = dataSource.getRepository(GitRepository);
    const deploymentRepo = dataSource.getRepository(GitDeployment);

    const repo = await repoRepo.findOneBy({ projectId });

    if (!repo) return { all: [] };
    const repoFullName = repo.namespace ? `${repo.namespace}/${repo.repositoryName}` : repo.repositoryName;
    const branch = repo.defaultBranch || 'main';

    const mapToUiCommit = (c: { sha: string; message: string; author: string; date: Date }) => ({
      oid: c.sha,
      commit: {
        message: c.message,
        author: {
          name: c.author || 'unknown',
          email: '',
          timestamp: c.date instanceof Date ? c.date.getTime() : Date.now(),
        },
      },
    });

    // Prefer remote commit history when we have credentials
    const platformSettings = await platformSettingsService.get();
    let accessToken = await credentialService.getAccessToken(userId, repo.providerId);
    if (!accessToken && platformSettings.gitProjectTokenSharingEnabled && repo.connectedByUserId) {
      const connectedByUserId = String(repo.connectedByUserId);
      if (connectedByUserId && connectedByUserId !== userId) {
        accessToken = await credentialService.getAccessToken(connectedByUserId, repo.providerId);
      }
    }

    if (accessToken) {
      try {
        const remoteCommits = await remoteGitService.getRemoteCommits(
          repo.providerId,
          accessToken,
          repoFullName,
          branch,
          limit
        );
        return { all: remoteCommits.map(mapToUiCommit) };
      } catch (error) {
        logger.warn('Failed to fetch remote commit history, falling back to deployments', {
          projectId,
          repo: repoFullName,
          error,
        });
      }
    }

    // Fallback: use deployments history as a lightweight commit feed
    const deployments = await deploymentRepo.find({
      where: { projectId },
      order: { deployedAt: 'DESC' },
      take: limit,
      select: ['commitSha', 'commitMessage', 'deployedBy', 'deployedAt'],
    });

    const all = deployments
      .map((d) => ({
        sha: String(d.commitSha),
        message: String(d.commitMessage),
        author: String(d.deployedBy || 'unknown'),
        date: new Date(Number(d.deployedAt || Date.now())),
      }))
      .map(mapToUiCommit);

    return { all };
  }

  /**
   * Log operation to audit log
   */
  private async logOperation(params: {
    repositoryId?: string;
    userId: string;
    operation: string;
    status: string;
    errorMessage?: string;
    details?: string;
    duration: number;
  }): Promise<void> {
    try {
      const dataSource = await getDataSource();
      const auditRepo = dataSource.getRepository(GitAuditLog);
      await auditRepo.insert({
        id: generateId(),
        repositoryId: params.repositoryId || null,
        userId: params.userId,
        operation: params.operation,
        details: params.details || null,
        status: params.status,
        errorMessage: params.errorMessage || null,
        duration: params.duration,
        createdAt: Date.now(),
      });
    } catch (error) {
      // Don't fail the main operation if audit logging fails
      logger.error('Failed to log operation', { error, params });
    }
  }
}
