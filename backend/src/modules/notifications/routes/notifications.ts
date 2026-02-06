import { Router } from 'express';
import { z } from 'zod';
import { IsNull } from 'typeorm';
import { requireAuth } from '@shared/middleware/auth.js';
import { notificationsLimiter } from '@shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { validateBody } from '@shared/middleware/validate.js';
import { getDataSource } from '@shared/db/data-source.js';
import { Notification } from '@shared/db/entities/Notification.js';

const router = Router();

const createNotificationSchema = z.object({
  state: z.enum(['success', 'info', 'warning', 'error']),
  title: z.string().min(1),
  subtitle: z.string().optional().nullable(),
});

router.get('/api/notifications', requireAuth, notificationsLimiter, asyncHandler(async (req, res) => {
  const dataSource = await getDataSource();
  const notificationRepo = dataSource.getRepository(Notification);
  const userId = req.user!.userId;
  const tenantId = req.tenant?.tenantId || null;

  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
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

router.patch('/api/notifications/read', requireAuth, notificationsLimiter, asyncHandler(async (req, res) => {
  const dataSource = await getDataSource();
  const notificationRepo = dataSource.getRepository(Notification);
  const userId = req.user!.userId;
  const tenantId = req.tenant?.tenantId || null;
  const now = Date.now();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : null;

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

router.delete('/api/notifications/:id', requireAuth, notificationsLimiter, asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) throw Errors.validation('Notification id is required');

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
