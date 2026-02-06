import { Router, Request, Response } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { asyncHandler } from '@shared/middleware/errorHandler.js';
import { generateId } from '@shared/utils/id.js';
import { z } from 'zod';
import { requireAuth } from '@shared/middleware/auth.js';
import { requireFileAccess } from '@shared/middleware/projectAuth.js';
import { validateParams } from '@shared/middleware/validate.js';
import { getDataSource } from '@shared/db/data-source.js';
import { Comment } from '@shared/db/entities/Comment.js';
import { unixTimestamp } from '@shared/utils/id.js';

const fileIdParamSchema = z.object({ fileId: z.string().uuid() });

const r = Router();

/**
 * List comments for a file (seed a couple if none)
 */
r.get('/starbase-api/files/:fileId/comments', apiLimiter, requireAuth, validateParams(fileIdParamSchema), requireFileAccess(), asyncHandler(async (req: Request, res: Response) => {
  const { fileId } = req.params;
  const dataSource = await getDataSource();
  const commentRepo = dataSource.getRepository(Comment);

  // Check if comments exist
  const commentCount = await commentRepo.count({ where: { fileId } });

  // Seed if empty
  if (commentCount === 0) {
    const now = unixTimestamp();
    await commentRepo.insert([
      {
        id: generateId(),
        fileId,
        author: 'system',
        message: 'Initial comment stub',
        createdAt: now
      },
      {
        id: generateId(),
        fileId,
        author: 'hary',
        message: 'Looks good for now',
        createdAt: now
      }
    ]);
  }

  // Get all comments for the file
  const rows = await commentRepo.find({
    where: { fileId },
    select: ['id', 'author', 'message', 'createdAt'],
    order: { createdAt: 'DESC' },
  });

  res.json(
    rows.map((row) => ({
      id: row.id,
      author: row.author || 'unknown',
      message: row.message || '',
      createdAt: Number(row.createdAt),
    }))
  );
}));

export default r;
