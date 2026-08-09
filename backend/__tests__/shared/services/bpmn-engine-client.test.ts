import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { fetch } from 'undici';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import {
  camundaGet,
  camundaGetWithConnection,
  camundaPost,
  fetchBpmnEngineEndpoint,
  MAX_ENGINE_RESPONSE_BYTES,
  resolveBpmnEngineConnection,
  resolveBpmnEngineRequestUrl,
  validateBpmnEngineEndpointUrl,
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
  blindIndex: vi.fn((domain: string, value: string) => `${domain}:${Buffer.from(value).toString('base64url')}`),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('undici', () => ({
  fetch: vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: vi.fn().mockReturnValue('application/json') },
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(''),
  }),
  Response: globalThis.Response,
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
      redirect: 'error',
      signal: expect.anything(),
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

  it('normalizes a connection-aware GET query without appending it twice', async () => {
    await camundaGetWithConnection({
      id: 'engine-1',
      baseUrl: 'http://localhost:8080/engine-rest',
      connectionMode: 'direct',
      authType: 'none',
    }, '/authorization?type=1&groupIdIn=operators', { resourceType: 6, resourceId: 'payments' });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8080/engine-rest/authorization?type=1&groupIdIn=operators&resourceType=6&resourceId=payments',
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
  });

  it('resolves credentialless sidecars without exposing endpoint or credential details in diagnostics', async () => {
    const connection = await resolveBpmnEngineConnection({
      id: 'engine-sidecar',
      baseUrl: 'https://private-sidecar.example.com/engine-rest',
      connectionMode: 'customer_sidecar',
      authType: 'none',
      passwordEnc: 'must-not-appear',
    }, { engineId: 'engine-sidecar', method: 'GET', path: '/version' });

    expect(connection.url).toBe('https://private-sidecar.example.com/engine-rest/version');
    expect(connection.headers).not.toHaveProperty('Authorization');
    expect(connection.diagnostics).toEqual({
      connectionMode: 'customer_sidecar',
      upstreamHop: 'enterpriseglue_to_sidecar',
      endpointAuthentication: 'none',
      downstreamAuthentication: 'customer_managed',
    });
    expect(JSON.stringify(connection.diagnostics)).not.toContain('private-sidecar.example.com');
    expect(JSON.stringify(connection.diagnostics)).not.toContain('must-not-appear');
  });

  it('supports opaque-token sidecar metadata and runtime hops without receiving or forwarding the customer downstream token', async () => {
    const engineRepo = { findOneBy: vi.fn().mockResolvedValue({
      id: 'engine-sidecar', baseUrl: 'https://sidecar.example.test/engine-rest', connectionMode: 'customer_sidecar', authType: 'none',
    }) };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === Engine ? engineRepo : {} });
    (fetch as unknown as Mock).mockImplementationOnce(async (_url: string, init: { headers: Record<string, string> }) => {
      // This represents the customer sidecar injecting its own downstream token after EnterpriseGlue's hop.
      expect(init.headers.Authorization).toBeUndefined();
      expect(Object.values(init.headers).join(' ')).not.toContain('customer-downstream-token');
      return { ok: true, status: 200, statusText: 'OK', headers: { get: vi.fn().mockReturnValue('application/json') }, json: vi.fn().mockResolvedValue({ version: '7.22.0' }) };
    });

    await expect(camundaGet('engine-sidecar', '/version')).resolves.toEqual({ version: '7.22.0' });
    (fetch as unknown as Mock).mockImplementationOnce(async (_url: string, init: { headers: Record<string, string> }) => {
      expect(init.headers.Authorization).toBeUndefined();
      expect(Object.values(init.headers).join(' ')).not.toContain('customer-downstream-token');
      return { ok: true, status: 200, statusText: 'OK', headers: { get: vi.fn().mockReturnValue('application/json') }, json: vi.fn().mockResolvedValue({ id: 'process-1' }) };
    });
    await expect(camundaPost('engine-sidecar', '/process-definition/key/payments/start', {})).resolves.toEqual({ id: 'process-1' });
    expect(JSON.stringify((fetch as unknown as Mock).mock.calls)).not.toContain('customer-downstream-token');
  });

  it('records sanitized canonical lineage for sidecar operations without endpoint or downstream-token data', async () => {
    const engineRepo = { findOneBy: vi.fn().mockResolvedValue({
      id: 'engine-sidecar', baseUrl: 'https://sidecar.example.test/engine-rest', connectionMode: 'customer_sidecar', authType: 'none',
    }) };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === Engine ? engineRepo : {} });

    await runWithBpmnEngineRequestContext({
      requestId: 'request-42', userId: 'user-1', tenantId: 'tenant-1', engineId: 'engine-sidecar', actionId: 'engine.runtime.process-definitions.start', projectId: 'project-1',
    }, async () => {
      await camundaPost('engine-sidecar', '/process-definition/key/payments/start', { customerDownstreamToken: 'customer-downstream-token' });
    });

    expect(logAudit).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
      action: 'engine.operation',
      resourceType: 'engine',
      resourceId: 'engine-sidecar',
      details: {
        requestId: 'request-42',
        authorizedActionId: 'engine.runtime.process-definitions.start',
        projectId: 'project-1',
        operationClass: 'engine.instance.mutate',
        method: 'POST',
        connectionMode: 'customer_sidecar',
        result: 'succeeded',
      },
    });
    expect(JSON.stringify((logAudit as unknown as Mock).mock.calls)).not.toContain('sidecar.example.test');
    expect(JSON.stringify((logAudit as unknown as Mock).mock.calls)).not.toContain('customer-downstream-token');
  });

  it('records a sanitized sidecar rejection outcome without an upstream response body', async () => {
    const engineRepo = { findOneBy: vi.fn().mockResolvedValue({
      id: 'engine-sidecar', baseUrl: 'https://sidecar.example.test/engine-rest', connectionMode: 'customer_sidecar', authType: 'none',
    }) };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === Engine ? engineRepo : {} });
    (fetch as unknown as Mock).mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized', headers: { get: vi.fn().mockReturnValue('text/plain') }, text: vi.fn().mockResolvedValue('customer-downstream-token') });

    await runWithBpmnEngineRequestContext({ requestId: 'request-43', userId: 'user-1', tenantId: 'tenant-1', actionId: 'engine.runtime.process-definitions.start' }, async () => {
      await expect(camundaPost('engine-sidecar', '/process-definition/key/payments/start', {})).rejects.toMatchObject({ code: 'ENGINE_OPERATION_REJECTED' });
    });

    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({
        requestId: 'request-43',
        authorizedActionId: 'engine.runtime.process-definitions.start',
        operationClass: 'engine.instance.mutate',
        connectionMode: 'customer_sidecar',
        result: 'operation_rejected',
        errorCode: 'ENGINE_OPERATION_REJECTED',
        engineStatus: 401,
      }),
    }));
    expect(JSON.stringify((logAudit as unknown as Mock).mock.calls)).not.toContain('customer-downstream-token');
  });

  it('retries one transient safe-read failure and reports bounded transport diagnostics', async () => {
    (fetch as unknown as Mock)
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable', body: null })
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });

    const result = await fetchBpmnEngineEndpoint({
      id: 'engine-sidecar',
      baseUrl: 'https://sidecar.example.com/engine-rest',
      connectionMode: 'customer_sidecar',
      authType: 'none',
    }, { engineId: 'engine-sidecar', method: 'GET', path: '/version', timeoutMs: 500 });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.response.status).toBe(200);
    expect(result.diagnostics).toMatchObject({ attempts: 2, timeoutMs: 500, connectionMode: 'customer_sidecar' });
  });

  it('cannot be configured by a caller to follow engine redirects', async () => {
    (fetch as unknown as Mock).mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', body: null });

    await fetchBpmnEngineEndpoint({
      id: 'engine-sidecar',
      baseUrl: 'https://sidecar.example.com/engine-rest',
      connectionMode: 'customer_sidecar',
      authType: 'none',
    }, { engineId: 'engine-sidecar', method: 'GET', path: '/version', retry: 'never' }, {
      redirect: 'follow',
    });

    expect(fetch).toHaveBeenCalledWith('https://sidecar.example.com/engine-rest/version', expect.objectContaining({
      redirect: 'error',
    }));
  });

  it('never retries mutations and sanitizes exhausted transport errors', async () => {
    const engineRepo = { findOneBy: vi.fn().mockResolvedValue({
      id: 'engine-sidecar', baseUrl: 'https://secret-engine.example.com/engine-rest', connectionMode: 'customer_sidecar', authType: 'none',
    }) };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === Engine ? engineRepo : {} });
    (fetch as unknown as Mock).mockRejectedValueOnce(new Error('request timed out https://secret-engine.example.com/downstream-secret-must-not-leak'));

    await runWithBpmnEngineRequestContext({ requestId: 'request-timeout', userId: 'user-1', tenantId: 'tenant-1', actionId: 'engine.runtime.process-definitions.start' }, async () => {
      await camundaPost('engine-sidecar', '/process-definition/key/order/start', {}).then(
        () => { throw new Error('Expected transport failure'); },
        (error: { code: string; statusCode: number; toJSON: () => unknown }) => {
          expect(error.code).toBe('ENGINE_TRANSPORT_UNAVAILABLE');
          expect(error.statusCode).toBe(502);
          expect(error.toJSON()).toEqual({
            error: 'The engine endpoint is unavailable',
            code: 'ENGINE_TRANSPORT_UNAVAILABLE',
            details: {
              operationClass: 'engine.instance.mutate',
              attempts: 1,
              timeoutMs: 10_000,
              connectionMode: 'customer_sidecar',
            },
          });
          expect(JSON.stringify(error.toJSON())).not.toContain('secret-engine.example.com');
          expect(JSON.stringify(error.toJSON())).not.toContain('downstream-secret-must-not-leak');
        },
      );
    });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ requestId: 'request-timeout', result: 'transport_unavailable', errorCode: 'ENGINE_TRANSPORT_UNAVAILABLE' }),
    }));
    expect(JSON.stringify((logAudit as unknown as Mock).mock.calls)).not.toContain('secret-engine.example.com');
    expect(JSON.stringify((logAudit as unknown as Mock).mock.calls)).not.toContain('downstream-secret-must-not-leak');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['outage', new Error('connect ECONNREFUSED https://secret-engine.example.com/downstream-secret-must-not-leak')],
    ['timeout', new DOMException('The operation timed out at https://secret-engine.example.com/downstream-secret-must-not-leak', 'TimeoutError')],
  ])('fails closed for every runtime read path when the external engine has a %s', async (_kind, transportFailure) => {
    const paths = [
      '/process-definition/definition-1',
      '/process-instance/instance-1',
      '/deployment/deployment-1',
      '/decision-definition/decision-1',
    ];
    for (const path of paths) {
      vi.clearAllMocks();
      (fetch as unknown as Mock).mockRejectedValueOnce(transportFailure).mockRejectedValueOnce(transportFailure);
      let error: { code?: string; statusCode?: number; details?: unknown; toJSON?: () => unknown } | undefined;
      try {
        await fetchBpmnEngineEndpoint({
          id: 'engine-sidecar',
          baseUrl: 'https://secret-engine.example.com/engine-rest',
          connectionMode: 'customer_sidecar',
          authType: 'none',
        }, { engineId: 'engine-sidecar', method: 'GET', path, timeoutMs: 125 });
      } catch (caught) {
        error = caught as typeof error;
      }
      expect(error).toMatchObject({
        code: 'ENGINE_TRANSPORT_UNAVAILABLE',
        statusCode: 502,
        details: { operationClass: 'engine.read', attempts: 2, timeoutMs: 125, connectionMode: 'customer_sidecar' },
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(error?.toJSON?.())).not.toContain('secret-engine.example.com');
      expect(JSON.stringify(error?.toJSON?.())).not.toContain('downstream-secret-must-not-leak');
    }
  });

  it('fails closed and records a sanitized TLS transport outcome for a sidecar', async () => {
    const engineRepo = { findOneBy: vi.fn().mockResolvedValue({
      id: 'engine-sidecar', baseUrl: 'https://sidecar.example.test/engine-rest', connectionMode: 'customer_sidecar', authType: 'none',
    }) };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === Engine ? engineRepo : {} });
    (fetch as unknown as Mock).mockRejectedValueOnce(new Error('TLS handshake failed for https://sidecar.example.test/engine-rest?peer=customer-downstream-token'));

    await runWithBpmnEngineRequestContext({ requestId: 'request-tls', userId: 'user-1', tenantId: 'tenant-1', actionId: 'engine.runtime.process-definitions.start' }, async () => {
      await expect(camundaPost('engine-sidecar', '/process-definition/key/payments/start', {})).rejects.toMatchObject({
        code: 'ENGINE_TRANSPORT_UNAVAILABLE',
        details: { connectionMode: 'customer_sidecar', operationClass: 'engine.instance.mutate' },
      });
    });

    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ requestId: 'request-tls', result: 'transport_unavailable', errorCode: 'ENGINE_TRANSPORT_UNAVAILABLE' }),
    }));
    expect(JSON.stringify((logAudit as unknown as Mock).mock.calls)).not.toContain('sidecar.example.test');
    expect(JSON.stringify((logAudit as unknown as Mock).mock.calls)).not.toContain('customer-downstream-token');
  });

  it('rejects oversized declared engine responses before callers can read them', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    (fetch as unknown as Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: vi.fn((name: string) => name === 'content-length' ? String(MAX_ENGINE_RESPONSE_BYTES + 1) : 'application/json') },
      body: { cancel },
    });

    await expect(fetchBpmnEngineEndpoint({
      id: 'engine-sidecar',
      baseUrl: 'https://sidecar.example.com/engine-rest',
      connectionMode: 'customer_sidecar',
      authType: 'none',
    }, { engineId: 'engine-sidecar', method: 'GET', path: '/version' })).rejects.toMatchObject({
      code: 'ENGINE_RESPONSE_TOO_LARGE',
      statusCode: 502,
      details: {
        operationClass: 'engine.read',
        maxResponseBytes: MAX_ENGINE_RESPONSE_BYTES,
        connectionMode: 'customer_sidecar',
      },
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized chunked engine responses while streaming their body', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const read = vi.fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(MAX_ENGINE_RESPONSE_BYTES) })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(1) });
    (fetch as unknown as Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: vi.fn().mockReturnValue(null) },
      body: { getReader: () => ({ read, cancel, releaseLock }) },
    });

    await expect(fetchBpmnEngineEndpoint({
      id: 'engine-sidecar',
      baseUrl: 'https://sidecar.example.com/engine-rest',
      connectionMode: 'customer_sidecar',
      authType: 'none',
    }, { engineId: 'engine-sidecar', method: 'GET', path: '/version' })).rejects.toMatchObject({
      code: 'ENGINE_RESPONSE_TOO_LARGE',
      statusCode: 502,
      details: { operationClass: 'engine.read', maxResponseBytes: MAX_ENGINE_RESPONSE_BYTES, connectionMode: 'customer_sidecar' },
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it('infers mutating operation classes for sidecar policy checks', async () => {
    await runWithBpmnEngineRequestContext({ requestId: 'req-2' }, async () => {
      await camundaPost('engine-1', '/process-definition/key/order/start', {});
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:8080/engine-rest/process-definition/key/order/start', {
      method: 'POST',
      redirect: 'error',
      signal: expect.anything(),
      headers: expect.objectContaining({
        'X-EnterpriseGlue-Request-Id': 'req-2',
        'X-EnterpriseGlue-Engine-Id': 'engine-1',
        'X-EnterpriseGlue-Operation-Class': 'engine.instance.mutate',
      }),
      body: '{}',
    });
  });

  it('marks bounded native authorization calls for customer-sidecar policy checks', async () => {
    await runWithBpmnEngineRequestContext({ requestId: 'req-backstop' }, async () => {
      await camundaPost('engine-1', '/authorization/create', {});
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:8080/engine-rest/authorization/create', {
      method: 'POST',
      redirect: 'error',
      signal: expect.anything(),
      headers: expect.objectContaining({
        'X-EnterpriseGlue-Request-Id': 'req-backstop',
        'X-EnterpriseGlue-Operation-Class': 'engine.native_authorization.backstop',
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
      redirect: 'error',
      signal: expect.anything(),
      headers: expect.objectContaining({
        Authorization: `Basic ${Buffer.from('demo:demo-secret').toString('base64')}`,
        'X-EnterpriseGlue-Request-Id': 'req-3',
        'X-EnterpriseGlue-Operation-Class': 'engine.read',
      }),
    });
  });

  it('rewrites loopback engine URLs for Docker outbound calls when enabled', async () => {
    const previousRewrite = process.env.EG_REWRITE_DOCKER_LOOPBACK_ENGINE_URLS;
    process.env.EG_REWRITE_DOCKER_LOOPBACK_ENGINE_URLS = 'true';

    try {
      await camundaGet('engine-1', '/version');

      expect(fetch).toHaveBeenCalledWith('http://host.docker.internal:8080/engine-rest/version', {
        method: 'GET',
        redirect: 'error',
        signal: expect.anything(),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-EnterpriseGlue-Engine-Id': 'engine-1',
          'X-EnterpriseGlue-Operation-Class': 'engine.read',
        }),
      });
    } finally {
      if (typeof previousRewrite === 'undefined') {
        delete process.env.EG_REWRITE_DOCKER_LOOPBACK_ENGINE_URLS;
      } else {
        process.env.EG_REWRITE_DOCKER_LOOPBACK_ENGINE_URLS = previousRewrite;
      }
    }
  });

  it('rejects non-HTTP engine endpoint schemes before an outbound request', () => {
    expect(() => resolveBpmnEngineRequestUrl('ftp://engine.example.test/engine-rest', '/version'))
      .toThrow('Engine endpoint URL must use HTTP or HTTPS');
  });

  it('rejects endpoint credential URLs and absolute request paths before an outbound request', () => {
    expect(() => resolveBpmnEngineRequestUrl('https://user:password@engine.example.test/engine-rest', '/version'))
      .toThrow('Engine endpoint URL must not include embedded credentials');
    expect(() => resolveBpmnEngineRequestUrl('https://engine.example.test/engine-rest', 'https://metadata.example.test/latest'))
      .toThrow('Engine request path must be relative to the configured endpoint');
    expect(() => resolveBpmnEngineRequestUrl('https://engine.example.test/engine-rest', '//metadata.example.test/latest'))
      .toThrow('Engine request path must be relative to the configured endpoint');
  });

  it('enforces the configured endpoint host allowlist before outbound engine requests', () => {
    const previousEnforcement = process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY;
    const previousAllowedHosts = process.env.EG_ENGINE_ALLOWED_HOSTS;
    process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY = 'true';
    process.env.EG_ENGINE_ALLOWED_HOSTS = 'sidecar.example.test,*.engines.trusted.internal';

    try {
      expect(resolveBpmnEngineRequestUrl('https://sidecar.example.test/engine-rest', '/version'))
        .toBe('https://sidecar.example.test/engine-rest/version');
      expect(resolveBpmnEngineRequestUrl('https://worker.engines.trusted.internal/engine-rest', '/version'))
        .toBe('https://worker.engines.trusted.internal/engine-rest/version');
      expect(() => resolveBpmnEngineRequestUrl('https://metadata.example.test/latest', '/version'))
        .toThrow('Engine endpoint URL host is not permitted by endpoint policy');
    } finally {
      if (previousEnforcement === undefined) delete process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY;
      else process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY = previousEnforcement;
      if (previousAllowedHosts === undefined) delete process.env.EG_ENGINE_ALLOWED_HOSTS;
      else process.env.EG_ENGINE_ALLOWED_HOSTS = previousAllowedHosts;
    }
  });

  it('requires HTTPS whenever endpoint policy is enforced unless explicitly overridden', () => {
    const previousEnforcement = process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY;
    const previousAllowedHosts = process.env.EG_ENGINE_ALLOWED_HOSTS;
    const previousInsecureHttp = process.env.EG_ALLOW_INSECURE_ENGINE_HTTP;
    process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY = 'true';
    process.env.EG_ENGINE_ALLOWED_HOSTS = 'sidecar.example.test';
    delete process.env.EG_ALLOW_INSECURE_ENGINE_HTTP;

    try {
      expect(() => validateBpmnEngineEndpointUrl('http://sidecar.example.test/engine-rest'))
        .toThrow('Engine endpoint URL must use HTTPS when endpoint policy is enforced');
      process.env.EG_ALLOW_INSECURE_ENGINE_HTTP = 'true';
      expect(validateBpmnEngineEndpointUrl('http://sidecar.example.test/engine-rest').toString())
        .toBe('http://sidecar.example.test/engine-rest');
    } finally {
      if (previousEnforcement === undefined) delete process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY;
      else process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY = previousEnforcement;
      if (previousAllowedHosts === undefined) delete process.env.EG_ENGINE_ALLOWED_HOSTS;
      else process.env.EG_ENGINE_ALLOWED_HOSTS = previousAllowedHosts;
      if (previousInsecureHttp === undefined) delete process.env.EG_ALLOW_INSECURE_ENGINE_HTTP;
      else process.env.EG_ALLOW_INSECURE_ENGINE_HTTP = previousInsecureHttp;
    }
  });

  it('keeps engine endpoint policy fail-closed in production and rejects broad wildcard trust', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousEnforcement = process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY;
    const previousAllowedHosts = process.env.EG_ENGINE_ALLOWED_HOSTS;
    process.env.NODE_ENV = 'production';
    process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY = 'false';

    try {
      process.env.EG_ENGINE_ALLOWED_HOSTS = '*.com';
      expect(() => validateBpmnEngineEndpointUrl('https://engine.example.com/engine-rest'))
        .toThrow('Engine endpoint URL host is not permitted by endpoint policy');
      process.env.EG_ENGINE_ALLOWED_HOSTS = '*.co.uk';
      expect(() => validateBpmnEngineEndpointUrl('https://engine.example.co.uk/engine-rest'))
        .toThrow('Engine endpoint URL host is not permitted by endpoint policy');
      for (const broadSuffix of ['*.github.io', '*.appspot.com', '*.cloudfront.net', '*.example.com']) {
        process.env.EG_ENGINE_ALLOWED_HOSTS = broadSuffix;
        expect(() => validateBpmnEngineEndpointUrl(`https://engine.${broadSuffix.slice(2)}/engine-rest`))
          .toThrow('Engine endpoint URL host is not permitted by endpoint policy');
      }
      process.env.EG_ENGINE_ALLOWED_HOSTS = '*.engines.example.com';
      expect(validateBpmnEngineEndpointUrl('https://prod.engines.example.com/engine-rest').hostname)
        .toBe('prod.engines.example.com');
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousEnforcement === undefined) delete process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY;
      else process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY = previousEnforcement;
      if (previousAllowedHosts === undefined) delete process.env.EG_ENGINE_ALLOWED_HOSTS;
      else process.env.EG_ENGINE_ALLOWED_HOSTS = previousAllowedHosts;
    }
  });

  it('requires exact reviewed allowlisting for private hosts and always blocks metadata endpoints', () => {
    const previousEnforcement = process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY;
    const previousAllowedHosts = process.env.EG_ENGINE_ALLOWED_HOSTS;
    const previousAllowPrivate = process.env.EG_ENGINE_ALLOW_PRIVATE_HOSTS;
    process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY = 'true';
    process.env.EG_ENGINE_ALLOW_PRIVATE_HOSTS = 'true';

    try {
      process.env.EG_ENGINE_ALLOWED_HOSTS = '*.docker.internal';
      expect(() => validateBpmnEngineEndpointUrl('https://host.docker.internal/engine-rest'))
        .toThrow('Engine endpoint URL private host must have an exact endpoint-policy allowlist entry');
      process.env.EG_ENGINE_ALLOWED_HOSTS = 'host.docker.internal';
      expect(validateBpmnEngineEndpointUrl('https://host.docker.internal/engine-rest').hostname).toBe('host.docker.internal');
      process.env.EG_ENGINE_ALLOWED_HOSTS = '169.254.169.254';
      expect(() => validateBpmnEngineEndpointUrl('https://169.254.169.254/latest/meta-data'))
        .toThrow('Engine endpoint URL host is not permitted by endpoint policy');
      process.env.EG_ENGINE_ALLOWED_HOSTS = '[::ffff:a9fe:a9fe]';
      expect(() => validateBpmnEngineEndpointUrl('https://[::ffff:169.254.169.254]/latest/meta-data'))
        .toThrow('Engine endpoint URL host is not permitted by endpoint policy');
    } finally {
      if (previousEnforcement === undefined) delete process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY;
      else process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY = previousEnforcement;
      if (previousAllowedHosts === undefined) delete process.env.EG_ENGINE_ALLOWED_HOSTS;
      else process.env.EG_ENGINE_ALLOWED_HOSTS = previousAllowedHosts;
      if (previousAllowPrivate === undefined) delete process.env.EG_ENGINE_ALLOW_PRIVATE_HOSTS;
      else process.env.EG_ENGINE_ALLOW_PRIVATE_HOSTS = previousAllowPrivate;
    }
  });

  it('revalidates Docker loopback rewrites against the final endpoint host', () => {
    const previousEnforcement = process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY;
    const previousAllowedHosts = process.env.EG_ENGINE_ALLOWED_HOSTS;
    const previousAllowPrivate = process.env.EG_ENGINE_ALLOW_PRIVATE_HOSTS;
    const previousRewrite = process.env.EG_REWRITE_DOCKER_LOOPBACK_ENGINE_URLS;
    process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY = 'true';
    process.env.EG_ENGINE_ALLOWED_HOSTS = 'localhost';
    process.env.EG_ENGINE_ALLOW_PRIVATE_HOSTS = 'true';
    process.env.EG_REWRITE_DOCKER_LOOPBACK_ENGINE_URLS = 'true';

    try {
      expect(() => resolveBpmnEngineRequestUrl('https://localhost:8443/engine-rest', '/version'))
        .toThrow('Engine endpoint URL private host must have an exact endpoint-policy allowlist entry');
    } finally {
      if (previousEnforcement === undefined) delete process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY;
      else process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY = previousEnforcement;
      if (previousAllowedHosts === undefined) delete process.env.EG_ENGINE_ALLOWED_HOSTS;
      else process.env.EG_ENGINE_ALLOWED_HOSTS = previousAllowedHosts;
      if (previousAllowPrivate === undefined) delete process.env.EG_ENGINE_ALLOW_PRIVATE_HOSTS;
      else process.env.EG_ENGINE_ALLOW_PRIVATE_HOSTS = previousAllowPrivate;
      if (previousRewrite === undefined) delete process.env.EG_REWRITE_DOCKER_LOOPBACK_ENGINE_URLS;
      else process.env.EG_REWRITE_DOCKER_LOOPBACK_ENGINE_URLS = previousRewrite;
    }
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
      redirect: 'error',
      signal: expect.anything(),
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
      redirect: 'error',
      signal: expect.anything(),
      headers: expect.objectContaining({
        Authorization: 'Bearer oauth-access-token',
        'X-EnterpriseGlue-Request-Id': 'req-4',
        'X-EnterpriseGlue-Operation-Class': 'engine.read',
      }),
    });
  });

  it('does not reuse OAuth tokens after secret rotation or destination replacement', async () => {
    const base = {
      id: 'engine-oauth-generation-test',
      connectionMode: 'customer_sidecar' as const,
      authType: 'oauth2-client-credentials' as const,
      username: 'client-id',
      oauthTokenUrl: 'https://identity.example.com/oauth/token',
    };
    const tokenResponse = (token: string) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: vi.fn().mockReturnValue('application/json') },
      body: null,
      json: vi.fn().mockResolvedValue({ access_token: token, expires_in: 300 }),
      text: vi.fn().mockResolvedValue(''),
    });
    (fetch as unknown as Mock)
      .mockResolvedValueOnce(tokenResponse('token-one'))
      .mockResolvedValueOnce(tokenResponse('token-two'))
      .mockResolvedValueOnce(tokenResponse('token-three'));

    await expect(resolveBpmnEngineConnection({
      ...base, baseUrl: 'https://engine-one.example.com/engine-rest', passwordEnc: 'secret-one',
    }, { method: 'GET', path: '/version' })).resolves.toMatchObject({ headers: { Authorization: 'Bearer token-one' } });
    await expect(resolveBpmnEngineConnection({
      ...base, baseUrl: 'https://engine-one.example.com/engine-rest', passwordEnc: 'secret-two',
    }, { method: 'GET', path: '/version' })).resolves.toMatchObject({ headers: { Authorization: 'Bearer token-two' } });
    await expect(resolveBpmnEngineConnection({
      ...base, baseUrl: 'https://engine-two.example.com/engine-rest', passwordEnc: 'secret-two',
    }, { method: 'GET', path: '/version' })).resolves.toMatchObject({ headers: { Authorization: 'Bearer token-three' } });

    expect(fetch).toHaveBeenCalledTimes(3);
    const submittedSecrets = (fetch as unknown as Mock).mock.calls.map((call) => (call[1].body as URLSearchParams).get('client_secret'));
    expect(submittedSecrets).toEqual(['secret-one', 'secret-two', 'secret-two']);
  });

  it('bounds OAuth2 client-credentials token responses before decoding JSON', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    (fetch as unknown as Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: vi.fn((name: string) => name === 'content-length' ? String(MAX_ENGINE_RESPONSE_BYTES + 1) : 'application/json') },
      body: { cancel },
    });

    await expect(resolveBpmnEngineConnection({
      id: 'engine-oauth-too-large',
      baseUrl: 'https://engine.example.com/engine-rest',
      connectionMode: 'customer_sidecar',
      authType: 'oauth2-client-credentials',
      username: 'client-id',
      passwordEnc: 'client-secret',
      oauthTokenUrl: 'https://identity.example.com/oauth/token',
    }, { engineId: 'engine-oauth-too-large', method: 'GET', path: '/version' })).rejects.toMatchObject({
      code: 'ENGINE_RESPONSE_TOO_LARGE',
      statusCode: 502,
      details: { maxResponseBytes: MAX_ENGINE_RESPONSE_BYTES, connectionMode: 'customer_sidecar' },
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('bounds a declared oversized OAuth2 error response before reporting its status', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    (fetch as unknown as Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: { get: vi.fn((name: string) => name === 'content-length' ? String(MAX_ENGINE_RESPONSE_BYTES + 1) : 'text/plain') },
      body: { cancel },
    });

    await expect(resolveBpmnEngineConnection({
      id: 'engine-oauth-error-too-large',
      baseUrl: 'https://engine.example.com/engine-rest',
      connectionMode: 'customer_sidecar',
      authType: 'oauth2-client-credentials',
      username: 'client-id',
      passwordEnc: 'client-secret',
      oauthTokenUrl: 'https://identity.example.com/oauth/token',
    }, { engineId: 'engine-oauth-error-too-large', method: 'GET', path: '/version' })).rejects.toMatchObject({
      code: 'ENGINE_RESPONSE_TOO_LARGE',
      statusCode: 502,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('bounds a chunked OAuth2 error response while streaming it', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const read = vi.fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(MAX_ENGINE_RESPONSE_BYTES) })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(1) });
    (fetch as unknown as Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: { get: vi.fn().mockReturnValue(null) },
      body: { getReader: () => ({ read, cancel, releaseLock }) },
    });

    await expect(resolveBpmnEngineConnection({
      id: 'engine-oauth-error-chunked',
      baseUrl: 'https://engine.example.com/engine-rest',
      connectionMode: 'customer_sidecar',
      authType: 'oauth2-client-credentials',
      username: 'client-id',
      passwordEnc: 'client-secret',
      oauthTokenUrl: 'https://identity.example.com/oauth/token',
    }, { engineId: 'engine-oauth-error-chunked', method: 'GET', path: '/version' })).rejects.toMatchObject({
      code: 'ENGINE_RESPONSE_TOO_LARGE',
      statusCode: 502,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['infinite number', Number.POSITIVE_INFINITY],
    ['infinite string', 'Infinity'],
    ['negative', -1],
    ['excessive', 10 ** 12],
  ])('never caches OAuth tokens indefinitely for a %s expires_in value', async (caseName, expiresIn) => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const tokenResponse = (token: string) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: vi.fn().mockReturnValue('application/json') },
      body: null,
      json: vi.fn().mockResolvedValue({ access_token: token, expires_in: expiresIn }),
      text: vi.fn().mockResolvedValue(''),
    });
    (fetch as unknown as Mock)
      .mockResolvedValueOnce(tokenResponse(`token-one-${caseName}`))
      .mockResolvedValueOnce(tokenResponse(`token-two-${caseName}`));
    const connection = {
      id: `ttl-${caseName}`,
      baseUrl: 'https://engine.example.com/engine-rest',
      connectionMode: 'customer_sidecar' as const,
      authType: 'oauth2-client-credentials' as const,
      username: 'client-id',
      passwordEnc: `secret-${caseName}`,
      oauthTokenUrl: 'https://identity.example.com/oauth/token',
    };

    await expect(resolveBpmnEngineConnection(connection, { method: 'GET', path: '/version' }))
      .resolves.toMatchObject({ headers: { Authorization: `Bearer token-one-${caseName}` } });
    now.mockReturnValue(1_000_000 + (3601 * 1000));
    await expect(resolveBpmnEngineConnection(connection, { method: 'GET', path: '/version' }))
      .resolves.toMatchObject({ headers: { Authorization: `Bearer token-two-${caseName}` } });
    now.mockRestore();
  });

  it('rejects empty, header-breaking, and oversized OAuth access tokens', async () => {
    for (const [index, accessToken] of ['', 'token\nInjected: value', 'x'.repeat((16 * 1024) + 1)].entries()) {
      (fetch as unknown as Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: vi.fn().mockReturnValue('application/json') },
        body: null,
        json: vi.fn().mockResolvedValue({ access_token: accessToken, expires_in: 300 }),
        text: vi.fn().mockResolvedValue(''),
      });

      await expect(resolveBpmnEngineConnection({
        id: `invalid-oauth-token-${index}`,
        baseUrl: 'https://engine.example.com/engine-rest',
        connectionMode: 'customer_sidecar',
        authType: 'oauth2-client-credentials',
        username: 'client-id',
        passwordEnc: `client-secret-${index}`,
        oauthTokenUrl: 'https://identity.example.com/oauth/token',
      }, { method: 'GET', path: '/version' })).rejects.toMatchObject({
        message: 'Engine OAuth2 token response did not include a valid access token',
      });
    }
  });

  it('rejects OAuth2 token endpoint URLs with embedded credentials before an outbound request', async () => {
    const engineRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'engine-1',
        baseUrl: 'https://engine.example.test/engine-rest',
        authType: 'oauth2-client-credentials',
        username: 'eg-client',
        passwordEnc: 'eg-secret',
        oauthTokenUrl: 'https://user:password@identity.example.test/token',
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(camundaGet('engine-1', '/version')).rejects.toThrow('OAuth2 token URL must not include embedded credentials');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('applies the endpoint host policy to OAuth2 token URLs before an outbound request', async () => {
    const previousEnforcement = process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY;
    const previousAllowedHosts = process.env.EG_ENGINE_ALLOWED_HOSTS;
    process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY = 'true';
    process.env.EG_ENGINE_ALLOWED_HOSTS = 'engine.example.test';

    try {
      await expect(resolveBpmnEngineConnection({
        id: 'engine-oauth-host-policy',
        baseUrl: 'https://engine.example.test/engine-rest',
        connectionMode: 'customer_sidecar',
        authType: 'oauth2-client-credentials',
        username: 'client-id',
        passwordEnc: 'client-secret',
        oauthTokenUrl: 'https://identity.example.test/oauth/token',
      }, { engineId: 'engine-oauth-host-policy', method: 'GET', path: '/version' })).rejects.toThrow(
        'OAuth2 token URL host is not permitted by endpoint policy',
      );
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      if (previousEnforcement === undefined) delete process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY;
      else process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY = previousEnforcement;
      if (previousAllowedHosts === undefined) delete process.env.EG_ENGINE_ALLOWED_HOSTS;
      else process.env.EG_ENGINE_ALLOWED_HOSTS = previousAllowedHosts;
    }
  });

  it('sanitizes OAuth token endpoint failures', async () => {
    (fetch as unknown as Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: vi.fn().mockResolvedValue('client_secret=must-not-leak'),
    });

    await expect(resolveBpmnEngineConnection({
      id: 'engine-oauth-failure',
      baseUrl: 'https://engine.example.com/engine-rest',
      connectionMode: 'customer_sidecar',
      authType: 'oauth2-client-credentials',
      username: 'client-id',
      passwordEnc: 'client-secret',
      oauthTokenUrl: 'https://identity.example.com/oauth/token',
    }, { engineId: 'engine-oauth-failure', method: 'GET', path: '/version' })).rejects.toMatchObject({
      message: 'Engine OAuth2 token request failed with status 401',
    });

  });

  it('sanitizes OAuth token endpoint network failures', async () => {
    (fetch as unknown as Mock).mockRejectedValueOnce(
      new Error('connect ECONNREFUSED https://identity.example.com/oauth/token?client_secret=must-not-leak'),
    );

    await resolveBpmnEngineConnection({
      id: 'engine-oauth-network-failure',
      baseUrl: 'https://engine.example.com/engine-rest',
      connectionMode: 'customer_sidecar',
      authType: 'oauth2-client-credentials',
      username: 'client-id',
      passwordEnc: 'client-secret',
      oauthTokenUrl: 'https://identity.example.com/oauth/token',
    }, { engineId: 'engine-oauth-network-failure', method: 'GET', path: '/version' }).then(
      () => { throw new Error('Expected OAuth transport failure'); },
      (error: { message: string; toJSON: () => unknown }) => {
        expect(error.message).toBe('Engine OAuth2 token request failed');
        expect(JSON.stringify(error.toJSON())).not.toContain('identity.example.com');
        expect(JSON.stringify(error.toJSON())).not.toContain('must-not-leak');
      },
    );
  });

  it('fails closed with sanitized diagnostics when a sidecar returns malformed JSON', async () => {
    const engineRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'engine-sidecar',
        baseUrl: 'https://sidecar.example.test/engine-rest',
        connectionMode: 'customer_sidecar',
        authType: 'none',
      }),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        throw new Error('Unexpected repository');
      },
    });
    (fetch as unknown as Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: vi.fn().mockReturnValue('application/json') },
      json: vi.fn().mockRejectedValue(new SyntaxError('unexpected token from https://sidecar.example.test/private')),
    });

    await runWithBpmnEngineRequestContext({ requestId: 'request-malformed', userId: 'user-1', tenantId: 'tenant-1', actionId: 'engine.runtime.process-definitions.read' }, async () => {
      await camundaGet('engine-sidecar', '/version').then(
        () => { throw new Error('Expected malformed response failure'); },
        (error: { code: string; statusCode: number; toJSON: () => unknown }) => {
          expect(error.code).toBe('ENGINE_MALFORMED_RESPONSE');
          expect(error.statusCode).toBe(502);
          expect(error.toJSON()).toEqual({
            error: 'The engine returned a malformed response',
            code: 'ENGINE_MALFORMED_RESPONSE',
            details: {
              operationClass: 'engine.read',
              connectionMode: 'customer_sidecar',
            },
          });
          expect(JSON.stringify(error.toJSON())).not.toContain('sidecar.example.test');
        },
      );
    });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ requestId: 'request-malformed', result: 'malformed_response', errorCode: 'ENGINE_MALFORMED_RESPONSE' }),
    }));
    expect(JSON.stringify((logAudit as unknown as Mock).mock.calls)).not.toContain('sidecar.example.test');
  });

  it('reports an engine rejection as an operational failure rather than local authorization denial', async () => {
    (fetch as unknown as Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: { get: vi.fn().mockReturnValue('application/json') },
      text: vi.fn().mockResolvedValue('{"message":"engine-only detail"}'),
    });

    await camundaPost('engine-1', '/job/job-1/execute').then(
      () => { throw new Error('Expected engine rejection'); },
      (error: { code: string; statusCode: number; toJSON: () => unknown }) => {
        expect(error.code).toBe('ENGINE_OPERATION_REJECTED');
        expect(error.statusCode).toBe(502);
        expect(error.toJSON()).toEqual({
          error: 'The engine rejected the requested operation',
          code: 'ENGINE_OPERATION_REJECTED',
          details: {
            engineStatus: 403,
            operationClass: 'engine.job.mutate',
          },
        });
        expect(JSON.stringify(error.toJSON())).not.toContain('engine-only detail');
        expect(JSON.stringify(error.toJSON())).not.toContain('localhost:8080');
      },
    );
  });

  it('reports a customer-sidecar rejection with sanitized transport-specific diagnostics', async () => {
    const engineRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'engine-sidecar', baseUrl: 'https://sidecar.example.test/engine-rest', connectionMode: 'customer_sidecar', authType: 'none',
      }),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === Engine ? engineRepo : {} });
    (fetch as unknown as Mock).mockResolvedValueOnce({
      ok: false, status: 403, statusText: 'Forbidden', headers: { get: vi.fn().mockReturnValue('application/json') },
      text: vi.fn().mockResolvedValue('{"downstreamToken":"must-not-leak"}'),
    });

    await camundaPost('engine-sidecar', '/job/job-1/execute').then(
      () => { throw new Error('Expected sidecar rejection'); },
      (error: { code: string; toJSON: () => unknown }) => {
        expect(error.code).toBe('ENGINE_OPERATION_REJECTED');
        expect(error.toJSON()).toEqual({
          error: 'The engine rejected the requested operation', code: 'ENGINE_OPERATION_REJECTED',
          details: { engineStatus: 403, operationClass: 'engine.job.mutate', connectionMode: 'customer_sidecar' },
        });
        expect(JSON.stringify(error.toJSON())).not.toContain('sidecar.example.test');
        expect(JSON.stringify(error.toJSON())).not.toContain('must-not-leak');
      },
    );
  });
});
