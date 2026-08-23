import {
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import type { PluginId } from '@enterpriseglue/plugin-sdk';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createPluginLifecyclePlanEnvelopeV1,
  FilePluginLifecycleExecutionStoreV1,
  PluginLifecycleExecutionError,
  pluginLifecyclePlanFileName,
  runPluginLifecycleExecutionV1,
  type PluginDeploymentLifecyclePlanV1,
  type PluginLifecyclePhaseExecutionContextV1,
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

function installPlan(): PluginDeploymentLifecyclePlanV1 {
  return {
    apiVersion: 'lifecycle-plan.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginLifecyclePlan',
    operation: 'install',
    pluginId,
    toVersion: '1.0.0',
    fromDataSchema: 0,
    toDataSchema: 0,
    rollbackSupported: true,
    phases: ['stage', 'commit'],
  };
}

function enablePlan(): PluginDeploymentLifecyclePlanV1 {
  return {
    apiVersion: 'lifecycle-plan.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginLifecyclePlan',
    operation: 'enable',
    pluginId,
    fromVersion: '1.0.0',
    toVersion: '1.0.0',
    fromDataSchema: 0,
    toDataSchema: 0,
    rollbackSupported: true,
    phases: ['activate', 'ready', 'commit'],
  };
}

function irreversibleUpgradePlan(): PluginDeploymentLifecyclePlanV1 {
  return {
    apiVersion: 'lifecycle-plan.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginLifecyclePlan',
    operation: 'upgrade',
    pluginId,
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    fromDataSchema: 0,
    toDataSchema: 2,
    migrationImage:
      `registry.example/migration@sha256:${'a'.repeat(64)}`,
    rollbackSupported: false,
    phases: [
      'stage',
      'drain',
      'deactivate',
      'checkpoint',
      'migrate',
      'activate',
      'ready',
      'commit',
    ],
  };
}

function reversibleUpgradePlan(): PluginDeploymentLifecyclePlanV1 {
  return {
    ...irreversibleUpgradePlan(),
    rollbackSupported: true,
  };
}

async function fixture(plan: PluginDeploymentLifecyclePlanV1) {
  const directory = await mkdtemp(
    resolve(tmpdir(), 'eg-plugin-execution-runner-'),
  );
  directories.push(directory);
  const envelope = createPluginLifecyclePlanEnvelopeV1(1, plan);
  await writeFile(
    resolve(directory, pluginLifecyclePlanFileName),
    `${JSON.stringify(envelope, null, 2)}\n`,
    { mode: 0o600 },
  );
  const store = new FilePluginLifecycleExecutionStoreV1(directory);
  await store.initialize({
    executionId: 'execution-runner-0001',
    occurredAt: '2026-07-25T00:00:00.000Z',
  });
  return { directory, envelope, store };
}

function clock(start = '2026-07-25T00:00:01.000Z') {
  let value = Date.parse(start);
  return () => {
    const result = new Date(value);
    value += 100;
    return result;
  };
}

describe('runPluginLifecycleExecutionV1', () => {
  it('drives every fixed phase with stable idempotency and lease renewal', async () => {
    const test = await fixture(reversibleUpgradePlan());
    const contexts: Array<
      Omit<PluginLifecyclePhaseExecutionContextV1, 'renewLease'>
    > = [];
    const execution = await runPluginLifecycleExecutionV1({
      store: test.store,
      owner: 'worker-runner-0001',
      leaseDurationMs: 60_000,
      now: clock(),
      adapter: {
        async executePhase(context) {
          const { renewLease, ...safeContext } = context;
          contexts.push(safeContext);
          if (context.phase === 'checkpoint') {
            await renewLease();
          }
        },
      },
    });

    expect(execution.status).toBe('succeeded');
    expect(contexts.map((context) => context.phase)).toEqual(
      test.envelope.plan!.phases,
    );
    expect(contexts.map((context) => context.idempotencyKey)).toEqual(
      test.envelope.plan!.phases.map(
        (phase) => `execution-runner-0001:${phase}`,
      ),
    );
    expect(
      contexts.every(
        (context) =>
          context.planSha256 === test.envelope.planSha256 &&
          context.desiredRevision === 1 &&
          context.pluginId === pluginId,
      ),
    ).toBe(true);
  });

  it('checkpoints a safe failure and resumes only the unfinished phase', async () => {
    const test = await fixture(enablePlan());
    const attempts: string[] = [];
    let failReady = true;
    const adapter = {
      async executePhase(context: PluginLifecyclePhaseExecutionContextV1) {
        attempts.push(context.idempotencyKey);
        if (context.phase === 'ready' && failReady) {
          failReady = false;
          throw new Error('unsafe adapter detail that must not be persisted');
        }
      },
    };

    const failed = await runPluginLifecycleExecutionV1({
      store: test.store,
      adapter,
      owner: 'worker-runner-0001',
      leaseDurationMs: 60_000,
      now: clock(),
    });
    expect(failed).toMatchObject({
      status: 'failed',
      reasonCode: 'phase_failed',
      completedPhases: ['activate'],
      nextPhase: 'ready',
    });
    expect(
      JSON.stringify(failed),
    ).not.toContain('unsafe adapter detail');

    const succeeded = await runPluginLifecycleExecutionV1({
      store: test.store,
      adapter,
      owner: 'worker-runner-0002',
      leaseDurationMs: 60_000,
      now: clock('2026-07-25T00:01:00.000Z'),
    });
    expect(succeeded.status).toBe('succeeded');
    expect(attempts).toEqual([
      'execution-runner-0001:activate',
      'execution-runner-0001:ready',
      'execution-runner-0001:ready',
      'execution-runner-0001:commit',
    ]);
  });

  it('requires manual intervention after an irreversible migrated failure', async () => {
    const test = await fixture(irreversibleUpgradePlan());
    const attempts: string[] = [];
    const adapter = {
      async executePhase(context: PluginLifecyclePhaseExecutionContextV1) {
        attempts.push(context.phase);
        if (context.phase === 'ready') throw new Error('readiness failed');
      },
    };
    const intervention = await runPluginLifecycleExecutionV1({
      store: test.store,
      adapter,
      owner: 'worker-runner-0001',
      leaseDurationMs: 60_000,
      now: clock(),
    });
    expect(intervention).toMatchObject({
      status: 'manual_intervention',
      reasonCode: 'rollback_unavailable',
      completedPhases: [
        'stage',
        'drain',
        'deactivate',
        'checkpoint',
        'migrate',
        'activate',
      ],
      nextPhase: 'ready',
    });

    const callsBeforeRetry = attempts.length;
    expect(
      await runPluginLifecycleExecutionV1({
        store: test.store,
        adapter,
        owner: 'worker-runner-0002',
        leaseDurationMs: 60_000,
        now: clock('2026-07-25T00:01:00.000Z'),
      }),
    ).toEqual(intervention);
    expect(attempts).toHaveLength(callsBeforeRetry);

    const replacementEnvelope = createPluginLifecyclePlanEnvelopeV1(
      2,
      installPlan(),
    );
    await writeFile(
      resolve(test.directory, pluginLifecyclePlanFileName),
      `${JSON.stringify(replacementEnvelope, null, 2)}\n`,
      { mode: 0o600 },
    );
    await expect(
      test.store.initialize({
        executionId: 'execution-runner-0002',
        occurredAt: '2026-07-25T00:02:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'execution_active' });
    await expect(
      test.store.initialize({
        executionId: 'execution-runner-0002',
        occurredAt: '2026-07-25T00:02:00.000Z',
        supersedeExecutionRevision: intervention.revision,
      }),
    ).resolves.toMatchObject({
      desiredRevision: 2,
      status: 'queued',
    });
  });

  it('does not steal another worker live lease', async () => {
    const test = await fixture(installPlan());
    const claimed = await test.store.claim({
      expectedRevision: 0,
      owner: 'worker-runner-0001',
      occurredAt: '2026-07-25T00:00:01.000Z',
      leaseDurationMs: 60_000,
    });
    expect(claimed.status).toBe('running');

    await expect(
      runPluginLifecycleExecutionV1({
        store: test.store,
        adapter: { async executePhase() {} },
        owner: 'worker-runner-0002',
        leaseDurationMs: 60_000,
        now: clock('2026-07-25T00:00:02.000Z'),
      }),
    ).rejects.toThrowError(
      expect.objectContaining<Partial<PluginLifecycleExecutionError>>({
        code: 'lease_held',
      }),
    );
  });
});
