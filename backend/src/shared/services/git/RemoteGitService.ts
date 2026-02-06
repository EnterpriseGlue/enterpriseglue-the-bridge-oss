/**
 * Remote Git Service
 * Manages connections to remote Git providers and syncs with local VCS
 */

import { getDataSource } from '@shared/db/data-source.js';
import { GitRepository } from '@shared/db/entities/GitRepository.js';
import { File as FileEntity } from '@shared/db/entities/File.js';
import { Folder } from '@shared/db/entities/Folder.js';
import { GitProvider } from '@shared/db/entities/GitProvider.js';
import { In } from 'typeorm';
import { createHash } from 'crypto';
import { logger } from '@shared/utils/logger.js';
import { vcsService } from '@shared/services/versioning/index.js';
import { generateId, unixTimestamp } from '@shared/utils/id.js';
import {
  createGitProviderClient,
  detectProviderFromUrl,
  type GitProviderClient,
  type ProviderType,
  type ProviderCredentials,
  type RepoInfo,
  type FileEntry,
  type CommitInfo,
} from './providers/index.js';
import { pushToRemote as executePushToRemote, type PushToRemoteResult, type PushOptions } from './remote-git-push.js';

interface ProviderConfig {
  id: string;
  type: ProviderType;
  name: string;
  baseUrl: string;
  token?: string;
  organization?: string;
}

// PushToRemoteResult is now exported from remote-git-push.ts
export type { PushToRemoteResult } from './remote-git-push.js';

/**
 * Service for managing remote Git provider connections
 */
class RemoteGitService {
  private clientCache: Map<string, GitProviderClient> = new Map();

  /**
   * Get or create a client for a provider
   */
  async getClient(providerId: string, userToken?: string): Promise<GitProviderClient> {
    const cacheKey = `${providerId}:${userToken || 'default'}`;
    
    if (this.clientCache.has(cacheKey)) {
      return this.clientCache.get(cacheKey)!;
    }

    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(GitProvider);
    const provider = await providerRepo.findOne({ where: { id: providerId } });

    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    const providerType = this.mapProviderType(provider.type);
    
    // User token is required - tokens are stored in git_credentials, not on provider
    if (!userToken) {
      throw new Error(`No token provided for provider: ${provider.name}`);
    }
    const token = userToken;

    const credentials: ProviderCredentials = {
      token,
      organization: provider.type === 'azure-devops' ? this.extractOrgFromUrl(provider.baseUrl) : undefined,
    };

    const client = createGitProviderClient(providerType, credentials, {
      host: provider.baseUrl || undefined,
    });

    this.clientCache.set(cacheKey, client);
    return client;
  }

  /**
   * Validate credentials for a provider
   */
  async validateCredentials(providerId: string, token: string): Promise<boolean> {
    try {
      const client = await this.getClient(providerId, token);
      return await client.validateCredentials();
    } catch (error) {
      logger.error('Failed to validate credentials', { providerId, error });
      return false;
    }
  }

  /**
   * Create a repository on the remote provider
   */
  async createRemoteRepository(
    providerId: string,
    token: string,
    options: {
      name: string;
      organization?: string;
      description?: string;
      private?: boolean;
    }
  ): Promise<RepoInfo> {
    const client = await this.getClient(providerId, token);
    
    const repo = await client.createRepository({
      name: options.name,
      organization: options.organization,
      description: options.description,
      private: options.private ?? true,
      autoInit: true,
    });

    logger.info('Created remote repository', { providerId, repo: repo.fullName });
    return repo;
  }

