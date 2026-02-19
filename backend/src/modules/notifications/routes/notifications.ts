import { Router } from 'express';
import { z } from 'zod';
import { IsNull } from 'typeorm';
import { requireAuth } from '@shared/middleware/auth.js';
import { notificationsLimiter } from '@shared/middleware/rateLimiter.js';
import { asyncHandler } from '@shared/middleware/errorHandler.js';
import { validateBody, validateParams, validateQuery } from '@shared/middleware/validate.js';
import { getDataSource } from '@shared/db/data-source.js';
import { Notification } from '@shared/db/entities/Notification.js';

const router = Router();

const createNotificationSchema = z.object({
  state: z.enum(['success', 'info', 'warning', 'error']),
  title: z.string().min(1),
  subtitle: z.string().optional().nullable(),
});

const notificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  unread: z.string().optional(),
  state: z.string().optional(),
});

const markNotificationsReadSchema = z.object({
  ids: z.array(z.string().min(1)).optional(),
});

const notificationIdParamSchema = z.object({
  id: z.string().min(1),
});

router.get('/api/notifications', requireAuth, notificationsLimiter, validateQuery(notificationsQuerySchema), asyncHandler(async (req, res) => {
  const dataSource = await getDataSource();
  const notificationRepo = dataSource.getRepository(Notification);
  const userId = req.user!.userId;
  const tenantId = req.tenant?.tenantId || null;

  const limit = Number(req.query.limit);
  const offset = Number(req.query.offset);
  const unread = String(req.query.unread || '').toLowerCase();
  const unreadOnly = unread === 'true' || unread === '1';
  const stateParam = String(req.query.state || '').trim();
  const states = stateParam
    ? stateParam.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const cutoff = Date.now() - 5 * 24 * 60 * 60 * 1000;
  await notificationRepo
    .createQueryBuilder()
    .delete()
    .where('createdAt < :cutoff', { cutoff })
    .execute();

  const qb = notificationRepo
    .createQueryBuilder('n')
    .where('n.userId = :userId', { userId })
    .orderBy('n.createdAt', 'DESC')
    .skip(offset)
    .take(limit);

  if (tenantId) {
    qb.andWhere('n.tenantId = :tenantId', { tenantId });
  }

  if (states.length > 0) {
    qb.andWhere('n.state IN (:...states)', { states });
  }

  if (unreadOnly) {
    qb.andWhere('n.readAt IS NULL');
  }

  const [rows, total] = await qb.getManyAndCount();

  const unreadCount = await notificationRepo.count({
    where: {
      userId,
      ...(tenantId ? { tenantId } : {}),
      readAt: IsNull(),
    },
  });

  res.json({
    notifications: rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      tenantId: row.tenantId,
      state: row.state,
      title: row.title,
      subtitle: row.subtitle,
      readAt: row.readAt,
      createdAt: row.createdAt,
    })),
    total,
    unreadCount,
  });
}));

router.post('/api/notifications', requireAuth, notificationsLimiter, validateBody(createNotificationSchema), asyncHandler(async (req, res) => {
  const dataSource = await getDataSource();
  const notificationRepo = dataSource.getRepository(Notification);
  const userId = req.user!.userId;
  const tenantId = req.tenant?.tenantId || null;
  const now = Date.now();

  const notification = notificationRepo.create({
    userId,
    tenantId,
    state: req.body.state,
    title: req.body.title,
    subtitle: req.body.subtitle ?? null,
    readAt: null,
    createdAt: now,
  });

  const saved = await notificationRepo.save(notification);

  res.status(201).json({
    id: saved.id,
    userId: saved.userId,
    tenantId: saved.tenantId,
    state: saved.state,
    title: saved.title,
    subtitle: saved.subtitle,
    readAt: saved.readAt,
    createdAt: saved.createdAt,
  });
}));

router.patch('/api/notifications/read', requireAuth, notificationsLimiter, validateBody(markNotificationsReadSchema), asyncHandler(async (req, res) => {
  const dataSource = await getDataSource();
  const notificationRepo = dataSource.getRepository(Notification);
  const userId = req.user!.userId;
  const tenantId = req.tenant?.tenantId || null;
  const now = Date.now();
  const ids = req.body.ids?.filter(Boolean) ?? null;

  const qb = notificationRepo
    .createQueryBuilder()
    .update(Notification)
    .set({ readAt: now })
    .where('userId = :userId', { userId });

  if (tenantId) {
    qb.andWhere('tenantId = :tenantId', { tenantId });
  }

  if (ids && ids.length > 0) {
    qb.andWhere('id IN (:...ids)', { ids });
  }

  const result = await qb.execute();

  res.json({ updated: result.affected || 0 });
}));

router.delete('/api/notifications', requireAuth, notificationsLimiter, asyncHandler(async (req, res) => {
  const dataSource = await getDataSource();
  const notificationRepo = dataSource.getRepository(Notification);
  const userId = req.user!.userId;
  const tenantId = req.tenant?.tenantId || null;

  const qb = notificationRepo
    .createQueryBuilder()
    .delete()
    .where('userId = :userId', { userId });

  if (tenantId) {
    qb.andWhere('tenantId = :tenantId', { tenantId });
  }

  const result = await qb.execute();

  res.json({ deleted: result.affected || 0 });
}));

router.delete('/api/notifications/:id', requireAuth, notificationsLimiter, validateParams(notificationIdParamSchema), asyncHandler(async (req, res) => {
  const id = req.params.id;

  const dataSource = await getDataSource();
  const notificationRepo = dataSource.getRepository(Notification);
  const userId = req.user!.userId;
  const tenantId = req.tenant?.tenantId || null;

  const qb = notificationRepo
    .createQueryBuilder()
    .delete()
    .where('id = :id', { id })
    .andWhere('userId = :userId', { userId });

  if (tenantId) {
    qb.andWhere('tenantId = :tenantId', { tenantId });
  }

  const result = await qb.execute();

  res.json({ deleted: result.affected || 0 });
}));

export default router;
