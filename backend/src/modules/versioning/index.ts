/**
 * VCS Routes
 * 
 * API endpoints for version control operations:
 * - Commit files to user's draft branch
 * - Publish (merge) draft to main
 * - Get commit history
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '@shared/middleware/auth.js';
import { requireProjectRole, requireProjectAccess } from '@shared/middleware/projectAuth.js';
import { validateBody, validateParams } from '@shared/middleware/validate.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { getDataSource } from '@shared/db/data-source.js';
import { projectIdParamSchema, commitBodySchema } from '@shared/schemas/common.js';
import { File } from '@shared/db/entities/File.js';
import { Project } from '@shared/db/entities/Project.js';
import { Branch } from '@shared/db/entities/Branch.js';
import { WorkingFile } from '@shared/db/entities/WorkingFile.js';
import { FileSnapshot } from '@shared/db/entities/FileSnapshot.js';
import { FileCommitVersion } from '@shared/db/entities/FileCommitVersion.js';
import { Commit } from '@shared/db/entities/Commit.js';
import { In, IsNull, Brackets } from 'typeorm';
import { AuthorizationService } from '@shared/services/authorization.js';
import { projectMemberService } from '@shared/services/platform-admin/ProjectMemberService.js';
import { vcsService } from '@shared/services/versioning/index.js';
import { logger } from '@shared/utils/logger.js';
import { EDIT_ROLES } from '@shared/constants/roles.js';

// Type for project row
interface ProjectRow {
  id: string;
  ownerId: string;
}

// Type for branch row
interface BranchRow {
  id: string;
  projectId: string;
  name: string;
  type: string;
  headCommitId: string | null;
}

const router = Router();

/**
 * Batch uncommitted status for multiple projects (draft baseline)
 * GET /vcs-api/projects/uncommitted-status?projectIds=a,b,c
 */
router.get('/vcs-api/projects/uncommitted-status', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const rawIds = String(req.query?.projectIds || '').trim();
  const requestedIds = rawIds
    ? rawIds.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  // Require explicit project IDs to avoid scanning all projects.
  if (requestedIds.length === 0) {
    return res.json({ statuses: {} });
  }

  const dataSource = await getDataSource();
  const projectRepo = dataSource.getRepository(Project);
  const candidates = await projectRepo.find({
    where: { id: In(requestedIds) },
    select: ['id', 'ownerId']
  }) as ProjectRow[];

  const projectIds: string[] = [];
  for (const row of candidates) {
    const pid = String(row.id);
    if (String(row.ownerId) === String(userId)) {
      projectIds.push(pid);
      continue;
    }
    if (await AuthorizationService.verifyProjectAccess(pid, userId)) {
      projectIds.push(pid);
    }
  }
  if (projectIds.length === 0) {
    return res.json({ statuses: {} });
  }

  if (!(await vcsService.ensureInitialized())) {
    throw Errors.serviceUnavailable('VCS');
  }

  try {
    // Use the same logic as ProjectDetail: compare MainFile content against FileSnapshot
    // This works consistently regardless of whether VCS branches exist
    const statuses: Record<string, { hasUncommittedChanges: boolean; dirtyFileCount: number }> = {};
    
    // Process projects in parallel for better performance
    await Promise.all(projectIds.map(async (pid) => {
      try {
        // Get user's draft branch to use as baseline
        const draftBranch = await vcsService.getUserBranch(pid, userId);
        const baselineCommitId = draftBranch?.headCommitId || null;
        
        // Use vcsSyncService to get uncommitted file count (same as ProjectDetail)
        const result = await vcsService.getUncommittedIds(pid, {
          baselineCommitId,
          treatNoBaselineAsAll: false, // Don't count all files as dirty if no baseline
        });
        
        const count = result.fileIds.length;
        statuses[pid] = { hasUncommittedChanges: count > 0, dirtyFileCount: count };
      } catch (e) {
        // If any project fails, default to no dirty files
        statuses[pid] = { hasUncommittedChanges: false, dirtyFileCount: 0 };
      }
    }));

    res.json({ statuses });
  } catch (error) {
    logger.error('Failed to batch uncommitted status', { userId, error });
    throw Errors.internal('Failed to batch uncommitted status');
  }
}));

/**
 * Commit current file state to user's draft branch
 * POST /vcs-api/projects/:projectId/commit
 * Body: { message: string, fileIds?: string[] }
 * 
 * If fileIds is provided, only those files are committed.
 * Otherwise, all files in the project are committed.
 */
