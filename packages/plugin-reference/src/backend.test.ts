import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { signPluginInvocationV1 } from '@enterpriseglue/plugin-runtime/gateway';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createReferencePluginServerV1,
  type ReferencePluginServerOptionsV1,
} from './backend.js';
import {
  REFERENCE_PLUGIN_ID,
  REFERENCE_EVENT_DELIVERY_OPERATION,
  REFERENCE_QUALIFICATION_OPERATION,
  REFERENCE_SCHEDULE_DELIVERY_OPERATION,
  REFERENCE_SCHEDULE_JOB_TYPE,
  REFERENCE_STATUS_OPERATION,
} from './frontend.js';

const servers = new Set<Server>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolvePromise) => {
          server.close(() => resolvePromise());
        }),
    ),
  );
  servers.clear();
});

describe('reference plugin backend', () => {
  it('exposes safe probes/capabilities and verifies one-time invocation', async () => {
    const keys = generateKeyPairSync('ed25519');
    const options: ReferencePluginServerOptionsV1 = {
      invocationPublicKey: keys.publicKey,
      requestSchemaSha256: 'a'.repeat(64),
      responseSchemaSha256: 'b'.repeat(64),
      nowEpochSeconds: () => 1_010,
    };
    const server = createReferencePluginServerV1(options);
    servers.add(server);
    const baseUrl = await listen(server);

    await expect(
      fetch(`${baseUrl}/_plugin/health`).then((response) => response.json()),
    ).resolves.toEqual({ status: 'alive' });
    const capabilities = (await (
      await fetch(`${baseUrl}/_plugin/capabilities`)
    ).json()) as { pluginId: string; operations: unknown[] };
    expect(capabilities.pluginId).toBe(REFERENCE_PLUGIN_ID);
    expect(capabilities.operations).toHaveLength(1);
    expect((await fetch(`${baseUrl}/v1/status`)).status).toBe(401);

    const token = signPluginInvocationV1(
      {
        iss: 'enterpriseglue-oss',
        aud: REFERENCE_PLUGIN_ID,
        sub: 'user-1',
        iat: 1_000,
        exp: 1_030,
        jti: 'reference-invocation-1',
        tenantRef: 'tenant-a',
        deploymentRef: 'deployment-1',
        operationId: REFERENCE_STATUS_OPERATION,
        grantedPermissions: ['host.identity.read_safe'],
        correlationId: 'correlation-1',
      },
      keys.privateKey,
    );
    const invoke = () =>
      fetch(`${baseUrl}/v1/status`, {
        headers: {
          'x-enterpriseglue-plugin-invocation': token,
        },
      });
    const first = await invoke();
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      status: 'ready',
      pluginId: REFERENCE_PLUGIN_ID,
    });
    expect((await invoke()).status).toBe(401);
  });

  it('qualifies tenant storage and schedules and accepts host-owned deliveries', async () => {
    const keys = generateKeyPairSync('ed25519');
    const brokerRequests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const broker = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      brokerRequests.push({ path: request.url ?? '', body });
      const result = request.url?.endsWith('/storage')
        ? {
            apiVersion: 'storage-result.plugin.enterpriseglue.io/v1',
            action: 'put',
            revision: 'r1',
          }
        : {
            apiVersion: 'fixed-schedule-result.plugin.enterpriseglue.io/v1',
            jobRef: 'job-reference-health',
            status: 'scheduled',
            nextRunAt: '2026-08-28T00:01:00.000Z',
            revision: 1,
          };
      const bytes = Buffer.from(JSON.stringify(result));
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': bytes.byteLength,
      });
      response.end(bytes);
    });
    servers.add(broker);
    const brokerBaseUrl = await listen(broker);
    const plugin = createReferencePluginServerV1({
      invocationPublicKey: keys.publicKey,
      requestSchemaSha256: 'a'.repeat(64),
      responseSchemaSha256: 'b'.repeat(64),
      operationSchemas: {
        [REFERENCE_QUALIFICATION_OPERATION]: {
          requestSchemaSha256: 'c'.repeat(64),
          responseSchemaSha256: 'd'.repeat(64),
        },
        [REFERENCE_SCHEDULE_DELIVERY_OPERATION]: {
          requestSchemaSha256: 'e'.repeat(64),
          responseSchemaSha256: 'f'.repeat(64),
        },
        [REFERENCE_EVENT_DELIVERY_OPERATION]: {
          requestSchemaSha256: '1'.repeat(64),
          responseSchemaSha256: '2'.repeat(64),
        },
      },
      hostBrokerBaseUrl: brokerBaseUrl,
      nowEpochSeconds: () => 1_010,
    });
    servers.add(plugin);
    const pluginBaseUrl = await listen(plugin);

    const token = (operationId: string, jti: string) =>
      signPluginInvocationV1(
        {
          iss: 'enterpriseglue-oss',
          aud: REFERENCE_PLUGIN_ID,
          sub: 'user-1',
          iat: 1_000,
          exp: 1_030,
          jti,
          tenantRef: 'tenant-a',
          deploymentRef: 'deployment-1',
          operationId,
          grantedPermissions: [
            'host.identity.read_safe',
            'host.plugin_storage.tenant',
            'host.jobs.schedule_fixed',
            'host.events.subscribe.engine_inventory',
          ],
          correlationId: `correlation-${jti}`,
        },
        keys.privateKey,
      );
    const invoke = (path: string, operationId: string, jti: string, body: unknown) =>
      fetch(`${pluginBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-enterpriseglue-plugin-invocation': token(operationId, jti),
        },
        body: JSON.stringify(body),
      });

    const qualification = await invoke(
      '/v1/qualification',
      REFERENCE_QUALIFICATION_OPERATION,
      'qualification-1',
      { runRef: 'pooled-e2e-1' },
    );
    expect(qualification.status).toBe(200);
    await expect(qualification.json()).resolves.toEqual({
      status: 'qualified',
      storage: { action: 'put', revision: 'r1' },
      schedule: {
        status: 'scheduled',
        jobRef: 'job-reference-health',
        revision: 1,
      },
    });
    expect(brokerRequests).toHaveLength(2);
    expect(brokerRequests[0]).toMatchObject({
      path: expect.stringMatching(/\/storage$/),
      body: {
        scope: 'tenant',
        key: 'qualification/pooled-e2e-1',
        action: 'put',
      },
    });
    expect(brokerRequests[0]?.body).not.toHaveProperty('tenantRef');
    expect(brokerRequests[1]).toMatchObject({
      path: expect.stringMatching(/\/schedules$/),
      body: {
        jobType: REFERENCE_SCHEDULE_JOB_TYPE,
        action: 'upsert',
        intervalSeconds: 60,
      },
    });

    const scheduleDelivery = {
      apiVersion: 'scheduled-job-delivery.plugin.enterpriseglue.io/v1',
      deliveryId: 'delivery-schedule-1',
      jobRef: 'job-reference-health',
      jobType: REFERENCE_SCHEDULE_JOB_TYPE,
      operationId: REFERENCE_SCHEDULE_DELIVERY_OPERATION,
      scheduledFor: '2026-08-28T00:00:00.000Z',
      attempt: 1,
    };
    await expect(
      invoke(
        '/v1/scheduled-health',
        REFERENCE_SCHEDULE_DELIVERY_OPERATION,
        'schedule-delivery-1',
        scheduleDelivery,
      ).then(async (response) => ({ status: response.status, body: await response.json() })),
    ).resolves.toMatchObject({
      status: 200,
      body: { deliveryId: 'delivery-schedule-1', status: 'accepted' },
    });

    const eventDelivery = {
      apiVersion: 'event-delivery.plugin.enterpriseglue.io/v1',
      deliveryId: 'delivery-event-1',
      operationId: REFERENCE_EVENT_DELIVERY_OPERATION,
      subscriptionType: 'io.enterpriseglue.host.engine-inventory.v1',
      attempt: 1,
      event: {
        specversion: '1.0',
        id: 'event-inventory-1',
        source: 'enterpriseglue-oss',
        type: 'io.enterpriseglue.host.engine-inventory.v1',
        subject: 'engine-reference-1',
        time: '2026-08-28T00:00:00.000Z',
        dataschema:
          'https://schemas.enterpriseglue.io/events/engine-inventory-v1.json',
        tenantRef: 'tenant-a',
        data: {
          engineRef: 'engine-reference-1',
          product: 'operaton',
          version: '7.24.0',
          observedAtBucket: '2026-08-28T00:00:00.000Z',
        },
      },
    };
    await expect(
      invoke(
        '/v1/events/engine-inventory',
        REFERENCE_EVENT_DELIVERY_OPERATION,
        'event-delivery-1',
        eventDelivery,
      ).then(async (response) => ({ status: response.status, body: await response.json() })),
    ).resolves.toMatchObject({
      status: 200,
      body: { deliveryId: 'delivery-event-1', status: 'accepted' },
    });
  });
});

async function listen(
  server: Server,
): Promise<string> {
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolvePromise, reject) => {
    server.once('listening', resolvePromise);
    server.once('error', reject);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
