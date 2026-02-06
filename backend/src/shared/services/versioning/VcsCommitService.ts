/**
 * VCS Commit Service - Commit operations
 */

import { getDataSource } from '@shared/db/data-source.js';
import { Branch } from '@shared/db/entities/Branch.js';
import { Commit } from '@shared/db/entities/Commit.js';
import { WorkingFile } from '@shared/db/entities/WorkingFile.js';
import { FileSnapshot } from '@shared/db/entities/FileSnapshot.js';
import { FileCommitVersion } from '@shared/db/entities/FileCommitVersion.js';
import { File as MainFile } from '@shared/db/entities/File.js';
import { In, IsNull, Not } from 'typeorm';
import { generateId } from '@shared/utils/id.js';
import { logger } from '@shared/utils/logger.js';
import { CommitInfo, hashContent, mapCommit, normalizeFolderId } from './vcs-types.js';

export class VcsCommitService {
  /**
   * Create a commit from current working files
   */
  async commit(branchId: string, userId: string, message: string, options?: { isRemote?: boolean; source?: string }): Promise<CommitInfo> {
    const dataSource = await getDataSource();
    const branchRepo = dataSource.getRepository(Branch);
    const commitRepo = dataSource.getRepository(Commit);
    const fileRepo = dataSource.getRepository(WorkingFile);
    const snapshotRepo = dataSource.getRepository(FileSnapshot);
    const now = Date.now();
    
    // Get branch info
    const branch = await branchRepo.findOne({ where: { id: branchId } });
    if (!branch) {
      throw new Error('Branch not found');
    }
    
    // Get current working files
    const files = await fileRepo.find({ where: { branchId } });

    // Load previous snapshots for this branch head
    const previousSnapshotsByWorkingId = new Map<string, {
      workingFileId: string;
      contentHash: string | null;
      name: string;
      type: string;
      folderId: string | null;
    }>();

    if (branch.headCommitId) {
      const previousSnapshots = await snapshotRepo.find({
        where: { commitId: branch.headCommitId },
        select: ['workingFileId', 'contentHash', 'name', 'type', 'folderId']
      });

      for (const snap of previousSnapshots) {
        previousSnapshotsByWorkingId.set(snap.workingFileId, {
          workingFileId: snap.workingFileId,
          contentHash: snap.contentHash,
          name: snap.name,
          type: snap.type,
          folderId: snap.folderId,
        });
      }
    }
    
    // Create content hash for the commit
    const commitHash = hashContent(JSON.stringify(files.map(f => ({ id: f.id, hash: f.contentHash }))));
    
    // Get next version number for this project
    const maxVersionResult = await commitRepo.createQueryBuilder('c')
      .select('COALESCE(MAX(c.versionNumber), 0)', 'maxVersion')
      .where('c.projectId = :projectId', { projectId: branch.projectId })
      .getRawOne();
    const nextVersionNumber = (maxVersionResult?.maxVersion ?? 0) + 1;
    
    // Create commit
    const commitId = generateId();
    const commit = {
      id: commitId,
      projectId: branch.projectId,
      branchId,
      parentCommitId: branch.headCommitId,
      userId,
      message,
      hash: commitHash,
      versionNumber: nextVersionNumber,
      source: options?.source ?? 'manual',
      isRemote: options?.isRemote ?? false,
      createdAt: now,
    };
    
    await commitRepo.insert(commit);
    
    // Create file snapshots with accurate changeType per file
    for (const file of files) {
      let changeType: string;
      let snapshotContent = file.content;
      let snapshotContentHash = file.contentHash;

      const previous = branch.headCommitId
        ? previousSnapshotsByWorkingId.get(file.id)
        : undefined;

      if (file.isDeleted) {
        changeType = 'deleted';
      } else if (!branch.headCommitId || !previous) {
        changeType = 'added';
      } else {
        const contentUnchanged = (file.contentHash ?? null) === (previous.contentHash ?? null);
        const nameUnchanged = file.name === previous.name;
        const typeUnchanged = file.type === previous.type;
        const folderUnchanged = (file.folderId ?? null) === (previous.folderId ?? null);

        if (contentUnchanged && nameUnchanged && typeUnchanged && folderUnchanged) {
          changeType = 'unchanged';
          if (branch.headCommitId) {
            const previousSnapshot = await snapshotRepo.findOne({
              where: { commitId: branch.headCommitId, workingFileId: file.id },
              select: ['content', 'contentHash']
            });
            
            if (previousSnapshot) {
              snapshotContent = previousSnapshot.content;
              snapshotContentHash = previousSnapshot.contentHash;
            }
          }
        } else {
          changeType = 'modified';
        }
      }

      await snapshotRepo.insert({
        id: generateId(),
        commitId,
        workingFileId: file.id,
        folderId: file.folderId,
        name: file.name,
        type: file.type,
        content: snapshotContent,
        contentHash: snapshotContentHash,
        changeType,
      });
    }
    
    // Update branch head
    await branchRepo.update({ id: branchId }, { headCommitId: commitId, updatedAt: now });
    
    logger.info('Commit created', { commitId, branchId, userId, message });
    
    // Persist file version numbers for non-auto commits
    await this.updateFileCommitVersionsOnCommit(branch.projectId, commitId, message, now);
    
    return mapCommit(commit);
  }
  