router.post('/vcs-api/projects/:projectId/commit', apiLimiter, requireAuth, validateParams(projectIdParamSchema), validateBody(commitBodySchema), requireProjectRole(EDIT_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const userId = req.user!.userId;
  const { message, fileIds } = req.body;

  if (!(await vcsService.ensureInitialized())) {
    throw Errors.serviceUnavailable('VCS');
  }

  try {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(File);
    const validatedFileIds = fileIds || null;

    // Get user's draft branch (creates if doesn't exist)
    const branch = await vcsService.getUserBranch(projectId, userId);

    // Get files to commit from main database
    let filesToCommit;
    if (validatedFileIds && validatedFileIds.length > 0) {
      // Commit specific files
      filesToCommit = await fileRepo.find({
        where: { projectId, id: In(validatedFileIds) }
      });
    } else {
      // Commit all files in project
      filesToCommit = await fileRepo.find({
        where: { projectId }
      });
    }

    if (filesToCommit.length === 0) {
      throw Errors.validation('No files to commit');
    }

    // Save each file to VCS working_files
    for (const file of filesToCommit) {
      await vcsService.saveFile(
        branch.id,
        projectId,
        null, // Let VCS find or create
        file.name,
        file.type,
        file.xml,
        file.folderId
      );
    }

    // Create the commit
    const commit = await vcsService.commit(
      branch.id,
      userId,
      message.trim()
    );

    logger.info('Files committed to VCS', { 
      projectId, 
      userId, 
      commitId: commit.id, 
      fileCount: filesToCommit.length 
    });

    res.json({
      commitId: commit.id,
      message: commit.message,
      fileCount: filesToCommit.length,
      createdAt: commit.createdAt
    });
  } catch (error) {
    logger.error('Failed to commit files', { projectId, userId, error });
    throw Errors.internal('Failed to commit files');
  }
}));

/**
 * Publish (merge) user's draft branch to main
 * POST /vcs-api/projects/:projectId/publish
 */
router.post('/vcs-api/projects/:projectId/publish', apiLimiter, requireAuth, requireProjectRole(EDIT_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const userId = req.user!.userId;

  if (!(await vcsService.ensureInitialized())) {
    throw Errors.serviceUnavailable('VCS');
  }

  try {
    // Get user's draft branch
    const draftBranch = await vcsService.getUserBranch(projectId, userId);
    
    // Merge to main
    const result = await vcsService.mergeToMain(draftBranch.id, projectId, userId);

    logger.info('Draft merged to main', { projectId, userId, mergeCommitId: result.mergeCommitId });

    res.json({
      success: true,
      mergeCommitId: result.mergeCommitId,
      filesChanged: result.filesChanged
    });
  } catch (error) {
    logger.error('Failed to publish to main', { projectId, userId, error });
    throw Errors.internal('Failed to publish changes');
  }
}));

/**
 * Get commit history for a project
 * GET /vcs-api/projects/:projectId/commits
 */
