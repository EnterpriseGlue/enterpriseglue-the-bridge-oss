import type { PluginId } from '@enterpriseglue/plugin-sdk';

import {
  PluginLifecycleExecutionError,
  type PluginLifecycleExecutionV1,
  type PluginLifecyclePlanEnvelopeV1,
} from './execution.js';
import type { PluginDeploymentLifecyclePhaseV1 } from './index.js';

export interface PluginLifecycleExecutionStorePortV1 {
  read(): Promise<PluginLifecycleExecutionV1>;
  readPlan(): Promise<PluginLifecyclePlanEnvelopeV1>;
  claim(input: {
    expectedRevision: number;
    owner: string;
    occurredAt: string;
    leaseDurationMs: number;
  }): Promise<PluginLifecycleExecutionV1>;
  renew(input: {
    expectedRevision: number;
    owner: string;
    occurredAt: string;
    leaseDurationMs: number;
  }): Promise<PluginLifecycleExecutionV1>;
  complete(input: {
    expectedRevision: number;
    owner: string;
    phase: PluginDeploymentLifecyclePhaseV1;
    occurredAt: string;
  }): Promise<PluginLifecycleExecutionV1>;
  fail(input: {
    expectedRevision: number;
    owner: string;
    occurredAt: string;
  }): Promise<PluginLifecycleExecutionV1>;
  recover(input: {
    expectedRevision: number;
    occurredAt: string;
  }): Promise<PluginLifecycleExecutionV1>;
}

export interface PluginLifecyclePhaseExecutionContextV1 {
  executionId: string;
  idempotencyKey: string;
  desiredRevision: number;
  planSha256: string;
  pluginId: PluginId;
  operation: PluginLifecycleExecutionV1['operation'];
  phase: PluginDeploymentLifecyclePhaseV1;
  leaseDurationMs: number;
  fromVersion?: string;
  toVersion?: string;
  fromDataSchema: number;
  toDataSchema: number;
  migrationImage?: string;
  dataAction?: 'retain' | 'export' | 'delete';
  renewLease(): Promise<void>;
}

/**
 * Deployment adapters implement fixed phases only.
 *
 * Every implementation must be idempotent for `idempotencyKey`. The runner
 * can safely retry a phase after process failure or after an adapter side
 * effect completed but its checkpoint did not.
 */
export interface PluginLifecyclePhaseAdapterV1 {
  executePhase(
    context: PluginLifecyclePhaseExecutionContextV1,
  ): Promise<void>;
}

export interface RunPluginLifecycleExecutionOptionsV1 {
  store: PluginLifecycleExecutionStorePortV1;
  adapter: PluginLifecyclePhaseAdapterV1;
  owner: string;
  leaseDurationMs: number;
  now?: () => Date;
}

function terminal(execution: PluginLifecycleExecutionV1): boolean {
  return (
    execution.status === 'succeeded' ||
    execution.status === 'manual_intervention'
  );
}

function expired(
  execution: PluginLifecycleExecutionV1,
  occurredAt: string,
): boolean {
  return Boolean(
    execution.leaseExpiresAt &&
      Date.parse(execution.leaseExpiresAt) <= Date.parse(occurredAt),
  );
}

export async function runPluginLifecycleExecutionV1(
  options: RunPluginLifecycleExecutionOptionsV1,
): Promise<PluginLifecycleExecutionV1> {
  const now = options.now ?? (() => new Date());
  const envelope = await options.store.readPlan();
  if (!envelope.plan) {
    throw new PluginLifecycleExecutionError(
      'plan_unavailable',
      'Lifecycle runner requires a non-empty current plan',
    );
  }
  let execution = await options.store.read();
  if (terminal(execution)) return execution;

  let occurredAt = now().toISOString();
  if (execution.status === 'running' && expired(execution, occurredAt)) {
    execution = await options.store.recover({
      expectedRevision: execution.revision,
      occurredAt,
    });
  }
  if (execution.status !== 'running') {
    occurredAt = now().toISOString();
    execution = await options.store.claim({
      expectedRevision: execution.revision,
      owner: options.owner,
      occurredAt,
      leaseDurationMs: options.leaseDurationMs,
    });
  } else if (execution.leaseOwner !== options.owner) {
    // Delegate the rejection to the store so every caller observes the same
    // compare-and-swap and lease semantics.
    execution = await options.store.claim({
      expectedRevision: execution.revision,
      owner: options.owner,
      occurredAt,
      leaseDurationMs: options.leaseDurationMs,
    });
  }

  while (!terminal(execution) && execution.nextPhase) {
    const phase = execution.nextPhase;
    occurredAt = now().toISOString();
    execution = await options.store.renew({
      expectedRevision: execution.revision,
      owner: options.owner,
      occurredAt,
      leaseDurationMs: options.leaseDurationMs,
    });
    const context: PluginLifecyclePhaseExecutionContextV1 = {
      executionId: execution.executionId,
      idempotencyKey: `${execution.executionId}:${phase}`,
      desiredRevision: execution.desiredRevision,
      planSha256: execution.planSha256,
      pluginId: execution.pluginId,
      operation: execution.operation,
      phase,
      leaseDurationMs: options.leaseDurationMs,
      fromVersion: envelope.plan.fromVersion,
      toVersion: envelope.plan.toVersion,
      fromDataSchema: envelope.plan.fromDataSchema,
      toDataSchema: envelope.plan.toDataSchema,
      migrationImage: envelope.plan.migrationImage,
      dataAction: envelope.plan.dataAction,
      renewLease: async () => {
        execution = await options.store.renew({
          expectedRevision: execution.revision,
          owner: options.owner,
          occurredAt: now().toISOString(),
          leaseDurationMs: options.leaseDurationMs,
        });
      },
    };

    try {
      await options.adapter.executePhase(context);
    } catch {
      occurredAt = now().toISOString();
      try {
        return await options.store.fail({
          expectedRevision: execution.revision,
          owner: options.owner,
          occurredAt,
        });
      } catch (error) {
        if (
          error instanceof PluginLifecycleExecutionError &&
          error.code === 'lease_expired'
        ) {
          return options.store.recover({
            expectedRevision: execution.revision,
            occurredAt,
          });
        }
        throw error;
      }
    }

    occurredAt = now().toISOString();
    try {
      execution = await options.store.complete({
        expectedRevision: execution.revision,
        owner: options.owner,
        phase,
        occurredAt,
      });
    } catch (error) {
      if (
        error instanceof PluginLifecycleExecutionError &&
        error.code === 'lease_expired'
      ) {
        return options.store.recover({
          expectedRevision: execution.revision,
          occurredAt,
        });
      }
      throw error;
    }
  }
  return execution;
}
