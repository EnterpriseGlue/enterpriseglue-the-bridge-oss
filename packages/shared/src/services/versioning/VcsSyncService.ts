/**
 * VCS Sync Service - Remote sync and uncommitted changes operations
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Branch } from '@enterpriseglue/shared/db/entities/Branch.js';
import { Commit } from '@enterpriseglue/shared/db/entities/Commit.js';
import { FileSnapshot } from '@enterpriseglue/shared/db/entities/FileSnapshot.js';
import { RemoteSyncState } from '@enterpriseglue/shared/db/entities/RemoteSyncState.js';
import { File as MainFile } from '@enterpriseglue/shared/db/entities/File.js';
import { Folder as MainFolder } from '@enterpriseglue/shared/db/entities/Folder.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { hashContent, normalizeFolderId } from './vcs-types.js';

export class VcsSyncService {
  /**
   * Set up remote sync for a project
   */
  async setupRemoteSync(
    projectId: string,
    branchId: string,
    remoteUrl: string,
    remoteBranch: string = 'main'
  ): Promise<void> {
    const dataSource = await getDataSource();
    const syncRepo = dataSource.getRepository(RemoteSyncState);
    const now = Date.now();
    
    const syncId = generateId();
    await syncRepo.insert({
      id: syncId,
      projectId,
      branchId,
      remoteUrl,
      remoteBranch,
      lastPushCommitId: null,
      lastPullCommitId: null,
      lastPushAt: null,
      lastPullAt: null,
      syncStatus: 'synced',
      createdAt: now,
      updatedAt: now,
    });
    
    logger.info('Remote sync configured', { projectId, branchId, remoteUrl });
  }
  
  /**
   * Get remote sync state
   */
  async getRemoteSyncState(projectId: string, branchId: string) {
    const dataSource = await getDataSource();
    const syncRepo = dataSource.getRepository(RemoteSyncState);
    
    return syncRepo.findOne({ where: { projectId, branchId } });
  }
  
  /**
   * Calculate sync status for a project
   * Returns: positive = ahead, negative = behind, 0 = synced, null = no commits yet
   */
  async getSyncStatus(projectId: string): Promise<number | null> {
    const dataSource = await getDataSource();
    const branchRepo = dataSource.getRepository(Branch);
    const commitRepo = dataSource.getRepository(Commit);
    const syncRepo = dataSource.getRepository(RemoteSyncState);
    
    const mainBranch = await branchRepo.findOne({ where: { projectId, name: 'main' } });
    
    if (!mainBranch || !mainBranch.headCommitId) {
      return null;
    }
    
    const syncState = await syncRepo.findOne({ where: { projectId } });
    
    if (!syncState) {
      return null;
    }
    
    const lastPushCommitId = syncState.lastPushCommitId;
    
    if (!lastPushCommitId) {
      const allCommits = await commitRepo.find({ where: { branchId: mainBranch.id } });
      return allCommits.length;
    }
    
    let aheadCount = 0;
    let currentCommitId: string | null = mainBranch.headCommitId;
    
    while (currentCommitId && currentCommitId !== lastPushCommitId) {
      aheadCount++;
      
      const commit = await commitRepo.findOne({ where: { id: currentCommitId } });
      
      if (!commit) break;
      currentCommitId = commit.parentCommitId;
      
      if (aheadCount > 1000) break;
    }
    
    return aheadCount;
  }
  
  /**
   * Update the last push commit after a successful push
   */
  async updateLastPushCommit(projectId: string, commitId: string): Promise<void> {
    const dataSource = await getDataSource();
    const syncRepo = dataSource.getRepository(RemoteSyncState);
    const now = Date.now();
    
    await syncRepo.update({ projectId }, { 
      lastPushCommitId: commitId, 
      lastPushAt: now,
      syncStatus: 'synced',
      updatedAt: now 
    });
    
    logger.info('Updated last push commit', { projectId, commitId });
  }
  
  /**
   * Check if a project has uncommitted changes
   */
  async hasUncommittedChanges(projectId: string): Promise<boolean> {
    const uncommittedIds = await this.getUncommittedFileIds(projectId);
    return uncommittedIds.length > 0;
  }
  
  /**
   * Get list of file IDs that have uncommitted changes
   */
  async getUncommittedFileIds(projectId: string): Promise<string[]> {
    const result = await this.getUncommittedIds(projectId);
    return result.fileIds;
  }

  /**
   * Get both file IDs and folder IDs that have uncommitted changes
   */
  async getUncommittedIds(
    projectId: string,
    options?: { baselineCommitId?: string | null; treatNoBaselineAsAll?: boolean }
  ): Promise<{ fileIds: string[]; folderIds: string[] }> {
    const dataSource = await getDataSource();
    const branchRepo = dataSource.getRepository(Branch);
    const mainFileRepo = dataSource.getRepository(MainFile);
    const mainFolderRepo = dataSource.getRepository(MainFolder);
    const snapshotRepo = dataSource.getRepository(FileSnapshot);
    const treatNoBaselineAsAll = options?.treatNoBaselineAsAll ?? true;
    let baselineCommitId: string | null | undefined = options?.baselineCommitId;
    
    if (typeof baselineCommitId === 'undefined') {
      const mainBranch = await branchRepo.findOne({ where: { projectId, name: 'main' } });
      baselineCommitId = mainBranch ? (mainBranch as any).headCommitId : null;
    }
    
    const currentFiles = await mainFileRepo.find({
      where: { projectId },
      select: ['id', 'name', 'type', 'xml', 'folderId']
    });
    
    const allFolders = await mainFolderRepo.find({
      where: { projectId },
      select: ['id', 'parentFolderId']
    });
    
    const folderParentMap = new Map(allFolders.map(f => [f.id, f.parentFolderId]));
    
    if (!baselineCommitId) {
      if (!treatNoBaselineAsAll) {
        return { fileIds: [], folderIds: [] };
      }
      const fileIds = currentFiles.map((f: any) => f.id);
      const folderIds = this.getAncestorFolderIds(
        currentFiles.map((f: any) => f.folderId).filter((id: any): id is string => id !== null),
        folderParentMap
      );
      return { fileIds, folderIds };
    }
    
    const lastCommitSnapshots = await snapshotRepo.find({ where: { commitId: baselineCommitId } });
    
    const snapshotsByMainFileId = new Map<string, Set<string>>();
    const snapshotsByKey = new Map<string, Set<string>>();
    for (const s of lastCommitSnapshots) {
      const hash = (s as any).contentHash;
      if (typeof hash !== 'string' || !hash) continue;

      const snapshotMainFileId = (s as any).mainFileId ? String((s as any).mainFileId) : null;
      if (snapshotMainFileId) {
        const set = snapshotsByMainFileId.get(snapshotMainFileId) ?? new Set<string>();
        set.add(hash);
        snapshotsByMainFileId.set(snapshotMainFileId, set);
        continue;
      }

      const key = `${normalizeFolderId((s as any).folderId)}:${(s as any).name}:${(s as any).type}`;
      const set = snapshotsByKey.get(key) ?? new Set<string>();
      set.add(hash);
      snapshotsByKey.set(key, set);
    }
    
    const uncommittedFileIds: string[] = [];
    const uncommittedFolderIdsSet = new Set<string>();
    
    for (const file of currentFiles) {
      const key = `${normalizeFolderId((file as any).folderId)}:${file.name}:${file.type}`;
      const snapshotHashes = snapshotsByMainFileId.get(String((file as any).id)) ?? snapshotsByKey.get(key);
      
      const currentHash = hashContent((file as any).xml || '');
      
      if (!snapshotHashes || !snapshotHashes.has(currentHash)) {
        uncommittedFileIds.push(file.id);
        
        if ((file as any).folderId) {
          let currentFolderId: string | null = (file as any).folderId;
          while (currentFolderId) {
            uncommittedFolderIdsSet.add(currentFolderId);
            currentFolderId = folderParentMap.get(currentFolderId) || null;
          }
        }
      }
    }
    
    return { fileIds: uncommittedFileIds, folderIds: Array.from(uncommittedFolderIdsSet) };
  }

  /**
   * Helper to get all ancestor folder IDs from a list of folder IDs
   */
  private getAncestorFolderIds(folderIds: string[], parentMap: Map<string, string | null>): string[] {
    const result = new Set<string>();
    for (const folderId of folderIds) {
      let currentId: string | null = folderId;
      while (currentId) {
        result.add(currentId);
        currentId = parentMap.get(currentId) || null;
      }
    }
    return Array.from(result);
  }
}

export const vcsSyncService = new VcsSyncService();