router.get('/vcs-api/projects/:projectId/commits', apiLimiter, requireAuth, requireProjectAccess(), asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const userId = req.user!.userId;
  const { branch: branchType = 'all', fileId } = req.query as { branch?: 'draft' | 'main' | 'all', fileId?: string };

  if (!(await vcsService.ensureInitialized())) {
    throw Errors.serviceUnavailable('VCS');
  }

  try {
    let commits: any[] = [];
    
    if (branchType === 'all') {
      // Fetch commits from both main and draft branches, merge and sort by date
      const mainBranch = await vcsService.getMainBranch(projectId);
      const draftBranch = await vcsService.getUserBranch(projectId, userId);
      
      const [mainCommits, draftCommits] = await Promise.all([
        mainBranch ? vcsService.getCommits(mainBranch.id, 50) : [],
        vcsService.getCommits(draftBranch.id, 50),
      ]);
      
      // Merge and deduplicate by commit ID, sort by createdAt descending
      // isRemote is now stored in the database, not inferred from branch
      const commitMap = new Map<string, any>();
      for (const c of [...mainCommits, ...draftCommits]) {
        if (!commitMap.has(c.id)) {
          commitMap.set(c.id, c);
        }
      }
      commits = Array.from(commitMap.values())
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50);
    } else if (branchType === 'main') {
      const mainBranch = await vcsService.getMainBranch(projectId);
      if (!mainBranch) {
        return res.json({ commits: [] });
      }
      commits = await vcsService.getCommits(mainBranch.id, 50);
    } else {
      const draftBranch = await vcsService.getUserBranch(projectId, userId);
      commits = await vcsService.getCommits(draftBranch.id, 50);
    }

    // If fileId is specified, filter to only commits that affected this file
    // and assign file-specific sequential version numbers
    if (fileId) {
      const mainDataSource = await getDataSource();
      const mainFileRepo = mainDataSource.getRepository(File);
      const fileRow = await mainFileRepo.findOne({
        where: { id: fileId },
        select: ['name', 'type', 'folderId']
      });
      const fileRows = fileRow ? [fileRow] : [];

      if (fileRows.length === 0) {
        commits = [];
      } else {
        const { name, type, folderId } = fileRows[0];
        const normalizedFolderId = folderId ?? null;

        const isAutoCommit = (message: string | null | undefined) => {
          const msg = String(message || '').toLowerCase();
          if (msg.startsWith('sync from starbase')) return true;
          if (msg.startsWith('merge from draft')) return true;
          if (msg.startsWith('pull from remote')) return true;
          return false;
        };

        const dataSource = await getDataSource();
        const fileCommitVersionRepo = dataSource.getRepository(FileCommitVersion);

        const commitIds = commits.map((c: any) => String(c.id));
        const affectedCommitIds = new Set<string>();

        if (commitIds.length > 0) {
          const snapshotRepo = dataSource.getRepository(FileSnapshot);
          const qb = snapshotRepo.createQueryBuilder('fs')
            .select('fs.commitId', 'commitId')
            .where('fs.commitId IN (:...commitIds)', { commitIds })
            .andWhere('fs.name = :name', { name })
            .andWhere('fs.type = :type', { type })
            .andWhere('fs.changeType <> :unchanged', { unchanged: 'unchanged' });

          if (normalizedFolderId === null) {
            qb.andWhere(new Brackets(qb2 => {
              qb2.where('fs.folderId IS NULL')
                 .orWhere("fs.folderId = ''");
            }));
          } else {
            qb.andWhere('fs.folderId = :folderId', { folderId: normalizedFolderId });
          }

          const affectedRows = await qb.groupBy('fs.commitId').getRawMany();

          for (const row of affectedRows) {
            affectedCommitIds.add(String(row.commitId));
          }
        }

        const filteredCommits = commits.filter((c: any) => affectedCommitIds.has(String(c.id)));

        // Ensure file_commit_versions is populated for this file.
        try {
          // First, find the latest user-visible commit that affected this file.
          // If file_commit_versions already contains that commit, we can skip the full backfill.
          const commitRepo = dataSource.getRepository(Commit);

          // Build query for commits with file snapshots matching the file
          const buildFileCommitsQuery = (order: 'DESC' | 'ASC', limit?: number) => {
            const qb = commitRepo.createQueryBuilder('c')
              .select(['c.id', 'c.createdAt', 'c.message'])
              .innerJoin(FileSnapshot, 'fs', 'fs.commitId = c.id')
              .where('c.projectId = :projectId', { projectId })
              .andWhere('fs.name = :name', { name })
              .andWhere('fs.type = :type', { type })
              .andWhere('fs.changeType <> :unchanged', { unchanged: 'unchanged' });

            if (normalizedFolderId === null) {
              qb.andWhere(new Brackets(qb2 => {
                qb2.where('fs.folderId IS NULL')
                   .orWhere("fs.folderId = ''");
              }));
            } else {
              qb.andWhere('fs.folderId = :folderId', { folderId: normalizedFolderId });
            }

            qb.groupBy('c.id').addGroupBy('c.createdAt').addGroupBy('c.message')
              .orderBy('c.createdAt', order);

            if (limit) {
              qb.limit(limit);
            }

            return qb;
          };

          const latestCandidates = await buildFileCommitsQuery('DESC', 10).getMany();
          const latest = latestCandidates.find((r) => !isAutoCommit(r.message));

          if (!latest) {
            await fileCommitVersionRepo.delete({ fileId });
          } else {
            const existingLatest = await fileCommitVersionRepo.findOne({
              where: { fileId, commitId: String(latest.id) }
            });

            // Also check if entry count matches expected non-auto commit count
            let needsBackfill = !existingLatest;
            if (!needsBackfill) {
              const allRowsForCount = await buildFileCommitsQuery('ASC').getMany();
              const expectedCount = allRowsForCount.filter((r) => !isAutoCommit(r.message)).length;
              const actualCount = await fileCommitVersionRepo.count({ where: { fileId } });
              needsBackfill = actualCount !== expectedCount;
            }

            if (needsBackfill) {
              // Full backfill: rebuild sequential v1..vN (oldest->newest), excluding auto commits.
              const allRowsAsc = await buildFileCommitsQuery('ASC').getMany();
              const rowsToNumber = allRowsAsc.filter((r) => !isAutoCommit(r.message));

              await dataSource.transaction(async (manager) => {
                await manager.delete(FileCommitVersion, { fileId });
                if (rowsToNumber.length > 0) {
                  const values = rowsToNumber.map((r, idx) => ({
                    projectId,
                    fileId,
                    commitId: String(r.id),
                    versionNumber: idx + 1,
                    createdAt: Number(r.createdAt),
                  }));
                  await manager.insert(FileCommitVersion, values as any);
                }
              });
            }
          }
        } catch (e) {
          logger.warn('Failed to ensure file_commit_versions, falling back to computed fileVersionNumber', { projectId, fileId, error: e });
        }

        // Read DB-backed file version numbers for returned commits
        // Only non-auto commits get version numbers (auto-commits are filtered by frontend)
        const nonAutoCommits = filteredCommits.filter((c: any) => !isAutoCommit(c.message));
        const versionMap = new Map<string, number>();
        if (nonAutoCommits.length > 0) {
          const versionRows = await fileCommitVersionRepo.find({
            where: { fileId, commitId: In(nonAutoCommits.map((c: any) => String(c.id))) },
            select: ['commitId', 'versionNumber']
          });

          for (const row of versionRows as any[]) {
            versionMap.set(String(row.commitId), Number(row.versionNumber));
          }
        }

        // If DB doesn't cover all non-auto commits, use computed sequential numbers exclusively
        // to avoid collisions between DB numbers (with gaps) and fallback numbers.
        if (versionMap.size < nonAutoCommits.length) {
          versionMap.clear();
          const ascByCreatedAt = [...nonAutoCommits].sort((a, b) => a.createdAt - b.createdAt);
          ascByCreatedAt.forEach((commit: any, index) => {
            versionMap.set(String(commit.id), index + 1);
          });
        }

        const commitsWithFileVersion = filteredCommits.map((commit: any) => {
          const commitId = String(commit.id);
          const fileVersionNumber = isAutoCommit(commit.message)
            ? undefined
            : versionMap.get(commitId);
          return {
            id: commit.id,
            projectId: commit.projectId,
            branchId: commit.branchId,
            parentCommitId: commit.parentCommitId,
            userId: commit.userId,
            message: commit.message,
            hash: commit.hash,
            versionNumber: commit.versionNumber,
            isRemote: commit.isRemote,
            createdAt: commit.createdAt,
            fileVersionNumber,
          };
        });

        commits = commitsWithFileVersion.sort((a, b) => b.createdAt - a.createdAt);
      }
    }

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    res.json({ commits });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('Failed to get commits', { projectId, userId, errorMessage, errorStack, error });
    throw Errors.internal('Failed to get commit history');
  }
}));

