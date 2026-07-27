import type { PluginId } from '@enterpriseglue/plugin-sdk';
import { describe, expect, it } from 'vitest';

import {
  claimPluginLifecycleExecutionV1,
  completePluginLifecyclePhaseV1,
  createPluginLifecycleExecutionV1,
  createPluginLifecyclePlanEnvelopeV1,
  failPluginLifecycleExecutionV1,
  hashPluginLifecyclePlanV1,
  parsePluginLifecycleExecutionV1,
  parsePluginLifecyclePlanEnvelopeV1,
  PluginLifecycleExecutionError,
  recoverExpiredPluginLifecycleExecutionV1,
  type PluginDeploymentLifecyclePlanV1,
} from './index.js';

const pluginId = 'io.enterpriseglue.example' as PluginId;
const migrationImage =
  `registry.example/migration@sha256:${'a'.repeat(64)}`;

function plan(
  overrides: Partial<PluginDeploymentLifecyclePlanV1> = {},
): PluginDeploymentLifecyclePlanV1 {
  return {
    apiVersion: 'lifecycle-plan.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginLifecyclePlan',
    operation: 'upgrade',
    pluginId,
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    fromDataSchema: 0,
    toDataSchema: 1,
    migrationImage,
    rollbackSupported: true,
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
    ...overrides,
  };
}