  /**
   * Get commit history for a branch
   */
  async getCommits(branchId: string, limit: number = 50): Promise<CommitInfo[]> {
    const dataSource = await getDataSource();
    const commitRepo = dataSource.getRepository(Commit);
    
    const commitList = await commitRepo.find({
      where: { branchId },
      order: { createdAt: 'DESC' },
      take: limit
    });
    
    return commitList.map(c => mapCommit(c));
  }

  /**
   * Get file snapshots for a specific commit
   */
  async getCommitSnapshots(commitId: string): Promise<{
    id: string;
    name: string;
    type: string;
    content: string | null;
    changeType: string;
  }[]> {
    const dataSource = await getDataSource();
    const snapshotRepo = dataSource.getRepository(FileSnapshot);
    const fileRepo = dataSource.getRepository(WorkingFile);
    
    const snapshots = await snapshotRepo.createQueryBuilder('fs')
      .leftJoin(WorkingFile, 'wf', 'fs.workingFileId = wf.id')
      .where('fs.commitId = :commitId', { commitId })
      .select([
        'fs.id AS id',
        'fs.name AS name',
        'fs.type AS type',
        'fs.content AS content',
        'fs.changeType AS "changeType"',
        'fs.folderId AS "folderId"',
        'wf.updatedAt AS "workingUpdatedAt"'
      ])
      .getRawMany();

    const bestByKey = new Map<string, (typeof snapshots)[number]>();

    const score = (s: (typeof snapshots)[number]) => {
      let v = 0;
      if (s.content) v += 10;
      if (s.changeType !== 'unchanged') v += 5;
      if (s.changeType === 'deleted') v -= 20;
      return v;
    };

    for (const s of snapshots) {
      const key = `${s.name}::${s.type}::${s.folderId ?? ''}`;
      const current = bestByKey.get(key);
      if (!current) {
        bestByKey.set(key, s);
        continue;
      }

      const sScore = score(s);
      const currentScore = score(current);

      if (sScore > currentScore) {
        bestByKey.set(key, s);
        continue;
      }

      if (sScore === currentScore) {
        const sUpdatedAt = s.workingUpdatedAt ?? 0;
        const currentUpdatedAt = current.workingUpdatedAt ?? 0;
        if (sUpdatedAt > currentUpdatedAt) {
          bestByKey.set(key, s);
        }
      }
    }

    return [...bestByKey.values()].map(s => ({
      id: s.id,
      name: s.name,
      type: s.type,
      content: s.content,
      changeType: s.changeType,
    }));
  }
  
