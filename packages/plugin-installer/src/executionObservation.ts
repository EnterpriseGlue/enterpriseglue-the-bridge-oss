import { randomUUID } from 'node:crypto';
import {
  lstat,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  pluginDeploymentExecutionObservationV1Schema,
  type PluginDeploymentExecutionObservationV1,
} from '@enterpriseglue/plugin-sdk';

import {
  parsePluginLifecycleExecutionV1,
  parsePluginLifecyclePlanEnvelopeV1,
  type PluginLifecycleExecutionV1,
  type PluginLifecyclePlanEnvelopeV1,
} from './execution.js';

export const pluginLifecycleObservationFileName =
  'plugin-lifecycle-observation.json';

export function createPluginDeploymentExecutionObservationV1(
  envelopeInput: PluginLifecyclePlanEnvelopeV1,
  executionInput: PluginLifecycleExecutionV1 | null,
): PluginDeploymentExecutionObservationV1 {
  const envelope = parsePluginLifecyclePlanEnvelopeV1(envelopeInput);
  if (!executionInput) {
    return pluginDeploymentExecutionObservationV1Schema.parse({
      apiVersion:
        'deployment-execution-observation.plugin.enterpriseglue.io/v1',
      observedFrom: 'local_execution_mirror',
      workloadReconciliation: 'not_checked',
      observationState: 'not_started',
      observationReason: 'execution_not_found',
      desiredRevision: envelope.desiredRevision,
      planSha256: envelope.planSha256,
      execution: null,
    });
  }
  const execution = parsePluginLifecycleExecutionV1(
    executionInput,
    envelope,
  );
  return pluginDeploymentExecutionObservationV1Schema.parse({
    apiVersion:
      'deployment-execution-observation.plugin.enterpriseglue.io/v1',
    observedFrom: 'local_execution_mirror',
    workloadReconciliation: 'not_checked',
    observationState: 'current',
    observationReason: 'none',
    desiredRevision: envelope.desiredRevision,
    planSha256: envelope.planSha256,
    execution: {
      executionId: execution.executionId,
      executionRevision: execution.revision,
      desiredRevision: execution.desiredRevision,
      planSha256: execution.planSha256,
      pluginId: execution.pluginId,
      operation: execution.operation,
      status: execution.status,
      completedPhases: execution.completedPhases,
      nextPhase: execution.nextPhase ?? null,
      reasonCode: execution.reasonCode,
      updatedAt: execution.updatedAt,
      leaseExpiresAt: execution.leaseExpiresAt ?? null,
    },
  });
}

export async function writePluginDeploymentExecutionObservationV1(
  root: string,
  envelope: PluginLifecyclePlanEnvelopeV1,
  execution: PluginLifecycleExecutionV1 | null,
): Promise<PluginDeploymentExecutionObservationV1> {
  const rootPath = resolve(root);
  const details = await lstat(rootPath);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(
      'Lifecycle observation root must be a regular directory',
    );
  }
  const observation =
    createPluginDeploymentExecutionObservationV1(
      envelope,
      execution,
    );
  const path = resolve(rootPath, pluginLifecycleObservationFileName);
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(
    temporary,
    `${JSON.stringify(observation, null, 2)}\n`,
    {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    },
  );
  try {
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return observation;
}
