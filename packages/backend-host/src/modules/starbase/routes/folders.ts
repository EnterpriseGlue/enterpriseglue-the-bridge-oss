import { Router, Request, Response } from 'express'
import { generateId } from '@enterpriseglue/shared/utils/id.js'
import { caseInsensitiveColumn } from '@enterpriseglue/shared/db/adapters/QueryHelpers.js'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { requireProjectAccess, requireProjectRole } from '@enterpriseglue/shared/middleware/projectAuth.js'
import { raw } from 'express'
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js'
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js'
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js'
import { Project } from '@enterpriseglue/shared/db/entities/Project.js'
import { Folder } from '@enterpriseglue/shared/db/entities/Folder.js'
import { File } from '@enterpriseglue/shared/db/entities/File.js'
import { In, IsNull, Raw } from 'typeorm'
import archiver from 'archiver'
import { AuthorizationService } from '@enterpriseglue/shared/services/authorization.js'
import { ResourceService } from '@enterpriseglue/shared/services/resources.js'
import { CascadeDeleteService } from '@enterpriseglue/shared/services/cascade-delete.js'
import { vcsService } from '@enterpriseglue/shared/services/versioning/index.js'
import { logger } from '@enterpriseglue/shared/utils/logger.js'
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js'
import { applyProjectArchiveToProject } from '@enterpriseglue/shared/services/starbase/index.js'
import { EDIT_ROLES } from '@enterpriseglue/shared/constants/roles.js'
import { unixTimestamp } from '@enterpriseglue/shared/utils/id.js'
import { projectIdParamSchema, folderIdParamSchema, createFolderBodySchema, renameFolderBodySchema, uuidSchema } from '@enterpriseglue/shared/schemas/common.js'
import { z } from 'zod'

