/**
 * VCS Service - Database-only Version Control (Facade)
 * 
 * This is a facade that delegates to the split services:
 * - VcsBranchService: Branch management
 * - VcsFileService: File operations
 * - VcsCommitService: Commit operations
 * - VcsSyncService: Remote sync and uncommitted changes
 */

import { getDataSource } from '@shared/db/data-source.js';
import { logger } from '@shared/utils/logger.js';

// Import split services
import { vcsBranchService } from './VcsBranchService.js';
import { vcsFileService } from './VcsFileService.js';
import { vcsCommitService } from './VcsCommitService.js';
import { vcsSyncService } from './VcsSyncService.js';

// Re-export types for backward compatibility
export type { BranchInfo, CommitInfo, WorkingFileInfo } from './vcs-types.js';
import type { BranchInfo, CommitInfo, WorkingFileInfo } from './vcs-types.js';

export class VcsService {
  private initialized = false;

  // Expose sub-services for direct access if needed
  readonly branch = vcsBranchService;
  readonly file = vcsFileService;
  readonly commitSvc = vcsCommitService;
  readonly sync = vcsSyncService;

  async ensureInitialized(): Promise<boolean> {
    if (this.initialized) return true;
    try {
      await getDataSource();
      this.initialized = true;
      return true;
    } catch (error) {
      logger.error('VCS tables not available', { error });
      return false;
    }
  }

  // Branch operations - delegate to VcsBranchService
  async initProject(projectId: string, userId: string): Promise<BranchInfo> {
    return vcsBranchService.initProject(projectId, userId);
  }

  async getUserBranch(projectId: string, userId: string): Promise<BranchInfo> {
    return vcsBranchService.getUserBranch(projectId, userId);
  }

  async getMainBranch(projectId: string): Promise<BranchInfo | null> {
    return vcsBranchService.getMainBranch(projectId);
  }

  async mergeToMain(
    sourceBranchId: string,
    projectId: string,
    userId: string
  ): Promise<{ mergeCommitId: string; filesChanged: number }> {
    return vcsBranchService.mergeToMain(
      sourceBranchId,
      projectId,
      userId,
      (branchId, uid, msg) => vcsCommitService.commit(branchId, uid, msg, { source: 'system' })
    );
  }

  async deleteProject(projectId: string): Promise<void> {
    return vcsBranchService.deleteProject(projectId);
  }

  // File operations - delegate to VcsFileService
  async saveFile(
    branchId: string,
    projectId: string,
    fileId: string | null,
    name: string,
    type: string,
    content: string,
    folderId?: string | null
  ): Promise<WorkingFileInfo> {
    return vcsFileService.saveFile(branchId, projectId, fileId, name, type, content, folderId);
  }

  async getFiles(branchId: string, folderId?: string | null): Promise<WorkingFileInfo[]> {
    return vcsFileService.getFiles(branchId, folderId);
  }

  async getFile(fileId: string): Promise<WorkingFileInfo | null> {
    return vcsFileService.getFile(fileId);
  }

  async deleteFile(fileId: string): Promise<void> {
    return vcsFileService.deleteFile(fileId);
  }

  async syncFromMainDb(projectId: string, userId: string, branchId: string): Promise<void> {
    return vcsFileService.syncFromMainDb(projectId, userId, branchId);
  }

  // Commit operations - delegate to VcsCommitService
  async commit(branchId: string, userId: string, message: string, options?: { isRemote?: boolean; source?: string }): Promise<CommitInfo> {
    return vcsCommitService.commit(branchId, userId, message, options);
  }

  async getCommits(branchId: string, limit: number = 50): Promise<CommitInfo[]> {
    return vcsCommitService.getCommits(branchId, limit);
  }

  async getCommitSnapshots(commitId: string): Promise<{
    id: string;
    name: string;
    type: string;
    content: string | null;
    changeType: string;
  }[]> {
    return vcsCommitService.getCommitSnapshots(commitId);
  }

  async commitHasFile(commitId: string, fileId: string): Promise<boolean> {
    return vcsCommitService.commitHasFile(commitId, fileId);
  }

  async getLastCommitForFile(projectId: string, fileId: string): Promise<{ id: string; message: string; createdAt: number } | null> {
    return vcsCommitService.getLastCommitForFile(projectId, fileId);
  }

  async commitCurrentState(projectId: string, userId: string, message: string, source: string = 'manual'): Promise<void> {
    return vcsCommitService.commitCurrentState(
      projectId,
      userId,
      message,
      (pid) => this.getMainBranch(pid),
      (pid, uid) => this.initProject(pid, uid),
      source
    );
  }

  // Sync operations - delegate to VcsSyncService
  async setupRemoteSync(
    projectId: string,
    branchId: string,
    remoteUrl: string,
    remoteBranch: string = 'main'
  ): Promise<void> {
    return vcsSyncService.setupRemoteSync(projectId, branchId, remoteUrl, remoteBranch);
  }

  async getRemoteSyncState(projectId: string, branchId: string) {
    return vcsSyncService.getRemoteSyncState(projectId, branchId);
  }

  async getSyncStatus(projectId: string): Promise<number | null> {
    return vcsSyncService.getSyncStatus(projectId);
  }

  async updateLastPushCommit(projectId: string, commitId: string): Promise<void> {
    return vcsSyncService.updateLastPushCommit(projectId, commitId);
  }

  async hasUncommittedChanges(projectId: string): Promise<boolean> {
    return vcsSyncService.hasUncommittedChanges(projectId);
  }

  async getUncommittedFileIds(projectId: string): Promise<string[]> {
    return vcsSyncService.getUncommittedFileIds(projectId);
  }

  async getUncommittedIds(
    projectId: string,
    options?: { baselineCommitId?: string | null; treatNoBaselineAsAll?: boolean }
  ): Promise<{ fileIds: string[]; folderIds: string[] }> {
    return vcsSyncService.getUncommittedIds(projectId, options);
  }
}

// Singleton instance
export const vcsService = new VcsService();
