import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import type { PluginId } from '@enterpriseglue/plugin-sdk';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createPluginLifecyclePlanEnvelopeV1,
  FilePluginLifecycleExecutionStoreV1,
  parsePluginLifecycleExecutionV1,
  pluginLifecycleExecutionFileName,
  pluginLifecycleExecutionLockFileName,
  pluginLifecycleObservationFileName,
  pluginLifecyclePlanFileName,
  type PluginDeploymentLifecyclePlanV1,
  type PluginLifecyclePlanEnvelopeV1,
} from './index.js';

const pluginId = 'io.enterpriseglue.example' as PluginId;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function plan(
  overrides: Partial<PluginDeploymentLifecyclePlanV1> = {},
): PluginDeploymentLifecyclePlanV1 {
  return {
    apiVersion: 'lifecycle-plan.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginLifecyclePlan',
    operation: 'upgrade',
    pluginId,
    fromVersion: '0.9.0',
    toVersion: '1.0.0',
    fromDataSchema: 0,
    toDataSchema: 0,
    rollbackSupported: true,
    phases: ['stage', 'checkpoint', 'commit'],
    ...overrides,
  };
}

async function fixture(
  envelope: PluginLifecyclePlanEnvelopeV1 =
    createPluginLifecyclePlanEnvelopeV1(1, plan()),
) {
  const directory = await mkdtemp(
    resolve(tmpdir(), 'eg-plugin-execution-store-'),
  );
  directories.push(directory);
  await writeFile(
    resolve(directory, pluginLifecyclePlanFileName),
    `${JSON.stringify(envelope, null, 2)}\n`,
    { mode: 0o600 },
  );
  return {
    directory,
    envelope,
    store: new FilePluginLifecycleExecutionStoreV1(directory),
  };
}

