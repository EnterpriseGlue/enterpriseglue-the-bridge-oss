/**
 * VCS Branch Service - Branch management operations
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Branch } from '@enterpriseglue/shared/db/entities/Branch.js';
import { WorkingFile } from '@enterpriseglue/shared/db/entities/WorkingFile.js';
import { WorkingFolder } from '@enterpriseglue/shared/db/entities/WorkingFolder.js';
import { Commit } from '@enterpriseglue/shared/db/entities/Commit.js';
import { FileSnapshot } from '@enterpriseglue/shared/db/entities/FileSnapshot.js';
import { PendingChange } from '@enterpriseglue/shared/db/entities/PendingChange.js';
import { RemoteSyncState } from '@enterpriseglue/shared/db/entities/RemoteSyncState.js';
import { In, IsNull } from 'typeorm';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { BranchInfo, mapBranch } from './vcs-types.js';

export class VcsBranchService {
  /**
   * Initialize VCS for a project
   * Creates the main branch
   */
  async initProject(projectId: string, userId: string): Promise<BranchInfo> {
    const dataSource = await getDataSource();
    const branchRepo = dataSource.getRepository(Branch);
    const now = Date.now();
    
    // Check if main branch already exists
    const existingMain = await branchRepo.findOne({
      where: { projectId, name: 'main' }
    });
    
    if (existingMain) {
      logger.info('Main branch already exists', { projectId });
      return mapBranch(existingMain);
    }
    
    // Create main branch
    const mainBranchId = generateId();
    const mainBranch = {
      id: mainBranchId,
      projectId,
      name: 'main',
      userId: null,
      baseCommitId: null,
      headCommitId: null,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    };
    
    await branchRepo.insert(mainBranch);
    
    logger.info('VCS initialized for project', { projectId, mainBranchId });
    
    return mapBranch(mainBranch);
  }
  
  /**
   * Get or create a user's draft branch for a project
   */
  async getUserBranch(projectId: string, userId: string): Promise<BranchInfo> {
    const dataSource = await getDataSource();
    const branchRepo = dataSource.getRepository(Branch);
    const now = Date.now();

    const legacyName = `draft/${userId}`;
    
    const existing = await branchRepo.findOne({
      where: { projectId, userId }
    });

    const existingHeadCommitId =
      existing && (existing as any).headCommitId ? String((existing as any).headCommitId) : null;

    const legacy = await branchRepo.findOne({
      where: { projectId, name: legacyName, userId: IsNull() }
    });

    if (legacy) {
      const row: any = legacy;
      const legacyHeadCommitId = row.headCommitId ? String(row.headCommitId) : null;

      if (legacyHeadCommitId || !existing || !existingHeadCommitId) {
        try {
          await branchRepo.update({ id: row.id }, { userId, updatedAt: now });
        } catch (error) {
          logger.warn('Failed to backfill legacy branch userId', {
            projectId,
            userId,
            branchId: row.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return mapBranch({ ...row, userId });
      }
    }

    if (existing) {
      return mapBranch(existing);
    }
    
    // Get main branch to base off of
    const mainBranch = await branchRepo.findOne({
      where: { projectId, name: 'main' }
    });
    
    if (!mainBranch) {
      // Initialize project first
      await this.initProject(projectId, userId);
    }
    
    // Create user's draft branch
    const branchId = generateId();
    const userBranch = {
      id: branchId,
      projectId,
      name: `draft/${userId}`,
      userId,
      baseCommitId: mainBranch?.headCommitId || null,
      headCommitId: mainBranch?.headCommitId || null,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    };
    
    await branchRepo.insert(userBranch);
    
    // Copy files from main branch to user's branch
    if (mainBranch) {
      await this.copyBranchFiles(mainBranch.id, branchId);
    }
    
    logger.info('User branch created', { projectId, userId, branchId });
    
    return mapBranch(userBranch);
  }
  
  /**
   * Get the main branch for a project
   */
  async getMainBranch(projectId: string): Promise<BranchInfo | null> {
    const dataSource = await getDataSource();
    const branchRepo = dataSource.getRepository(Branch);
    
    const result = await branchRepo.findOne({
      where: { projectId, name: 'main' }
    });
    
    return result ? mapBranch(result) : null;
  }

  /**
   * Copy files from one branch to another
   */
  async copyBranchFiles(sourceBranchId: string, targetBranchId: string): Promise<void> {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(WorkingFile);
    const folderRepo = dataSource.getRepository(WorkingFolder);
    const now = Date.now();
    
    // Get source files
    const sourceFiles = await fileRepo.find({
      where: { branchId: sourceBranchId, isDeleted: false }
    });
    
    // Copy to target branch
    for (const file of sourceFiles) {
      await fileRepo.insert({
        id: generateId(),
        branchId: targetBranchId,
        projectId: file.projectId,
        mainFileId: file.mainFileId,
        folderId: file.folderId,
        name: file.name,
        type: file.type,
        content: file.content,
        contentHash: file.contentHash,
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
      });
    }
    
    // Copy folders too
    const sourceFolders = await folderRepo.find({
      where: { branchId: sourceBranchId, isDeleted: false }
    });
    
    for (const folder of sourceFolders) {
      await folderRepo.insert({
        id: generateId(),
        branchId: targetBranchId,
        projectId: folder.projectId,
        parentFolderId: folder.parentFolderId,
        name: folder.name,
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /**
   * Merge a branch into main
   */
  async mergeToMain(
    sourceBranchId: string,
    projectId: string,
    userId: string,
    commitFn: (branchId: string, userId: string, message: string) => Promise<CommitInfo>
  ): Promise<{ mergeCommitId: string; filesChanged: number }> {
    const dataSource = await getDataSource();
    const branchRepo = dataSource.getRepository(Branch);
    const fileRepo = dataSource.getRepository(WorkingFile);
    const now = Date.now();
    
    // Get source branch
    const sourceBranch = await branchRepo.findOne({ where: { id: sourceBranchId } });
    if (!sourceBranch) {
      throw new Error('Source branch not found');
    }
    
    // Get main branch
    const mainBranch = await branchRepo.findOne({
      where: { projectId: sourceBranch.projectId, name: 'main' }
    });
    
    if (!mainBranch) {
      throw new Error('Main branch not found');
    }
    
    // Get source files count before merge
    const sourceFiles = await fileRepo.find({
      where: { branchId: sourceBranchId, isDeleted: false }
    });
    
    const filesChanged = sourceFiles.length;
    
    // Mark all main branch files as deleted
    await fileRepo.update({ branchId: mainBranch.id }, { isDeleted: true, updatedAt: now });
    
    // Copy source files to main
    await this.copyBranchFiles(sourceBranchId, mainBranch.id);
    
    // Create merge commit on main
    const mergeMessage = `Merge from ${sourceBranch.name}`;
    const commit = await commitFn(mainBranch.id, userId, mergeMessage);
    
    logger.info('Branch merged to main', { sourceBranchId, mainBranchId: mainBranch.id, commitId: commit.id });
    
    return { mergeCommitId: commit.id, filesChanged };
  }

  /**
   * Delete all VCS data for a project
   */
  async deleteProject(projectId: string): Promise<void> {
    try {
      const dataSource = await getDataSource();
      const branchRepo = dataSource.getRepository(Branch);
      const commitRepo = dataSource.getRepository(Commit);
      const snapshotRepo = dataSource.getRepository(FileSnapshot);
      const fileRepo = dataSource.getRepository(WorkingFile);
      const folderRepo = dataSource.getRepository(WorkingFolder);
      const pendingRepo = dataSource.getRepository(PendingChange);
      const syncRepo = dataSource.getRepository(RemoteSyncState);
      
      const projectBranches = await branchRepo.find({
        where: { projectId },
        select: ['id']
      });
      
      const branchIds = projectBranches.map(b => b.id);
      
      const projectCommits = await commitRepo.find({
        where: { projectId },
        select: ['id']
      });
      
      const commitIds = projectCommits.map(c => c.id);
      
      if (commitIds.length > 0) {
        await snapshotRepo.delete({ commitId: In(commitIds) });
      }
      
      if (branchIds.length > 0) {
        await fileRepo.delete({ branchId: In(branchIds) });
        await folderRepo.delete({ branchId: In(branchIds) });
        await commitRepo.delete({ branchId: In(branchIds) });
        await pendingRepo.delete({ branchId: In(branchIds) });
      }
      
      await syncRepo.delete({ projectId });
      await branchRepo.delete({ projectId });
      
      logger.info('Deleted VCS data for project', { projectId, branchCount: branchIds.length });
    } catch (error) {
      logger.warn('Failed to delete VCS data (may not exist)', { projectId, error });
    }
  }
}

// Need to import CommitInfo for mergeToMain signature
import type { CommitInfo } from './vcs-types.js';

export const vcsBranchService = new VcsBranchService();
