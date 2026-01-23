import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { createApp } from '../../src/app.js';

describe('GET /health', () => {
  it('returns ok status', async () => {
    const app = createApp({
      registerRoutes: false,
      includeRateLimiting: false,
      includeDocs: false,
    });
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
