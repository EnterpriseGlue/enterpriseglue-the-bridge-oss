import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import notificationsRouter from '../../../src/modules/notifications/routes/notifications.js';
import { getDataSource } from '../../../src/shared/db/data-source.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    req.tenant = { tenantId: null };
    next();
  },
}));

vi.mock('@shared/middleware/validate.js', () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
}));

describe('notifications module', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(notificationsRouter);
    vi.clearAllMocks();
  });

  it('returns notifications list and unread count', async () => {
    const qb = {
      delete: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({}),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    };
    const notificationRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      count: vi.fn().mockResolvedValue(0),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => notificationRepo,
    });

    const response = await request(app).get('/api/notifications');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(0);
    expect(response.body.unreadCount).toBe(0);
    expect(response.body.notifications).toEqual([]);
  });

  it('creates a notification', async () => {
    const qb = {
      delete: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({}),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    };
    const notificationRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockReturnValue({
        id: 'notif-1',
        userId: 'user-1',
        tenantId: null,
        state: 'info',
        title: 'Hello',
        subtitle: null,
        readAt: null,
        createdAt: 123,
      }),
      save: vi.fn().mockResolvedValue({
        id: 'notif-1',
        userId: 'user-1',
        tenantId: null,
        state: 'info',
        title: 'Hello',
        subtitle: null,
        readAt: null,
        createdAt: 123,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => notificationRepo,
    });

    const response = await request(app)
      .post('/api/notifications')
      .send({ state: 'info', title: 'Hello' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: 'notif-1',
      state: 'info',
      title: 'Hello',
    });
  });
});
