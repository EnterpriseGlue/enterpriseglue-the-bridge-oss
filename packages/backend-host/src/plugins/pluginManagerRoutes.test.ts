import type { AddressInfo } from 'node:net';

import express, { type RequestHandler } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { registerPluginManagerInternalRoutesV1 } from './pluginManagerRoutes.js';
import type { PluginManagerStoreV1 } from './pluginManagerStore.js';

const allowWorkload: RequestHandler = (_request, _response, next) => next();
const denyWorkload: RequestHandler = (_request, response) => {
  response.status(401).json({ code: 'manager_workload_identity_invalid' });
};

function storeFixture(): PluginManagerStoreV1 {
  return {
    createIntent: vi.fn(),
    listInstallations: vi.fn(),
    getInstallation: vi.fn(),
    approve: vi.fn(),
    advertiseCapability: vi.fn(async () => undefined),
    claim: vi.fn(async () => null),
    renew: vi.fn(),
    publishReview: vi.fn(),
    readApproval: vi.fn(),
    publishObservation: vi.fn(),
  } as unknown as PluginManagerStoreV1;
}

function application(input: {
  store: PluginManagerStoreV1;
  middleware: RequestHandler[];
  identity?: string;
}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  registerPluginManagerInternalRoutesV1(app, input.store, {
    middleware: input.middleware,
    managerIdentity: () => input.identity ?? 'manager-001',
  });
  return app;
}

describe('plugin manager internal routes', () => {
  it('runs workload authentication before reading or mutating manager state', async () => {
    const store = storeFixture();
    await withServer(
      application({ store, middleware: [denyWorkload] }),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/plugin-platform/internal/v1/installations:claim`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              managerId: 'manager-001',
              leaseDurationMs: 30_000,
              occurredAt: '2026-08-24T00:00:00.000Z',
            }),
          },
        );
        expect(response.status).toBe(401);
        expect(store.claim).not.toHaveBeenCalled();
      },
    );
  });

  it('binds the advertised and claimed manager identity to the workload', async () => {
    const store = storeFixture();
    await withServer(
      application({ store, middleware: [allowWorkload] }),
      async (baseUrl) => {
        const capability = await fetch(
          `${baseUrl}/api/plugin-platform/internal/v1/manager/capability`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              apiVersion: 'manager-capability.plugin.enterpriseglue.io/v1',
              kind: 'EnterpriseGluePluginManagerCapability',
              managerId: 'manager-substitution',
              managerVersion: '0.1.0',
              protocolVersions: ['v1'],
              deploymentModes: ['kubernetes'],
              architectures: ['amd64'],
              operations: ['plan', 'install'],
              state: 'ready',
              observedAt: '2026-08-24T00:00:00.000Z',
            }),
          },
        );
        expect(capability.status).toBe(403);
        expect(store.advertiseCapability).not.toHaveBeenCalled();

        const claim = await fetch(
          `${baseUrl}/api/plugin-platform/internal/v1/installations:claim`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              managerId: 'manager-substitution',
              leaseDurationMs: 30_000,
              occurredAt: '2026-08-24T00:00:00.000Z',
            }),
          },
        );
        expect(claim.status).toBe(403);
        expect(store.claim).not.toHaveBeenCalled();
      },
    );
  });

  it('returns only a bounded empty claim and disables caching', async () => {
    const store = storeFixture();
    await withServer(
      application({ store, middleware: [allowWorkload] }),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/plugin-platform/internal/v1/installations:claim`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              managerId: 'manager-001',
              leaseDurationMs: 30_000,
              occurredAt: '2026-08-24T00:00:00.000Z',
            }),
          },
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({ intent: null });
        expect(store.claim).toHaveBeenCalledOnce();
      },
    );
  });
});

async function withServer(
  app: express.Express,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