  /**
   * Push files from VCS to remote repository
   * Also creates a VCS commit to keep VCS in sync with remote
   */
  async pushToRemote(
    projectId: string,
    providerId: string,
    token: string,
    options: {
      repo: string;
      branch?: string;
      message?: string;
      patterns?: string[];
      userId?: string; // Required for VCS commit
    }
  ): Promise<PushToRemoteResult> {
    const client = await this.getClient(providerId, token);
    const branch = options.branch || 'main';

    const totalStart = Date.now();
    const timings: Record<string, number> = {};
    const mark = (key: string, start: number) => {
      timings[key] = Date.now() - start;
    };

    // Get files from main Starbase DB (not VCS) to reflect current UI state
    // This ensures file moves/renames are captured even if VCS isn't updated
    const dataSource = await getDataSource();
    const gitRepoRepo = dataSource.getRepository(GitRepository);
    const fileRepo = dataSource.getRepository(FileEntity);
    const folderRepo = dataSource.getRepository(Folder);

    const manifestStart = Date.now();
    const repoRow = await gitRepoRepo.findOne({
      where: { projectId },
      select: ['id', 'lastCommitSha', 'lastPushedManifest', 'lastPushedManifestUpdatedAt']
    });
    mark('loadRepoManifestMs', manifestStart);

    let previousManifest: Record<string, string> | null = null;
    if (repoRow?.lastPushedManifest) {
      try {
        const parsed = JSON.parse(String(repoRow.lastPushedManifest));
        if (parsed && typeof parsed === 'object') {
          previousManifest = parsed;
        }
      } catch (e) {
        logger.warn('Failed to parse last pushed manifest', { projectId, error: e });
      }
    }

    const driftCheckStart = Date.now();
    let remoteDrift = false;
    if (previousManifest && repoRow?.lastCommitSha) {
      try {
        const branches = await client.getBranches(options.repo);
        const remoteBranch = branches.find((b) => b.name === branch);
        if (remoteBranch?.sha && remoteBranch.sha !== repoRow.lastCommitSha) {
          remoteDrift = true;
          previousManifest = null;
        }
      } catch (e) {
        logger.warn('Failed to check remote branch head for drift', { projectId, repo: options.repo, branch, error: e });
      }
    }
    mark('remoteDriftCheckMs', driftCheckStart);

    const loadFilesStart = Date.now();
    const filesToPush = await fileRepo.find({
      where: { projectId, type: In(['bpmn', 'dmn']) },
      select: ['id', 'folderId', 'name', 'type', 'updatedAt']
    });
    mark('loadFilesMs', loadFilesStart);

    // Build folder path map from main DB folders (reflects current Starbase UI state)
    const loadFoldersStart = Date.now();
    const projectFolders = await folderRepo.find({ where: { projectId } });
    mark('loadFoldersMs', loadFoldersStart);
    
    // Build folder path lookup (folderId -> full path)
    const folderById = new Map<string, any>();
    for (const folder of projectFolders) {
      folderById.set(folder.id, folder);
    }
    const folderPathMap = new Map<string, string>();
    const buildFolderPath = (folderId: string | null): string => {
      if (!folderId) return '';
      if (folderPathMap.has(folderId)) return folderPathMap.get(folderId)!;
      
      const folder = folderById.get(folderId);
      if (!folder) return '';
      
      const parentPath = buildFolderPath(folder.parentFolderId);
      const fullPath = parentPath ? `${parentPath}/${folder.name}` : folder.name;
      folderPathMap.set(folderId, fullPath);
      return fullPath;
    };
    
    // Pre-build all folder paths
    for (const folder of projectFolders) {
      buildFolderPath(folder.id);
    }

    if (filesToPush.length === 0) {
      throw new Error('No files to push');
    }

    const normalizeTimestampMs = (value: number | null | undefined): number | null => {
      if (value === null || typeof value === 'undefined') return null;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return null;
      return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    };

    const lastManifestUpdatedAtMs = normalizeTimestampMs(repoRow?.lastPushedManifestUpdatedAt ?? null);
    const hasBaselineManifest = Boolean(previousManifest && lastManifestUpdatedAtMs);

    const filesNeedingHash: string[] = [];
    const filePathById = new Map<string, string>();

    for (const f of filesToPush) {
      const folderPath = f.folderId ? folderPathMap.get(f.folderId) || '' : '';
      const extension = `.${f.type}`;
      const fileName = f.name.endsWith(extension) ? f.name : `${f.name}${extension}`;
      const path = folderPath ? `${folderPath}/${fileName}` : fileName;
      filePathById.set(f.id, path);

      if (!hasBaselineManifest) {
        filesNeedingHash.push(f.id);
        continue;
      }

      const previousHash = previousManifest?.[path];
      if (!previousHash) {
        filesNeedingHash.push(f.id);
        continue;
      }

      const updatedAtMs = normalizeTimestampMs((f as any).updatedAt ?? null);
      if (updatedAtMs && lastManifestUpdatedAtMs && updatedAtMs > lastManifestUpdatedAtMs) {
        filesNeedingHash.push(f.id);
      }
    }

    const loadChangedFilesStart = Date.now();
    const uniqueFileIds = Array.from(new Set(filesNeedingHash));
    const filesWithContent = uniqueFileIds.length
      ? await fileRepo.find({
          where: { id: In(uniqueFileIds) },
          select: ['id', 'xml'],
        })
      : [];
    mark('loadChangedFilesMs', loadChangedFilesStart);

    const contentById = new Map(filesWithContent.map((f) => [f.id, String((f as any).xml || '')]));

    // Convert to FileEntry format with full paths
    const buildEntriesStart = Date.now();
    const currentManifest: Record<string, string> = {};
    const changedEntries: Array<FileEntry & { hash: string }> = [];
    const filesNeedingHashSet = new Set(uniqueFileIds);

    for (const f of filesToPush) {
      const path = filePathById.get(f.id) || '';
      const previousHash = previousManifest?.[path];
      let hash = previousHash;

      if (!hasBaselineManifest || !hash || filesNeedingHashSet.has(f.id)) {
        const content = contentById.get(f.id) ?? '';
        hash = createHash('sha256').update(content).digest('hex');
        if (!previousManifest || previousHash !== hash) {
          changedEntries.push({
            path,
            content,
            encoding: 'utf-8' as const,
            hash,
          });
        }
      }

      if (hash) {
        currentManifest[path] = hash;
      }
    }
    mark('buildEntriesMs', buildEntriesStart);

    const diffStart = Date.now();
    const changed = previousManifest ? changedEntries : changedEntries;

    let usedRemoteTree = false;
    let deletions: string[] = [];
    if (previousManifest) {
      deletions = Object.keys(previousManifest).filter((path) => !currentManifest[path]);
    }
    mark('computeDiffMs', diffStart);

    if (!previousManifest) {
      const remoteTreeStart = Date.now();
      const localPaths = new Set(Object.keys(currentManifest));
      const remoteTree = await client.getTree(options.repo, branch);
      usedRemoteTree = true;
      for (const entry of remoteTree) {
        if (entry.type === 'blob' && (entry.path.endsWith('.bpmn') || entry.path.endsWith('.dmn'))) {
          if (!localPaths.has(entry.path)) {
            deletions.push(entry.path);
          }
        }
      }
      mark('remoteTreeMs', remoteTreeStart);
    }

    const pushedFilesCount = changed.length;
    const deletionsCount = deletions.length;
    const skippedFilesCount = filesToPush.length - changed.length;

    if (pushedFilesCount === 0 && deletionsCount === 0) {
      logger.info('No remote changes to push', {
        projectId,
        repo: options.repo,
        branch,
        remoteDrift,
        ...timings,
        totalMs: Date.now() - totalStart,
      });

      return {
        commit: null,
        pushedFilesCount,
        deletionsCount,
        skippedFilesCount,
        totalFilesCount: filesToPush.length,
        usedRemoteTree,
      };
    }

    const pushStart = Date.now();
    const commit = await client.pushFiles({
      repo: options.repo,
      branch,
      files: changed.map((f) => ({ path: f.path, content: f.content, encoding: f.encoding } satisfies FileEntry)),
      message: options.message || `Sync from Starbase: ${new Date().toISOString()}`,
      createBranch: true,
      deletions,
    });
    mark('pushMs', pushStart);

    const persistStart = Date.now();
    if (repoRow?.id) {
      await gitRepoRepo.update({ id: repoRow.id }, {
        lastPushedManifest: JSON.stringify(currentManifest),
        lastPushedManifestUpdatedAt: Date.now(),
        lastCommitSha: commit?.sha || null,
        lastSyncAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    mark('persistManifestMs', persistStart);

    // Create VCS commit to keep VCS in sync with remote push
    let vcsCommitId: string | null = null;
    if (options.userId && (pushedFilesCount > 0 || deletionsCount > 0)) {
      const vcsStart = Date.now();
      try {
        const mainBranch = await vcsService.getMainBranch(projectId);
        if (mainBranch) {
          // Commit current state to VCS
          const vcsCommit = await vcsService.commit(
            mainBranch.id,
            options.userId,
            options.message || `Push to remote: ${options.repo}@${branch}`,
            { isRemote: true, source: 'sync-push' }
          );
          vcsCommitId = vcsCommit.id;
          
          // Update VCS last push commit to mark as synced
          await vcsService.updateLastPushCommit(projectId, vcsCommit.id);
          
          logger.info('Created VCS commit after push', { projectId, vcsCommitId, filesChanged: pushedFilesCount + deletionsCount });
        }
      } catch (vcsError) {
        // Log but don't fail the push - remote push already succeeded
        logger.warn('Failed to create VCS commit after push', { projectId, error: vcsError });
      }
      mark('vcsCommitMs', vcsStart);
    }

    logger.info('Pushed to remote', {
      projectId,
      repo: options.repo,
      branch,
      filesCount: pushedFilesCount,
      deletionsCount,
      skippedFilesCount,
      usedRemoteTree,
      remoteDrift,
      vcsCommitId,
      ...timings,
      totalMs: Date.now() - totalStart,
    });

    return {
      commit,
      pushedFilesCount,
      deletionsCount,
      skippedFilesCount,
      totalFilesCount: filesToPush.length,
      usedRemoteTree,
    };
  }

  /**
   * Pull files from remote repository to VCS
   */
  async pullFromRemote(
    projectId: string,
    userId: string,
    providerId: string,
    token: string,
    options: {
      repo: string;
      branch?: string;
      patterns?: string[];
    }
  ): Promise<{ filesCount: number; commitId: string }> {
    const client = await this.getClient(providerId, token);
    const branch = options.branch || 'main';

    // Pull files from remote
    const pullResult = await client.pullFiles({
      repo: options.repo,
      branch,
      patterns: options.patterns || ['**/*.bpmn', '**/*.dmn'],
    });

    if (pullResult.files.length === 0) {
      return { filesCount: 0, commitId: '' };
    }
    
    // Get the remote commit message to use as VCS checkpoint message
    const remoteCommitMessage = pullResult.commit.message;

    // Get main branch for this project (update main branch, not user draft)
    const mainBranch = await vcsService.getMainBranch(projectId);
    if (!mainBranch) {
      throw new Error('Project has no main branch');
    }

    // Get existing files to match by name
    const existingVcsFiles = await vcsService.getFiles(mainBranch.id);
    
    // Get main database connection
    const dataSource = await getDataSource();
    const folderRepo = dataSource.getRepository(Folder);
    const fileRepo = dataSource.getRepository(FileEntity);

    // Build folder structure from remote file paths
    // Maps folder path (e.g., "processes/onboarding") to folder ID
    const folderPathToId = new Map<string, string>();
    
    // Load existing folders for this project
    const existingFolders = await folderRepo.find({ where: { projectId } });
    
    // Build existing folder path map
    const existingFolderById = new Map<string, typeof existingFolders[0]>();
    for (const f of existingFolders) {
      existingFolderById.set(f.id, f);
    }
    
    // Recursively build path for existing folders
    const buildExistingFolderPath = (folderId: string): string => {
      const folder = existingFolderById.get(folderId);
      if (!folder) return '';
      if (!folder.parentFolderId) return folder.name;
      return `${buildExistingFolderPath(folder.parentFolderId)}/${folder.name}`;
    };
    
    // Map existing folder paths to IDs
    for (const folder of existingFolders) {
      const path = buildExistingFolderPath(folder.id);
      folderPathToId.set(path, folder.id);
    }

    /**
     * Get or create folder for a path like "processes/onboarding"
     * Creates parent folders recursively if needed
     */
    const getOrCreateFolder = async (folderPath: string): Promise<string | null> => {
      if (!folderPath) return null;
      
      // Check cache first
      if (folderPathToId.has(folderPath)) {
        return folderPathToId.get(folderPath)!;
      }
      
      // Split path into parts
      const parts = folderPath.split('/');
      let currentPath = '';
      let parentFolderId: string | null = null;
      
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        
        if (folderPathToId.has(currentPath)) {
          parentFolderId = folderPathToId.get(currentPath)!;
          continue;
        }
        
        // Create this folder
        const now = unixTimestamp();
        const newFolderId = generateId();
        
        await folderRepo.insert({
          id: newFolderId,
          projectId,
          parentFolderId,
          name: part,
          createdAt: now,
          updatedAt: now,
        });
        
        folderPathToId.set(currentPath, newFolderId);
        parentFolderId = newFolderId;
        
        logger.info('Created folder from remote structure', { folderPath: currentPath, folderId: newFolderId });
      }
      
      return parentFolderId;
    };

    let filesActuallyChanged = 0;
    // Save/update files in VCS AND main database - only if content changed
    for (const file of pullResult.files) {
      const fileType = file.path.endsWith('.dmn') ? 'dmn' : 'bpmn';
      const extension = `.${fileType}`;
      
      // Extract folder path and filename from full path
      const pathParts = file.path.split('/');
      const fileName = pathParts.pop() || file.path;
      const folderPath = pathParts.join('/'); // e.g., "processes/onboarding"
      
      const baseFileName = fileName.endsWith(extension) 
        ? fileName.slice(0, -extension.length) 
        : fileName;
      
      // Get or create the folder structure
      const folderId = await getOrCreateFolder(folderPath);
      
      // Find existing VCS file by base name, type, and folder
      const existingVcsFile = existingVcsFiles.find(f => 
        f.name === baseFileName && f.type === fileType && f.folderId === folderId
      );
      
      // Check if content actually changed by comparing with main DB
      // Match by name, type, AND folderId to handle same-named files in different folders
      const mainDbFiles = await fileRepo.find({
        where: { projectId, name: baseFileName, type: fileType }
      });
      
      // Find the file in the correct folder (or root if folderId is null)
      const matchingFile = mainDbFiles.find((f: any) => f.folderId === folderId);
      
      // Compare content - skip if identical
      const existingContent = matchingFile ? matchingFile.xml : null;
      const newContent = file.content;
      
      if (existingContent === newContent) {
        logger.info('File unchanged, skipping', { fileName: baseFileName, folderPath });
        continue;
      }
      
      // Content changed - update VCS
      await vcsService.saveFile(
        mainBranch.id,
        projectId,
        existingVcsFile?.id || null,
        baseFileName,
        fileType,
        file.content,
        folderId
      );
      
      // Update or create in the main Starbase files table
      if (matchingFile) {
        await fileRepo.update({ id: matchingFile.id }, {
          xml: file.content,
          updatedAt: unixTimestamp(),
        });
        
        logger.info('Updated main DB file', { fileId: matchingFile.id, fileName: baseFileName, folderPath });
      } else {
        // Create new file in main DB with proper folder
        const now = unixTimestamp();
        const newFileId = generateId();
        await fileRepo.insert({
          id: newFileId,
          projectId,
          folderId, // Now properly set from folder structure
          name: baseFileName,
          type: fileType,
          xml: file.content,
          createdAt: now,
          updatedAt: now,
        });
        
        logger.info('Created new file in main DB from remote', { fileId: newFileId, fileName: baseFileName, folderPath, folderId });
      }
      
      filesActuallyChanged++;
      logger.info('Pulled file with changes', { 
        fileName: baseFileName, 
        fileType,
        folderPath,
        action: existingVcsFile ? 'updated' : 'created' 
      });
    }

    // Only create a checkpoint if files actually changed
    if (filesActuallyChanged > 0) {
      const commit = await vcsService.commit(
        mainBranch.id,
        userId,
        remoteCommitMessage || `Pull from remote: ${options.repo}@${branch}`,
        { isRemote: true, source: 'sync-pull' } // Mark as remote since it came from Git
      );
      logger.info('Created checkpoint for pull', { commitId: commit.id, message: remoteCommitMessage, filesChanged: filesActuallyChanged });
      return { filesCount: filesActuallyChanged, commitId: commit.id };
    } else {
      logger.info('No files changed, skipping checkpoint creation');
      return { filesCount: 0, commitId: '' };
    }
  }

  /**
   * Sync project with remote (bidirectional)
   */
  async syncWithRemote(
    projectId: string,
    userId: string,
    providerId: string,
    token: string,
    options: {
      repo: string;
      branch?: string;
      direction?: 'push' | 'pull' | 'both';
    }
  ): Promise<{ pushed: boolean; pulled: boolean; filesChanged: number }> {
    const direction = options.direction || 'both';
    let pushed = false;
    let pulled = false;
    let filesChanged = 0;

    if (direction === 'pull' || direction === 'both') {
      const pullResult = await this.pullFromRemote(projectId, userId, providerId, token, options);
      pulled = pullResult.filesCount > 0;
      filesChanged += pullResult.filesCount;
    }

    if (direction === 'push' || direction === 'both') {
      await this.pushToRemote(projectId, providerId, token, options);
      pushed = true;
    }

    return { pushed, pulled, filesChanged };
  }

  /**
   * List repositories from a provider
   */
  async listRemoteRepositories(
    providerId: string,
    token: string,
    options?: { org?: string; limit?: number }
  ): Promise<RepoInfo[]> {
    const client = await this.getClient(providerId, token);
    return client.listRepositories(options);
  }

  /**
   * Get repository info
   */
  async getRemoteRepository(
    providerId: string,
    token: string,
    repo: string
  ): Promise<RepoInfo | null> {
    const client = await this.getClient(providerId, token);
    return client.getRepository(repo);
  }

  /**
   * Get branches from a repository
   */
  async getRemoteBranches(
    providerId: string,
    token: string,
    repo: string
  ) {
    const client = await this.getClient(providerId, token);
    return client.getBranches(repo);
  }

  /**
   * Get commits from a repository
   */
  async getRemoteCommits(
    providerId: string,
    token: string,
    repo: string,
    branch: string,
    limit?: number
  ): Promise<CommitInfo[]> {
    const client = await this.getClient(providerId, token);
    return client.getCommits(repo, branch, limit);
  }

  // Helper methods
  private mapProviderType(type: string): ProviderType {
    const typeMap: Record<string, ProviderType> = {
      'github': 'github',
      'gitlab': 'gitlab',
      'bitbucket': 'bitbucket',
      'azure-devops': 'azure-devops',
      'azure_devops': 'azure-devops',
      'azuredevops': 'azure-devops',
    };
    
    const mapped = typeMap[type.toLowerCase()];
    if (!mapped) {
      throw new Error(`Unknown provider type: ${type}`);
    }
    return mapped;
  }

  private extractOrgFromUrl(url: string): string | undefined {
    // Extract organization from Azure DevOps URL
    // https://dev.azure.com/myorg -> myorg
    const match = url.match(/dev\.azure\.com\/([^/]+)/);
    return match?.[1];
  }

  private matchesPattern(path: string, pattern: string): boolean {
    const regex = new RegExp(
      '^' + pattern
        .replace(/\\/g, '\\\\')
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*') + '$'
    );
    return regex.test(path);
  }

  /**
   * Clear client cache (useful for testing or token refresh)
   */
  clearCache(): void {
    this.clientCache.clear();
  }
}

export const remoteGitService = new RemoteGitService();
