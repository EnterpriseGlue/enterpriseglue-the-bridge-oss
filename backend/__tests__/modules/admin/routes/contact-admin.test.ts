import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import contactAdminRouter from '../../../../../packages/backend-host/src/modules/admin/routes/contact-admin.js';

vi.mock('@enterpriseglue/shared/services/email/contact.js', () => ({
  sendContactAdminEmail: vi.fn().mockResolvedValue({ success: true }),
}));

describe('POST /api/contact-admin', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use('/api/contact-admin', contactAdminRouter);
    vi.clearAllMocks();
  });

  it('sends contact admin email successfully', async () => {
    const response = await request(app)
      .post('/api/contact-admin')
      .send({
        userEmail: 'user@example.com',
        subject: 'Need help',
        message: 'Test message',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('validates email format', async () => {
    const response = await request(app)
      .post('/api/contact-admin')
      .send({
        userEmail: 'invalid-email',
        subject: 'Test',
      });

    expect(response.status).toBe(400);
  });

  it('requires subject', async () => {
    const response = await request(app)
      .post('/api/contact-admin')
      .send({
        userEmail: 'user@example.com',
        subject: '',
      });

    expect(response.status).toBe(400);
  });
});
