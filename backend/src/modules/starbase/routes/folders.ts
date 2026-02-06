import { Router, Request, Response } from 'express'
import { generateId } from '@shared/utils/id.js'
import { caseInsensitiveColumn } from '@shared/db/adapters/QueryHelpers.js'
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js'
import { requireAuth } from '@shared/middleware/auth.js'
import { requireProjectAccess, requireProjectRole } from '@shared/middleware/projectAuth.js'
import { validateBody, validateParams } from '@shared/middleware/validate.js'
import { apiLimiter } from '@shared/middleware/rateLimiter.js'
import { getDataSource } from '@shared/db/data-source.js'
import { Project } from '@shared/db/entities/Project.js'
import { Folder } from '@shared/db/entities/Folder.js'
import { File } from '@shared/db/entities/File.js'
import { IsNull, Raw } from 'typeorm'
import archiver from 'archiver'
import { AuthorizationService } from '@shared/services/authorization.js'
import { ResourceService } from '@shared/services/resources.js'
import { CascadeDeleteService } from '@shared/services/cascade-delete.js'
import { vcsService } from '@shared/services/versioning/index.js'
import { logger } from '@shared/utils/logger.js'
import { projectMemberService } from '@shared/services/platform-admin/ProjectMemberService.js'
import { EDIT_ROLES } from '@shared/constants/roles.js'
import { unixTimestamp } from '@shared/utils/id.js'
import { projectIdParamSchema, folderIdParamSchema, createFolderBodySchema, renameFolderBodySchema } from '@shared/schemas/common.js'

// Auto-commit helper for folder operations
async function autoCommitFolderChange(projectId: string, userId: string, message: string): Promise<void> {
  try {
    const dataSource = await getDataSource()
    const fileRepo = dataSource.getRepository(File)
    const branch = await vcsService.getUserBranch(projectId, userId)
    
    // Get all files in project to save to VCS
    const projectFiles = await fileRepo.findBy({ projectId })
    
    // Save files to VCS working_files
    for (const file of projectFiles) {
      await vcsService.saveFile(branch.id, projectId, null, file.name, file.type, file.xml, file.folderId)
    }
    
    // Create auto-commit
    await vcsService.commit(branch.id, userId, message)
    logger.info('Auto-committed folder change', { projectId, userId, message })
  } catch (error) {
    // Don't fail the main operation if VCS auto-commit fails
    logger.error('Failed to auto-commit folder change', { projectId, userId, error })
  }
}

const r = Router()

// Helpers
function rowString(row: any, key: string): string | null {
  const v = row?.[key]
  return v == null ? null : String(v)
}

 function ensureFileExtension(name: string, type: string | null | undefined): string {
   const t = String(type || '').trim()
   if (!t) return name
   const ext = `.${t}`
   return name.endsWith(ext) ? name : `${name}${ext}`
 }

function toFolderSummary(row: any) {
  return { id: String(row.id), name: String(row.name), parentFolderId: rowString(row, 'parent_folder_id') }
}

/**
 * Get breadcrumb trail for a folder
 * ✨ Migrated to TypeORM
 */
async function getBreadcrumb(folderId: string | null) {
  const bc: Array<{ id: string; name: string; parentFolderId: string | null }> = []
  let current = folderId
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);
  
  while (current) {
    const row = await folderRepo.findOne({
      where: { id: current },
      select: ['id', 'name', 'parentFolderId']
    });
    
    if (!row) break;
    bc.unshift({ id: String(row.id), name: String(row.name), parentFolderId: row.parentFolderId || null });
    current = row.parentFolderId || null;
  }
  return bc;
}

/**
 * Check if testId is a descendant of ancestorId (prevents cycles)
 * ✨ Migrated to TypeORM
 */
async function isDescendant(ancestorId: string, testId: string | null): Promise<boolean> {
  // Walk upward from testId to root; if we hit ancestorId, it's a cycle
  let current = testId;
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);
  
  while (current) {
    const row = await folderRepo.findOne({
      where: { id: current },
      select: ['parentFolderId']
    });
    
    if (!row) break;
    if (String(current) === String(ancestorId)) return true;
    current = row.parentFolderId || null;
  }
  return false;
}

/**
 * Collect all folders and files in a subtree (for deletion)
 * ✨ Migrated to TypeORM
 */
