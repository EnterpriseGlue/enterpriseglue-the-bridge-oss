import { createServer } from 'node:http';

const AUTHORIZATION_ID_PATH = /^\/engine-rest\/authorization\/[^/]+$/;
const EXACT_AUTHORIZATION_QUERY_KEYS = ['groupId', 'resourceId', 'resourceType', 'type'];
const MAX_EXACT_AUTHORIZATION_ROWS = 1_000;
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_UPSTREAM_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;

async function readBoundedIncomingBody(request) {
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) throw new Error('request_too_large');
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBoundedUpstreamBody(response) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPSTREAM_RESPONSE_BYTES) throw new Error('upstream_response_too_large');
  const chunks = [];
  let total = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      total += bytes.length;
      if (total > MAX_UPSTREAM_RESPONSE_BYTES) {
        await response.body.cancel().catch(() => undefined);
        throw new Error('upstream_response_too_large');
      }
      chunks.push(bytes);
    }
  }
  return Buffer.concat(chunks);
}

function jsonObject(body) {
  const value = JSON.parse(body.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_json_object');
  return value;
}

function trackedAuthorization(body, expectedId) {
  const row = jsonObject(body);
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  if (id !== expectedId
    || Number(row.type) !== 1
    || !Array.isArray(row.permissions) || row.permissions.length !== 1 || row.permissions[0] !== 'READ'
    || typeof row.groupId !== 'string' || !row.groupId.trim()
    || ![6, 10].includes(Number(row.resourceType))
    || typeof row.resourceId !== 'string' || !row.resourceId.trim()) throw new Error('invalid_tracked_authorization');
  return {
    id,
    type: 1,
    permissions: ['READ'],
    groupId: row.groupId,
    resourceType: Number(row.resourceType),
    resourceId: row.resourceId,
  };
}

function exactAuthorizationQuery(url) {
  if (url.pathname !== '/engine-rest/authorization') return null;
  const keys = [...url.searchParams.keys()].sort();
  if (keys.length !== EXACT_AUTHORIZATION_QUERY_KEYS.length
    || keys.some((key, index) => key !== EXACT_AUTHORIZATION_QUERY_KEYS[index])
    || EXACT_AUTHORIZATION_QUERY_KEYS.some((key) => url.searchParams.getAll(key).length !== 1)) return null;
  const type = url.searchParams.get('type');
  const groupId = url.searchParams.get('groupId') || '';
  const resourceType = url.searchParams.get('resourceType');
  const resourceId = url.searchParams.get('resourceId') || '';
  if (type !== '1' || !['6', '10'].includes(resourceType || '')) return null;
  if (!groupId.trim() || groupId.length > 256 || groupId === '*') return null;
  if (!resourceId.trim() || resourceId.length > 512 || resourceId === '*') return null;
  return { type: 1, groupId, resourceType: Number(resourceType), resourceId };
}

function isValidCreateBody(body) {
  try {
    const value = JSON.parse(body.toString('utf8'));
    const keys = Object.keys(value || {}).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['groupId', 'permissions', 'resourceId', 'resourceType', 'type'])) return false;
    return value.type === 1
      && Array.isArray(value.permissions) && value.permissions.length === 1 && value.permissions[0] === 'READ'
      && typeof value.groupId === 'string' && value.groupId.trim() && value.groupId.length <= 256 && value.groupId !== '*'
      && [6, 10].includes(value.resourceType)
      && typeof value.resourceId === 'string' && value.resourceId.trim() && value.resourceId.length <= 512 && value.resourceId !== '*';
  } catch {
    return false;
  }
}

function allowedNativeAuthorizationOperation(method, url) {
  if (method === 'POST' && url.pathname === '/engine-rest/authorization/create' && !url.search) return 'create';
  if ((method === 'GET' || method === 'DELETE') && AUTHORIZATION_ID_PATH.test(url.pathname) && !url.search) return 'tracked-id';
  if (method === 'GET' && exactAuthorizationQuery(url)) return 'exact-inventory';
  return null;
}

