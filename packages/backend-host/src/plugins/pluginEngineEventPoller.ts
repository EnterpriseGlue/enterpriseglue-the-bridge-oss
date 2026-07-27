import { createHash } from 'node:crypto';

import {
  pluginHostEventV1Schema,
  type PluginHostEventV1,
} from '@enterpriseglue/plugin-sdk';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { DEFAULT_TENANT_ID } from '@enterpriseglue/shared/middleware/tenant.js';
import { camundaGet } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import type { DataSource } from 'typeorm';

import type { PluginEventDispatcherV1 } from './pluginEventDispatcher.js';

const DEFAULT_INTERVAL_MS = 30_000;
const MAX_RESULTS_PER_ENGINE = 100;

interface EngineEventSourceV1 {
  id: string;
  type: string | null;
  tenantId: string | null;
  version: string | null;
}

export interface PluginEngineEventPollerOptionsV1 {
  dataSource?: () => Promise<DataSource>;
  read?: (
    engineId: string,
    path: string,
    params: Record<string, unknown>,
  ) => Promise<unknown[]>;
  intervalMs?: number;
  now?: () => Date;
}

/**
 * Opt-in discovery of new engine incidents and exhausted jobs plus one
 * minimized product/version observation per engine and UTC day.
 *
 * Repeated scans are safe: event and delivery identities are deterministic and
 * the durable delivery store rejects semantic changes for an existing ID.
 * Only closed metadata is published; exception messages, stack traces,
 * variables, payloads, credentials, and log bytes are never read here.
 */
export class PluginEngineEventPollerV1 {
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly dispatcher: Pick<PluginEventDispatcherV1, 'publish'>,
    private readonly options: PluginEngineEventPollerOptionsV1 = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    if (
      !Number.isSafeInteger(this.intervalMs) ||
      this.intervalMs < 5_000 ||
      this.intervalMs > 3_600_000
    ) {
      throw new Error('plugin_engine_event_poller_options_invalid');
    }
  }

  async runOnce(): Promise<{
    engines: number;
    published: number;
    failed: number;
  }> {
    const dataSource = await (this.options.dataSource ?? getDataSource)();
    const engines = (
      await dataSource.getRepository(Engine).find({
        select: { id: true, type: true, tenantId: true, version: true },
      })
    ).filter(
      (engine) => engine.type === 'operaton' || engine.type === 'camunda7',
    );
    let published = 0;
    let failed = 0;
    for (const engine of engines) {
      let engineFailed = false;
      try {
        await this.dispatcher.publish(
          engineInventoryEvent(
            engine,
            (this.options.now ?? (() => new Date()))(),
          ),
        );
        published += 1;
      } catch {
        engineFailed = true;
      }
      try {
        const events = await this.readEngine(engine);
        for (const event of events) {
          await this.dispatcher.publish(event);
          published += 1;
        }
      } catch {
        engineFailed = true;
      }
      if (engineFailed) failed += 1;
    }
    return { engines: engines.length, published, failed };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.runOnce()
        .then((result) => {
          if (result.failed > 0) {
            console.error(
              `[Plugin engine event poller] ${result.failed} engine scan(s) failed`,
            );
          }
        })
        .catch(() => {
          console.error('[Plugin engine event poller] Scan cycle failed');
        })
        .finally(() => {
          this.running = false;
        });
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async readEngine(
    engine: EngineEventSourceV1,
  ): Promise<PluginHostEventV1[]> {
    const read =
      this.options.read ??
      ((engineId, path, params) => camundaGet<unknown[]>(engineId, path, params));
    const [incidentResult, failedJobResult] = await Promise.allSettled([
      read(engine.id, '/incident', {
        sortBy: 'incidentTimestamp',
        sortOrder: 'desc',
        maxResults: MAX_RESULTS_PER_ENGINE,
      }),
      read(engine.id, '/job', {
        noRetriesLeft: true,
        maxResults: MAX_RESULTS_PER_ENGINE,
      }),
    ]);
    if (
      incidentResult.status === 'rejected' &&
      failedJobResult.status === 'rejected'
    ) {
      throw new Error('plugin_engine_event_sources_unavailable');
    }
    const incidents =
      incidentResult.status === 'fulfilled' ? incidentResult.value : [];
    const failedJobs =
      failedJobResult.status === 'fulfilled' ? failedJobResult.value : [];
    const tenantRef = engine.tenantId ?? DEFAULT_TENANT_ID;
    return [
      ...incidents.flatMap((value) => incidentEvent(engine.id, tenantRef, value)),
      ...failedJobs.flatMap((value) => failedJobEvent(engine.id, tenantRef, value)),
    ];
  }
}