async function collectSubtree(rootId: string): Promise<{ folders: string[]; files: string[] }> {
  const foldersOut: string[] = [];
  const filesOut: string[] = [];
  const stack: string[] = [rootId];
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);
  const fileRepo = dataSource.getRepository(File);
  
  while (stack.length) {
    const fid = stack.pop() as string;
    foldersOut.push(fid);
    
    // Enqueue child folders
    const childFolders = await folderRepo.find({
      where: { parentFolderId: fid },
      select: ['id']
    });
    for (const row of childFolders) {
      stack.push(String(row.id));
    }
    
    // Collect files in this folder
    const folderFiles = await fileRepo.find({
      where: { folderId: fid },
      select: ['id']
    });
    for (const row of folderFiles) {
      filesOut.push(String(row.id));
    }
  }
  return { folders: foldersOut, files: filesOut };
}

/**
 * Build full path for a file (for ZIP archives)
 * ✨ Migrated to TypeORM
 */
async function buildPathForFile(folderId: string | null, fileName: string): Promise<string> {
  const parts: string[] = [fileName];
  let current = folderId;
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);
  
  while (current) {
    const row = await folderRepo.findOne({
      where: { id: current },
      select: ['name', 'parentFolderId']
    });
    
    if (!row) break;
    parts.unshift(String(row.name));
    current = row.parentFolderId || null;
  }
  return parts.join('/');
}

/**
 * GET project contents (folders + files) under optional parent folder
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/projects/:projectId/contents', apiLimiter, requireAuth, requireProjectAccess(), asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const folderId = typeof req.query?.folderId === 'string' ? String(req.query.folderId) : null;
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);
  const fileRepo = dataSource.getRepository(File);

  // Breadcrumb
  const breadcrumb = await getBreadcrumb(folderId);

  // Get folders in current location
  const foldersResult = await folderRepo.find({
    where: {
      projectId,
      parentFolderId: folderId ? folderId : IsNull()
    },
    order: { name: 'ASC' },
    select: ['id', 'name', 'parentFolderId', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt']
  });
  const foldersRes = foldersResult.map((r: any) => ({
    id: String(r.id),
    name: String(r.name),
    parentFolderId: r.parentFolderId ? String(r.parentFolderId) : null,
    createdBy: r.createdBy || null,
    updatedBy: r.updatedBy || null,
    createdAt: Number(r.createdAt),
    updatedAt: Number(r.updatedAt)
  }));

  // Get files in current location
  const filesResult = await fileRepo.find({
    where: {
      projectId,
      folderId: folderId ? folderId : IsNull()
    },
    order: { updatedAt: 'DESC' },
    select: ['id', 'name', 'type', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt']
  });
  const filesRes = filesResult.map((r: any) => ({
    id: String(r.id),
    name: String(r.name),
    type: String(r.type),
    createdBy: r.createdBy || null,
    updatedBy: r.updatedBy || null,
    createdAt: Number(r.createdAt),
    updatedAt: Number(r.updatedAt)
  }));

  // Debug log to see file types
  logger.info('Files in folder', { folderId, files: filesRes.map((f: { name: string; type: string }) => ({ name: f.name, type: f.type })) });

  res.json({ breadcrumb, folders: foldersRes, files: filesRes });
}));

/**
 * GET all folders for a project (flat list)
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/projects/:projectId/folders', apiLimiter, requireAuth, requireProjectAccess(), asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);
  
  const result = await folderRepo.find({
    where: { projectId },
    select: ['id', 'name', 'parentFolderId']
  });
  const out = result.map((r: any) => ({ id: String(r.id), name: String(r.name), parentFolderId: r.parentFolderId || null }));
  
  res.json(out);
}));

/**
 * POST create folder
 * ✨ Migrated to TypeORM
 */
r.post('/starbase-api/projects/:projectId/folders', apiLimiter, requireAuth, validateParams(projectIdParamSchema), validateBody(createFolderBodySchema), requireProjectRole(EDIT_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const userId = req.user!.userId;
  const { name, parentFolderId } = req.body;
  const parentFolderIdStr = parentFolderId || null;
  const trimmed = name.trim();

  const id = generateId();
  const now = unixTimestamp();
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);

  // Uniqueness (case-insensitive among siblings)
  const dupCheck = await folderRepo.find({
    where: {
      projectId,
      parentFolderId: parentFolderIdStr ? parentFolderIdStr : IsNull(),
      name: Raw(alias => `${caseInsensitiveColumn(alias)} = ${caseInsensitiveColumn(':name')}`, { name: trimmed })
    },
    select: ['id']
  });
  if (dupCheck.length > 0) throw Errors.validation('A folder with this name already exists here');

  await folderRepo.insert({
    id,
    projectId,
    parentFolderId: parentFolderIdStr,
    name: trimmed,
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now
  });

  // Auto-commit folder creation to VCS (async, non-blocking)
  autoCommitFolderChange(projectId, userId, `Created folder: ${trimmed}`).catch((err) => logger.debug('Auto-commit folder creation failed', { err }));

  res.status(201).json({ id, name: trimmed, parentFolderId: parentFolderIdStr, createdAt: now, updatedAt: now });
}));

