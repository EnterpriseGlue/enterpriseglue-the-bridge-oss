import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { signPluginInvocationV1 } from '@enterpriseglue/plugin-runtime/gateway';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createReferencePluginServerV1,
  type ReferencePluginServerOptionsV1,
} from './backend.js';
import {
  REFERENCE_PLUGIN_ID,
  REFERENCE_STATUS_OPERATION,
} from './frontend.js';

const servers = new Set<ReturnType<typeof createReferencePluginServerV1>>();

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
});

async function listen(
  server: ReturnType<typeof createReferencePluginServerV1>,
): Promise<string> {
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolvePromise, reject) => {
    server.once('listening', resolvePromise);
    server.once('error', reject);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
