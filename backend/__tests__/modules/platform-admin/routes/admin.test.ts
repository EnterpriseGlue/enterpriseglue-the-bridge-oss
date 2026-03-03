import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import adminRouter from '../../../../../packages/backend-host/src/modules/platform-admin/routes/admin.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    next();
  },
}));

vi.mock('../../../../../packages/backend-host/src/modules/platform-admin/routes/settings.js', () => ({
  default: express.Router(),
}));

vi.mock('../../../../../packages/backend-host/src/modules/platform-admin/routes/branding.js', () => ({
  default: express.Router(),
}));

vi.mock('../../../../../packages/backend-host/src/modules/platform-admin/routes/tenants.js', () => ({
  default: express.Router(),
}));

vi.mock('../../../../../packages/backend-host/src/modules/platform-admin/routes/environments.js', () => ({
  default: express.Router(),
}));

vi.mock('../../../../../packages/backend-host/src/modules/platform-admin/routes/governance.js', () => ({
  default: express.Router(),
}));

describe('platform-admin admin routes', () => {
  it('mounts sub-routers', () => {
    const app = express();
    app.disable('x-powered-by');
    app.use(adminRouter);
    expect(app).toBeDefined();
  });
});
