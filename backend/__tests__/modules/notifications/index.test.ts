import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../packages/backend-host/src/modules/notifications/routes/notifications.js', () => ({
  __esModule: true,
  default: vi.fn(),
  createNotificationsRouter: vi.fn(),
}));

describe('notifications module index', () => {
  it('exports notifications route', async () => {
    const notificationsModule = await import('../../../../packages/backend-host/src/modules/notifications/index.js');

    expect(notificationsModule).toHaveProperty('notificationsRoute');
  });

  it('exports notifications router factory', async () => {
    const notificationsModule = await import('../../../../packages/backend-host/src/modules/notifications/index.js');

    expect(notificationsModule).toHaveProperty('createNotificationsRouter');
  });
});
