/**
 * VCS Commit Service - Commit operations
 */

import type { EntityManager } from 'typeorm';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Branch } from '@enterpriseglue/shared/infrastructure/persistence/entities/Branch.js';
import { Commit } from '@enterpriseglue/shared/infrastructure/persistence/entities/Commit.js';
import { WorkingFile } from '@enterpriseglue/shared/infrastructure/persistence/entities/WorkingFile.js';
import { FileSnapshot } from '@enterpriseglue/shared/infrastructure/persistence/entities/FileSnapshot.js';
import { FileCommitVersion } from '@enterpriseglue/shared/infrastructure/persistence/entities/FileCommitVersion.js';
import { File as MainFile } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { FILE_SCOPED_COMMIT_SOURCES, isFileScopedCommitSource } from '../../utils/commit-snapshot.js';
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
  async commit(branchId: string, userId: string, message: string, options?: VcsCommitOptions, manager?: EntityManager): Promise<CommitInfo> {
    // Copy scope before the first await. Empty or partial scope must never
    // silently become a project-wide save.
    const captured = { ...options };
    const fileIds = captured.fileIds;
    if (fileIds !== undefined && (!Array.isArray(fileIds) || fileIds.length === 0
      || fileIds.some(id => typeof id !== 'string' || !id.trim())
      || new Set(fileIds).size !== fileIds.length)) {
      throw Errors.validation('File scope must contain distinct non-empty file IDs');
    }
    const scopedIds = fileIds === undefined ? null : [...fileIds];
    if (scopedIds && captured.source && !isFileScopedCommitSource(captured.source)) {
      throw Errors.validation('File-scoped commits require the file-save source');
    }
    const dataSource = manager ?? await getDataSource();
    const branchRepo = dataSource.getRepository(Branch);
    const commitRepo = dataSource.getRepository(Commit);
    const fileRepo = dataSource.getRepository(WorkingFile);
    const snapshotRepo = dataSource.getRepository(FileSnapshot);
    const branch = await branchRepo.findOne({ where: { id: branchId } });
    if (!branch) throw new Error('Branch not found');

    const workingFiles = await fileRepo.find({ where: { branchId, projectId: branch.projectId } });
    let previousSnapshots: FileSnapshot[] = [];
    if (branch.headCommitId) {
      const parent = await commitRepo.findOne({ where: { id: branch.headCommitId, projectId: branch.projectId }, select: ['id'] });
      if (!parent) throw Errors.conflict('The saved branch head is unavailable for this project');
      previousSnapshots = await snapshotRepo.find({ where: { commitId: branch.headCommitId } });
    }
    const previousByWorkingId = new Map(previousSnapshots.map(snapshot => [snapshot.workingFileId, snapshot]));
    const previousByMainId = new Map(previousSnapshots.filter(snapshot => snapshot.mainFileId).map(snapshot => [snapshot.mainFileId!, snapshot]));
    let files = workingFiles;
    const selectedMainIdByWorkingId = new Map<string, string>();
    if (scopedIds) {
      const identities = previousSnapshots.map(snapshot => snapshot.mainFileId
        ? `id:${snapshot.mainFileId}` : `legacy:${buildSnapshotKey(snapshot.folderId, snapshot.name, snapshot.type)}`);
      if (new Set(identities).size !== identities.length || previousByWorkingId.size !== previousSnapshots.length) {
        throw Errors.conflict('The saved branch head contains ambiguous file identities');
      }
      const targets = await dataSource.getRepository(MainFile).find({
        where: { projectId: branch.projectId, id: In(scopedIds) },
        select: ['id', 'name', 'type', 'folderId'],
      });
      if (targets.length !== scopedIds.length) throw Errors.conflict('One or more selected files are unavailable in this project');
      files = targets.map(target => {
        const identified = workingFiles.filter(file => file.mainFileId === target.id);
        const matches = identified.length ? identified : workingFiles.filter(file => !file.mainFileId
          && file.name === target.name && file.type === target.type
          && normalizeFolderId(file.folderId) === normalizeFolderId(target.folderId));
        if (matches.length !== 1) throw Errors.conflict('One or more selected working files are unavailable or ambiguous');
        selectedMainIdByWorkingId.set(matches[0].id, target.id);
        return matches[0];
      });
    }

    type PlannedSnapshot = Pick<FileSnapshot, 'workingFileId' | 'mainFileId' | 'folderId' | 'name' | 'type' | 'content' | 'contentHash' | 'changeType'>;
    const planned: PlannedSnapshot[] = files.map(file => {
      const previous = (file.mainFileId ? previousByMainId.get(file.mainFileId) : undefined) ?? previousByWorkingId.get(file.id);
      const contentHash = file.content === null ? null : hashContent(file.content);
      const unchanged = previous && contentHash === previous.contentHash && file.content === previous.content
        && file.name === previous.name && file.type === previous.type
        && normalizeFolderId(file.folderId) === normalizeFolderId(previous.folderId);
      return {
        workingFileId: file.id, mainFileId: selectedMainIdByWorkingId.get(file.id) ?? file.mainFileId ?? null, folderId: file.folderId,
        name: file.name, type: file.type, content: file.content, contentHash,
        changeType: file.isDeleted ? 'deleted' : !previous ? 'added' : unchanged ? 'unchanged' : 'modified',
      };
    });
    if (scopedIds) {
      const selectedWorkingIds = new Set(files.map(file => file.id));
      const selectedMainIds = new Set(scopedIds);
      // Unselected entries come from the immutable saved tree, never their
      // current working rows. This also preserves tombstones and removed rows.
      for (const previous of previousSnapshots) {
        if (selectedWorkingIds.has(previous.workingFileId) || (previous.mainFileId && selectedMainIds.has(previous.mainFileId))) continue;
        planned.push({
          workingFileId: previous.workingFileId, mainFileId: previous.mainFileId, folderId: previous.folderId,
          name: previous.name, type: previous.type, content: previous.content, contentHash: previous.contentHash,
          changeType: previous.changeType === 'deleted' ? 'deleted' : 'unchanged',
        });
      }
    }
    planned.sort((a, b) => a.workingFileId < b.workingFileId ? -1 : a.workingFileId > b.workingFileId ? 1 : 0);
    const commitHash = hashContent(JSON.stringify(planned.map(file => ({
      id: file.workingFileId, mainFileId: file.mainFileId, name: file.name, type: file.type,
      folderId: file.folderId, hash: file.contentHash, deleted: file.changeType === 'deleted',
    }))));
    const now = Date.now();
    const maxVersionResult = await commitRepo.createQueryBuilder('c')
      .select('COALESCE(MAX(c.versionNumber), 0)', 'maxVersion')
      .where('c.projectId = :projectId', { projectId: branch.projectId }).getRawOne();
    const commitId = generateId();
    const commit = {
      id: commitId, projectId: branch.projectId, branchId, parentCommitId: branch.headCommitId, userId, message,
      hash: commitHash, versionNumber: (maxVersionResult?.maxVersion ?? 0) + 1,
      source: scopedIds ? 'file-save' : captured.source ?? 'manual', isRemote: captured.isRemote ?? false,
      hotfixFromCommitId: captured.hotfixFromCommitId ?? null, hotfixFromFileVersion: captured.hotfixFromFileVersion ?? null,
      createdAt: now,
    };
    await commitRepo.insert(commit);
    if (planned.length) await snapshotRepo.insert(planned.map(snapshot => ({ ...snapshot, id: generateId(), commitId })));
    await branchRepo.update({ id: branchId }, { headCommitId: commitId, updatedAt: now });
    logger.info('Commit created', { commitId, branchId, userId, message });
    await this.updateFileCommitVersionsOnCommit(branch.projectId, commitId, message, now, scopedIds, manager);
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
  async getCommitSnapshots(commitId: string, projectId: string, manager?: EntityManager): Promise<{
    id: string;
    mainFileId: string | null;
    folderId: string | null;
    name: string;
    type: string;
    content: string | null;
    changeType: string;
  }[]> {
    if (!projectId) throw new Error('A project is required to read commit snapshots');
    const dataSource = manager ?? await getDataSource();
    const snapshotRepo = dataSource.getRepository(FileSnapshot);
    
    const snapshots = await snapshotRepo.createQueryBuilder('fs')
      .innerJoin(Commit, 'vc', 'fs.commitId = vc.id')
      .where('fs.commitId = :commitId', { commitId })
      .andWhere('vc.projectId = :projectId', { projectId })
      .select([
        'fs.id AS id',
        'fs.mainFileId AS "mainFileId"',
        'fs.name AS name',
        'fs.type AS type',
        'fs.content AS content',
        'fs.changeType AS "changeType"',
        'fs.folderId AS "folderId"'
      ])
      .getRawMany();

    // Preserve duplicate identities so readers and restores can reject ambiguity.
    // Current working-file timestamps must not choose a historical snapshot.
    return snapshots.map(s => ({
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
    if (isFileScopedCommitSource(commitRow?.source)) {
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
      .andWhere('(c.source IS NULL OR c.source NOT IN (:...fileScopedSources))', { fileScopedSources: [...FILE_SCOPED_COMMIT_SOURCES] })
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
    explicitFileIds?: string[] | null,
    manager?: EntityManager
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
      const dataSource = manager ?? await getDataSource();
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
          const insert = versionRepo.createQueryBuilder()
            .insert()
            .values(insertValues);
          if (!manager) insert.orIgnore();
          await insert.execute();
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

        const insert = versionRepo.createQueryBuilder()
          .insert()
          .values({
            projectId,
            fileId,
            commitId,
            versionNumber: nextVersionNumber,
            createdAt,
          });
        if (!manager) insert.orIgnore();
        await insert.execute();
      }

      logger.debug('Updated file_commit_versions on commit', { projectId, commitId, affectedFiles: affectedSnapshots.length });
    } catch (error) {
      logger.warn('Failed to update file_commit_versions on commit', { projectId, commitId, error });
      if (manager) throw error;
    }
  }
}

export const vcsCommitService = new VcsCommitService();
