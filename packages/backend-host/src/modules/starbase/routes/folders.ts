import { Router, Request, Response } from 'express'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js'
import { raw } from 'express'
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js'
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js'
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js'
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js'
import { Folder } from '@enterpriseglue/shared/infrastructure/persistence/entities/Folder.js'
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js'
import { In, IsNull } from 'typeorm'
import archiver from 'archiver'
import { ResourceService } from '@enterpriseglue/shared/services/resources.js'
import { CascadeDeleteService } from '@enterpriseglue/shared/services/cascade-delete.js'
import { logger } from '@enterpriseglue/shared/utils/logger.js'
import { applyProjectArchiveToProject } from '@enterpriseglue/shared/services/starbase/index.js'
import { unixTimestamp } from '@enterpriseglue/shared/utils/id.js'
import { projectIdParamSchema, folderIdParamSchema, uuidSchema } from '@enterpriseglue/shared/schemas/common.js'
import { CreateFolderRequest, FolderSummarySchema, FolderListResponseSchema, FolderDeletePreviewSchema, UpdateFolderRequest, ProjectArchiveImportResponseSchema, CreateFolderResponseSchema, UpdateFolderResponseSchema } from '@enterpriseglue/shared/schemas/starbase/folder.js'
import { buildStarbaseFileName, sanitizeFileNameSegment } from '@enterpriseglue/shared/utils/starbase-filenames.js'
import { folderService } from '@enterpriseglue/shared/services/starbase/FolderService.js'
import { readFolderAncestors, collectProjectFolderSubtree, lockFolderProject } from '@enterpriseglue/shared/services/starbase/folder-tree.js'
import { z } from 'zod'

const r = Router()

// Helpers
function rowString(row: any, key: string): string | null {
  const v = row?.[key]
  return v == null ? null : String(v)
}

// Archive path-segment helpers are provided by the shared
// `@enterpriseglue/shared/utils/starbase-filenames` module so that ZIP entry
// names stay consistent with individual-file downloads and future export
// formats. See packages/shared/src/utils/starbase-filenames.ts for rules.
function sanitizeArchivePathSegment(name: string, fallback: string): string {
  return sanitizeFileNameSegment(name, fallback)
}

async function getBreadcrumb(projectId: string, folderId: string | null) {
  const dataSource = await getDataSource();
  return (await readFolderAncestors(dataSource, projectId, folderId)).map(row => ({ id: row.id, name: row.name, parentFolderId: row.parentFolderId }));
}

async function buildPathForFolder(projectId: string, folderId: string): Promise<string> {
  return (await getBreadcrumb(projectId, folderId)).map(row => sanitizeArchivePathSegment(row.name, 'folder')).join('/');
}

async function collectSubtree(projectId: string, rootId: string): Promise<{ folders: string[]; files: string[] }> {
  return collectProjectFolderSubtree(await getDataSource(), projectId, rootId);
}

async function buildPathForFile(projectId: string, folderId: string | null, fileName: string): Promise<string> {
  const parts = (await getBreadcrumb(projectId, folderId)).map(row => sanitizeArchivePathSegment(row.name, 'folder'));
  return [...parts, sanitizeArchivePathSegment(fileName, 'file')].join('/');
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

  const folderEntries = await Promise.all(
    folders.map(async (folder) => ({
      id: folder.id,
      name: folder.name,
      parentFolderId: folder.parentFolderId,
      path: await buildPathForFolder(projectId, folder.id),
    }))
  )

  const fileEntries = await Promise.all(
    files.map(async (file) => ({
      id: file.id,
      name: file.name,
      type: file.type,
      folderId: file.folderId,
      path: await buildPathForFile(projectId, file.folderId, buildStarbaseFileName(file.name, file.type)),
      xml: file.xml,
      bpmnProcessId: file.bpmnProcessId ?? null,
      dmnDecisionId: file.dmnDecisionId ?? null,
    }))
  )

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

  folderEntries
    .filter((folder) => folder.path)
    .sort((a, b) => a.path.localeCompare(b.path))
    .forEach((folder) => {
      archive.append('', { name: `${folder.path}/` })
    })

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
r.get('/starbase-api/projects/:projectId/contents', apiLimiter, requireAuth, requireAction('project.files.read', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const folderId = typeof req.query?.folderId === 'string' ? String(req.query.folderId) : null;
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);
  const fileRepo = dataSource.getRepository(File);

  // Breadcrumb
  const breadcrumb = await getBreadcrumb(projectId, folderId);

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
r.get('/starbase-api/projects/:projectId/folders', apiLimiter, requireAuth, requireAction('project.files.read', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);
  
  const result = await folderRepo.find({
    where: { projectId },
    select: ['id', 'name', 'parentFolderId']
  });
  const out = result.map((r: any) => ({ id: String(r.id), name: String(r.name), parentFolderId: r.parentFolderId || null }));
  
  res.json(FolderListResponseSchema.parse(out));
}));

