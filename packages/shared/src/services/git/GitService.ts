/**
 * Git Service - Database-only Version Control
 * 
 * This service manages Git repository metadata and integrates with the VCS service
 * for database-only version control. No physical git folders are created.
 */

import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitRepository } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitRepository.js';
import { GitDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitDeployment.js';
import { GitAuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitAuditLog.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { decrypt } from '../encryption.js';
import { vcsService } from '../versioning/index.js';
import { remoteGitService } from './RemoteGitService.js';
import { credentialService } from './CredentialService.js';
import { platformSettingsService } from '../platform-admin/PlatformSettingsService.js';

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
   * Resolve the access token for a project's Git connection.
   * Reads from git_repositories.encryptedToken (project-level).
   */
  static async getProjectAccessToken(repo: GitRepository, _actingUserId?: string): Promise<string | null> {
    if (repo.encryptedToken) {
      try {
        return decrypt(repo.encryptedToken);
      } catch (err) {
        logger.error('Failed to decrypt project-level token – re-save the token in Git Settings', { projectId: repo.projectId, error: err });
      }
    }
    return null;
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
      await repoRepo.delete({ projectId });
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
      await repoRepo.delete({ projectId });
      await repoRepo.insert(repo);

      // Pull files from remote repository (only .bpmn and .dmn files)
      try {
        const savedRepo = await repoRepo.findOne({ where: { projectId }, order: { createdAt: 'DESC' } });
        const accessToken = savedRepo ? await GitService.getProjectAccessToken(savedRepo, userId) : null;
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
    const repo = await repoRepo.findOne({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });

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
    vcsCommitId?: string;
  }): Promise<{ deploymentId: string; commitSha: string; tag?: string; filesChanged: number; vcsCommitId?: string }> {
    options = { ...options };
    if (options.vcsCommitId !== undefined && (!options.vcsCommitId || options.vcsCommitId.trim() !== options.vcsCommitId)) {
      throw Errors.validation('A nonempty saved deployment version is required');
    }
    const startTime = Date.now();

    await this.ensureVcsInitialized();

    const dataSource = await getDataSource();
    const repoRepo = dataSource.getRepository(GitRepository);
    const deploymentRepo = dataSource.getRepository(GitDeployment);

    const repo = await repoRepo.findOne({
      where: { projectId: options.projectId },
      order: { createdAt: 'DESC' },
    });

    if (!repo) {
      throw new Error('Project is not connected to Git');
    }

    const accessToken = await GitService.getProjectAccessToken(repo, options.userId);

    if (!accessToken) {
      throw new Error('No Git credentials found for this provider');
    }

    const repoFullName = repo.namespace ? `${repo.namespace}/${repo.repositoryName}` : repo.repositoryName;
    const branch = repo.defaultBranch || 'main';

    // Legacy callers first save a complete owned draft. A failed checkpoint
    // cannot fall through into an unversioned push.
    let vcsCommitId = options.vcsCommitId;
    if (!vcsCommitId) {
      const draft = await vcsService.getUserBranch(options.projectId, options.userId);
      await vcsService.syncFromMainDb(options.projectId, options.userId, draft.id);
      const saved = await vcsService.commit(draft.id, options.userId, `Pre-deploy checkpoint: ${options.message}`, { source: 'deploy' });
      vcsCommitId = saved.id;
    }
    // Push to remote - includes userId so pushToRemote can update VCS after push
    const pushStart = Date.now();
    const pushResult = await remoteGitService.pushToRemote(options.projectId, repo.providerId, accessToken, {
      repo: repoFullName,
      branch,
      message: options.message,
      patterns: ['**/*.bpmn', '**/*.dmn'],
      userId: options.userId,
      vcsCommitId,
    });

    logger.info('Push to remote complete', { projectId: options.projectId, ms: Date.now() - pushStart, filesChanged: pushResult.pushedFilesCount + pushResult.deletionsCount });

    const commitSha = pushResult.commit?.sha || repo.lastCommitSha || '';
    if (!commitSha || commitSha.trim() !== commitSha) throw Errors.conflict('Git deployment commit was not verified');

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
      } catch {
        throw Errors.conflict('Git push completed but the requested tag was not verified; reconcile before retrying');
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

    const repo = await repoRepo.findOne({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });

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
    const accessToken = await GitService.getProjectAccessToken(repo, userId);

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
