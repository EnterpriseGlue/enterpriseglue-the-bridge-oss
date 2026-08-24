import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createPluginLifecyclePlanEnvelopeV1,
  pluginLifecyclePlanFileName,
} from '@enterpriseglue/plugin-installer';
import { afterEach, describe, expect, it } from 'vitest';

import { assertPreparedPluginPlanMatchesV1 } from './planGate.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('assertPreparedPluginPlanMatchesV1', () => {
  it('accepts only the package-generated plan approved by exact digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eg-plan-gate-'));
    roots.push(root);
    const envelope = createPluginLifecyclePlanEnvelopeV1(1, {
      apiVersion: 'lifecycle-plan.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginLifecyclePlan',
      operation: 'install',
      pluginId: 'io.enterpriseglue.example',
      toVersion: '1.0.0',
      fromDataSchema: 0,
      toDataSchema: 0,
      rollbackSupported: true,
      phases: ['stage', 'commit'],
    });
    await writeFile(
      join(root, pluginLifecyclePlanFileName),
      JSON.stringify(envelope),
    );
    await expect(
      assertPreparedPluginPlanMatchesV1(root, envelope),
    ).resolves.toBeUndefined();
    await expect(
      assertPreparedPluginPlanMatchesV1(root, {
        ...envelope,
        planSha256: 'f'.repeat(64),
      }),
    ).rejects.toThrow('verified_package_plan_mismatch');
  });
});
