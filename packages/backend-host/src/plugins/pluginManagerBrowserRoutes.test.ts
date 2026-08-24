import type { AddressInfo } from 'node:net';

import express, { type RequestHandler } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { registerPluginManagerBrowserRoutesV1 } from './pluginManagerBrowserRoutes.js';
import type { PluginManagerStoreV1 } from './pluginManagerStore.js';

const hash = (character: string) => character.repeat(64);
const release = `registry.example/plugin@sha256:${hash('1')}`;
const now = '2026-08-24T00:00:00.000Z';

const allow: RequestHandler = (request, _response, next) => {
  Object.assign(request, { user: { userId: 'user-001' } });
  next();
};
const deny: RequestHandler = (_request, response) => {
  response.status(403).json({ code: 'permission_denied' });
};

function storeFixture(): PluginManagerStoreV1 {
  return {
    createIntent: vi.fn(async (intent) => intent),
    listInstallations: vi.fn(async () => ({ items: [], total: 0 })),
    getInstallation: vi.fn(),
    approve: vi.fn(async (approval) => ({ approval, revision: 3 })),
    cancel: vi.fn(async () => ({ revision: 4 })),
    retry: vi.fn(async () => ({ revision: 4 })),
    latestCapability: vi.fn(async () => null),
    advertiseCapability: vi.fn(),
    claim: vi.fn(),
    renew: vi.fn(),
    publishReview: vi.fn(),
    readApproval: vi.fn(),
    publishObservation: vi.fn(),
  };
}

function application(input: {
  store: PluginManagerStoreV1;
  read?: RequestHandler[];
  manage?: RequestHandler[];
}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  registerPluginManagerBrowserRoutesV1(app, input.store, {
    readMiddleware: input.read ?? [allow],
    manageMiddleware: input.manage ?? [allow],
    now: () => new Date(now),
  });
  return app;
}

describe('plugin manager browser routes', () => {
  it('checks management authorization before accepting an intent', async () => {
    const store = storeFixture();
    await withServer(application({ store, manage: [deny] }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/plugin-platform/v1/installations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pluginId: 'io.enterpriseglue.example',
          release,
          source: 'connected_registry',
          deploymentMode: 'kubernetes',
          expectedPlatformRevision: 1,
          idempotencyKey: 'request-001',
        }),
      });
      expect(response.status).toBe(403);
      expect(store.createIntent).not.toHaveBeenCalled();
    });
  });

  it('injects trusted requester identity and server time', async () => {
    const store = storeFixture();
    await withServer(application({ store }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/plugin-platform/v1/installations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pluginId: 'io.enterpriseglue.example',
          release,
          source: 'connected_registry',
          deploymentMode: 'kubernetes',
          expectedPlatformRevision: 1,
          idempotencyKey: 'request-001',
        }),
      });
      expect(response.status).toBe(201);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(store.createIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          installationId: expect.stringMatching(/^installation-[0-9a-f-]+$/),
          requesterRef: 'user-001',
          requestedAt: now,
        }),
      );
    });
  });

  it('paginates safe summaries and binds approval to the retained review expiry', async () => {
    const store = storeFixture();
    vi.mocked(store.getInstallation).mockResolvedValue({
      intent: {
        apiVersion: 'installation-intent.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginInstallationIntent',
        installationId: 'installation-001',
        pluginId: 'io.enterpriseglue.example',
        release,
        source: 'connected_registry',
        deploymentMode: 'kubernetes',
        requesterRef: 'user-001',
        expectedPlatformRevision: 1,
        idempotencyKey: 'request-001',
        requestedAt: now,
      },
      state: 'awaiting_approval',
      reasonCode: 'approval_required',
      revision: 2,
      review: {
        installationId: 'installation-001',
        expiresAt: '2026-08-24T00:15:00.000Z',
      },
      approval: null,
      latestObservation: null,
      updatedAt: now,
    } as Awaited<ReturnType<PluginManagerStoreV1['getInstallation']>>);
    await withServer(application({ store }), async (baseUrl) => {
      const list = await fetch(
        `${baseUrl}/api/plugin-platform/v1/installations?limit=10&offset=20`,
      );
      expect(list.status).toBe(200);
      expect(store.listInstallations).toHaveBeenCalledWith({ limit: 10, offset: 20 });

      const approval = await fetch(
        `${baseUrl}/api/plugin-platform/v1/installations/installation-001/approval`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            decision: 'approve',
            reviewSha256: hash('2'),
            planSha256: hash('3'),
            expectedRevision: 2,
          }),
        },
      );
      expect(approval.status).toBe(200);
      expect(store.approve).toHaveBeenCalledWith(
        expect.objectContaining({
          approverRef: 'user-001',
          decidedAt: now,
          expiresAt: '2026-08-24T00:15:00.000Z',
        }),
      );
    });
  });

  it('passes only a server timestamp and expected revision to recovery mutations', async () => {
    const store = storeFixture();
    await withServer(application({ store }), async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/plugin-platform/v1/installations/installation-001/retry`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedRevision: 3 }),
        },
      );
      expect(response.status).toBe(200);
      expect(store.retry).toHaveBeenCalledWith({
        installationId: 'installation-001',
        expectedRevision: 3,
        occurredAt: now,
      });
    });
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
