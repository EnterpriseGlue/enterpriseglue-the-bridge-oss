import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postJson } from '@enterpriseglue/shared/services/pii/http.js';

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn();
  vi.stubGlobal('fetch', mock);
  return mock;
});

const originalEnv = { ...process.env };

describe('PII HTTP outbound boundary', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });
  afterAll(() => vi.unstubAllGlobals());

  it('rejects private and metadata destinations before sending the PII payload or token', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EG_ADMIN_INTEGRATION_ALLOWED_HOSTS = 'pii.example.com';
    await expect(postJson(
      'https://169.254.169.254/analyze',
      { text: 'private@example.com' },
      { Authorization: 'Bearer pii-secret' },
    )).rejects.toThrow('not permitted by endpoint policy');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forces redirect rejection and returns only bounded JSON', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EG_ADMIN_INTEGRATION_ALLOWED_HOSTS = '93.184.216.34';
    fetchMock.mockResolvedValue(new Response('{"detections":[]}', { status: 200 }));
    await expect(postJson(
      'https://93.184.216.34/analyze',
      { text: 'safe input' },
      { Authorization: 'Bearer pii-secret' },
    )).resolves.toEqual({ detections: [] });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error', method: 'POST' });
  });

  it('rejects oversized request and streamed response bodies', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EG_ADMIN_INTEGRATION_ALLOWED_HOSTS = '93.184.216.34';
    fetchMock.mockResolvedValue(new Response('x'.repeat(1_048_577), { status: 200 }));
    await expect(postJson(
      'https://93.184.216.34/analyze',
      { text: 'x'.repeat(1_048_577) },
      {},
    )).rejects.toThrow('request exceeds the maximum allowed size');
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(postJson('https://93.184.216.34/analyze', { text: 'small' }, {}))
      .rejects.toThrow('response exceeds the maximum allowed size');
  });
});