/**
 * Get VCS status for a project (has uncommitted changes, etc.)
 * GET /vcs-api/projects/:projectId/status
 */
router.get('/vcs-api/projects/:projectId/status', apiLimiter, requireAuth, requireProjectAccess(), asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const userId = req.user!.userId;

  if (!(await vcsService.ensureInitialized())) {
    throw Errors.serviceUnavailable('VCS');
  }

  try {
    // Check if project has VCS initialized
    const mainBranch = await vcsService.getMainBranch(projectId);
    
    if (!mainBranch) {
      return res.json({ 
        initialized: false,
        hasUncommittedChanges: false,
        hasUnpublishedCommits: false
      });
    }

    // Get user's draft branch
    const draftBranch = await vcsService.getUserBranch(projectId, userId);
    
    // Get latest commits on each branch
    const draftCommits = await vcsService.getCommits(draftBranch.id, 1);
    const mainCommits = await vcsService.getCommits(mainBranch.id, 1);

    const hasUnpublishedCommits = draftCommits.length > 0 && (
      mainCommits.length === 0 || 
      draftCommits[0].createdAt > mainCommits[0].createdAt
    );

    res.json({
      initialized: true,
      draftBranchId: draftBranch.id,
      mainBranchId: mainBranch.id,
      hasUnpublishedCommits,
      lastDraftCommit: draftCommits[0] || null,
      lastMainCommit: mainCommits[0] || null
    });
  } catch (error) {
    logger.error('Failed to get VCS status', { projectId, userId, error });
    throw Errors.internal('Failed to get VCS status');
  }
}));

