/**
 * Remote Git Push Operations
 * Handles pushing files from Starbase VCS to remote Git repositories
 */

import { getDataSource } from '@shared/db/data-source.js';
import { GitRepository } from '@shared/db/entities/GitRepository.js';
import { File } from '@shared/db/entities/File.js';
import { Folder } from '@shared/db/entities/Folder.js';
import { In } from 'typeorm';
import { createHash } from 'crypto';
import { logger } from '@shared/utils/logger.js';
import { vcsService } from '@shared/services/versioning/index.js';
import type { GitProviderClient, FileEntry, CommitInfo } from './providers/index.js';

export interface PushToRemoteResult {
  commit: CommitInfo | null;
  pushedFilesCount: number;
  deletionsCount: number;
  skippedFilesCount: number;
  totalFilesCount: number;
  usedRemoteTree: boolean;
}

export interface PushOptions {
  repo: string;
  branch?: string;
  message?: string;
  patterns?: string[];
  userId?: string;
}

/**
 * Push files from VCS to remote repository
 * Also creates a VCS commit to keep VCS in sync with remote
 */
export async function pushToRemote(
  client: GitProviderClient,
  projectId: string,
  options: PushOptions
): Promise<PushToRemoteResult> {
  const branch = options.branch || 'main';

  const totalStart = Date.now();
  const timings: Record<string, number> = {};
  const mark = (key: string, start: number) => {
    timings[key] = Date.now() - start;
  };

  // Get files from main Starbase DB (not VCS) to reflect current UI state
  const dataSource = await getDataSource();
  const repoRepo = dataSource.getRepository(GitRepository);
  const fileRepo = dataSource.getRepository(File);
  const folderRepo = dataSource.getRepository(Folder);

  const manifestStart = Date.now();
  const repoRow = await repoRepo.findOne({
    where: { projectId },
    select: ['id', 'lastCommitSha', 'lastPushedManifest'],
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
    select: ['id', 'folderId', 'name', 'type', 'xml'],
  });
  mark('loadFilesMs', loadFilesStart);

  // Build folder path map from main DB folders
  const loadFoldersStart = Date.now();
  const projectFolders = await folderRepo.findBy({ projectId });
  mark('loadFoldersMs', loadFoldersStart);
  
  // Build folder path lookup
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

  // Convert to FileEntry format with full paths
  const buildEntriesStart = Date.now();
  const fileEntries = filesToPush
    .filter((f) => f.xml !== null)
    .map((f) => {
      const folderPath = f.folderId ? folderPathMap.get(f.folderId) || '' : '';
      const extension = `.${f.type}`;
      const fileName = f.name.endsWith(extension) ? f.name : `${f.name}${extension}`;
      const path = folderPath ? `${folderPath}/${fileName}` : fileName;
      const content = String(f.xml || '');
      const hash = createHash('sha256').update(content).digest('hex');

      return { path, content, encoding: 'utf-8' as const, hash };
    });
  mark('buildEntriesMs', buildEntriesStart);

  if (fileEntries.length === 0) {
    throw new Error('No files to push');
  }

  const diffStart = Date.now();
  const currentManifest: Record<string, string> = {};
  for (const f of fileEntries) {
    currentManifest[f.path] = f.hash;
  }

  const changed = previousManifest
    ? fileEntries.filter((f) => previousManifest![f.path] !== f.hash)
    : fileEntries;

  let usedRemoteTree = false;
  let deletions: string[] = [];
  if (previousManifest) {
    deletions = Object.keys(previousManifest).filter((path) => !currentManifest[path]);
  }
  mark('computeDiffMs', diffStart);

  if (!previousManifest) {
    const remoteTreeStart = Date.now();
    const localPaths = new Set(fileEntries.map((f) => f.path));
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
  const skippedFilesCount = fileEntries.length - changed.length;

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
      totalFilesCount: fileEntries.length,
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
    await repoRepo.update({ id: repoRow.id }, {
      lastPushedManifest: JSON.stringify(currentManifest),
      lastPushedManifestUpdatedAt: Date.now(),
      lastCommitSha: commit.sha,
    });
  }
  mark('persistManifestMs', persistStart);

  // Create VCS commit if userId provided
  if (options.userId) {
    const vcsCommitStart = Date.now();
    try {
      const mainBranch = await vcsService.getMainBranch(projectId);
      if (mainBranch) {
        await vcsService.commit(
          mainBranch.id,
          options.userId,
          options.message || `Pushed to remote: ${options.repo}`,
          { isRemote: true, source: 'sync-push' }
        );
      }
    } catch (e) {
      logger.warn('Failed to create VCS commit after push', { projectId, error: e });
    }
    mark('vcsCommitMs', vcsCommitStart);
  }

  logger.info('Pushed to remote', {
    projectId,
    repo: options.repo,
    branch,
    commitSha: commit.sha,
    pushedFilesCount,
    deletionsCount,
    skippedFilesCount,
    usedRemoteTree,
    remoteDrift,
    ...timings,
    totalMs: Date.now() - totalStart,
  });

  return {
    commit,
    pushedFilesCount,
    deletionsCount,
    skippedFilesCount,
    totalFilesCount: fileEntries.length,
    usedRemoteTree,
  };
}
