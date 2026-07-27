import { createServer } from 'node:http';

const pluginId =
  'io.enterpriseglue.reference-health-secondary';
const pluginVersion =
  process.env.SECONDARY_PLUGIN_VERSION?.trim();
const pluginMode =
  process.env.SECONDARY_PLUGIN_MODE?.trim();
const configuredPluginId =
  process.env.ENTERPRISEGLUE_PLUGIN_ID?.trim();

if (
  pluginVersion !== '0.1.0' &&
  pluginVersion !== '0.2.0' &&
  pluginVersion !== '0.3.0' &&
  pluginVersion !== '0.4.0' &&
  pluginVersion !== '0.5.0'
) {
  throw new Error('Secondary lifecycle fixture version is invalid');
}
if (
  pluginMode !== 'ready' &&
  pluginMode !== 'readiness-fail' &&
  pluginMode !== 'crash'
) {
  throw new Error('Secondary lifecycle fixture mode is invalid');
}
if (configuredPluginId && configuredPluginId !== pluginId) {
  throw new Error('Secondary lifecycle fixture identity mismatch');
}
if (pluginMode === 'crash') {
  throw new Error('Synthetic secondary lifecycle crash');
}

const server = createServer((request, response) => {
  if (
    request.method === 'GET' &&
    request.url === '/_plugin/health'
  ) {
    send(response, 200, { status: 'alive' });
    return;
  }
  if (
    request.method === 'GET' &&
    request.url === '/_plugin/ready'
  ) {
    if (pluginMode === 'readiness-fail') {
      send(response, 503, {
        ready: false,
        reasonCode: 'synthetic_not_ready',
      });
      return;
    }
    send(response, 200, { ready: true, reasonCode: 'ready' });
    return;
  }
  if (
    request.method === 'GET' &&
    request.url === '/_plugin/capabilities'
  ) {
    send(response, 200, {
      protocol: 'backend.plugin.enterpriseglue.io/v1',
      pluginId,
      pluginVersion,
      apiRevision: '1',
      schemaRevision: 0,
      operations: [],
      optionalFeatures: [],
    });
    return;
  }
  send(response, 404, { error: 'not_found' });
});

const port = Number(process.env.PORT ?? '8080');
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
  throw new Error('Secondary lifecycle fixture port is invalid');
}
server.listen(port, '0.0.0.0');

function send(response, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}
