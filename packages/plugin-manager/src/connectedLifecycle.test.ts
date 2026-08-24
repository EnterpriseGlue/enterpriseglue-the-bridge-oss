import { describe, expect, it, vi } from 'vitest';

import { ConnectedOciPluginLifecycleV1 } from './connectedLifecycle.js';

const hash = '1'.repeat(64);

describe('ConnectedOciPluginLifecycleV1', () => {
  it('keeps registry and trust configuration in the manager and delegates the exact subject', async () => {
    const installer = vi.fn(async () => 0);
    const execute = vi.fn(async () => ({
      status: 'succeeded' as const,
      reasonCode: 'none' as const,
      occurredAt: '2026-08-24T00:00:00.000Z',
    }));
    const lifecycle = new ConnectedOciPluginLifecycleV1({
      outputRoot: '/deployment/plugin-manager',
      trustFile: '/run/enterpriseglue/trust.json',
      cosignPolicyFile: '/run/enterpriseglue/cosign-policy.json',
      registryConfigFile: '/run/enterpriseglue/registry/config.json',
      registryCaFile: '/run/enterpriseglue/registry/ca.pem',
      permissionGrantsFile: '/etc/enterpriseglue/plugin-grants.json',
      hostVersion: '0.15.0',
      execution: { execute },
      installer,
      assertPreparedPlan: vi.fn(async () => undefined),
    });
    const input = {
      intent: {
        source: 'connected_registry' as const,
        installationId: 'install-001',
        release: `registry.example/plugin@sha256:${hash}`,
      },
      release: {
        package: `registry.example/plugin-package@sha256:${'2'.repeat(64)}`,
      },
      envelope: {
        desiredRevision: 1,
        planSha256: hash,
      },
      managerId: 'manager-001',
    } as Parameters<typeof lifecycle.execute>[0];

    await expect(lifecycle.execute(input)).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(installer).toHaveBeenCalledOnce();
    const argv = installer.mock.calls[0]?.[0] ?? [];
    expect(argv).toEqual(
      expect.arrayContaining([
        'install-oci',
        '--subject',
        input.release.package,
        '--registry-config',
        '/run/enterpriseglue/registry/config.json',
        '--expected-plan-sha256',
        hash,
      ]),
    );
    expect(execute).toHaveBeenCalledWith(input);
  });

  it('rejects an offline intent before invoking connected acquisition', async () => {
    const installer = vi.fn(async () => 0);
    const lifecycle = new ConnectedOciPluginLifecycleV1({
      outputRoot: '/deployment/plugin-manager',
      trustFile: '/trust.json',
      cosignPolicyFile: '/cosign.json',
      hostVersion: '0.15.0',
      execution: { execute: vi.fn() },
      installer,
      assertPreparedPlan: vi.fn(async () => undefined),
    });
    const input = {
      intent: { source: 'offline_delivery' },
    } as Parameters<typeof lifecycle.execute>[0];
    await expect(lifecycle.execute(input)).rejects.toThrow(
      'connected_lifecycle_source_invalid',
    );
    expect(installer).not.toHaveBeenCalled();
  });

  it('uses the verified package upgrade command for an update intent', async () => {
    const installer = vi.fn(async () => 0);
    const lifecycle = new ConnectedOciPluginLifecycleV1({
      outputRoot: '/deployment/plugin-manager',
      trustFile: '/trust.json',
      cosignPolicyFile: '/cosign.json',
      hostVersion: '0.15.0',
      execution: {
        execute: vi.fn(async () => ({
          status: 'succeeded' as const,
          reasonCode: 'none' as const,
          occurredAt: '2026-08-24T00:00:00.000Z',
        })),
      },
      installer,
      assertPreparedPlan: vi.fn(async () => undefined),
    });
    await lifecycle.execute({
      intent: {
        source: 'connected_registry',
        operation: 'upgrade',
      },
      release: {
        package: `registry.example/plugin-package@sha256:${'2'.repeat(64)}`,
      },
      envelope: { desiredRevision: 2, planSha256: hash },
    } as Parameters<typeof lifecycle.execute>[0]);
    expect(installer.mock.calls[0]?.[0][0]).toBe('upgrade-oci');
  });
});
