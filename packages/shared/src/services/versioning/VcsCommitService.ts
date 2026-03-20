/**
 * VCS Commit Service - Commit operations
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Branch } from '@enterpriseglue/shared/db/entities/Branch.js';
import { Commit } from '@enterpriseglue/shared/db/entities/Commit.js';
import { WorkingFile } from '@enterpriseglue/shared/db/entities/WorkingFile.js';
import { FileSnapshot } from '@enterpriseglue/shared/db/entities/FileSnapshot.js';
import { FileCommitVersion } from '@enterpriseglue/shared/db/entities/FileCommitVersion.js';
import { File as MainFile } from '@enterpriseglue/shared/db/entities/File.js';
import { Brackets, In } from 'typeorm';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { CommitInfo, hashContent, mapCommit, normalizeFolderId } from './vcs-types.js';

type VcsCommitOptions = {
  isRemote?: boolean;
  source?: string;
  hotfixFromCommitId?: string;
  hotfixFromFileVersion?: number;
  fileIds?: string[];
};

function buildSnapshotKey(folderId: string | null | undefined, name: string, type: string): string {
  return `${normalizeFolderId(folderId ?? null)}:${String(name)}:${String(type)}`;
}

function resolveSnapshotFileId(
  snapshot: { mainFileId?: string | null; folderId?: string | null; name: string; type: string },
  validFileIds: Set<string>,
  fileByKey: Map<string, string>
): string | null {
  const directFileId = snapshot.mainFileId ? String(snapshot.mainFileId) : null;
  if (directFileId && validFileIds.has(directFileId)) {
    return directFileId;
  }

  return fileByKey.get(buildSnapshotKey(snapshot.folderId ?? null, snapshot.name, snapshot.type)) ?? null;
}

export class VcsCommitService {
  /**
   * Create a commit from current working files
   */
  async commit(branchId: string, userId: string, message: string, options?: VcsCommitOptions): Promise<CommitInfo> {
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
      hotfixFromCommitId: options?.hotfixFromCommitId ?? null,
      hotfixFromFileVersion: options?.hotfixFromFileVersion ?? null,
      createdAt: now,
    };
    
    await commitRepo.insert(commit);
    
    // Pre-load previous snapshot content for reuse on unchanged files
    const prevContentByWorkingId = new Map<string, { content: string | null; contentHash: string | null }>();
    if (branch.headCommitId) {
      const prevSnapshots = await snapshotRepo.find({
        where: { commitId: branch.headCommitId },
        select: ['workingFileId', 'content', 'contentHash']
      });
      for (const snap of prevSnapshots) {
        prevContentByWorkingId.set(snap.workingFileId, { content: snap.content, contentHash: snap.contentHash });
      }
    }

    // Create file snapshots with accurate changeType per file (batched)
    const snapshotRows: any[] = [];
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
          const prevContent = prevContentByWorkingId.get(file.id);
          if (prevContent) {
            snapshotContent = prevContent.content;
            snapshotContentHash = prevContent.contentHash;
          }
        } else {
          changeType = 'modified';
        }
      }

      snapshotRows.push({
        id: generateId(),
        commitId,
        workingFileId: file.id,
        mainFileId: file.mainFileId ?? null,
        folderId: file.folderId,
        name: file.name,
        type: file.type,
        content: snapshotContent,
        contentHash: snapshotContentHash,
        changeType,
      });
    }

    if (snapshotRows.length > 0) {
      await snapshotRepo.insert(snapshotRows);
    }
    
    // Update branch head
    await branchRepo.update({ id: branchId }, { headCommitId: commitId, updatedAt: now });
    
    logger.info('Commit created', { commitId, branchId, userId, message });
    
    // Persist file version numbers for non-auto commits
    await this.updateFileCommitVersionsOnCommit(branch.projectId, commitId, message, now, options?.fileIds ?? null);
    
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
    mainFileId: string | null;
    folderId: string | null;
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
        'fs.mainFileId AS "mainFileId"',
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
      const key = s.mainFileId
        ? `main:${String(s.mainFileId)}`
        : buildSnapshotKey(s.folderId ?? null, s.name, s.type);
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
      mainFileId: s.mainFileId ? String(s.mainFileId) : null,
      folderId: s.folderId ?? null,
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
    const commitRepo = dataSource.getRepository(Commit);
    const versionRepo = dataSource.getRepository(FileCommitVersion);
    const mainFileRepo = dataSource.getRepository(MainFile);
    const snapshotRepo = dataSource.getRepository(FileSnapshot);

    const explicitVersion = await versionRepo.findOne({
      where: { fileId, commitId },
      select: ['commitId']
    });
    if (explicitVersion) {
      return true;
    }

    const commitRow = await commitRepo.findOne({
      where: { id: commitId },
      select: ['source']
    });
    if (commitRow?.source === 'file-save') {
      logger.debug('commitHasFile skipped snapshot fallback for file-scoped save', { commitId, fileId });
      return false;
    }
    
    const mainFile = await mainFileRepo.findOne({
      where: { id: fileId },
      select: ['id', 'name', 'type', 'folderId']
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
      .andWhere(new Brackets((where) => {
        where.where('fs.mainFileId = :fileId', { fileId });
        where.orWhere(new Brackets((legacy) => {
          legacy.where('fs.mainFileId IS NULL')
            .andWhere('fs.name = :name', { name })
            .andWhere('fs.type = :type', { type });

          if (normalizedFolderId === null) {
            legacy.andWhere('(fs.folderId IS NULL OR fs.folderId = :empty)', { empty: '' });
          } else {
            legacy.andWhere('fs.folderId = :folderId', { folderId: normalizedFolderId });
          }
        }));
      }));
    
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

    const explicitRow = await commitRepo.createQueryBuilder('c')
      .innerJoin(FileCommitVersion, 'fv', 'fv.commitId = c.id')
      .where('c.projectId = :projectId', { projectId })
      .andWhere('fv.fileId = :fileId', { fileId })
      .select(['c.id AS id', 'c.message AS message', 'c.createdAt AS "createdAt"'])
      .orderBy('c.createdAt', 'DESC')
      .limit(1)
      .getRawOne();

    if (explicitRow) {
      return {
        id: String(explicitRow.id),
        message: String(explicitRow.message || ''),
        createdAt: Number(explicitRow.createdAt || 0),
      };
    }
    
    const mainFile = await mainFileRepo.findOne({
      where: { id: fileId },
      select: ['id', 'name', 'type', 'folderId']
    });

    if (!mainFile) {
      return null;
    }

    const { name, type, folderId } = mainFile;
    const normalizedFolderId = folderId ?? null;

    const qb = commitRepo.createQueryBuilder('c')
      .innerJoin(FileSnapshot, 'fs', 'fs.commitId = c.id')
      .where('c.projectId = :projectId', { projectId })
      .andWhere('(c.source IS NULL OR c.source <> :fileSaveSource)', { fileSaveSource: 'file-save' })
      .andWhere(new Brackets((where) => {
        where.where('fs.mainFileId = :fileId', { fileId });
        where.orWhere(new Brackets((legacy) => {
          legacy.where('fs.mainFileId IS NULL')
            .andWhere('fs.name = :name', { name })
            .andWhere('fs.type = :type', { type });

          if (normalizedFolderId === null) {
            legacy.andWhere('(fs.folderId IS NULL OR fs.folderId = :empty)', { empty: '' });
          } else {
            legacy.andWhere('fs.folderId = :folderId', { folderId: normalizedFolderId });
          }
        }));
      }))
      .andWhere('fs.changeType != :unchanged', { unchanged: 'unchanged' });
    
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

    const previousSnapshotsByMainFileId = new Map<string, Set<string>>();
    const previousSnapshotsByKey = new Map<string, Set<string>>();
    if (baselineCommitId) {
      const lastCommitSnapshots = await snapshotRepo.find({
        where: { commitId: baselineCommitId },
        select: ['mainFileId', 'folderId', 'name', 'type', 'contentHash']
      });

      for (const s of lastCommitSnapshots) {
        const hash = s.contentHash;
        if (typeof hash !== 'string' || !hash) continue;

        if (s.mainFileId) {
          const fileId = String(s.mainFileId);
          const set = previousSnapshotsByMainFileId.get(fileId) ?? new Set<string>();
          set.add(hash);
          previousSnapshotsByMainFileId.set(fileId, set);
          continue;
        }

        const key = buildSnapshotKey(s.folderId, String(s.name), String(s.type));
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

    const stateSnapshotRows: any[] = [];
    for (const file of currentFiles) {
      const contentHash = hashContent((file as any).xml || '');

      const key = buildSnapshotKey((file as any).folderId, String((file as any).name), String((file as any).type));
      const prevHashes = baselineCommitId
        ? (previousSnapshotsByMainFileId.get(String((file as any).id)) ?? previousSnapshotsByKey.get(key))
        : undefined;

      let changeType: string;
      if (!baselineCommitId) changeType = 'added';
      else if (!prevHashes) changeType = 'added';
      else if (prevHashes.has(contentHash)) changeType = 'unchanged';
      else changeType = 'modified';

      stateSnapshotRows.push({
        id: generateId(),
        commitId,
        workingFileId: file.id,
        mainFileId: String((file as any).id),
        folderId: (file as any).folderId,
        name: file.name,
        type: file.type,
        content: (file as any).xml || '',
        contentHash,
        changeType,
      });
    }

    if (stateSnapshotRows.length > 0) {
      await snapshotRepo.insert(stateSnapshotRows);
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
    createdAt: number,
    explicitFileIds?: string[] | null
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
      const normalizedExplicitFileIds = Array.isArray(explicitFileIds)
        ? Array.from(new Set(explicitFileIds.map((id) => String(id)).filter(Boolean)))
        : [];

      if (normalizedExplicitFileIds.length > 0) {
        const scopedFiles = await mainFileRepo.find({
          where: { projectId, id: In(normalizedExplicitFileIds) },
          select: ['id']
        });
        const scopedFileIds = scopedFiles.map((file) => String(file.id));

        if (scopedFileIds.length === 0) {
          return;
        }

        const maxVersionsByFileId = new Map<string, number>();
        const maxVersionRows = await versionRepo.createQueryBuilder('v')
          .select(['v.fileId AS "fileId"', 'COALESCE(MAX(v.versionNumber), 0) AS "maxVersion"'])
          .where('v.fileId IN (:...fileIds)', { fileIds: scopedFileIds })
          .groupBy('v.fileId')
          .getRawMany();

        for (const row of maxVersionRows) {
          maxVersionsByFileId.set(String(row.fileId), Number(row.maxVersion));
        }

        const insertValues = scopedFileIds.map((fileId) => {
          const nextVersionNumber = (maxVersionsByFileId.get(fileId) ?? 0) + 1;
          maxVersionsByFileId.set(fileId, nextVersionNumber);
          return {
            projectId,
            fileId,
            commitId,
            versionNumber: nextVersionNumber,
            createdAt,
          };
        });

        if (insertValues.length > 0) {
          await versionRepo.createQueryBuilder()
            .insert()
            .values(insertValues)
            .orIgnore()
            .execute();
        }

        logger.debug('Updated file_commit_versions on explicit file-scoped commit', { projectId, commitId, affectedFiles: scopedFileIds.length });
        return;
      }

      // Include ALL committed files (even unchanged) so every explicit save
      // gets a FileCommitVersion row. This is critical for deployments: the
      // artifact row links to the commit, and edit-target resolves file version
      // via FileCommitVersion. If we only tracked changed files, deploying
      // after a "save version" with no content change would resolve to the
      // previous version instead of the newly saved one.
      const affectedSnapshots = await snapshotRepo.find({
        where: { commitId },
        select: ['mainFileId', 'name', 'type', 'folderId', 'changeType']
      });

      if (affectedSnapshots.length === 0) {
        return;
      }

      // Batch: load all project files once and build a lookup map
      const allProjectFiles = await mainFileRepo.find({
        where: { projectId },
        select: ['id', 'name', 'type', 'folderId']
      });
      const validFileIds = new Set(allProjectFiles.map((file) => String(file.id)));
      const fileByKey = new Map<string, string>();
      for (const f of allProjectFiles) {
        fileByKey.set(buildSnapshotKey((f as any).folderId, f.name, f.type), f.id);
      }

      const matchedFileIds = Array.from(new Set(
        affectedSnapshots
          .map((snapshot) => resolveSnapshotFileId(snapshot, validFileIds, fileByKey))
          .filter((fileId): fileId is string => typeof fileId === 'string' && fileId.length > 0)
      ));

      const maxVersionsByFileId = new Map<string, number>();
      if (matchedFileIds.length > 0) {
        const maxVersionRows = await versionRepo.createQueryBuilder('v')
          .select(['v.fileId AS "fileId"', 'COALESCE(MAX(v.versionNumber), 0) AS "maxVersion"'])
          .where('v.fileId IN (:...fileIds)', { fileIds: matchedFileIds })
          .groupBy('v.fileId')
          .getRawMany();
        for (const row of maxVersionRows) {
          maxVersionsByFileId.set(String(row.fileId), Number(row.maxVersion));
        }
      }

      for (const fileId of matchedFileIds) {
        const maxVersion = maxVersionsByFileId.get(fileId) ?? 0;
        const nextVersionNumber = maxVersion + 1;
        maxVersionsByFileId.set(fileId, nextVersionNumber);

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
