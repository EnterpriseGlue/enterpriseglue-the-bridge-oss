import { describe, expect, it } from 'vitest';
import { formatEffectiveAccessLineage } from './accessControlPresentation';

describe('effective access presentation', () => {
  it('renders structured config bundle and apply-run lineage', () => {
    expect(formatEffectiveAccessLineage({
      type: 'role-assignment',
      source: 'config',
      configBundle: {
        bundleKey: 'acme.authz',
        sourceRef: 'config_bundle:acme.authz',
        objectType: 'role_assignment',
        objectId: 'assignment-config-operators',
        sourceHash: 'assignment-object-hash',
        lastAppliedAt: 1700000000000,
        driftStatus: 'in_sync',
        ownershipMode: 'config_locked',
        applyRun: {
          id: 'apply-run-1',
          canonicalHash: 'bundle-canonical-hash',
          appliedAt: 1700000001000,
        },
      },
    })).toContain(
      'Config bundle: acme.authz role_assignment:assignment-config-operators apply=apply-run-1 hash=bundle-canonical-hash drift=in_sync',
    );
  });
});
