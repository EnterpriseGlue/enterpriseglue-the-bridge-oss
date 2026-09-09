import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  RELEASE_EFFECT_INVENTORY_VERSION,
  RELEASE_EFFECT_SOURCES_V1,
} from '@enterpriseglue/shared/contracts/release-effect-inventory.js';

const expectedSources = [
  'release_runtime_membership',
  'tenant_release_assignment',
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
  'diagnostic_bundle_handoff',
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
    expect(RELEASE_EFFECT_SOURCES_V1).toHaveLength(21);
    expect(createHash('sha256').update(JSON.stringify({
      version: RELEASE_EFFECT_INVENTORY_VERSION, sources: RELEASE_EFFECT_SOURCES_V1,
    }), 'utf8').digest('hex')).toBe('c35183c2dee4ec8477948fdcd00d8b0b5e10de051d6e5ce9001950e2dac36087');
    expect(new Set(expectedSources).size).toBe(expectedSources.length);
    expect(RELEASE_EFFECT_SOURCES_V1.filter((source) => source.settlementRequired && source.coverage === 'uncovered').length).toBeGreaterThan(0);
    expect(RELEASE_EFFECT_SOURCES_V1.filter((source) => source.coverage === 'authoritative').map((source) => source.sourceId)).toEqual([
      'tenant_release_assignment', 'plugin_event_delivery', 'plugin_schedule_delivery',
    ]);
  });

  it('documents every executable source and fences both authoritative producers', () => {
    const root = new URL('../../../', import.meta.url);
    const runbook = readFileSync(new URL('docs/runbooks/release-effect-settlement.md', root), 'utf8');
    for (const source of RELEASE_EFFECT_SOURCES_V1) expect(runbook).toContain(`\`${source.sourceId}\``);
    for (const relative of [
      'packages/backend-host/src/plugins/pluginEventDeliveryStore.ts',
      'packages/backend-host/src/plugins/pluginScheduleStore.ts',
      'packages/shared/src/services/platform-admin/TenantReleaseWorkAssignmentService.ts',
    ]) {
      expect(readFileSync(new URL(relative, root), 'utf8')).toContain('assertReleaseEffectAdmission');
    }
    expect(readFileSync(new URL('packages/backend-host/src/plugins/localDiagnosticCollector.ts', root), 'utf8'))
      .toContain("method: 'POST'");
  });
});
