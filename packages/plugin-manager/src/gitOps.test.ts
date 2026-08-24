import { describe, expect, it, vi } from 'vitest';

import { reconcilePluginDesiredStateV1 } from './gitOps.js';

const release = `registry.example/releases/example@sha256:${'1'.repeat(64)}`;

function response(status: number, body: unknown) {
  const bytes = Buffer.from(JSON.stringify(body));
  return new Response(bytes, {
    status,
    headers: {
      'content-type': 'application/json',
      'content-length': String(bytes.byteLength),
    },
  });
}

function desired(targetVersion = '1.0.0') {
  return {
    apiVersion: 'desired-state.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginDesiredState',
    plugins: [
      {
        pluginId: 'io.enterpriseglue.example',
        targetVersion,
        release,
        source: 'connected_registry',
        deploymentMode: 'kubernetes',
      },
    ],
  };
}

describe('reconcilePluginDesiredStateV1', () => {
  it('creates one idempotent install intent from declarative desired state', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response(200, { revision: 4, plugins: [] }),
      )
      .mockResolvedValueOnce(
        response(201, { installationId: 'installation-001' }),
      );
    await expect(
      reconcilePluginDesiredStateV1({
        baseUrl: 'https://enterpriseglue.example',
        accessToken: 'valid-access-token-0001',
        desired: desired(),
        fetch,
      }),
    ).resolves.toEqual({
      status: 'requested',
      changed: true,
      pluginId: 'io.enterpriseglue.example',
      operation: 'install',
      installationId: 'installation-001',
    });
    const request = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    expect(request).toMatchObject({
      operation: 'install',
      expectedPlatformRevision: 4,
    });
    expect(request.idempotencyKey).toMatch(/^gitops-[a-f0-9]{64}$/);
  });

  it('derives upgrade state and stops once the desired version is current', async () => {
    const firstFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response(200, {
          revision: 8,
          plugins: [
            {
              pluginId: 'io.enterpriseglue.example',
              version: '1.0.0',
              enabled: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response(201, { installationId: 'installation-002' }),
      );
    await reconcilePluginDesiredStateV1({
      baseUrl: 'https://enterpriseglue.example',
      accessToken: 'valid-access-token-0001',
      desired: desired('1.1.0'),
      fetch: firstFetch,
    });
    expect(JSON.parse(String(firstFetch.mock.calls[1]?.[1]?.body))).toMatchObject({
      operation: 'upgrade',
      fromVersion: '1.0.0',
      currentEnabled: true,
    });

    const currentFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      response(200, {
        revision: 9,
        plugins: [
          {
            pluginId: 'io.enterpriseglue.example',
            version: '1.1.0',
            enabled: true,
          },
        ],
      }),
    );
    await expect(
      reconcilePluginDesiredStateV1({
        baseUrl: 'https://enterpriseglue.example',
        accessToken: 'valid-access-token-0001',
        desired: desired('1.1.0'),
        fetch: currentFetch,
      }),
    ).resolves.toEqual({ status: 'current', changed: false });
    expect(currentFetch).toHaveBeenCalledOnce();
  });
});
