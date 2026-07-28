import {
  pluginDiagnosticMetricReasonValues,
  pluginDiagnosticMetricsV1Schema,
  pluginIdSchema,
  type PluginDiagnosticCollectionResponseV1,
  type PluginDiagnosticCollectorStatusResponseV1,
  type PluginDiagnosticMetricReasonV1,
  type PluginDiagnosticMetricsV1,
  type PluginId,
} from '@enterpriseglue/plugin-sdk';

const MAX_SERIES = 1_000;
const MAX_COUNT = Number.MAX_SAFE_INTEGER;
const knownReasons = new Set<string>(pluginDiagnosticMetricReasonValues);

export interface PluginDiagnosticCollectionMetricInputV1 {
  readonly pluginId: PluginId | string;
  readonly status: Extract<
    PluginDiagnosticCollectionResponseV1['status'],
    'sanitized_bundle_ready' | 'rejected'
  >;
  readonly reasonCode: string;
  readonly sanitizedBytes?: number;
}

export interface PluginDiagnosticStatusMetricInputV1 {
  readonly pluginId: PluginId | string;
  readonly state: PluginDiagnosticCollectorStatusResponseV1['state'];
  readonly reasonCode: string;
  readonly sourceClass:
    PluginDiagnosticCollectorStatusResponseV1['sourceClass'];
}

/**
 * In-process, low-cardinality diagnostics telemetry.
 *
 * It intentionally accepts no tenant, subject, engine, incident, source,
 * path, endpoint, key, credential, content, or correlation field.
 */
export class PluginDiagnosticMetricsRegistryV1 {
  private readonly collections = new Map<string, number>();
  private readonly statusChecks = new Map<string, number>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  recordCollection(input: PluginDiagnosticCollectionMetricInputV1): void {
    const pluginId = pluginIdSchema.parse(input.pluginId);
    const reasonCode = safeReason(input.reasonCode);
    const byteClass =
      input.status === 'sanitized_bundle_ready'
        ? sanitizedByteClass(input.sanitizedBytes)
        : 'not_applicable';
    increment(
      this.collections,
      [pluginId, input.status, reasonCode, byteClass].join('\0'),
    );
  }

  recordStatus(input: PluginDiagnosticStatusMetricInputV1): void {
    const pluginId = pluginIdSchema.parse(input.pluginId);
    increment(
      this.statusChecks,
      [
        pluginId,
        input.state,
        safeReason(input.reasonCode),
        input.sourceClass,
      ].join('\0'),
    );
  }

  snapshot(): PluginDiagnosticMetricsV1 {
    return pluginDiagnosticMetricsV1Schema.parse({
      apiVersion: 'diagnostic-metrics.plugin.enterpriseglue.io/v1',
      generatedAt: this.now().toISOString(),
      collections: [...this.collections.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, count]) => {
          const [pluginId, status, reasonCode, sanitizedByteClass] =
            key.split('\0');
          return {
            pluginId,
            status,
            reasonCode,
            sanitizedByteClass,
            count,
          };
        }),
      statusChecks: [...this.statusChecks.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, count]) => {
          const [pluginId, state, reasonCode, sourceClass] =
            key.split('\0');
          return {
            pluginId,
            state,
            reasonCode,
            sourceClass,
            count,
          };
        }),
    });
  }
}

function safeReason(value: string): PluginDiagnosticMetricReasonV1 {
  return knownReasons.has(value)
    ? (value as PluginDiagnosticMetricReasonV1)
    : 'other';
}

function sanitizedByteClass(
  value: number | undefined,
):
  | 'empty'
  | 'up_to_4_kib'
  | 'up_to_64_kib'
  | 'up_to_256_kib' {
  if (!Number.isSafeInteger(value) || value === undefined || value < 0) {
    return 'empty';
  }
  if (value === 0) return 'empty';
  if (value <= 4 * 1024) return 'up_to_4_kib';
  if (value <= 64 * 1024) return 'up_to_64_kib';
  return 'up_to_256_kib';
}

function increment(metrics: Map<string, number>, key: string): void {
  if (!metrics.has(key) && metrics.size >= MAX_SERIES) {
    return;
  }
  metrics.set(
    key,
    Math.min(MAX_COUNT, (metrics.get(key) ?? 0) + 1),
  );
}
