import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { createApp } from '../../src/app.js';

describe('POST /api/auth/login', () => {
  it('returns validation error for missing body fields', async () => {
    const app = createApp({
      includeRateLimiting: false,
    });

    const response = await request(app).post('/api/auth/login').send({});

    expect(response.status).toBe(400);
    expect(response.body?.error).toBe('Validation failed');
  });
});