describe('plugin lifecycle execution contract', () => {
  it('hashes a plan canonically and binds it to the desired revision', () => {
    const original = plan();
    const reordered = {
      phases: original.phases,
      rollbackSupported: original.rollbackSupported,
      toDataSchema: original.toDataSchema,
      fromDataSchema: original.fromDataSchema,
      migrationImage: original.migrationImage,
      toVersion: original.toVersion,
      fromVersion: original.fromVersion,
      pluginId: original.pluginId,
      operation: original.operation,
      kind: original.kind,
      apiVersion: original.apiVersion,
    } as PluginDeploymentLifecyclePlanV1;

    expect(hashPluginLifecyclePlanV1(reordered)).toBe(
      hashPluginLifecyclePlanV1(original),
    );
    const envelope = createPluginLifecyclePlanEnvelopeV1(7, original);
    expect(parsePluginLifecyclePlanEnvelopeV1(envelope)).toMatchObject({
      schemaVersion: 1,
      desiredRevision: 7,
      planSha256: hashPluginLifecyclePlanV1(original),
    });
    const tampered = structuredClone(envelope);
    tampered.plan!.toVersion = '2.0.1';
    expect(() =>
      parsePluginLifecyclePlanEnvelopeV1(tampered),
    ).toThrowError(
      expect.objectContaining<Partial<PluginLifecycleExecutionError>>({
        code: 'plan_mismatch',
      }),
    );
    const unsafeOrder = createPluginLifecyclePlanEnvelopeV1(7, {
      ...original,
      phases: ['commit'],
    });
    expect(() =>
      parsePluginLifecyclePlanEnvelopeV1(unsafeOrder),
    ).toThrowError(
      expect.objectContaining<Partial<PluginLifecycleExecutionError>>({
        code: 'execution_invalid',
      }),
    );
  });

  it('claims and checkpoints every phase in strict order', () => {
    const envelope = createPluginLifecyclePlanEnvelopeV1(7, plan());
    const queued = createPluginLifecycleExecutionV1({
      envelope,
      executionId: 'execution-0001',
      occurredAt: '2026-07-25T00:00:00.000Z',
    });
    let execution = claimPluginLifecycleExecutionV1({
      execution: queued,
      envelope,
      owner: 'worker-0001',
      occurredAt: '2026-07-25T00:00:01.000Z',
      leaseDurationMs: 60_000,
    });

    for (const [index, phase] of envelope.plan!.phases.entries()) {
      execution = completePluginLifecyclePhaseV1({
        execution,
        envelope,
        owner: 'worker-0001',
        phase,
        occurredAt: new Date(
          Date.parse('2026-07-25T00:00:02.000Z') + index * 1_000,
        ).toISOString(),
      });
    }

    expect(execution).toMatchObject({
      status: 'succeeded',
      reasonCode: 'none',
      completedPhases: envelope.plan!.phases,
    });
    expect(execution.nextPhase).toBeUndefined();
    expect(execution.leaseOwner).toBeUndefined();
    expect(
      parsePluginLifecycleExecutionV1(execution, envelope),
    ).toEqual(execution);
    expect(queued.status).toBe('queued');
  });

  it('rejects out-of-order phases and a competing live lease', () => {
    const envelope = createPluginLifecyclePlanEnvelopeV1(7, plan());
    const queued = createPluginLifecycleExecutionV1({
      envelope,
      executionId: 'execution-0002',
      occurredAt: '2026-07-25T00:00:00.000Z',
    });
    const claimed = claimPluginLifecycleExecutionV1({
      execution: queued,
      envelope,
      owner: 'worker-0001',
      occurredAt: '2026-07-25T00:00:01.000Z',
      leaseDurationMs: 60_000,
    });

    expect(() =>
      completePluginLifecyclePhaseV1({
        execution: claimed,
        envelope,
        owner: 'worker-0001',
        phase: 'migrate',
        occurredAt: '2026-07-25T00:00:02.000Z',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PluginLifecycleExecutionError>>({
        code: 'phase_out_of_order',
      }),
    );
    expect(() =>
      claimPluginLifecycleExecutionV1({
        execution: claimed,
        envelope,
        owner: 'worker-0002',
        occurredAt: '2026-07-25T00:00:03.000Z',
        leaseDurationMs: 60_000,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PluginLifecycleExecutionError>>({
        code: 'lease_held',
      }),
    );
  });

  it('recovers an expired lease without repeating completed phases', () => {
    const envelope = createPluginLifecyclePlanEnvelopeV1(7, plan());
    let execution = createPluginLifecycleExecutionV1({
      envelope,
      executionId: 'execution-0003',
      occurredAt: '2026-07-25T00:00:00.000Z',
    });
    execution = claimPluginLifecycleExecutionV1({
      execution,
      envelope,
      owner: 'worker-0001',
      occurredAt: '2026-07-25T00:00:01.000Z',
      leaseDurationMs: 1_000,
    });
    execution = completePluginLifecyclePhaseV1({
      execution,
      envelope,
      owner: 'worker-0001',
      phase: 'stage',
      occurredAt: '2026-07-25T00:00:01.500Z',
    });
    execution = recoverExpiredPluginLifecycleExecutionV1({
      execution,
      envelope,
      occurredAt: '2026-07-25T00:00:03.000Z',
    });

    expect(execution).toMatchObject({
      status: 'queued',
      reasonCode: 'lease_expired',
      completedPhases: ['stage'],
      nextPhase: 'drain',
    });
    execution = claimPluginLifecycleExecutionV1({
      execution,
      envelope,
      owner: 'worker-0002',
      occurredAt: '2026-07-25T00:00:04.000Z',
      leaseDurationMs: 60_000,
    });
    expect(execution.nextPhase).toBe('drain');
  });

  it('fails closed on plan drift and irreversible post-migration failure', () => {
    const originalPlan = plan({ rollbackSupported: false });
    const envelope = createPluginLifecyclePlanEnvelopeV1(7, originalPlan);
    let execution = createPluginLifecycleExecutionV1({
      envelope,
      executionId: 'execution-0004',
      occurredAt: '2026-07-25T00:00:00.000Z',
    });
    const changedEnvelope = createPluginLifecyclePlanEnvelopeV1(7, {
      ...originalPlan,
      toVersion: '2.0.1',
    });
    expect(() =>
      claimPluginLifecycleExecutionV1({
        execution,
        envelope: changedEnvelope,
        owner: 'worker-0001',
        occurredAt: '2026-07-25T00:00:01.000Z',
        leaseDurationMs: 60_000,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PluginLifecycleExecutionError>>({
        code: 'plan_mismatch',
      }),
    );

    execution = claimPluginLifecycleExecutionV1({
      execution,
      envelope,
      owner: 'worker-0001',
      occurredAt: '2026-07-25T00:00:01.000Z',
      leaseDurationMs: 60_000,
    });
    for (const [index, phase] of (
      [
        'stage',
        'drain',
        'deactivate',
        'checkpoint',
        'migrate',
      ] as const
    ).entries()) {
      execution = completePluginLifecyclePhaseV1({
        execution,
        envelope,
        owner: 'worker-0001',
        phase,
        occurredAt: new Date(
          Date.parse('2026-07-25T00:00:02.000Z') + index * 1_000,
        ).toISOString(),
      });
    }
    execution = failPluginLifecycleExecutionV1({
      execution,
      envelope,
      owner: 'worker-0001',
      occurredAt: '2026-07-25T00:00:06.000Z',
    });
    expect(execution).toMatchObject({
      status: 'manual_intervention',
      reasonCode: 'rollback_unavailable',
      completedPhases: [
        'stage',
        'drain',
        'deactivate',
        'checkpoint',
        'migrate',
      ],
    });
  });
});
