import { describe, expect, it } from 'vitest';

import { PluginDiagnosticMetricsRegistryV1 } from './pluginDiagnosticMetrics.js';

const pluginId = 'io.enterpriseglue.ion-support';

describe('PluginDiagnosticMetricsRegistryV1', () => {
  it('aggregates only closed diagnostic classes', () => {
    const metrics = new PluginDiagnosticMetricsRegistryV1(
      () => new Date('2026-07-26T00:00:00.000Z'),
    );
    metrics.recordCollection({
      pluginId,
      status: 'sanitized_bundle_ready',
      reasonCode: 'locally_filtered_and_handed_off',
      sanitizedBytes: 4_097,
    });
    metrics.recordCollection({
      pluginId,
      status: 'sanitized_bundle_ready',
      reasonCode: 'locally_filtered_and_handed_off',
      sanitizedBytes: 4_097,
    });
    metrics.recordCollection({
      pluginId,
      status: 'rejected',
      reasonCode: 'customer-path-/var/log/private',
    });
    metrics.recordStatus({
      pluginId,
      state: 'ready',
      reasonCode: 'collector_ready',
      sourceClass: 'multiple',
    });

    const snapshot = metrics.snapshot();
    expect(snapshot).toEqual({
      apiVersion: 'diagnostic-metrics.plugin.enterpriseglue.io/v1',
      generatedAt: '2026-07-26T00:00:00.000Z',
      collections: [
        {
          pluginId,
          status: 'rejected',
          reasonCode: 'other',
          sanitizedByteClass: 'not_applicable',
          count: 1,
        },
        {
          pluginId,
          status: 'sanitized_bundle_ready',
          reasonCode: 'locally_filtered_and_handed_off',
          sanitizedByteClass: 'up_to_64_kib',
          count: 2,
        },
      ],
      statusChecks: [
        {
          pluginId,
          state: 'ready',
          reasonCode: 'collector_ready',
          sourceClass: 'multiple',
          count: 1,
        },
      ],
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('/var/log');
    expect(serialized).not.toContain('customer-path');
  });

  it('rejects a caller-shaped plugin identity before creating a series', () => {
    const metrics = new PluginDiagnosticMetricsRegistryV1();
    expect(() =>
      metrics.recordStatus({
        pluginId: 'tenant/customer',
        state: 'degraded',
        reasonCode: 'collector_unavailable',
        sourceClass: 'none',
      }),
    ).toThrow();
    expect(metrics.snapshot().statusChecks).toEqual([]);
  });
});