/**
 * Minimal customer-sidecar reference adapter for the mirrored-backstop contract.
 * It deliberately is not a general engine proxy: only the four ownership-safe
 * native authorization call forms are forwarded. The caller never supplies the
 * downstream credential; the sidecar owns that boundary.
 */
export async function startCustomerSidecarReference(engineBaseUrl, {
  rejectNativeWrites = false,
  malformedAuthorizationCreateResponse = false,
  responseDelayMs = 0,
  upstreamTimeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
  upstreamAuthorization = null,
  listenHost = '127.0.0.1',
  listenPort = 0,
} = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://customer-sidecar.local');
    let body;
    try {
      body = await readBoundedIncomingBody(request);
    } catch {
      response.writeHead(413, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'customer sidecar request exceeded the allowed size' }));
      return;
    }
    requests.push({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: request.headers,
      body: body.toString('utf8'),
    });
    const operation = allowedNativeAuthorizationOperation(request.method, url);
    if (!operation || (operation === 'create' && !isValidCreateBody(body))) {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'native authorization operation is not allowed by the customer sidecar reference' }));
      return;
    }
    if (rejectNativeWrites && request.method === 'POST') {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'native authorization writes are denied by customer sidecar policy' }));
      return;
    }
    if (responseDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, responseDelayMs));
    }
    const headers = body.length > 0 ? { 'content-type': request.headers['content-type'] || 'application/json' } : {};
    if (upstreamAuthorization) headers.authorization = upstreamAuthorization;
    try {
      const upstream = await fetch(`${engineBaseUrl}${url.pathname.slice('/engine-rest'.length)}${url.search}`, {
        method: request.method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: body.length > 0 ? body : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(Math.max(1, Math.min(Number(upstreamTimeoutMs) || DEFAULT_UPSTREAM_TIMEOUT_MS, 60_000))),
      });
      const upstreamBody = await readBoundedUpstreamBody(upstream);
      if (!upstream.ok) {
        if (upstream.status === 404 && operation === 'tracked-id') {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'native authorization was not found' }));
          return;
        }
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'customer sidecar engine operation failed' }));
        return;
      }
      if (operation === 'exact-inventory' && upstream.ok) {
        try {
          const expected = exactAuthorizationQuery(url);
          const rows = JSON.parse(upstreamBody.toString('utf8'));
          if (!expected || !Array.isArray(rows) || rows.length > MAX_EXACT_AUTHORIZATION_ROWS) throw new Error('invalid exact inventory');
          const exactRows = rows.filter((row) => row && typeof row === 'object'
            && typeof row.id === 'string' && row.id.trim()
            && Number(row.type) === expected.type
            && row.groupId === expected.groupId
            && Number(row.resourceType) === expected.resourceType
            && row.resourceId === expected.resourceId)
            .map((row) => ({
              id: row.id.trim(),
              type: expected.type,
              groupId: expected.groupId,
              resourceType: expected.resourceType,
              resourceId: expected.resourceId,
            }));
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify(exactRows));
          return;
        } catch {
          response.writeHead(502, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'customer sidecar received an invalid exact authorization inventory' }));
          return;
        }
      }
      if (malformedAuthorizationCreateResponse && request.method === 'POST' && url.pathname === '/engine-rest/authorization/create') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ accepted: true }));
        return;
      }
      if (operation === 'create') {
        try {
          const value = jsonObject(upstreamBody);
          const id = typeof value.id === 'string' ? value.id.trim() : '';
          if (!id || id.length > 512) throw new Error('invalid_create_response');
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ id }));
        } catch {
          response.writeHead(502, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'customer sidecar received an invalid authorization create response' }));
        }
        return;
      }
      if (request.method === 'GET') {
        try {
          const expectedId = decodeURIComponent(url.pathname.slice('/engine-rest/authorization/'.length));
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify(trackedAuthorization(upstreamBody, expectedId)));
        } catch {
          response.writeHead(502, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'customer sidecar received an invalid tracked authorization response' }));
        }
        return;
      }
      response.writeHead(204);
      response.end();
    } catch {
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'customer sidecar could not reach its engine' }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, listenHost, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Customer sidecar reference did not bind a TCP port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/engine-rest`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
