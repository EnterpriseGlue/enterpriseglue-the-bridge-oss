import { createHash, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { PluginInvocationReplayStoreV1 } from '@enterpriseglue/plugin-runtime/gateway';
import {
  PluginGatewayError,
  verifyPluginInvocationV1,
} from '@enterpriseglue/plugin-runtime/gateway';

import {
  REFERENCE_PLUGIN_ID,
  REFERENCE_PLUGIN_VERSION,
  REFERENCE_STATUS_OPERATION,
} from './frontend.js';
import { ReferenceFileReplayStoreV1 } from './replayStore.js';

const CAPABILITIES_PATH = '/_plugin/capabilities';
const HEALTH_PATH = '/_plugin/health';
const READY_PATH = '/_plugin/ready';
const STATUS_PATH = '/v1/status';

class MemoryReplayStore implements PluginInvocationReplayStoreV1 {
  private readonly entries = new Map<string, number>();

  constructor(private readonly nowEpochSeconds = () => Math.floor(Date.now() / 1_000)) {}

  async consume(jti: string, expiresAtEpochSeconds: number): Promise<boolean> {
    const now = this.nowEpochSeconds();
    for (const [key, expiry] of this.entries) {
      if (expiry < now) this.entries.delete(key);
    }
    if (this.entries.has(jti)) return false;
    this.entries.set(jti, expiresAtEpochSeconds);
    return true;
  }
}

export interface ReferencePluginServerOptionsV1 {
  invocationPublicKey: KeyObject | string | Buffer;
  requestSchemaSha256: string;
  responseSchemaSha256: string;
  replayStore?: PluginInvocationReplayStoreV1;
  nowEpochSeconds?: () => number;
}

export function createReferencePluginServerV1(
  options: ReferencePluginServerOptionsV1,
): Server {
  const replayStore =
    options.replayStore ?? new MemoryReplayStore(options.nowEpochSeconds);
  return createServer((request, response) => {
    handleRequest(request, response, options, replayStore).catch((error) => {
      const status =
        error instanceof PluginGatewayError &&
        (error.code.startsWith('token_') || error.code === 'permission_denied')
          ? 401
          : 500;
      sendJson(response, status, { error: 'reference_plugin_request_failed' });
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ReferencePluginServerOptionsV1,
  replayStore: PluginInvocationReplayStoreV1,
): Promise<void> {
  if (request.url === HEALTH_PATH && request.method === 'GET') {
    sendJson(response, 200, { status: 'alive' });
    return;
  }
  if (request.url === READY_PATH && request.method === 'GET') {
    sendJson(response, 200, { ready: true, reasonCode: 'ready' });
    return;
  }
  if (request.url === CAPABILITIES_PATH && request.method === 'GET') {
    sendJson(response, 200, {
      protocol: 'backend.plugin.enterpriseglue.io/v1',
      pluginId: REFERENCE_PLUGIN_ID,
      pluginVersion: REFERENCE_PLUGIN_VERSION,
      apiRevision: '1',
      schemaRevision: 0,
      operations: [
        {
          operationId: REFERENCE_STATUS_OPERATION,
          requestSchemaSha256: options.requestSchemaSha256,
          responseSchemaSha256: options.responseSchemaSha256,
        },
      ],
      optionalFeatures: [],
    });
    return;
  }
  if (request.url !== STATUS_PATH) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  const token = firstHeader(
    request.headers['x-enterpriseglue-plugin-invocation'],
  );
  if (!token) {
    sendJson(response, 401, { error: 'invocation_required' });
    return;
  }
  await verifyPluginInvocationV1({
    token,
    publicKey: options.invocationPublicKey,
    expectedAudience: REFERENCE_PLUGIN_ID,
    expectedOperationId: REFERENCE_STATUS_OPERATION,
    replayStore,
    nowEpochSeconds:
      options.nowEpochSeconds?.() ?? Math.floor(Date.now() / 1_000),
  });
  sendJson(response, 200, {
    status: 'ready',
    pluginId: REFERENCE_PLUGIN_ID,
    version: REFERENCE_PLUGIN_VERSION,
    apiRevision: '1',
  });
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function startReferencePlugin(): Promise<void> {
  const publicKeyFile =
    process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PUBLIC_KEY_FILE?.trim();
  if (!publicKeyFile) {
    throw new Error('Plugin invocation public key file is required');
  }
  const schemaRoot =
    process.env.REFERENCE_PLUGIN_SCHEMA_ROOT?.trim() ??
    '/opt/enterpriseglue/reference-plugin/schemas';
  const [publicKey, requestSchema, responseSchema] = await Promise.all([
    readFile(publicKeyFile),
    readFile(resolve(schemaRoot, 'status.request.schema.json')),
    readFile(resolve(schemaRoot, 'status.response.schema.json')),
  ]);
  const server = createReferencePluginServerV1({
    invocationPublicKey: publicKey,
    requestSchemaSha256: sha256(requestSchema),
    responseSchemaSha256: sha256(responseSchema),
    replayStore: new ReferenceFileReplayStoreV1(
      resolve(
        process.env.REFERENCE_PLUGIN_DATA_DIR?.trim() ??
          '/var/lib/enterpriseglue/reference-health',
        'invocation-replay.json',
      ),
    ),
  });
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error('PORT must be an unprivileged TCP port');
  }
  server.listen(port, '0.0.0.0');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  startReferencePlugin().catch(() => {
    process.exitCode = 1;
  });
}
