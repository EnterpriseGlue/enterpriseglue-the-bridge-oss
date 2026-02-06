import { Router, Request, Response } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { generateId } from '@shared/utils/id.js';
import { z } from 'zod';
import { requireAuth } from '@shared/middleware/auth.js';
import { requireFileAccess } from '@shared/middleware/projectAuth.js';
import { validateParams } from '@shared/middleware/validate.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { getDataSource } from '@shared/db/data-source.js';
import { Version } from '@shared/db/entities/Version.js';
import { File } from '@shared/db/entities/File.js';
import { AuthorizationService } from '@shared/services/authorization.js';
import { unixTimestamp } from '@shared/utils/id.js';

const fileIdParamSchema = z.object({ fileId: z.string().uuid() });
const versionIdParamSchema = z.object({ fileId: z.string().uuid(), versionId: z.string().uuid() });

const r = Router();

/**
 * List versions for a file (seed an initial version if none)
 */
r.get('/starbase-api/files/:fileId/versions', apiLimiter, requireAuth, validateParams(fileIdParamSchema), requireFileAccess(), asyncHandler(async (req: Request, res: Response) => {
  const { fileId } = req.params;
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
  
  res.json(rows.map((row) => ({
    id: row.id,
    author: row.author || 'unknown',
    message: row.message || '',
    createdAt: Number(row.createdAt),
  })));
}));

/**
 * Very simple compare endpoint placeholder
 */
r.get('/starbase-api/versions/:versionId/compare/:otherVersionId', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { versionId, otherVersionId } = req.params;
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