function engineInventoryEvent(
  engine: EngineEventSourceV1,
  observedAt: Date,
): PluginHostEventV1 {
  if (Number.isNaN(observedAt.valueOf())) {
    throw new Error('plugin_engine_inventory_time_invalid');
  }
  const tenantRef = engine.tenantId ?? DEFAULT_TENANT_ID;
  const product =
    engine.type === 'operaton' ? ('operaton' as const) : ('camunda7' as const);
  const observedAtBucket = `${observedAt.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const data = {
    engineRef: engine.id,
    product,
    version: safeEngineVersion(engine.version),
    observedAtBucket,
  };
  return pluginHostEventV1Schema.parse({
    specversion: '1.0',
    id: stableEventId(
      'engine-inventory',
      engine.id,
      data.version,
      observedAtBucket,
      data,
    ),
    source: 'enterpriseglue-oss',
    type: 'io.enterpriseglue.host.engine-inventory.v1',
    subject: engine.id,
    time: observedAtBucket,
    dataschema:
      'https://schemas.enterpriseglue.io/events/engine-inventory-v1.json',
    tenantRef,
    data,
  });
}

function incidentEvent(
  engineRef: string,
  tenantRef: string,
  value: unknown,
): PluginHostEventV1[] {
  const row = object(value);
  const incidentRef = opaque(row?.id);
  const incidentType = code(row?.incidentType);
  if (!incidentRef || !incidentType) return [];
  const time = stableTime(row?.incidentTimestamp);
  const data = compact({
    engineRef,
    incidentRef,
    incidentType,
    activityId: code(row?.activityId),
    errorCode: code(row?.errorCode),
    processDefinitionRef: opaque(row?.processDefinitionId),
    processInstanceRef: opaque(row?.processInstanceId),
    occurredAt: optionalTime(row?.incidentTimestamp),
  });
  return [
    pluginHostEventV1Schema.parse({
      specversion: '1.0',
      id: stableEventId('incident', engineRef, incidentRef, time, data),
      source: 'enterpriseglue-oss',
      type: 'io.enterpriseglue.host.incident.v1',
      subject: incidentRef,
      time,
      dataschema:
        'https://schemas.enterpriseglue.io/events/incident-v1.json',
      tenantRef,
      data,
    }),
  ];
}

function failedJobEvent(
  engineRef: string,
  tenantRef: string,
  value: unknown,
): PluginHostEventV1[] {
  const row = object(value);
  const jobRef = opaque(row?.id);
  const retries = integer(row?.retries);
  if (!jobRef || retries === undefined || retries > 0) return [];
  const time = stableTime(row?.due);
  const data = compact({
    engineRef,
    jobRef,
    activityId: code(row?.activityId),
    processDefinitionRef: opaque(row?.processDefinitionId),
    processInstanceRef: opaque(row?.processInstanceId),
    retries,
    occurredAt: optionalTime(row?.due),
  });
  return [
    pluginHostEventV1Schema.parse({
      specversion: '1.0',
      id: stableEventId('failed-job', engineRef, jobRef, time, data),
      source: 'enterpriseglue-oss',
      type: 'io.enterpriseglue.host.failed-job.v1',
      subject: jobRef,
      time,
      dataschema:
        'https://schemas.enterpriseglue.io/events/failed-job-v1.json',
      tenantRef,
      data,
    }),
  ];
}

function stableEventId(
  kind: string,
  engineRef: string,
  ref: string,
  time: string,
  data: Record<string, unknown>,
): string {
  return `${kind}-${createHash('sha256')
    .update(
      [engineRef, ref, time, JSON.stringify(data)].join('\0'),
      'utf8',
    )
    .digest('hex')}`;
}

function stableTime(value: unknown): string {
  return optionalTime(value) ?? '1970-01-01T00:00:00.000Z';
}

function optionalTime(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function opaque(value: unknown): string | undefined {
  return typeof value === 'string' &&
    /^[A-Za-z0-9._:-]{1,256}$/.test(value)
    ? value
    : undefined;
}

function code(value: unknown): string | undefined {
  return typeof value === 'string' &&
    /^[A-Za-z0-9._:-]{1,200}$/.test(value)
    ? value
    : undefined;
}

function safeEngineVersion(value: unknown): string {
  return code(value) ?? 'unknown';
}

function integer(value: unknown): number | undefined {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 && result <= 1_000_000
    ? result
    : undefined;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