  /**
   * Check if a commit has a file snapshot for a specific file
   */
  async commitHasFile(commitId: string, fileId: string): Promise<boolean> {
    const dataSource = await getDataSource();
    const mainFileRepo = dataSource.getRepository(MainFile);
    const snapshotRepo = dataSource.getRepository(FileSnapshot);
    
    const mainFile = await mainFileRepo.findOne({
      where: { id: fileId },
      select: ['name', 'type', 'folderId']
    });
    
    if (!mainFile) {
      logger.debug('commitHasFile: file not found in main DB', { fileId });
      return false;
    }
    
    const { name, type, folderId } = mainFile;
    const normalizedFolderId = folderId ?? null;
    
    const qb = snapshotRepo.createQueryBuilder('fs')
      .select(['fs.changeType'])
      .where('fs.commitId = :commitId', { commitId })
      .andWhere('fs.name = :name', { name })
      .andWhere('fs.type = :type', { type });
    
    if (normalizedFolderId === null) {
      qb.andWhere('(fs.folderId IS NULL OR fs.folderId = :empty)', { empty: '' });
    } else {
      qb.andWhere('fs.folderId = :folderId', { folderId: normalizedFolderId });
    }
    
    const snapshots = await qb.getMany();

    const hasSnapshot = snapshots.some(s => s.changeType !== 'unchanged');
    logger.debug('commitHasFile check', { commitId, fileId, name, type, hasSnapshot });
    return hasSnapshot;
  }

  /**
   * Get the most recent commit that affected a given file
   */
  async getLastCommitForFile(projectId: string, fileId: string): Promise<{ id: string; message: string; createdAt: number } | null> {
    const dataSource = await getDataSource();
    const mainFileRepo = dataSource.getRepository(MainFile);
    const commitRepo = dataSource.getRepository(Commit);
    
    const mainFile = await mainFileRepo.findOne({
      where: { id: fileId },
      select: ['name', 'type', 'folderId']
    });

    if (!mainFile) {
      return null;
    }

    const { name, type, folderId } = mainFile;
    const normalizedFolderId = folderId ?? null;

    const qb = commitRepo.createQueryBuilder('c')
      .innerJoin(FileSnapshot, 'fs', 'fs.commitId = c.id')
      .where('c.projectId = :projectId', { projectId })
      .andWhere('fs.name = :name', { name })
      .andWhere('fs.type = :type', { type })
      .andWhere('fs.changeType != :unchanged', { unchanged: 'unchanged' });
    
    if (normalizedFolderId === null) {
      qb.andWhere('(fs.folderId IS NULL OR fs.folderId = :empty)', { empty: '' });
    } else {
      qb.andWhere('fs.folderId = :folderId', { folderId: normalizedFolderId });
    }
    
    const row = await qb
      .select(['c.id AS id', 'c.message AS message', 'c.createdAt AS "createdAt"'])
      .orderBy('c.createdAt', 'DESC')
      .limit(1)
      .getRawOne();

    if (!row) return null;
    return {
      id: String(row.id),
      message: String(row.message || ''),
      createdAt: Number(row.createdAt || 0),
    };
  }

  /**
   * Create a VCS commit capturing the current state of all files
   */
  async commitCurrentState(projectId: string, userId: string, message: string, getMainBranchFn: (projectId: string) => Promise<any>, initProjectFn: (projectId: string, userId: string) => Promise<any>, source: string = 'manual'): Promise<void> {
    const dataSource = await getDataSource();
    const mainFileRepo = dataSource.getRepository(MainFile);
    const commitRepo = dataSource.getRepository(Commit);
    const snapshotRepo = dataSource.getRepository(FileSnapshot);
    const branchRepo = dataSource.getRepository(Branch);

    let mainBranch = await getMainBranchFn(projectId);
    if (!mainBranch) {
      mainBranch = await initProjectFn(projectId, userId);
    }

    const currentFiles = await mainFileRepo.find({ where: { projectId } });

    if (currentFiles.length === 0) {
      logger.debug('No files to commit', { projectId });
      return;
    }

    const baselineCommitId = mainBranch.headCommitId;

    const previousSnapshotsByKey = new Map<string, Set<string>>();
    if (baselineCommitId) {
      const lastCommitSnapshots = await snapshotRepo.find({
        where: { commitId: baselineCommitId },
        select: ['folderId', 'name', 'type', 'contentHash']
      });

      for (const s of lastCommitSnapshots) {
        const key = `${normalizeFolderId(s.folderId)}:${String(s.name)}:${String(s.type)}`;
        const hash = s.contentHash;
        if (typeof hash !== 'string' || !hash) continue;
        const set = previousSnapshotsByKey.get(key) ?? new Set<string>();
        set.add(hash);
        previousSnapshotsByKey.set(key, set);
      }
    }

    const commitId = generateId();
    const now = Date.now();
    
    const allContent = currentFiles.map((f: any) => f.xml || '').join('');
    const commitHash = hashContent(allContent);

    await commitRepo.insert({
      id: commitId,
      projectId,
      branchId: mainBranch.id,
      parentCommitId: mainBranch.headCommitId,
      userId,
      message,
      hash: commitHash,
      source,
      isRemote: false,
      createdAt: now,
    });

    for (const file of currentFiles) {
      const contentHash = hashContent((file as any).xml || '');

      const key = `${normalizeFolderId((file as any).folderId)}:${String((file as any).name)}:${String((file as any).type)}`;
      const prevHashes = baselineCommitId ? previousSnapshotsByKey.get(key) : undefined;

      let changeType: string;
      if (!baselineCommitId) changeType = 'added';
      else if (!prevHashes) changeType = 'added';
      else if (prevHashes.has(contentHash)) changeType = 'unchanged';
      else changeType = 'modified';

      await snapshotRepo.insert({
        id: generateId(),
        commitId,
        workingFileId: file.id,
        folderId: (file as any).folderId,
        name: file.name,
        type: file.type,
        content: (file as any).xml || '',
        contentHash,
        changeType,
      });
    }

    await branchRepo.update({ id: mainBranch.id }, { headCommitId: commitId, updatedAt: now });

    logger.info('Created VCS commit for current state', { projectId, commitId, filesCount: currentFiles.length });
  }

