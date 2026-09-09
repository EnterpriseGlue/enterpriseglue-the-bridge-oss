import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { RELEASE_EFFECT_SOURCES_V1 } from '@enterpriseglue/shared/contracts/release-effect-inventory.js';

const expectedSources = [
  'plugin_event_delivery',
  'plugin_schedule_delivery',
  'plugin_gateway_invocation',
  'plugin_manager_lifecycle',
  'engine_api_mutation',
  'engine_backstop_sync',
  'config_runtime_reconciliation',
  'git_remote_mutation',
  'email_delivery',
  'tenant_secret_broker_mutation',
  'plugin_engine_event_polling',
  'plugin_contribution_refresh',
  'engine_inventory_and_batch_polling',
  'identity_provider_diagnostics',
  'config_identity_replay',
  'pii_provider_classification',
  'plugin_and_notification_streaming',
  'remote_configuration_reads',
];

describe('release effect source inventory', () => {
  it('keeps the reviewed API and worker boundary complete, unique, and fail-closed', () => {
    expect(RELEASE_EFFECT_SOURCES_V1.map((source) => source.sourceId)).toEqual(expectedSources);
    expect(new Set(expectedSources).size).toBe(expectedSources.length);
    expect(RELEASE_EFFECT_SOURCES_V1.filter((source) => source.settlementRequired && source.coverage === 'uncovered').length).toBeGreaterThan(0);
    expect(RELEASE_EFFECT_SOURCES_V1.filter((source) => source.coverage === 'authoritative').map((source) => source.sourceId)).toEqual([
      'plugin_event_delivery', 'plugin_schedule_delivery',
    ]);
  });

  it('documents every executable source and fences both authoritative producers', () => {
    const root = new URL('../../../', import.meta.url);
    const runbook = readFileSync(new URL('docs/runbooks/release-effect-settlement.md', root), 'utf8');
    for (const source of RELEASE_EFFECT_SOURCES_V1) expect(runbook).toContain(`\`${source.sourceId}\``);
    for (const relative of [
      'packages/backend-host/src/plugins/pluginEventDeliveryStore.ts',
      'packages/backend-host/src/plugins/pluginScheduleStore.ts',
    ]) {
      expect(readFileSync(new URL(relative, root), 'utf8')).toContain('assertReleaseEffectAdmission');
    }
  });
});
