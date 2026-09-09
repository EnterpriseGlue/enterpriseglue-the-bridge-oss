import { createServer } from 'node:http';
import { connect } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { Agent, fetch as realFetch } from 'undici';
import { fetchBpmnEngineEndpoint, resolveBpmnEngineRequestUrl, validateBpmnEngineEndpointUrl } from '@enterpriseglue/shared/services/bpmn-engine-client.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/encryption.js', () => ({ safeDecrypt: (value: string) => value }));
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({ logAudit: vi.fn() }));
const forwarded = vi.hoisted(() => ({ dispatcher: undefined as Agent | undefined, count: 0 }));
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: ((input, init) => {
    forwarded.count++;
    return actual.fetch(input, { ...init, dispatcher: forwarded.dispatcher });
  }) as typeof realFetch };
});

const settings = {
  EG_ENFORCE_ENGINE_ENDPOINT_POLICY: 'true', EG_ENGINE_ALLOW_PRIVATE_HOSTS: 'true',
  EG_ALLOW_INSECURE_ENGINE_HTTP: 'true', EG_MANAGED_ENGINE_INTERNAL_DNS_SUFFIX: 'managed.svc.cluster.local',
  EG_ENGINE_ALLOWED_HOSTS: '*.managed.svc.cluster.local',
};
const hostname = `egme-${'a'.repeat(40)}.managed.svc.cluster.local`;
const baseUrl = `http://${hostname}:8081/engine-rest`;
async function withPolicy(action: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  try { await action(); }
  finally { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } }
}

describe('managed REST request boundary', () => {
  it('reaches health, overview, BPMN and typed variables through the real bounded HTTP transport', async () => withPolicy(async () => {
    const requests: string[] = [];
    const replies: Record<string, unknown> = {
      '/engine-rest/version': { version: '2.1.4' },
      '/engine-rest/process-instance?active=true': [{ id: 'instance-1' }],
      '/engine-rest/process-definition/order%3A1%3Aid/xml': { bpmn20Xml: '<bpmn:definitions><bpmndi:BPMNDiagram /></bpmn:definitions>' },
      '/engine-rest/history/variable-instance?processInstanceId=instance-1': [{ name: 'amount', type: 'Integer', value: 84 }],
    };
    const server = createServer((request, response) => {
      requests.push(request.url!);
      response.setHeader('Content-Type', 'application/json');
      if (request.headers.host !== `${hostname}:8081` || request.headers.authorization !== `Basic ${Buffer.from('enterpriseglue:synthetic-password').toString('base64')}`) {
        response.writeHead(401); response.end('{}'); return;
      }
      response.end(JSON.stringify(replies[request.url!] ?? {}));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('fixture address missing');
    // Test-only DNS/port mapping; production URL validation and HTTP transport
    // still execute unchanged. No external engine or network is contacted.
    const dispatcher = new Agent({ connect(options, callback) {
      if (options.hostname !== hostname || Number(options.port) !== 8081) { callback(Error('unexpected fixture target'), null); return; }
      const socket = connect({ host: '127.0.0.1', port: address.port });
      socket.once('connect', () => callback(null, socket));
      socket.once('error', (error) => callback(error, null));
    } });
    forwarded.dispatcher = dispatcher;
    try {
      for (const [resource, reply] of Object.entries(replies)) {
        const result = await fetchBpmnEngineEndpoint({ id: 'managed-1', baseUrl, authType: 'basic', username: 'enterpriseglue', passwordEnc: 'synthetic-password' },
          { engineId: 'managed-1', method: 'GET', path: resource.slice('/engine-rest'.length) });
        expect(result.response.status).toBe(200);
        expect(await result.response.json()).toEqual(reply);
      }
      expect(requests).toEqual(Object.keys(replies));
    } finally {
      forwarded.dispatcher = undefined;
      await dispatcher.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }));

  it('rejects escapes and ambiguous encoded paths before outbound transport', async () => withPolicy(async () => {
    const before = forwarded.count;
    for (const path of ['https://other.example/version', '//other.example/version', '/../admin', '/%2e%2e/admin',
      '/%2e%2e%2fadmin', '/%252e%252e%252fadmin', '/..;/admin', '/version#fragment', '/%0aadmin', '/%5cadmin', '\\..\\admin']) {
      await expect(fetchBpmnEngineEndpoint({ id: 'managed-1', baseUrl, authType: 'none' }, { path })).rejects.toThrow();
    }
    expect(forwarded.count).toBe(before);
    // Resource support must not relax the externally supplied registration base.
    for (const suffix of ['/version', '?active=true', '#fragment']) expect(() => validateBpmnEngineEndpointUrl(baseUrl + suffix)).toThrow();
  }));

  it('still requires every private-engine opt-in and the exact managed authority', async () => withPolicy(async () => {
    for (const key of Object.keys(settings).filter((key) => key !== 'EG_ENFORCE_ENGINE_ENDPOINT_POLICY')) {
      const value = process.env[key];
      delete process.env[key];
      try { expect(() => resolveBpmnEngineRequestUrl(baseUrl, '/version')).toThrow(); }
      finally { process.env[key] = value; }
    }
    for (const invalid of [baseUrl.replace(hostname, 'unowned.managed.svc.cluster.local'), baseUrl.replace(':8081', ':8082'), baseUrl.replace('/engine-rest', '/other')]) {
      expect(() => resolveBpmnEngineRequestUrl(invalid, '/version')).toThrow();
    }
  }));
});
