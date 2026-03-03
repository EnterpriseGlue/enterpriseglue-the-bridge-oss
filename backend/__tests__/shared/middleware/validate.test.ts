import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { validateBody, validateParams, validateQuery, validateResponse } from '@enterpriseglue/shared/middleware/validate.js';

const createRes = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  return res;
};

describe('validate middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates request body', async () => {
    const schema = z.object({ name: z.string() });
    const req: any = { body: { name: 'Test' } };
    const res = createRes();
    const next = vi.fn();

    await validateBody(schema)(req, res as any, next);

    expect(req.body).toEqual({ name: 'Test' });
    expect(next).toHaveBeenCalled();
  });

  it('returns 400 on invalid body', async () => {
    const schema = z.object({ name: z.string() });
    const req: any = { body: {} };
    const res = createRes();
    const next = vi.fn();

    await validateBody(schema)(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('validates query parameters', async () => {
    const schema = z.object({ page: z.string() });
    const req: any = { query: { page: '1' } };
    const res = createRes();
    const next = vi.fn();

    await validateQuery(schema)(req, res as any, next);

    expect(req.query).toEqual({ page: '1' });
    expect(next).toHaveBeenCalled();
  });

  it('validates route params', async () => {
    const schema = z.object({ id: z.string() });
    const req: any = { params: { id: 'abc' } };
    const res = createRes();
    const next = vi.fn();

    await validateParams(schema)(req, res as any, next);

    expect(req.params).toEqual({ id: 'abc' });
    expect(next).toHaveBeenCalled();
  });

  it('validates response data', async () => {
    const schema = z.object({ id: z.string() });
    const req: any = {};
    const originalJson = vi.fn();
    const res: any = { json: originalJson };
    const next = vi.fn();

    validateResponse(schema)(req, res as any, next);

    res.json({ id: '123' });
    expect(originalJson).toHaveBeenCalledWith({ id: '123' });
    expect(next).toHaveBeenCalled();
  });

  it('returns validation error response in development', async () => {
    const schema = z.object({ id: z.string() });
    const req: any = {};
    const originalJson = vi.fn();
    const res: any = { json: originalJson };
    const next = vi.fn();
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    validateResponse(schema)(req, res as any, next);
    res.json({});

    expect(originalJson).toHaveBeenCalled();
    const payload = originalJson.mock.calls[0][0];
    expect(payload.error).toContain('Response validation failed');

    process.env.NODE_ENV = prevEnv;
    consoleSpy.mockRestore();
  });
});
