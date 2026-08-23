import { describe, expect, it } from 'vitest';

import { PluginEventMetricsRegistryV1 } from './pluginEventMetrics.js';

const pluginId = 'io.enterpriseglue.ion-support';
const subscriptionType = 'io.enterpriseglue.host.incident.v1';

describe('PluginEventMetricsRegistryV1', () => {
  it('aggregates only closed event lifecycle classes', () => {
    const metrics = new PluginEventMetricsRegistryV1(
      () => new Date('2026-07-26T01:00:00.000Z'),
    );
    metrics.recordEnqueue({
      pluginId,
      subscriptionType,
      outcome: 'queued',
      reasonCode: 'queued',
    });
    metrics.recordEnqueue({
      pluginId,
      subscriptionType,
      outcome: 'queued',
      reasonCode: 'queued',
    });
    metrics.recordDelivery({
      pluginId,
      subscriptionType,
      outcome: 'retry_wait',
      receiptStatus: 'retryable_rejected',
      reasonCode: 'delivery_unavailable',
      attempt: 1,
      maxAttempts: 2,
    });
    metrics.recordDelivery({
      pluginId,
      subscriptionType,
      outcome: 'dead_letter',
      receiptStatus: 'retryable_rejected',
      reasonCode: 'delivery_unavailable',
      attempt: 2,
      maxAttempts: 2,
    });
    metrics.recordCircuit({
      pluginId,
      subscriptionType,
      state: 'open',
      reasonCode: 'circuit_open',
    });

    expect(metrics.snapshot()).toEqual({
      apiVersion: 'event-metrics.plugin.enterpriseglue.io/v1',
      generatedAt: '2026-07-26T01:00:00.000Z',
      enqueues: [
        {
          pluginId,
          subscriptionType,
          outcome: 'queued',
          reasonCode: 'queued',
          count: 2,
        },
      ],
      deliveries: [
        {
          pluginId,
          subscriptionType,
          outcome: 'dead_letter',
          receiptStatus: 'retryable_rejected',
          reasonCode: 'delivery_unavailable',
          attemptClass: 'exhausted',
          count: 1,
        },
        {
          pluginId,
          subscriptionType,
          outcome: 'retry_wait',
          receiptStatus: 'retryable_rejected',
          reasonCode: 'delivery_unavailable',
          attemptClass: 'first',
          count: 1,
        },
      ],
      circuits: [
        {
          pluginId,
          subscriptionType,
          state: 'open',
          reasonCode: 'circuit_open',
          count: 1,
        },
      ],
    });
  });

  it('normalizes arbitrary reasons and exposes no payload-shaped fields', () => {
    const metrics = new PluginEventMetricsRegistryV1();
    metrics.recordDelivery({
      pluginId,
      subscriptionType,
      outcome: 'delivered',
      receiptStatus: 'accepted',
      reasonCode: '/var/log/customer-a/engine.log',
      attempt: 1,
      maxAttempts: 3,
    });
    const snapshot = metrics.snapshot();
    expect(snapshot.deliveries[0]).toEqual({
      pluginId,
      subscriptionType,
      outcome: 'delivered',
      receiptStatus: 'accepted',
      reasonCode: 'other',
      attemptClass: 'first',
      count: 1,
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('/var/log');
    expect(serialized).not.toContain('tenant');
    expect(serialized).not.toContain('deliveryId');
    expect(serialized).not.toContain('eventId');
    expect(serialized).not.toContain('operationId');
    expect(serialized).not.toContain('payload');
  });

  it('rejects an invalid plugin or subscription label before creating a series', () => {
    const metrics = new PluginEventMetricsRegistryV1();
    expect(() =>
      metrics.recordEnqueue({
        pluginId: 'customer-a',
        subscriptionType,
        outcome: 'rejected',
        reasonCode: 'event_invalid',
      }),
    ).toThrow();
    expect(() =>
      metrics.recordEnqueue({
        pluginId,
        subscriptionType: 'customer.private.event',
        outcome: 'rejected',
        reasonCode: 'event_invalid',
      }),
    ).toThrow();
    expect(metrics.snapshot().enqueues).toEqual([]);
  });
});