/**
 * POST create folder
 * ✨ Migrated to TypeORM
 */
r.post('/starbase-api/projects/:projectId/folders', apiLimiter, requireAuth, validateParams(projectIdParamSchema), validateBody(CreateFolderRequest), requireAction('project.files.create', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const result = await folderService.create({ ...req.body, projectId: String(req.params.projectId), userId: req.user!.userId });
  res.status(201).json(CreateFolderResponseSchema.parse(result));
}));

/**
 * PATCH update (rename/move)
 * ✨ Migrated to TypeORM
 */
r.patch('/starbase-api/folders/:folderId', apiLimiter, requireAuth, validateParams(folderIdParamSchema), validateBody(UpdateFolderRequest), requireAction('project.files.update', { resourceResolver: 'project.byFolderId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const result = await folderService.rename({ ...req.body, folderId: String(req.params.folderId), userId: req.user!.userId });
  res.json(UpdateFolderResponseSchema.parse(result));
}));

/**
 * GET delete preview
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/folders/:folderId/delete-preview', apiLimiter, requireAuth, requireAction('project.files.delete', { resourceResolver: 'project.byFolderId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const folderId = String(req.params.folderId);
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);
  const fileRepo = dataSource.getRepository(File);

  // Ensure exists
  const root = await folderRepo.findOne({ where: { id: folderId }, select: ['id', 'projectId'] });
  if (!root) throw Errors.notFound('Folder');
  const projectId = root.projectId;
  const subtree = await collectSubtree(projectId, folderId);
  
  // File type counts
  let bpmn = 0, dmn = 0, other = 0;
  for (const fid of subtree.files) {
    const fileResult = await fileRepo.findOne({
      where: { id: fid, projectId },
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
    const parts = (await getBreadcrumb(projectId, fid)).map(row => row.name);
    samplePaths.push(parts.join('/'));
  }

  res.json(FolderDeletePreviewSchema.parse({ folderCount: subtree.folders.length, fileCount: subtree.files.length, filesByType: { bpmn, dmn, other }, samplePaths }));
}));

/**
 * DELETE folder (cascade)
 * ✨ Migrated to TypeORM
 */
r.delete('/starbase-api/folders/:folderId', apiLimiter, requireAuth, requireAction('project.files.delete', { resourceResolver: 'project.byFolderId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
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

  const { projectId, name: folderName } = ownerCheck;

  // Ensure exists
  await ResourceService.getFolderOrThrow(folderId);

  // Delete folder and all its contents using cascade delete service
  await CascadeDeleteService.deleteFolder(folderId, projectId);

  res.status(204).end();
}));

/**
 * Download a folder (and its subtree) as a zip file
 * ✨ Migrated to TypeORM
 */
r.get('/starbase-api/folders/:folderId/download', apiLimiter, requireAuth, requireAction('project.files.read', { resourceResolver: 'project.byFolderId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
  const folderId = String(req.params.folderId);
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);
  const fileRepo = dataSource.getRepository(File);

  // Verify user owns the project containing this folder
  const ownerCheck = await folderRepo.findOne({
    where: { id: folderId },
    select: ['projectId', 'name']
  });
  if (!ownerCheck) throw Errors.notFound('Folder');

  const folderName = String(ownerCheck.name || 'folder');
  const subtree = await collectSubtree(String(ownerCheck.projectId), folderId);

  const folders = subtree.folders.length
    ? (await folderRepo.find({
        where: { projectId: String(ownerCheck.projectId), id: In(subtree.folders) },
        select: ['id', 'name', 'parentFolderId']
      })).map((folder) => ({
        id: String(folder.id),
        name: String(folder.name),
        parentFolderId: folder.parentFolderId || null,
      }))
    : []

  const files = subtree.files.length
    ? (await fileRepo.find({
        where: { projectId: String(ownerCheck.projectId), id: In(subtree.files) },
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
r.get('/starbase-api/projects/:projectId/download', apiLimiter, requireAuth, requireAction('project.files.read', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
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

r.post('/starbase-api/projects/:projectId/import-zip', apiLimiter, requireAuth, raw({ type: ['application/zip', 'application/octet-stream'], limit: '25mb' }), validateParams(projectIdParamSchema), requireAction('project.files.create', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
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
    await lockFolderProject(manager, projectId);
    return ProjectArchiveImportResponseSchema.parse(await applyProjectArchiveToProject({
      manager,
      projectId,
      userId,
      zipBuffer,
    }))
  })

  res.status(201).json(result)
}))

r.post('/starbase-api/projects/:projectId/download-selection', apiLimiter, requireAuth, validateParams(projectIdParamSchema), validateBody(downloadSelectionBodySchema), requireAction('project.files.read', { resourceResolver: 'project.byId', resourceIdFrom: 'params' }), asyncHandler(async (req: Request, res: Response) => {
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
    const subtree = await collectSubtree(projectId, String(folder.id))
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