/**
 * PATCH update (rename/move)
 * ✨ Migrated to TypeORM
 */
r.patch('/starbase-api/folders/:folderId', apiLimiter, requireAuth, validateParams(folderIdParamSchema), validateBody(renameFolderBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const { folderId } = req.params;
  const userId = req.user!.userId;
  const { name, parentFolderId } = req.body;
  const now = unixTimestamp();
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);

  // Verify user owns the project containing this folder
  // Read existing folder
  const row = await folderRepo.findOne({
    where: { id: folderId },
    select: ['id', 'projectId', 'parentFolderId', 'name']
  });
  if (!row) throw Errors.notFound('Folder', folderId);
  
  const projectId = String(row.projectId);

  const canEditProject = await projectMemberService.hasRole(
    projectId,
    userId,
    EDIT_ROLES
  )
  if (!canEditProject) throw Errors.notFound('Folder', folderId);

  const currentName = String(row.name);
  const currentParent = row.parentFolderId || null;

  if (name !== undefined && typeof name !== 'string') {
    throw Errors.validation('Folder name is required');
  }
  const newName = (typeof name === 'string' ? name : currentName).trim();
  const parentFolderIdStr = typeof parentFolderId === 'string' ? parentFolderId : null;
  const newParent = parentFolderId === undefined ? currentParent : parentFolderIdStr;

  // Prevent cycles
  if (await isDescendant(folderId, newParent)) {
    throw Errors.validation('Cannot move a folder into its descendant');
  }

  // Uniqueness among siblings
  const dupCheck = await folderRepo.createQueryBuilder('f')
    .where('f.projectId = :projectId', { projectId })
    .andWhere(newParent ? 'f.parentFolderId = :newParent' : 'f.parentFolderId IS NULL', { newParent })
    .andWhere(`${caseInsensitiveColumn('f.name')} = ${caseInsensitiveColumn(':newName')}`, { newName })
    .andWhere('f.id <> :folderId', { folderId })
    .select(['f.id'])
    .getMany();
  if (dupCheck.length > 0) throw Errors.validation('A folder with this name already exists here');

  await folderRepo.update({ id: folderId }, {
    name: newName,
    parentFolderId: newParent,
    updatedBy: userId,
    updatedAt: now
  });

  res.json({ id: folderId, name: newName, parentFolderId: newParent, updatedAt: now });
}));

/**
 * GET delete preview
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/folders/:folderId/delete-preview', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { folderId } = req.params;
  const userId = req.user!.userId;
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);
  const fileRepo = dataSource.getRepository(File);

  // Verify user owns the project containing this folder
  const folderRow = await folderRepo.findOne({
    where: { id: folderId },
    select: ['projectId']
  });
  if (!folderRow) throw Errors.notFound('Folder');
  const canEditProject = await projectMemberService.hasRole(
    String(folderRow.projectId),
    userId,
    EDIT_ROLES
  )
  if (!canEditProject) throw Errors.notFound('Folder');

  // Ensure exists
  await ResourceService.getFolderOrThrow(folderId);

  const subtree = await collectSubtree(folderId);
  
  // File type counts
  let bpmn = 0, dmn = 0, other = 0;
  for (const fid of subtree.files) {
    const fileResult = await fileRepo.findOne({
      where: { id: fid },
      select: ['type']
    });
    if (fileResult) {
      const ty = String(fileResult.type);
      if (ty === 'bpmn') bpmn++; else if (ty === 'dmn') dmn++; else other++;
    }
  }

  // Sample paths
  const samplePaths: string[] = [];
  for (const fid of subtree.folders.slice(0, 10)) {
    let current: string | null = fid;
    const parts: string[] = [];
    while (current) {
      const folderResult = await folderRepo.findOne({
        where: { id: current },
        select: ['name', 'parentFolderId']
      });
      if (!folderResult) break;
      parts.unshift(String(folderResult.name));
      current = folderResult.parentFolderId || null;
    }
    samplePaths.push(parts.join('/'));
  }

  res.json({ folderCount: subtree.folders.length, fileCount: subtree.files.length, filesByType: { bpmn, dmn, other }, samplePaths });
}));

/**
 * DELETE folder (cascade)
 * ✨ Migrated to TypeORM
 */
