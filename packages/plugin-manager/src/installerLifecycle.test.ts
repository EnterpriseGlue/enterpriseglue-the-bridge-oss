import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  PluginInstallationIntentV1,
  PluginReleaseV1,
} from '@enterpriseglue/plugin-sdk/manager';

import { createPluginInstallPlanV1 } from './manager.js';
import { FileInstallerLifecycleV1 } from './installerLifecycle.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('FileInstallerLifecycleV1', () => {
  it('resumes an exact completed execution without repeating adapter effects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eg-manager-lifecycle-'));
    roots.push(root);
    const packageDigest = `registry.example/plugin@sha256:${'1'.repeat(64)}`;
    const intent = {
      apiVersion: 'installation-intent.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginInstallationIntent',
      installationId: 'install-001',
      pluginId: 'io.enterpriseglue.example',
      release: packageDigest,
      source: 'static_catalog',
      deploymentMode: 'compose_planner',
      requesterRef: 'user-001',
      expectedPlatformRevision: 0,
      idempotencyKey: 'request-001',
      requestedAt: '2026-08-24T00:00:00.000Z',
    } satisfies PluginInstallationIntentV1;
    const release = {
      pluginId: intent.pluginId,
      version: '1.0.0',
      schemaTransition: { to: 0, rollbackClass: 'stateless' },
      artifacts: [{ role: 'package', subject: packageDigest }],
    } as PluginReleaseV1;
    const envelope = createPluginInstallPlanV1({ intent, release });
    const times = [
      '2026-08-24T00:00:00.000Z',
      '2026-08-24T00:00:01.000Z',
      '2026-08-24T00:00:02.000Z',
      '2026-08-24T00:00:03.000Z',
      '2026-08-24T00:00:04.000Z',
      '2026-08-24T00:00:05.000Z',
      '2026-08-24T00:00:06.000Z',
      '2026-08-24T00:00:07.000Z',
    ];
    let clockIndex = 0;
    let effects = 0;
    const lifecycle = new FileInstallerLifecycleV1({
      root,
      now: () => new Date(times[Math.min(clockIndex++, times.length - 1)]!),
      adapter: {
        executePhase: async () => {
          effects += 1;
        },
      },
    });
    const input = {
      intent,
      release,
      envelope,
      managerId: 'manager-001',
    };

    expect((await lifecycle.execute(input)).status).toBe('succeeded');
    expect((await lifecycle.execute(input)).status).toBe('succeeded');
    expect(effects).toBe(2);
    const stored = JSON.parse(
      await readFile(
        join(root, intent.installationId, 'plugin-lifecycle-execution.json'),
        'utf8',
      ),
    ) as { execution: { completedPhases: string[] } };
    expect(stored.execution.completedPhases).toEqual(['stage', 'commit']);
  });
});