// Auto-commit helper for folder operations
async function autoCommitFolderChange(projectId: string, userId: string, message: string): Promise<void> {
  try {
    const branch = await vcsService.getUserBranch(projectId, userId)
    await vcsService.syncFromMainDb(projectId, userId, branch.id)
    await vcsService.commit(branch.id, userId, message, { source: 'system' })
    logger.info('Auto-committed folder change', { projectId, userId, message })
  } catch (error) {
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

function sanitizeArchivePathSegment(name: string, fallback: string): string {
  const cleaned = String(name || '')
    .replace(/[\u0000-\u001F\u007F]/g, '_')
    .replace(/[\\/]/g, '_')
    .replace(/[:*?"<>|]/g, '_')
    .trim()
    .slice(0, 200)

  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return fallback
  }

  return cleaned
}

async function buildPathForFolder(folderId: string): Promise<string> {
  const parts: string[] = []
  let current: string | null = folderId
  const dataSource = await getDataSource()
  const folderRepo = dataSource.getRepository(Folder)

  while (current) {
    const row = await folderRepo.findOne({
      where: { id: current },
      select: ['name', 'parentFolderId']
    })

    if (!row) break
    parts.unshift(sanitizeArchivePathSegment(String(row.name), 'folder'))
    current = row.parentFolderId || null
  }

  return parts.join('/')
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
  const parts: string[] = [sanitizeArchivePathSegment(fileName, 'file')];
  let current = folderId;
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);
  
  while (current) {
    const row = await folderRepo.findOne({
      where: { id: current },
      select: ['name', 'parentFolderId']
    });
    
    if (!row) break;
    parts.unshift(sanitizeArchivePathSegment(String(row.name), 'folder'));
    current = row.parentFolderId || null;
  }
  return parts.join('/');
}

type ArchiveScope = 'project' | 'folder' | 'selection'

type ArchiveFolderEntry = {
  id: string
  name: string
  parentFolderId: string | null
}

type ArchiveFileEntry = {
  id: string
  name: string
  type: string
  folderId: string | null
  xml: string
  bpmnProcessId?: string | null
  dmnDecisionId?: string | null
}

async function streamZipArchive(params: {
  res: Response
  downloadName: string
  projectId: string
  scope: ArchiveScope
  files: ArchiveFileEntry[]
  folders: ArchiveFolderEntry[]
  rootFolderId?: string | null
  selectedFileIds?: string[]
  selectedFolderIds?: string[]
}) {
  const { res, downloadName, projectId, scope, files, folders, rootFolderId = null, selectedFileIds = [], selectedFolderIds = [] } = params

  if (!files.length && !folders.length) {
    return res.status(204).end()
  }

  const safeDownloadName = sanitizeArchivePathSegment(downloadName, 'project')
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${safeDownloadName.replace(/"/g, '')}.zip"`)

  const archive = archiver('zip', { zlib: { level: 9 } })
  archive.on('warning', (err: any) => {
    logger.warn('ZIP archive warning', { projectId, scope, err })
  })
  archive.on('error', (err: any) => {
    logger.error('ZIP archive error', { projectId, scope, err })
    try {
      if (!res.headersSent) res.status(500).end()
      else res.end()
    } catch {}
  })
  res.on('close', () => {
    if (!res.writableEnded) {
      try { archive.abort() } catch {}
    }
  })
  archive.pipe(res)

  const folderEntries = await Promise.all(
    folders.map(async (folder) => ({
      id: folder.id,
      name: folder.name,
      parentFolderId: folder.parentFolderId,
      path: await buildPathForFolder(folder.id),
    }))
  )

  folderEntries
    .filter((folder) => folder.path)
    .sort((a, b) => a.path.localeCompare(b.path))
    .forEach((folder) => {
      archive.append('', { name: `${folder.path}/` })
    })

  const fileEntries = await Promise.all(
    files.map(async (file) => ({
      id: file.id,
      name: file.name,
      type: file.type,
      folderId: file.folderId,
      path: await buildPathForFile(file.folderId, ensureFileExtension(file.name, file.type)),
      xml: file.xml,
      bpmnProcessId: file.bpmnProcessId ?? null,
      dmnDecisionId: file.dmnDecisionId ?? null,
    }))
  )

  const manifest = {
    format: 'enterpriseglue.starbase.export',
    version: 1,
    exportedAt: new Date().toISOString(),
    scope,
    projectId,
    rootFolderId,
    selectedFileIds,
    selectedFolderIds,
    folders: folderEntries.map(({ id, name, parentFolderId, path }) => ({ id, name, parentFolderId, path })),
    files: fileEntries.map(({ id, name, type, folderId, path }) => ({ id, name, type, folderId, path })),
  }

  const legacyManifest = {
    schemaVersion: 1,
    projectName: safeDownloadName,
    exportedAt: unixTimestamp(),
    folders: folderEntries
      .filter((folder) => folder.path)
      .map(({ id, path }) => ({
        folderId: id,
        path,
      })),
    files: fileEntries.map(({ id, name, type, path, bpmnProcessId, dmnDecisionId }) => ({
      fileId: id,
      path,
      type: String(type).toLowerCase() === 'dmn' ? 'dmn' : 'bpmn',
      name,
      bpmnProcessId,
      dmnDecisionId,
    })),
  }

  archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: 'manifest.json' })
  archive.append(`${JSON.stringify(legacyManifest, null, 2)}\n`, { name: 'starbase-manifest.json' })
  archive.append(`${JSON.stringify(legacyManifest, null, 2)}\n`, { name: '.starbase/manifest.json' })

  fileEntries
    .sort((a, b) => a.path.localeCompare(b.path))
    .forEach((file) => {
      archive.append(file.xml, { name: file.path })
    })

  archive.finalize()
}

const downloadSelectionBodySchema = z.object({
  fileIds: z.array(uuidSchema).default([]),
  folderIds: z.array(uuidSchema).default([]),
})

/**
 * GET project contents (folders + files) under optional parent folder
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/projects/:projectId/contents', apiLimiter, requireAuth, requireProjectAccess(), asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
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
  const projectId = String(req.params.projectId);
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
  const projectId = String(req.params.projectId);
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
  const folderId = String(req.params.folderId);
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
  const folderId = String(req.params.folderId);
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
  const folderId = String(req.params.folderId);
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
  const folderId = String(req.params.folderId);
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

  const folders = subtree.folders.length
    ? (await folderRepo.find({
        where: { id: In(subtree.folders) },
        select: ['id', 'name', 'parentFolderId']
      })).map((folder) => ({
        id: String(folder.id),
        name: String(folder.name),
        parentFolderId: folder.parentFolderId || null,
      }))
    : []

  const files = subtree.files.length
    ? (await fileRepo.find({
        where: { id: In(subtree.files) },
        select: ['id', 'name', 'type', 'folderId', 'xml', 'bpmnProcessId', 'dmnDecisionId']
      })).map((file) => ({
        id: String(file.id),
        name: String(file.name),
        type: String(file.type),
        folderId: file.folderId || null,
        xml: String(file.xml || ''),
        bpmnProcessId: file.bpmnProcessId ? String(file.bpmnProcessId) : null,
        dmnDecisionId: file.dmnDecisionId ? String(file.dmnDecisionId) : null,
      }))
    : []

  if (files.length === 0) {
    return res.status(204).end()
  }

  return streamZipArchive({
    res,
    downloadName: folderName,
    projectId: String(ownerCheck.projectId),
    scope: 'folder',
    rootFolderId: folderId,
    selectedFolderIds: [folderId],
    files,
    folders,
  })
}));

/**
 * Download entire project as a zip (all folders/files)
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/projects/:projectId/download', apiLimiter, requireAuth, requireProjectAccess(), asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);

  const dataSource = await getDataSource();
  const fileRepo = dataSource.getRepository(File);
  const folderRepo = dataSource.getRepository(Folder);
  const projectRepo = dataSource.getRepository(Project);

  const files = (await fileRepo.find({
    where: { projectId },
    select: ['id', 'name', 'type', 'folderId', 'xml', 'bpmnProcessId', 'dmnDecisionId']
  })).map((r: any) => ({
    id: String(r.id),
    name: String(r.name),
    type: String(r.type),
    folderId: r.folderId || null,
    xml: String(r.xml || ''),
    bpmnProcessId: r.bpmnProcessId ? String(r.bpmnProcessId) : null,
    dmnDecisionId: r.dmnDecisionId ? String(r.dmnDecisionId) : null,
  }))

  const folders = (await folderRepo.find({
    where: { projectId },
    select: ['id', 'name', 'parentFolderId']
  })).map((r: any) => ({
    id: String(r.id),
    name: String(r.name),
    parentFolderId: r.parentFolderId || null,
  }))

  const projResult = await projectRepo.findOne({
    where: { id: projectId },
    select: ['name']
  });
  const projectName = projResult ? String(projResult.name) : 'project';

  return streamZipArchive({
    res,
    downloadName: projectName,
    projectId,
    scope: 'project',
    files,
    folders,
  })
}));

r.post('/starbase-api/projects/:projectId/import-zip', apiLimiter, requireAuth, raw({ type: ['application/zip', 'application/octet-stream'], limit: '25mb' }), validateParams(projectIdParamSchema), requireProjectRole(EDIT_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId)
  const userId = req.user!.userId
  const zipBuffer = Buffer.isBuffer(req.body)
    ? req.body
    : (req.body ? Buffer.from(req.body) : Buffer.alloc(0))

  if (zipBuffer.length === 0) {
    throw Errors.validation('ZIP archive is required')
  }

  const dataSource = await getDataSource()
  const result = await dataSource.transaction(async (manager) => {
    return applyProjectArchiveToProject({
      manager,
      projectId,
      userId,
      zipBuffer,
    })
  })

  res.status(201).json(result)
}))

r.post('/starbase-api/projects/:projectId/download-selection', apiLimiter, requireAuth, validateParams(projectIdParamSchema), validateBody(downloadSelectionBodySchema), requireProjectAccess(), asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId)
  const body = downloadSelectionBodySchema.parse(req.body)
  const fileIds = Array.from(new Set(body.fileIds.map((id) => String(id))))
  const folderIds = Array.from(new Set(body.folderIds.map((id) => String(id))))

  if (!fileIds.length && !folderIds.length) {
    throw Errors.validation('Select at least one file or folder to download')
  }

  const dataSource = await getDataSource()
  const fileRepo = dataSource.getRepository(File)
  const folderRepo = dataSource.getRepository(Folder)
  const projectRepo = dataSource.getRepository(Project)

  const selectedFolders = folderIds.length
    ? await folderRepo.find({
        where: { projectId, id: In(folderIds) },
        select: ['id', 'name', 'parentFolderId']
      })
    : []
  if (selectedFolders.length !== folderIds.length) {
    throw Errors.validation('One or more selected folders could not be downloaded')
  }

  const folderIdSet = new Set<string>(selectedFolders.map((folder) => String(folder.id)))
  const fileIdSet = new Set<string>(fileIds)

  for (const folder of selectedFolders) {
    const subtree = await collectSubtree(String(folder.id))
    subtree.folders.forEach((id) => folderIdSet.add(String(id)))
    subtree.files.forEach((id) => fileIdSet.add(String(id)))
  }

  const files = fileIdSet.size
    ? (await fileRepo.find({
        where: { projectId, id: In(Array.from(fileIdSet)) },
        select: ['id', 'name', 'type', 'folderId', 'xml', 'bpmnProcessId', 'dmnDecisionId']
      })).map((file) => ({
        id: String(file.id),
        name: String(file.name),
        type: String(file.type),
        folderId: file.folderId || null,
        xml: String(file.xml || ''),
        bpmnProcessId: file.bpmnProcessId ? String(file.bpmnProcessId) : null,
        dmnDecisionId: file.dmnDecisionId ? String(file.dmnDecisionId) : null,
      }))
    : []

  if (files.length !== fileIdSet.size) {
    throw Errors.validation('One or more selected files could not be downloaded')
  }

  const folders = folderIdSet.size
    ? (await folderRepo.find({
        where: { projectId, id: In(Array.from(folderIdSet)) },
        select: ['id', 'name', 'parentFolderId']
      })).map((folder) => ({
        id: String(folder.id),
        name: String(folder.name),
        parentFolderId: folder.parentFolderId || null,
      }))
    : []

  if (folders.length !== folderIdSet.size) {
    throw Errors.validation('One or more selected folders could not be downloaded')
  }

  const projectRow = await projectRepo.findOne({
    where: { id: projectId },
    select: ['name']
  })
  const projectName = projectRow ? String(projectRow.name) : 'project'

  return streamZipArchive({
    res,
    downloadName: `${projectName}-selection`,
    projectId,
    scope: 'selection',
    selectedFileIds: fileIds,
    selectedFolderIds: folderIds,
    files,
    folders,
  })
}))

export default r;