describe('FilePluginLifecycleExecutionStoreV1', () => {
  it('persists checkpoints and resumes after a process and lease expiry', async () => {
    const test = await fixture();
    let execution = await test.store.initialize({
      executionId: 'execution-store-0001',
      occurredAt: '2026-07-25T00:00:00.000Z',
    });
    expect(execution.revision).toBe(0);

    const restartedStore = new FilePluginLifecycleExecutionStoreV1(
      test.directory,
    );
    expect(await restartedStore.read()).toEqual(execution);
    execution = await restartedStore.claim({
      expectedRevision: 0,
      owner: 'worker-store-0001',
      occurredAt: '2026-07-25T00:00:01.000Z',
      leaseDurationMs: 1_000,
    });
    execution = await restartedStore.complete({
      expectedRevision: 1,
      owner: 'worker-store-0001',
      phase: 'stage',
      occurredAt: '2026-07-25T00:00:01.500Z',
    });
    expect(execution).toMatchObject({
      revision: 2,
      completedPhases: ['stage'],
      nextPhase: 'checkpoint',
    });

    const afterCrash = new FilePluginLifecycleExecutionStoreV1(
      test.directory,
    );
    execution = await afterCrash.recover({
      expectedRevision: 2,
      occurredAt: '2026-07-25T00:00:03.000Z',
    });
    expect(execution).toMatchObject({
      revision: 3,
      status: 'queued',
      reasonCode: 'lease_expired',
      completedPhases: ['stage'],
      nextPhase: 'checkpoint',
    });
    execution = await afterCrash.claim({
      expectedRevision: 3,
      owner: 'worker-store-0002',
      occurredAt: '2026-07-25T00:00:04.000Z',
      leaseDurationMs: 60_000,
    });
    for (const [index, phase] of (
      ['checkpoint', 'commit'] as const
    ).entries()) {
      execution = await afterCrash.complete({
        expectedRevision: execution.revision,
        owner: 'worker-store-0002',
        phase,
        occurredAt: new Date(
          Date.parse('2026-07-25T00:00:05.000Z') + index * 1_000,
        ).toISOString(),
      });
    }
    expect(execution).toMatchObject({
      status: 'succeeded',
      completedPhases: test.envelope.plan!.phases,
    });

    const stored = JSON.parse(
      await readFile(
        resolve(test.directory, pluginLifecycleExecutionFileName),
        'utf8',
      ),
    );
    expect(
      parsePluginLifecycleExecutionV1(
        stored.execution,
        stored.envelope,
      ),
    ).toEqual(execution);
    const observation = JSON.parse(
      await readFile(
        resolve(test.directory, pluginLifecycleObservationFileName),
        'utf8',
      ),
    );
    expect(observation).toMatchObject({
      observationState: 'current',
      workloadReconciliation: 'not_checked',
      desiredRevision: 1,
      execution: {
        executionId: execution.executionId,
        executionRevision: execution.revision,
        status: 'succeeded',
      },
    });
    expect(JSON.stringify(observation)).not.toContain('leaseOwner');
    expect(observation).not.toHaveProperty('history');
    expect(observation).not.toHaveProperty('envelope');

    const nextEnvelope = createPluginLifecyclePlanEnvelopeV1(
      2,
      plan({
        operation: 'enable',
        fromVersion: '1.0.0',
        toVersion: '1.0.0',
        phases: ['activate', 'ready', 'commit'],
      }),
    );
    await writeFile(
      resolve(test.directory, pluginLifecyclePlanFileName),
      `${JSON.stringify(nextEnvelope, null, 2)}\n`,
      { mode: 0o600 },
    );
    const nextExecution = await afterCrash.initialize({
      executionId: 'execution-store-0002',
      occurredAt: '2026-07-25T00:01:00.000Z',
    });
    expect(nextExecution).toMatchObject({
      revision: 0,
      desiredRevision: 2,
      operation: 'enable',
      status: 'queued',
    });
    const rotated = JSON.parse(
      await readFile(
        resolve(test.directory, pluginLifecycleExecutionFileName),
        'utf8',
      ),
    );
    expect(rotated.history).toHaveLength(1);
    expect(rotated.history[0].execution.status).toBe('succeeded');
  });

  it('enforces revision, lease, active-execution, and current-plan ownership', async () => {
    const test = await fixture();
    let execution = await test.store.initialize({
      executionId: 'execution-store-0002',
      occurredAt: '2026-07-25T00:00:00.000Z',
    });
    execution = await test.store.claim({
      expectedRevision: execution.revision,
      owner: 'worker-store-0001',
      occurredAt: '2026-07-25T00:00:01.000Z',
      leaseDurationMs: 60_000,
    });

    await expect(
      test.store.complete({
        expectedRevision: 0,
        owner: 'worker-store-0001',
        phase: 'stage',
        occurredAt: '2026-07-25T00:00:02.000Z',
      }),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(
      test.store.claim({
        expectedRevision: execution.revision,
        owner: 'worker-store-0002',
        occurredAt: '2026-07-25T00:00:02.000Z',
        leaseDurationMs: 60_000,
      }),
    ).rejects.toMatchObject({ code: 'lease_held' });

    const replacementEnvelope = createPluginLifecyclePlanEnvelopeV1(
      2,
      plan({ toVersion: '1.1.0' }),
    );
    await writeFile(
      resolve(test.directory, pluginLifecyclePlanFileName),
      `${JSON.stringify(replacementEnvelope, null, 2)}\n`,
      { mode: 0o600 },
    );
    await expect(
      test.store.complete({
        expectedRevision: execution.revision,
        owner: 'worker-store-0001',
        phase: 'stage',
        occurredAt: '2026-07-25T00:00:03.000Z',
      }),
    ).rejects.toMatchObject({ code: 'plan_mismatch' });
    await expect(
      test.store.initialize({
        executionId: 'execution-store-0003',
        occurredAt: '2026-07-25T00:00:03.000Z',
        supersedeExecutionRevision: execution.revision,
      }),
    ).rejects.toMatchObject({ code: 'execution_active' });
  });

  it('fails closed for live locks and symlinks, but recovers an abandoned lock', async () => {
    const test = await fixture();
    const lockPath = resolve(
      test.directory,
      pluginLifecycleExecutionLockFileName,
    );
    await writeFile(lockPath, '{"owner":"other"}\n', { mode: 0o600 });
    await expect(
      test.store.initialize({
        executionId: 'execution-store-0004',
        occurredAt: '2026-07-25T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'store_locked' });

    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);
    const staleRecoveringStore =
      new FilePluginLifecycleExecutionStoreV1(test.directory, {
        staleLockMs: 1_000,
      });
    await expect(
      staleRecoveringStore.initialize({
        executionId: 'execution-store-0004',
        occurredAt: '2026-07-25T00:00:01.000Z',
      }),
    ).resolves.toMatchObject({ status: 'queued' });

    const outside = resolve(test.directory, 'outside.json');
    await writeFile(outside, '{}', { mode: 0o600 });
    const planPath = resolve(test.directory, pluginLifecyclePlanFileName);
    await unlink(planPath);
    await symlink(outside, planPath);
    await expect(staleRecoveringStore.read()).rejects.toMatchObject({
      code: 'store_corrupt',
    });
  });
});
