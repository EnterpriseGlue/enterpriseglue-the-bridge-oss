import { createServer } from 'node:http';

const AUTHORIZATION_ID_PATH = /^\/engine-rest\/authorization\/[^/]+$/;

function allowedNativeAuthorizationOperation(method, path) {
  return (method === 'POST' && path === '/engine-rest/authorization/create')
    || ((method === 'GET' || method === 'DELETE') && AUTHORIZATION_ID_PATH.test(path));
}

/**
 * Minimal customer-sidecar reference adapter for the mirrored-backstop contract.
 * It deliberately is not a general engine proxy: only the three ownership-safe
 * native authorization calls are forwarded. The caller never supplies the
 * downstream credential; the sidecar owns that boundary.
 */
export async function startCustomerSidecarReference(engineBaseUrl, {
  rejectNativeWrites = false,
  upstreamAuthorization = null,
  listenHost = '127.0.0.1',
  listenPort = 0,
} = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://customer-sidecar.local');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    requests.push({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: request.headers,
      body: body.toString('utf8'),
    });
    if (!allowedNativeAuthorizationOperation(request.method, url.pathname)) {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'native authorization operation is not allowed by the customer sidecar reference' }));
      return;
    }
    if (rejectNativeWrites && request.method === 'POST') {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'native authorization writes are denied by customer sidecar policy' }));
      return;
    }
    const headers = body.length > 0 ? { 'content-type': request.headers['content-type'] || 'application/json' } : {};
    if (upstreamAuthorization) headers.authorization = upstreamAuthorization;
    try {
      const upstream = await fetch(`${engineBaseUrl}${url.pathname.slice('/engine-rest'.length)}${url.search}`, {
        method: request.method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: body.length > 0 ? body : undefined,
      });
      const upstreamBody = Buffer.from(await upstream.arrayBuffer());
      const contentType = upstream.headers.get('content-type');
      response.writeHead(upstream.status, contentType ? { 'content-type': contentType } : undefined);
      response.end(upstreamBody);
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
