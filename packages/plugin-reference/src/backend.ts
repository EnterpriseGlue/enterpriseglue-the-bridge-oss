import { createHash, type KeyObject } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  pluginEventDeliveryV1Schema,
  pluginFixedScheduleResponseV1Schema,
  pluginScheduledJobDeliveryV1Schema,
  pluginStorageMutationResponseV1Schema,
} from '@enterpriseglue/plugin-sdk';

import type { PluginInvocationReplayStoreV1 } from '@enterpriseglue/plugin-runtime/gateway';
import {
  PluginGatewayError,
  verifyPluginInvocationV1,
} from '@enterpriseglue/plugin-runtime/gateway';

import {
  REFERENCE_EVENT_DELIVERY_OPERATION,
  REFERENCE_PLUGIN_ID,
  REFERENCE_PLUGIN_VERSION,
  REFERENCE_QUALIFICATION_OPERATION,
  REFERENCE_SCHEDULE_DELIVERY_OPERATION,
  REFERENCE_SCHEDULE_JOB_TYPE,
  REFERENCE_STATUS_OPERATION,
} from './frontend.js';
import { ReferenceFileReplayStoreV1 } from './replayStore.js';

const CAPABILITIES_PATH = '/_plugin/capabilities';
const HEALTH_PATH = '/_plugin/health';
const READY_PATH = '/_plugin/ready';
const STATUS_PATH = '/v1/status';
const QUALIFICATION_PATH = '/v1/qualification';
const SCHEDULE_DELIVERY_PATH = '/v1/scheduled-health';
const EVENT_DELIVERY_PATH = '/v1/events/engine-inventory';

interface OperationSchemaHashesV1 {
  requestSchemaSha256: string;
  responseSchemaSha256: string;
}

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
  operationSchemas?: Record<string, OperationSchemaHashesV1>;
  hostBrokerBaseUrl?: string;
  deliveryEvidenceFile?: string;
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
        ...Object.entries(options.operationSchemas ?? {}).map(
          ([operationId, hashes]) => ({ operationId, ...hashes }),
        ),
      ],
      optionalFeatures: [],
    });
    return;
  }
  const operation = operationFor(request.url, request.method);
  if (!operation) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }
  const token = firstHeader(
    request.headers['x-enterpriseglue-plugin-invocation'],
  );
  if (!token) {
    sendJson(response, 401, { error: 'invocation_required' });
    return;
  }
  const claims = await verifyPluginInvocationV1({
    token,
    publicKey: options.invocationPublicKey,
    expectedAudience: REFERENCE_PLUGIN_ID,
    expectedOperationId: operation.operationId,
    replayStore,
    nowEpochSeconds:
      options.nowEpochSeconds?.() ?? Math.floor(Date.now() / 1_000),
  });
  if (operation.operationId === REFERENCE_STATUS_OPERATION) {
    sendJson(response, 200, {
      status: 'ready',
      pluginId: REFERENCE_PLUGIN_ID,
      version: REFERENCE_PLUGIN_VERSION,
      apiRevision: '1',
    });
    return;
  }
  const body = await readJsonBody(request);
  if (operation.operationId === REFERENCE_QUALIFICATION_OPERATION) {
    if (!claims.tenantRef) {
      sendJson(response, 403, { error: 'tenant_required' });
      return;
    }
    const runRef = qualificationRunRef(body);
    if (!runRef) {
      sendJson(response, 400, { error: 'request_invalid' });
      return;
    }
    const brokerBaseUrl = options.hostBrokerBaseUrl?.replace(/\/$/, '');
    if (!brokerBaseUrl) {
      sendJson(response, 503, { error: 'host_broker_unavailable' });
      return;
    }
    const storage = pluginStorageMutationResponseV1Schema.parse(
      await brokerCall(
        brokerBaseUrl,
        'storage',
        token,
        {
          apiVersion: 'storage-request.plugin.enterpriseglue.io/v1',
          callId: `qualification-${runRef}-storage`,
          operationId: REFERENCE_QUALIFICATION_OPERATION,
          scope: 'tenant',
          key: `qualification/${runRef}`,
          action: 'put',
          value: { runRef, status: 'qualified' },
        },
      ),
    );
    const schedule = pluginFixedScheduleResponseV1Schema.parse(
      await brokerCall(
        brokerBaseUrl,
        'schedules',
        token,
        {
          apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1',
          callId: `qualification-${runRef}-schedule`,
          operationId: REFERENCE_QUALIFICATION_OPERATION,
          jobType: REFERENCE_SCHEDULE_JOB_TYPE,
          idempotencyKey: `qualification-${runRef}-schedule`,
          action: 'upsert',
          intervalSeconds: 60,
        },
      ),
    );
    if (storage.action !== 'put') {
      throw new Error('host_broker_storage_result_invalid');
    }
    sendJson(response, 200, {
      status: 'qualified',
      storage: { action: storage.action, revision: storage.revision },
      schedule: {
        status: schedule.status,
        jobRef: schedule.jobRef,
        revision: schedule.revision,
      },
    });
    return;
  }
  if (operation.operationId === REFERENCE_SCHEDULE_DELIVERY_OPERATION) {
    const delivery = pluginScheduledJobDeliveryV1Schema.parse(body);
    await recordDeliveryEvidence(
      options.deliveryEvidenceFile,
      'schedule',
      delivery.deliveryId,
      claims.tenantRef,
    );
    sendJson(response, 200, {
      apiVersion: 'scheduled-job-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: delivery.deliveryId,
      status: 'accepted',
      reasonCode: 'qualified',
    });
    return;
  }
  const delivery = pluginEventDeliveryV1Schema.parse(body);
  await recordDeliveryEvidence(
    options.deliveryEvidenceFile,
    'event',
    delivery.deliveryId,
    claims.tenantRef,
  );
  sendJson(response, 200, {
    apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
    deliveryId: delivery.deliveryId,
    status: 'accepted',
    reasonCode: 'qualified',
  });
}

