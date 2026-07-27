import {
  pluginEventMetricReasonValues,
  pluginEventMetricsV1Schema,
  pluginEventTypeSchema,
  pluginIdSchema,
  type PluginEventMetricReasonV1,
  type PluginEventMetricsV1,
  type PluginEventReceiptV1,
  type PluginEventTypeV1,
  type PluginId,
} from '@enterpriseglue/plugin-sdk';

const MAX_SERIES = 1_000;
const MAX_COUNT = Number.MAX_SAFE_INTEGER;
const knownReasons = new Set<string>(pluginEventMetricReasonValues);

export interface PluginEventEnqueueMetricInputV1 {
  readonly pluginId: PluginId | string;
  readonly subscriptionType: PluginEventTypeV1 | string;
  readonly outcome: 'queued' | 'duplicate' | 'rejected';
  readonly reasonCode: string;
}

export interface PluginEventDeliveryMetricInputV1 {
  readonly pluginId: PluginId | string;
  readonly subscriptionType: PluginEventTypeV1 | string;
  readonly outcome:
    | 'delivered'
    | 'retry_wait'
    | 'dead_letter'
    | 'requeued';
  readonly receiptStatus: PluginEventReceiptV1['status'] | 'none';
  readonly reasonCode: string;
  readonly attempt?: number;
  readonly maxAttempts?: number;
}

export interface PluginEventCircuitMetricInputV1 {
  readonly pluginId: PluginId | string;
  readonly subscriptionType: PluginEventTypeV1 | string;
  readonly state: 'closed' | 'open' | 'half_open';
  readonly reasonCode: string;
}

/**
 * In-process, bounded event lifecycle telemetry.
 *
 * The input surface deliberately has no tenant, deployment, event, delivery,
 * operation, actor, correlation, payload, exception, endpoint, or credential
 * field. The snapshot contains only manifest-bounded plugin/event classes and
 * closed lifecycle outcomes.
 */
export class PluginEventMetricsRegistryV1 {
  private readonly enqueues = new Map<string, number>();
  private readonly deliveries = new Map<string, number>();
  private readonly circuits = new Map<string, number>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  recordEnqueue(input: PluginEventEnqueueMetricInputV1): void {
    const pluginId = pluginIdSchema.parse(input.pluginId);
    const subscriptionType = pluginEventTypeSchema.parse(
      input.subscriptionType,
    );
    increment(
      this.enqueues,
      [
        pluginId,
        subscriptionType,
        input.outcome,
        safeReason(input.reasonCode),
      ].join('\0'),
    );
  }

  recordDelivery(input: PluginEventDeliveryMetricInputV1): void {
    const pluginId = pluginIdSchema.parse(input.pluginId);
    const subscriptionType = pluginEventTypeSchema.parse(
      input.subscriptionType,
    );
    increment(
      this.deliveries,
      [
        pluginId,
        subscriptionType,
        input.outcome,
        input.receiptStatus,
        safeReason(input.reasonCode),
        attemptClass(input),
      ].join('\0'),
    );
  }

  recordCircuit(input: PluginEventCircuitMetricInputV1): void {
    const pluginId = pluginIdSchema.parse(input.pluginId);
    const subscriptionType = pluginEventTypeSchema.parse(
      input.subscriptionType,
    );
    increment(
      this.circuits,
      [
        pluginId,
        subscriptionType,
        input.state,
        safeReason(input.reasonCode),
      ].join('\0'),
    );
  }

  snapshot(): PluginEventMetricsV1 {
    return pluginEventMetricsV1Schema.parse({
      apiVersion: 'event-metrics.plugin.enterpriseglue.io/v1',
      generatedAt: this.now().toISOString(),
      enqueues: sorted(this.enqueues).map(([key, count]) => {
        const [pluginId, subscriptionType, outcome, reasonCode] =
          key.split('\0');
        return {
          pluginId,
          subscriptionType,
          outcome,
          reasonCode,
          count,
        };
      }),
      deliveries: sorted(this.deliveries).map(([key, count]) => {
        const [
          pluginId,
          subscriptionType,
          outcome,
          receiptStatus,
          reasonCode,
          deliveryAttemptClass,
        ] = key.split('\0');
        return {
          pluginId,
          subscriptionType,
          outcome,
          receiptStatus,
          reasonCode,
          attemptClass: deliveryAttemptClass,
          count,
        };
      }),
      circuits: sorted(this.circuits).map(([key, count]) => {
        const [pluginId, subscriptionType, state, reasonCode] =
          key.split('\0');
        return {
          pluginId,
          subscriptionType,
          state,
          reasonCode,
          count,
        };
      }),
    });
  }
}

function safeReason(value: string): PluginEventMetricReasonV1 {
  return knownReasons.has(value)
    ? (value as PluginEventMetricReasonV1)
    : 'other';
}

function attemptClass(
  input: PluginEventDeliveryMetricInputV1,
): 'not_applicable' | 'first' | 'retry' | 'exhausted' {
  if (
    input.outcome === 'requeued' ||
    !Number.isSafeInteger(input.attempt) ||
    input.attempt === undefined ||
    input.attempt < 1
  ) {
    return 'not_applicable';
  }
  if (
    input.receiptStatus === 'retryable_rejected' &&
    Number.isSafeInteger(input.maxAttempts) &&
    input.maxAttempts !== undefined &&
    input.maxAttempts >= 1 &&
    input.attempt >= input.maxAttempts
  ) {
    return 'exhausted';
  }
  return input.attempt === 1 ? 'first' : 'retry';
}

function increment(metrics: Map<string, number>, key: string): void {
  if (!metrics.has(key) && metrics.size >= MAX_SERIES) return;
  metrics.set(
    key,
    Math.min(MAX_COUNT, (metrics.get(key) ?? 0) + 1),
  );
}

function sorted(metrics: Map<string, number>): Array<[string, number]> {
  return [...metrics.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
}