/**
 * Get uncommitted file IDs for a project
 * GET /vcs-api/projects/:projectId/uncommitted-files
 */
router.get('/vcs-api/projects/:projectId/uncommitted-files', apiLimiter, requireAuth, requireProjectAccess(), asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const userId = req.user!.userId;
  const baseline = String(req.query?.baseline || 'main').toLowerCase();

  if (!(await vcsService.ensureInitialized())) {
    throw Errors.serviceUnavailable('VCS');
  }

  try {
    let fileIds: string[] = [];
    let folderIds: string[] = [];

    if (baseline === 'draft') {
      const draftBranch = await vcsService.getUserBranch(projectId, userId);
      const result = await vcsService.getUncommittedIds(projectId, {
        baselineCommitId: 'headCommitId' in draftBranch ? String(draftBranch.headCommitId) : null,
        treatNoBaselineAsAll: false,
      });
      fileIds = result.fileIds;
      folderIds = result.folderIds;
    } else {
      const result = await vcsService.getUncommittedIds(projectId);
      fileIds = result.fileIds;
      folderIds = result.folderIds;
    }
    const hasUncommittedChanges = fileIds.length > 0;

    res.json({
      hasUncommittedChanges,
      uncommittedFileIds: fileIds,
      uncommittedFolderIds: folderIds
    });
  } catch (error) {
    logger.error('Failed to get uncommitted files', { projectId, userId, error });
    throw Errors.internal('Failed to get uncommitted files');
  }
}));

/**
 * Get file snapshots for a specific commit
 * GET /vcs-api/projects/:projectId/commits/:commitId/files
 */
router.get('/vcs-api/projects/:projectId/commits/:commitId/files', apiLimiter, requireAuth, requireProjectAccess(), asyncHandler(async (req: Request, res: Response) => {
  const { projectId, commitId } = req.params;
  const userId = req.user!.userId;

  if (!(await vcsService.ensureInitialized())) {
    throw Errors.serviceUnavailable('VCS');
  }

  try {
    const snapshots = await vcsService.getCommitSnapshots(commitId);
    res.json({ files: snapshots });
  } catch (error) {
    logger.error('Failed to get commit files', { projectId, commitId, userId, error });
    throw Errors.internal('Failed to get commit files');
  }
}));

/**
 * Restore files from a specific commit
 * POST /vcs-api/projects/:projectId/commits/:commitId/restore
 */
router.post('/vcs-api/projects/:projectId/commits/:commitId/restore', apiLimiter, requireAuth, requireProjectRole(EDIT_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const { projectId, commitId } = req.params;
  const userId = req.user!.userId;

  if (!(await vcsService.ensureInitialized())) {
    throw Errors.serviceUnavailable('VCS');
  }

  try {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(File);
    
    // Get file snapshots from the commit
    const snapshots = await vcsService.getCommitSnapshots(commitId);
    
    if (snapshots.length === 0) {
      throw Errors.fileNotFound();
    }

    // Update each file in the main files table with the snapshot content
    for (const snapshot of snapshots) {
      // Find the file by name and project (since working file IDs may not match)
      const existingFiles = await fileRepo.find({
        where: { projectId, name: snapshot.name }
      });
      
      if (existingFiles.length > 0 && snapshot.content) {
        await fileRepo.update({ id: existingFiles[0].id }, {
          xml: snapshot.content,
          updatedAt: Date.now()
        });
      }
    }

    // Create a new checkpoint with the restore
    const branch = await vcsService.getUserBranch(projectId, userId);
    
    // Get current files to commit
    const currentFiles = await fileRepo.find({
      where: { projectId }
    });

    for (const file of currentFiles) {
      await vcsService.saveFile(
        branch.id,
        projectId,
        null,
        file.name,
        file.type,
        file.xml,
        file.folderId
      );
    }

    const restoreCommit = await vcsService.commit(
      branch.id,
      userId,
      `Restored from checkpoint ${commitId.substring(0, 8)}`
    );

    logger.info('Files restored from commit', { projectId, commitId, userId, filesRestored: snapshots.length });

    res.json({
      success: true,
      filesRestored: snapshots.length,
      newCommitId: restoreCommit.id
    });
  } catch (error) {
    logger.error('Failed to restore from commit', { projectId, commitId, userId, error });
    throw Errors.internal('Failed to restore files');
  }
}));

export default router;
