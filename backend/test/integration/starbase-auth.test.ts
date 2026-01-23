import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { createApp } from '../../src/app.js';

describe('Starbase auth guard', () => {
  it('rejects unauthenticated project listing', async () => {
    const app = createApp({
      includeRateLimiting: false,
    });

    const response = await request(app).get('/t/default/starbase-api/projects');

    expect(response.status).toBe(401);
  });
});
