/**
 * VCS Branch Service - Branch management operations
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Branch } from '@enterpriseglue/shared/infrastructure/persistence/entities/Branch.js';
import { WorkingFile } from '@enterpriseglue/shared/infrastructure/persistence/entities/WorkingFile.js';
import { WorkingFolder } from '@enterpriseglue/shared/infrastructure/persistence/entities/WorkingFolder.js';
import { Commit } from '@enterpriseglue/shared/infrastructure/persistence/entities/Commit.js';
import { FileSnapshot } from '@enterpriseglue/shared/infrastructure/persistence/entities/FileSnapshot.js';
import { PendingChange } from '@enterpriseglue/shared/infrastructure/persistence/entities/PendingChange.js';
import { RemoteSyncState } from '@enterpriseglue/shared/infrastructure/persistence/entities/RemoteSyncState.js';
import { In, IsNull } from 'typeorm';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { BranchInfo, CommitInfo, hashContent, mapBranch, normalizeFolderId } from './vcs-types.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { File as MainFile } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { Folder as MainFolder } from '@enterpriseglue/shared/infrastructure/persistence/entities/Folder.js';

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
    const source = await branchRepo.findOne({ where: { id: sourceBranchId, projectId, userId, isDefault: false } });
    if (!source || source.isDefault || !source.headCommitId) {
      throw Errors.conflict('The owned draft has no saved version to publish');
    }
    const head = await dataSource.getRepository(Commit).findOne({
      where: { id: source.headCommitId, projectId, branchId: sourceBranchId },
    });
    if (!head) throw Errors.conflict('The saved draft version is unavailable for this project');
    const main = await branchRepo.findOne({ where: { projectId, name: 'main', userId: IsNull(), isDefault: true } });
    if (!main || main.id === source.id) throw Errors.conflict('The published branch is unavailable');

    // Publish the immutable saved tree. Working drafts, including sibling edits
    // after a file-scoped save, are never publication inputs.
    const saved = await dataSource.getRepository(FileSnapshot).find({ where: { commitId: head.id } });
    const targets = await fileRepo.find({ where: { branchId: main.id, projectId } });
    const key = (file: { mainFileId: string | null; folderId: string | null; name: string; type: string }) =>
      file.mainFileId ? `id:${file.mainFileId}` : `legacy:${pathKey(file)}`;
    const pathKey = (file: { folderId: string | null; name: string; type: string }) =>
      JSON.stringify([normalizeFolderId(file.folderId), file.name, file.type]);
    if (new Set(saved.map(key)).size !== saved.length
      || new Set(saved.map(file => file.workingFileId)).size !== saved.length
      || new Set(targets.map(key)).size !== targets.length) {
      throw Errors.conflict('The saved or published tree contains ambiguous file identities');
    }
    for (const file of saved) {
      if (!['added', 'modified', 'unchanged', 'deleted'].includes(file.changeType)
        || file.contentHash !== (file.content === null ? null : hashContent(file.content))) {
        throw Errors.conflict('The saved file content does not match its recorded hash');
      }
    }
    const stableIds = saved.flatMap(file => file.mainFileId ? [file.mainFileId] : []);
    if (stableIds.length) {
      const current = await dataSource.getRepository(MainFile).find({ where: { id: In(stableIds) }, select: ['id', 'projectId'] });
      if (current.some(file => file.projectId !== projectId)) throw Errors.conflict('The saved tree references another project');
    }
    const folderIds = [...new Set(saved.flatMap(file => normalizeFolderId(file.folderId) ? [file.folderId!] : []))];
    if (folderIds.length) {
      const folders = await dataSource.getRepository(MainFolder).find({ where: { id: In(folderIds) }, select: ['id', 'projectId'] });
      if (folders.some(folder => folder.projectId !== projectId)) throw Errors.conflict('The saved tree references another project folder');
    }
    const usedTargets = new Set<string>();
    const byStableId = new Map(targets.filter(file => file.mainFileId).map(file => [file.mainFileId!, file]));
    const byPath = new Map<string, WorkingFile[]>();
    for (const target of targets) {
      const path = pathKey(target);
      byPath.set(path, [...(byPath.get(path) ?? []), target]);
    }
    const now = Date.now();
    const plan = saved.map(file => {
      const identified = file.mainFileId ? byStableId.get(file.mainFileId) : undefined;
      const matches = identified ? [identified] : (byPath.get(pathKey(file)) ?? []).filter(target => !file.mainFileId || !target.mainFileId);
      if (matches.length > 1 || (matches[0] && usedTargets.has(matches[0].id))) {
        throw Errors.conflict('The published file identity is ambiguous');
      }
      const target = matches[0];
      if (target) usedTargets.add(target.id);
      return {
        existingId: target?.id,
        row: { id: target?.id ?? generateId(), branchId: main.id, projectId,
          mainFileId: file.mainFileId ?? target?.mainFileId ?? null, folderId: file.folderId,
          name: file.name, type: file.type, content: file.content, contentHash: file.contentHash,
          isDeleted: file.changeType === 'deleted', createdAt: target?.createdAt ?? now, updatedAt: now },
      };
    });
    // A changed head requires a new user decision, not an implicit retry.
    const [currentSource, currentMain] = await Promise.all([
      branchRepo.findOne({ where: { id: source.id, projectId, userId, isDefault: false } }),
      branchRepo.findOne({ where: { id: main.id, projectId, userId: IsNull(), isDefault: true } }),
    ]);
    if (!currentSource || currentSource.headCommitId !== head.id || !currentMain || currentMain.headCommitId !== main.headCommitId) {
      throw Errors.conflict('The draft or published version changed; review before publishing');
    }

    // Reuse stable target rows: repeated publishing must not append duplicate
    // deleted/active identities. Absent saved files become tombstones.
    await fileRepo.update({ branchId: main.id, projectId }, { isDeleted: true, updatedAt: now });
    for (const { existingId, row } of plan) {
      if (existingId) {
        const result = await fileRepo.update({ id: existingId, branchId: main.id, projectId }, row);
        if (result.affected !== 1) throw Errors.conflict('The published file changed during publication');
      } else await fileRepo.insert(row);
    }
    const commit = await commitFn(main.id, userId, `Merge from ${source.name}`);
    logger.info('Saved branch version published to main', { sourceBranchId, mainBranchId: main.id, sourceCommitId: head.id, commitId: commit.id });
    return { mergeCommitId: commit.id, filesChanged: saved.filter(file => file.changeType !== 'deleted').length };
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

export const vcsBranchService = new VcsBranchService();