r.delete('/starbase-api/folders/:folderId', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { folderId } = req.params;
  const userId = req.user!.userId;
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);

  // Verify user owns the project containing this folder
  const ownerCheck = await folderRepo.findOne({
    where: { id: folderId },
    select: ['projectId', 'name']
  });
  if (!ownerCheck) throw Errors.notFound('Folder');
  const canEditProject = await projectMemberService.hasRole(
    String(ownerCheck.projectId),
    userId,
    EDIT_ROLES
  )
  if (!canEditProject) throw Errors.notFound('Folder');

  const { projectId, name: folderName } = ownerCheck;

  // Ensure exists
  await ResourceService.getFolderOrThrow(folderId);

  // Delete folder and all its contents using cascade delete service
  await CascadeDeleteService.deleteFolder(folderId);

  // Auto-commit folder deletion to VCS (async, non-blocking)
  autoCommitFolderChange(projectId, userId, `Deleted folder: ${folderName}`).catch((err) => logger.debug('Auto-commit folder deletion failed', { err }));

  res.status(204).end();
}));

/**
 * Download a folder (and its subtree) as a zip file
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/folders/:folderId/download', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { folderId } = req.params;
  const userId = req.user!.userId;
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);
  const fileRepo = dataSource.getRepository(File);

  // Verify user owns the project containing this folder
  const ownerCheck = await folderRepo.findOne({
    where: { id: folderId },
    select: ['projectId', 'name']
  });
  if (!ownerCheck) throw Errors.notFound('Folder');

  if (!(await AuthorizationService.verifyProjectAccess(String(ownerCheck.projectId), userId))) {
    throw Errors.notFound('Folder');
  }

  const folderName = String(ownerCheck.name || 'folder');
  const subtree = await collectSubtree(folderId);
  
  if (!subtree.files.length) {
    return res.status(204).end();
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${folderName.replace(/"/g, '')}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('warning', (err: any) => {
    logger.warn('ZIP archive warning', { folderId, err });
  });
  archive.on('error', (err: any) => {
    logger.error('ZIP archive error', { folderId, err });
    try {
      if (!res.headersSent) res.status(500).end();
      else res.end();
    } catch {}
  });
  res.on('close', () => {
    if (!res.writableEnded) {
      try { archive.abort(); } catch {}
    }
  });
  archive.pipe(res);

  for (const fid of subtree.files) {
    const fileResult = await fileRepo.findOne({
      where: { id: fid },
      select: ['name', 'type', 'folderId', 'xml']
    });
    if (!fileResult) continue;
    const fullPath = await buildPathForFile(fileResult.folderId || null, ensureFileExtension(String(fileResult.name), fileResult.type));
    archive.append(String(fileResult.xml || ''), { name: fullPath });
  }

  archive.finalize();
}));

/**
 * Download entire project as a zip (all folders/files)
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/projects/:projectId/download', apiLimiter, requireAuth, requireProjectAccess(), asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;

  const dataSource = await getDataSource();
  const fileRepo = dataSource.getRepository(File);
  const projectRepo = dataSource.getRepository(Project);
  
  const filesResult = await fileRepo.find({
    where: { projectId },
    select: ['id', 'name', 'type', 'folderId', 'xml']
  });
  
  const filesList = filesResult.map((r: any) => ({
    id: String(r.id),
    name: String(r.name),
    type: String(r.type),
    folderId: r.folderId || null,
    xml: String(r.xml || ''),
  }));

  if (!filesList.length) {
    return res.status(204).end();
  }

  const projResult = await projectRepo.findOne({
    where: { id: projectId },
    select: ['name']
  });
  const projectName = projResult ? String(projResult.name) : 'project';

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${projectName.replace(/"/g, '')}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('warning', (err: any) => {
    logger.warn('ZIP archive warning', { projectId, err });
  });
  archive.on('error', (err: any) => {
    logger.error('ZIP archive error', { projectId, err });
    try {
      if (!res.headersSent) res.status(500).end();
      else res.end();
    } catch {}
  });
  res.on('close', () => {
    if (!res.writableEnded) {
      try { archive.abort(); } catch {}
    }
  });
  archive.pipe(res);

  for (const f of filesList) {
    const fullPath = await buildPathForFile(f.folderId, ensureFileExtension(f.name, f.type));
    archive.append(f.xml, { name: fullPath });
  }

  archive.finalize();
}));

export default r;
