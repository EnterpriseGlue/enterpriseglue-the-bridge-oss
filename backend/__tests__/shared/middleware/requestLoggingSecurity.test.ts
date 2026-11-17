import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import morgan from 'morgan';
import request from 'supertest';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Morgan registers its built-in tokens on the exported function at runtime.
const tokens = morgan as unknown as morgan.TokenIndexer;

describe('request logging security', () => {
  it('escapes Unicode line separators and control characters in request fields', () => {
    const request = {
      method: 'GET',
      url: '/processes\u2028forged\u2029record\nnext\rline',
      headers: { 'user-agent': 'browser\u2028forged\u2029record', referer: 'https://example.test/\nentry' },
    } as unknown as IncomingMessage;
    const line = morgan.compile(':method :url :user-agent :referrer')(tokens, request, {} as ServerResponse);
    expect(line).toBe('GET /processes\\u2028forged\\u2029record\\nnext\\rline browser\\u2028forged\\u2029record https://example.test/\\nentry');
    expect(line).not.toMatch(/[\u2028\u2029\r\n]/u);
  });

  it('preserves ordinary request fields', () => {
    const request = { method: 'GET', url: '/api/engines?limit=50', headers: {} } as IncomingMessage;
    expect(morgan.compile(':method :url')(tokens, request, {} as ServerResponse))
      .toBe('GET /api/engines?limit=50');
  });
});

describe('structured request logs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('correlates parallel requests and omits raw paths, query strings, and bodies', async () => {
    vi.stubEnv('EG_LOG_FORMAT', 'json');
    vi.stubEnv('EG_LOG_LEVEL', 'info');
    vi.stubEnv('EG_LOGGER_LEVELS', '');
    const output: string[] = [];
    for (const method of ['log', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation((line) => { output.push(line); });
    }
    const { requestLogging } = await import('@enterpriseglue/backend-host/middleware/requestLogging.js');
    const { logConfigBundleResponse } = await import('@enterpriseglue/backend-host/services/configBundleLogging.js');
    const { logger } = await import('@enterpriseglue/shared/utils/logger.js');
    const app = express();
    app.use(requestLogging);
    app.use(express.json());
    app.post('/test/preview/:key', logConfigBundleResponse('validate'), async (_req, res) => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      logger.info('Checking a bundle');
      res.sendStatus(422);
    });
    app.post('/test/apply/:key', logConfigBundleResponse('apply'), (_req, res) => res.sendStatus(202));

    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const [preview, apply] = await Promise.all([
      request(app).post('/test/preview/private-path?token=private-query')
        .set('X-Request-Id', 'preview-request')
        .set('traceparent', `00-${traceId}-00f067aa0ba902b7-01`)
        .send({ password: 'private-body' }),
      request(app).post('/test/apply/another-private-path')
        .set('X-Correlation-Id', 'apply-request')
        .set('traceparent', `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`),
    ]);

    expect(preview.status).toBe(422);
    expect(apply.status).toBe(202);
    expect(output.join('\n')).not.toMatch(/private-(?:path|query|body)/);
    const records = output.filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
    const previewLogs = records.filter((line) => line.request?.id === 'preview-request');
    expect(previewLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ log: { level: 'info', logger: 'app' }, trace: { id: traceId } }),
      expect.objectContaining({
        event: { action: 'config_bundle_validate', outcome: 'failure', code: 'validation_failed' },
        config_bundle: { status: 'failed' },
      }),
      expect.objectContaining({
        event: { action: 'http_request', outcome: 'failure', duration: expect.any(Number) },
        http: { request: { method: 'POST' }, response: { status_code: 422 }, route: '/test/preview/:key' },
      }),
    ]));
    const applyLogs = records.filter((line) => line.request?.id === 'apply-request');
    expect(applyLogs.some((line) => line.trace)).toBe(false);
    expect(applyLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        log: { level: 'info', logger: 'config-bundle' },
        event: { action: 'config_bundle_apply', outcome: 'success' },
        config_bundle: { status: 'accepted' },
      }),
    ]));
  });
});
