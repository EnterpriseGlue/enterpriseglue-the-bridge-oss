import { describe, expect, it } from 'vitest';

import {
  PluginEventDeliveryCoordinatorV1,
  type ClaimedPluginEventV1,
  type PluginEventDeliveryStoreV1,
  type PluginEventSafeSummaryV1,
} from './pluginEventDeliveryStore.js';

function delivery(id: string): ClaimedPluginEventV1 {
  return {
    deliveryId: id,
    pluginId: 'io.enterpriseglue.reference',
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
    attempt: 1,
    maxAttempts: 3,
    leaseOwner: 'worker-1',
    request: {
      apiVersion: 'event-delivery.plugin.enterpriseglue.io/v1',
      deliveryId: id,
      operationId: 'io.enterpriseglue.reference.consume-incident',
      subscriptionType: 'io.enterpriseglue.host.incident.v1',
      attempt: 1,
      event: {
        specversion: '1.0',
        id: `event-${id}`,
        source: 'enterpriseglue-oss',
        type: 'io.enterpriseglue.host.incident.v1',
        subject: 'incident-1',
        time: '2026-07-24T00:00:00.000Z',
        dataschema:
          'https://schemas.enterpriseglue.io/events/incident-v1.json',
        tenantRef: 'tenant-1',
        data: {
          engineRef: 'engine-1',
          incidentRef: 'incident-1',
          incidentType: 'failedJob',
        },
      },
    },
  };
}

describe('PluginEventDeliveryCoordinatorV1', () => {
  it('persists accepted and retryable outcomes without one delivery blocking another', async () => {
    const claimed = [delivery('delivery-1'), delivery('delivery-2')];
    const completed: Array<{ deliveryId: string; status: string }> = [];
    const store: PluginEventDeliveryStoreV1 = {
      enqueue: async () => ({ deliveryId: 'unused' }),
      claimDue: async () => claimed,
      complete: async (input) => {
        completed.push({
          deliveryId: input.deliveryId,
          status: input.receipt.status,
        });
        return {
          deliveryId: input.deliveryId,
          pluginId: 'io.enterpriseglue.reference',
          tenantRef: 'tenant-1',
          subscriptionType: 'io.enterpriseglue.host.incident.v1',
          status:
            input.receipt.status === 'accepted'
              ? 'delivered'
              : 'retry_wait',
          attempt: 1,
          maxAttempts: 3,
          reasonCode: input.receipt.reasonCode,
          nextAttemptAt: 1_000,
          updatedAt: 1_000,
        } satisfies PluginEventSafeSummaryV1;
      },
      requeueDeadLetter: async () => {
        throw new Error('unused');
      },
    };
    const result = await new PluginEventDeliveryCoordinatorV1(store).runOnce({
      workerRef: 'worker-1',
      now: 1_000,
      deliver: async (item) => {
        if (item.deliveryId === 'delivery-2') {
          throw new Error('sidecar unavailable');
        }
        return {
          apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
          deliveryId: item.deliveryId,
          status: 'accepted',
          reasonCode: 'accepted',
        };
      },
    });

    expect(result.map((item) => item.status)).toEqual([
      'delivered',
      'retry_wait',
    ]);
    expect(completed).toEqual([
      { deliveryId: 'delivery-1', status: 'accepted' },
      { deliveryId: 'delivery-2', status: 'retryable_rejected' },
    ]);
  });
});