  /**
   * Update file_commit_versions for all files affected by a commit
   */
  private async updateFileCommitVersionsOnCommit(
    projectId: string,
    commitId: string,
    message: string,
    createdAt: number
  ): Promise<void> {
    const msgLower = (message || '').toLowerCase();
    if (
      msgLower.startsWith('sync from starbase') ||
      msgLower.startsWith('merge from draft') ||
      msgLower.startsWith('pull from remote')
    ) {
      return;
    }

    try {
      const dataSource = await getDataSource();
      const snapshotRepo = dataSource.getRepository(FileSnapshot);
      const mainFileRepo = dataSource.getRepository(MainFile);
      const versionRepo = dataSource.getRepository(FileCommitVersion);

      const affectedSnapshots = await snapshotRepo.find({
        where: { commitId, changeType: Not('unchanged') },
        select: ['name', 'type', 'folderId', 'changeType']
      });

      if (affectedSnapshots.length === 0) {
        return;
      }

      for (const snapshot of affectedSnapshots) {
        const normalizedFolderId = snapshot.folderId ?? null;

        const qb = mainFileRepo.createQueryBuilder('f')
          .select(['f.id'])
          .where('f.projectId = :projectId', { projectId })
          .andWhere('f.name = :name', { name: snapshot.name })
          .andWhere('f.type = :type', { type: snapshot.type });
        
        if (normalizedFolderId === null || normalizedFolderId === '') {
          qb.andWhere('(f.folderId IS NULL OR f.folderId = :empty)', { empty: '' });
        } else {
          qb.andWhere('f.folderId = :folderId', { folderId: normalizedFolderId });
        }
        
        const fileRow = await qb.getOne();

        if (!fileRow) {
          continue;
        }

        const fileId = fileRow.id;

        const maxVersionResult = await versionRepo.createQueryBuilder('v')
          .select('COALESCE(MAX(v.versionNumber), 0)', 'maxVersion')
          .where('v.fileId = :fileId', { fileId })
          .getRawOne();

        const nextVersionNumber = (maxVersionResult?.maxVersion ?? 0) + 1;

        await versionRepo.createQueryBuilder()
          .insert()
          .values({
            projectId,
            fileId,
            commitId,
            versionNumber: nextVersionNumber,
            createdAt,
          })
          .orIgnore()
          .execute();
      }

      logger.debug('Updated file_commit_versions on commit', { projectId, commitId, affectedFiles: affectedSnapshots.length });
    } catch (error) {
      logger.warn('Failed to update file_commit_versions on commit', { projectId, commitId, error });
    }
  }
}

export const vcsCommitService = new VcsCommitService();
