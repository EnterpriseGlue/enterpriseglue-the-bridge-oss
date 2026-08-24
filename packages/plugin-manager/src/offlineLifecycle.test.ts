import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OfflineDeliveryPluginLifecycleV1 } from './offlineLifecycle.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('OfflineDeliveryPluginLifecycleV1', () => {
  it('imports and installs a digest-selected delivery before lifecycle execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eg-offline-lifecycle-'));
    roots.push(root);
    const digest = '1'.repeat(64);
    const delivery = join(root, `sha256-${digest}`);
    await mkdir(join(delivery, 'airgap'), { recursive: true });
    await writeFile(join(delivery, 'airgap-registry-map.json'), '{}');
    const installer = vi.fn(async () => 0);
    const execute = vi.fn(async () => ({ status: 'succeeded' as const, reasonCode: 'none' as const, occurredAt: '2026-08-24T00:00:00.000Z' }));
    const lifecycle = new OfflineDeliveryPluginLifecycleV1({
      intakeRoot: root,
      outputRoot: join(root, 'output'),
      trustFile: join(root, 'trust.json'),
      hostVersion: '0.15.0',
      execution: { execute },
      installer,
      assertPreparedPlan: vi.fn(async () => undefined),
    });
    const input = {
      intent: { source: 'offline_delivery' as const, release: `registry.example/releases/example@sha256:${digest}` },
      release: {}, envelope: { desiredRevision: 1, planSha256: digest }, managerId: 'manager-1',
    } as Parameters<typeof lifecycle.execute>[0];

    await expect(lifecycle.execute(input)).resolves.toMatchObject({ status: 'succeeded' });
    expect(installer).toHaveBeenCalledTimes(2);
    expect(installer.mock.calls[0]?.[0][0]).toBe('import-airgap');
    expect(installer.mock.calls[1]?.[0][0]).toBe('install-airgap-package');
    expect(installer.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        '--expected-plan-sha256',
        digest,
      ]),
    );
    expect(execute).toHaveBeenCalledWith(input);
  });
});