async function recordDeliveryEvidence(
  file: string | undefined,
  kind: 'schedule' | 'event',
  deliveryId: string,
  tenantRef: string | undefined,
): Promise<void> {
  if (!file) return;
  await appendFile(
    file,
    `${JSON.stringify({ kind, deliveryId, tenantRef: tenantRef ?? null })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

function operationFor(
  path: string | undefined,
  method: string | undefined,
): { operationId: string } | undefined {
  const key = `${method ?? ''} ${path ?? ''}`;
  return (
    {
      [`GET ${STATUS_PATH}`]: { operationId: REFERENCE_STATUS_OPERATION },
      [`POST ${QUALIFICATION_PATH}`]: {
        operationId: REFERENCE_QUALIFICATION_OPERATION,
      },
      [`POST ${SCHEDULE_DELIVERY_PATH}`]: {
        operationId: REFERENCE_SCHEDULE_DELIVERY_OPERATION,
      },
      [`POST ${EVENT_DELIVERY_PATH}`]: {
        operationId: REFERENCE_EVENT_DELIVERY_OPERATION,
      },
    } as Record<string, { operationId: string }>
  )[key];
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > 16_384) throw new Error('request_too_large');
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('request_invalid');
  }
}

function qualificationRunRef(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value);
  const runRef = (value as Record<string, unknown>).runRef;
  return keys.length === 1 &&
    typeof runRef === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(runRef)
    ? runRef
    : undefined;
}

async function brokerCall(
  baseUrl: string,
  suffix: string,
  token: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetch(
    `${baseUrl}/_enterpriseglue/plugin-broker/v1/${REFERENCE_PLUGIN_ID}/${suffix}`,
    {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        'x-enterpriseglue-plugin-invocation': token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3_000),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('host_broker_rejected');
  return result;
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
  const schemaFiles = {
    [REFERENCE_QUALIFICATION_OPERATION]: [
      'qualification.request.schema.json',
      'qualification.response.schema.json',
    ],
    [REFERENCE_SCHEDULE_DELIVERY_OPERATION]: [
      'scheduled-health.delivery.schema.json',
      'scheduled-health.receipt.schema.json',
    ],
    [REFERENCE_EVENT_DELIVERY_OPERATION]: [
      'engine-inventory.delivery.schema.json',
      'engine-inventory.receipt.schema.json',
    ],
  } as const;
  const [publicKey, requestSchema, responseSchema, operationSchemas] = await Promise.all([
    readFile(publicKeyFile),
    readFile(resolve(schemaRoot, 'status.request.schema.json')),
    readFile(resolve(schemaRoot, 'status.response.schema.json')),
    Promise.all(
      Object.entries(schemaFiles).map(async ([operationId, files]) => {
        const [requestBytes, responseBytes] = await Promise.all(
          files.map((file) => readFile(resolve(schemaRoot, file))),
        );
        return [
          operationId,
          {
            requestSchemaSha256: sha256(requestBytes),
            responseSchemaSha256: sha256(responseBytes),
          },
        ] as const;
      }),
    ).then((entries) => Object.fromEntries(entries)),
  ]);
  const server = createReferencePluginServerV1({
    invocationPublicKey: publicKey,
    requestSchemaSha256: sha256(requestSchema),
    responseSchemaSha256: sha256(responseSchema),
    operationSchemas,
    ...(process.env.REFERENCE_PLUGIN_HOST_BROKER_BASE_URL?.trim()
      ? {
          hostBrokerBaseUrl:
            process.env.REFERENCE_PLUGIN_HOST_BROKER_BASE_URL.trim(),
        }
      : {}),
    deliveryEvidenceFile: resolve(
      process.env.REFERENCE_PLUGIN_DATA_DIR?.trim() ??
        '/var/lib/enterpriseglue/reference-health',
      'qualification-deliveries.jsonl',
    ),
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
