import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { fetch } from 'undici';
import {
  camundaGet,
  camundaPost,
} from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import {
  runWithBpmnEngineRequestContext,
  updateBpmnEngineRequestContext,
} from '@enterpriseglue/shared/services/bpmn-engine-request-context.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/encryption.js', () => ({
  safeDecrypt: vi.fn((val) => val),
}));

vi.mock('undici', () => ({
  fetch: vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: vi.fn().mockReturnValue('application/json') },
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(''),
  }),
}));

describe('bpmn-engine-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const engineRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'engine-1',
        baseUrl: 'http://localhost:8080/engine-rest',
        authType: 'none',
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        throw new Error('Unexpected repository');
      },
    });
  });

  it('sends EnterpriseGlue request metadata headers for sidecar-compatible reads', async () => {
    await runWithBpmnEngineRequestContext({ requestId: 'req-1' }, async () => {
      updateBpmnEngineRequestContext({
        userId: 'user-1',
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
        engineId: 'engine-1',
      });

      await camundaGet('engine-1', '/version');
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:8080/engine-rest/version', {
      method: 'GET',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'X-EnterpriseGlue-Request-Id': 'req-1',
        'X-EnterpriseGlue-User-Id': 'user-1',
        'X-EnterpriseGlue-Tenant-Id': 'tenant-1',
        'X-EnterpriseGlue-Tenant-Slug': 'acme',
        'X-EnterpriseGlue-Engine-Id': 'engine-1',
        'X-EnterpriseGlue-Operation-Class': 'engine.read',
      }),
    });
  });

  it('infers mutating operation classes for sidecar policy checks', async () => {
    await runWithBpmnEngineRequestContext({ requestId: 'req-2' }, async () => {
      await camundaPost('engine-1', '/process-definition/key/order/start', {});
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:8080/engine-rest/process-definition/key/order/start', {
      method: 'POST',
      headers: expect.objectContaining({
        'X-EnterpriseGlue-Request-Id': 'req-2',
        'X-EnterpriseGlue-Engine-Id': 'engine-1',
        'X-EnterpriseGlue-Operation-Class': 'engine.instance.mutate',
      }),
      body: '{}',
    });
  });

  it('keeps basic engine credentials server-side while adding metadata headers', async () => {
    const engineRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'engine-1',
        baseUrl: 'http://localhost:8080/engine-rest',
        authType: 'basic',
        username: 'demo',
        passwordEnc: 'demo-secret',
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        throw new Error('Unexpected repository');
      },
    });

    await runWithBpmnEngineRequestContext({ requestId: 'req-3' }, async () => {
      await camundaGet('engine-1', '/version');
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:8080/engine-rest/version', {
      method: 'GET',
      headers: expect.objectContaining({
        Authorization: `Basic ${Buffer.from('demo:demo-secret').toString('base64')}`,
        'X-EnterpriseGlue-Request-Id': 'req-3',
        'X-EnterpriseGlue-Operation-Class': 'engine.read',
      }),
    });
  });

  it('obtains OAuth2 client credentials tokens server-side before calling the engine', async () => {
    const engineRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'engine-1',
        baseUrl: 'http://localhost:8080/engine-rest',
        authType: 'oauth2-client-credentials',
        username: 'eg-client',
        passwordEnc: 'eg-secret',
        oauthTokenUrl: 'https://keycloak.example.com/realms/acme/protocol/openid-connect/token',
        oauthScopes: 'engine-rest',
        oauthAudience: 'ion-engine',
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        throw new Error('Unexpected repository');
      },
    });

    (fetch as unknown as Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: vi.fn().mockReturnValue('application/json') },
        json: vi.fn().mockResolvedValue({ access_token: 'oauth-access-token', expires_in: 300 }),
        text: vi.fn().mockResolvedValue(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: vi.fn().mockReturnValue('application/json') },
        json: vi.fn().mockResolvedValue({ version: 'test' }),
        text: vi.fn().mockResolvedValue(''),
      });

    await runWithBpmnEngineRequestContext({ requestId: 'req-4' }, async () => {
      await camundaGet('engine-1', '/version');
    });

    expect(fetch).toHaveBeenNthCalledWith(1, 'https://keycloak.example.com/realms/acme/protocol/openid-connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: expect.any(URLSearchParams),
    });
    const tokenBody = (fetch as unknown as Mock).mock.calls[0][1].body as URLSearchParams;
    expect(tokenBody.get('grant_type')).toBe('client_credentials');
    expect(tokenBody.get('client_id')).toBe('eg-client');
    expect(tokenBody.get('client_secret')).toBe('eg-secret');
    expect(tokenBody.get('scope')).toBe('engine-rest');
    expect(tokenBody.get('audience')).toBe('ion-engine');

    expect(fetch).toHaveBeenNthCalledWith(2, 'http://localhost:8080/engine-rest/version', {
      method: 'GET',
      headers: expect.objectContaining({
        Authorization: 'Bearer oauth-access-token',
        'X-EnterpriseGlue-Request-Id': 'req-4',
        'X-EnterpriseGlue-Operation-Class': 'engine.read',
      }),
    });
  });
});
