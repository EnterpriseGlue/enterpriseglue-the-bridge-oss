import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { z } from 'zod';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireFileAccess } from '@enterpriseglue/shared/middleware/projectAuth.js';
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Version } from '@enterpriseglue/shared/db/entities/Version.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { AuthorizationService } from '@enterpriseglue/shared/services/authorization.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { EDIT_ROLES } from '@enterpriseglue/shared/constants/roles.js';
import { unixTimestamp, unixTimestampMs } from '@enterpriseglue/shared/utils/id.js';

const fileIdParamSchema = z.object({ fileId: z.string().uuid() });
const versionIdParamSchema = z.object({ fileId: z.string().uuid(), versionId: z.string().uuid() });
const createVersionBodySchema = z.object({
  message: z.string().max(500).optional(),
});

const r = Router();

/**
 * List versions for a file (seed an initial version if none)
 */
r.get('/starbase-api/files/:fileId/versions', apiLimiter, requireAuth, validateParams(fileIdParamSchema), requireFileAccess(), asyncHandler(async (req: Request, res: Response) => {
  const fileId = String(req.params.fileId);
  const dataSource = await getDataSource();
  const versionRepo = dataSource.getRepository(Version);
  const fileRepo = dataSource.getRepository(File);

  // Check if versions exist
  const versionCount = await versionRepo.count({ where: { fileId } });

  // Seed if no versions
  if (versionCount === 0) {
    const file = await fileRepo.findOne({
      where: { id: fileId },
      select: ['xml'],
    });
    
    if (file) {
      const now = unixTimestamp();
      await versionRepo.insert({
        id: generateId(),
        fileId,
        author: 'system',
        message: 'Initial import',
        xml: file.xml,
        createdAt: now
      });
    }
  }

  // Get all versions for the file
  const rows = await versionRepo.find({
    where: { fileId },
    select: ['id', 'author', 'message', 'createdAt'],
    order: { createdAt: 'DESC' },
  });
  
  res.json(rows.map((row: Version) => ({
    id: row.id,
    author: row.author || 'unknown',
    message: row.message || '',
    createdAt: Number(row.createdAt),
  })));
}));

r.post('/starbase-api/files/:fileId/versions', apiLimiter, requireAuth, validateParams(fileIdParamSchema), validateBody(createVersionBodySchema), requireFileAccess(), asyncHandler(async (req: Request, res: Response) => {
  const fileId = String(req.params.fileId);
  const userId = req.user!.userId;
  const dataSource = await getDataSource();
  const versionRepo = dataSource.getRepository(Version);
  const fileRepo = dataSource.getRepository(File);
  const file = await fileRepo.findOne({
    where: { id: fileId },
    select: ['id', 'projectId', 'xml'],
  });

  if (!file) {
    throw Errors.notFound('File');
  }

  const canEditFile = await projectMemberService.hasRole(String(file.projectId), userId, EDIT_ROLES);
  if (!canEditFile) {
    throw Errors.notFound('File');
  }

  const now = unixTimestampMs();
  const message = String(req.body?.message || '').trim();
  const id = generateId();

  await versionRepo.insert({
    id,
    fileId,
    author: userId,
    message,
    xml: file.xml,
    createdAt: now,
  });

  res.status(201).json({
    id,
    author: userId,
    message,
    createdAt: now,
  });
}));

r.get('/starbase-api/files/:fileId/versions/:versionId', apiLimiter, requireAuth, validateParams(versionIdParamSchema), requireFileAccess(), asyncHandler(async (req: Request, res: Response) => {
  const fileId = String(req.params.fileId);
  const versionId = String(req.params.versionId);
  const dataSource = await getDataSource();
  const versionRepo = dataSource.getRepository(Version);

  const row = await versionRepo.findOne({
    where: { id: versionId, fileId },
    select: ['id', 'fileId', 'author', 'message', 'xml', 'createdAt'],
  });

  if (!row) {
    throw Errors.notFound('Version');
  }

  res.json({
    id: row.id,
    fileId: row.fileId,
    author: row.author || 'unknown',
    message: row.message || '',
    xml: row.xml,
    createdAt: Number(row.createdAt),
  });
}));

r.post('/starbase-api/files/:fileId/versions/:versionId/restore', apiLimiter, requireAuth, validateParams(versionIdParamSchema), requireFileAccess(), asyncHandler(async (req: Request, res: Response) => {
  const fileId = String(req.params.fileId);
  const versionId = String(req.params.versionId);
  const userId = req.user!.userId;
  const dataSource = await getDataSource();
  const versionRepo = dataSource.getRepository(Version);
  const fileRepo = dataSource.getRepository(File);

  const [file, version] = await Promise.all([
    fileRepo.findOne({
      where: { id: fileId },
      select: ['id', 'projectId'],
    }),
    versionRepo.findOne({
      where: { id: versionId, fileId },
      select: ['id', 'fileId', 'message', 'xml'],
    }),
  ]);

  if (!file) {
    throw Errors.notFound('File');
  }

  if (!version) {
    throw Errors.notFound('Version');
  }

  const canEditFile = await projectMemberService.hasRole(String(file.projectId), userId, EDIT_ROLES);
  if (!canEditFile) {
    throw Errors.notFound('File');
  }

  const updatedAt = unixTimestamp();
  const versionCreatedAt = unixTimestampMs();

  await fileRepo.update(
    { id: fileId },
    {
      xml: version.xml,
      updatedAt,
    }
  );

  await versionRepo.insert({
    id: generateId(),
    fileId,
    author: userId,
    message: `Restored from ${String(version.message || '').trim() || `version ${versionId.substring(0, 8)}`}`,
    xml: version.xml,
    createdAt: versionCreatedAt,
  });

  res.json({
    restored: true,
    fileId,
    versionId,
    updatedAt,
  });
}));

/**
 * Very simple compare endpoint placeholder
 */
r.get('/starbase-api/versions/:versionId/compare/:otherVersionId', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const versionId = String(req.params.versionId);
  const otherVersionId = String(req.params.otherVersionId);
  const userId = req.user!.userId;
  const dataSource = await getDataSource();
  const versionRepo = dataSource.getRepository(Version);
  
  // Helper to read a version with XML length
  const readVersion = async (id: string) => {
    const result = await versionRepo.createQueryBuilder('v')
      .select(['v.id', 'v.fileId', 'v.createdAt'])
      .addSelect('LENGTH(v.xml)', 'xmlLen')
      .where('v.id = :id', { id })
      .getRawOne();
    
    return result || null;
  };
  
  const a = await readVersion(versionId);
  const b = await readVersion(otherVersionId);
  
  if (!a || !b) throw Errors.notFound('Version');

  if (!(await AuthorizationService.verifyFileAccess(String(a.v_fileId || a.fileId), userId))) {
    throw Errors.notFound('Version');
  }
  if (!(await AuthorizationService.verifyFileAccess(String(b.v_fileId || b.fileId), userId))) {
    throw Errors.notFound('Version');
  }
  
  res.json({
    a: { id: a.v_id || a.id, fileId: a.v_fileId || a.fileId, createdAt: Number(a.v_createdAt || a.createdAt), xmlLength: Number(a.xmlLen) },
    b: { id: b.v_id || b.id, fileId: b.v_fileId || b.fileId, createdAt: Number(b.v_createdAt || b.createdAt), xmlLength: Number(b.xmlLen) },
    // Placeholder: length diff only
    lengthDelta: Number(a.xmlLen) - Number(b.xmlLen),
  });
}));

export default r;
