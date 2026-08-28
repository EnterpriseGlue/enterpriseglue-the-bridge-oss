import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const host = '127.0.0.1';
const port = 8791;
const expectedToken = process.env.EG_TENANT_SECRET_BROKER_TOKEN || '';
const purposes = new Set([
  'oidc.client_secret',
  'saml.metadata_xml',
  'saml.idp_signing_certificate',
  'saml.request_signing_private_key',
  'saml.request_signing_certificate',
  'ldap.bind_password',
  'ldap.tls_trust_certificate',
]);
const values = new Map();
const retired = new Set();
const maxRequestBytes = 384 * 1024;

if (!expectedToken) throw new Error('EG_TENANT_SECRET_BROKER_TOKEN is required');

function authenticated(value) {
  const actual = Buffer.from(String(value || ''), 'utf8');
  const expected = Buffer.from(`Bearer ${expectedToken}`, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function reference(tenantId, purpose, opaqueId) {
  return `tenant-secret://v1/${tenantId}/${purpose}/${opaqueId}`;
}

function parseReference(value) {
  const match = /^tenant-secret:\/\/v1\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(String(value || ''));
  return match ? { tenantId: match[1], purpose: match[2], opaqueId: match[3] } : null;
}

function validContext(body, request) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(String(body.tenantId || ''))
    && purposes.has(body.purpose)
    && String(request.headers['x-enterpriseglue-tenant-id'] || '') === body.tenantId
    && String(request.headers['x-correlation-id'] || '') === body.correlationId;
}

function boundReference(value, body) {
  const parsed = parseReference(value);
  return parsed && parsed.tenantId === body.tenantId && parsed.purpose === body.purpose;
}

function respond(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  response.end(payload);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'POST' || !authenticated(request.headers.authorization)) {
      respond(response, 401, { error: 'unauthorized' });
      return;
    }
    const body = await readBody(request);
    if (!validContext(body, request)) {
      respond(response, 400, { error: 'invalid_context' });
      return;
    }
    const operation = /^\/v1\/tenant-secrets:(put|resolve|availability|retire)$/.exec(request.url || '')?.[1];
    if (!operation) {
      respond(response, 404, { error: 'not_found' });
      return;
    }

    if (operation === 'put') {
      if (typeof body.value !== 'string' || !body.value || Buffer.byteLength(body.value, 'utf8') > 256 * 1024) {
        respond(response, 400, { error: 'invalid_value' });
        return;
      }
      if (body.previousReference && !boundReference(body.previousReference, body)) {
        respond(response, 400, { error: 'invalid_previous_reference' });
        return;
      }
      const next = reference(body.tenantId, body.purpose, randomUUID());
      const version = String(values.size + retired.size + 1);
      values.set(next, { value: body.value, version });
      respond(response, 200, { reference: next, version, updatedAt: Date.now() });
      return;
    }

    if (!boundReference(body.reference, body)) {
      respond(response, 400, { error: 'invalid_reference' });
      return;
    }
    const stored = values.get(body.reference);
    if (operation === 'resolve') {
      if (!stored || retired.has(body.reference)) {
        respond(response, 404, { error: 'not_found' });
        return;
      }
      respond(response, 200, { reference: body.reference, value: stored.value, version: stored.version });
      return;
    }
    if (operation === 'availability') {
      const available = Boolean(stored) && !retired.has(body.reference);
      respond(response, 200, available
        ? { available: true, version: stored.version }
        : { available: false, reason: retired.has(body.reference) ? 'retired' : 'not_found' });
      return;
    }
    const didRetire = Boolean(stored) && !retired.has(body.reference);
    if (didRetire) retired.add(body.reference);
    respond(response, 200, { retired: didRetire, retiredAt: Date.now() });
  } catch {
    respond(response, 400, { error: 'invalid_request' });
  }
});

server.listen(port, host);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
