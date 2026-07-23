import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ADAPTERS = ['Postgres', 'MySQL', 'SqlServer', 'Oracle', 'Spanner'];
const REQUIRED_CANONICAL_ENTITIES = [
  'IdentityProvider',
  'IdentityReconciliationCheckpoint',
  'DeploymentReceipt',
  'ConfigBundleApplyRun',
  'ConfigBundleIdentityReplayTask',
  'ConfigBundleRuntimeReconciliationTask',
  'AuthzGroup',
  'AuthzGroupMembership',
  'IdentityEntitlementMapping',
  'ExternalIdentity',
  'EngineTenantMapping',
  'EngineSet',
  'RuntimeResourceSet',
  'RuntimeResource',
  'ProjectEngineTarget',
  'EngineDeployment',
  'EngineDeploymentArtifact',
];

function entityRegistry(adapter: string): string {
  const file = path.resolve(__dirname, `../../../../packages/shared/src/infrastructure/persistence/adapters/${adapter}Adapter.ts`);
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(/const entities = \[([\s\S]*?)\n\];/);
  if (!match) throw new Error(`Could not locate ${adapter} entity registry`);
  return match[1];
}

describe('database adapter entity registries', () => {
  it('registers every canonical authorization, identity, config, and runtime entity in every adapter', () => {
    for (const adapter of ADAPTERS) {
      const registry = entityRegistry(adapter);
      for (const entity of REQUIRED_CANONICAL_ENTITIES) {
        expect(registry, `${adapter} must register ${entity}`).toMatch(new RegExp(`\\b${entity}\\b`));
      }
    }
  });
});
