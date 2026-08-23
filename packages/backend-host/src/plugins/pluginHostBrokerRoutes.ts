import {
  opaqueReferenceSchema,
  pluginReadableEngineAccessResponseV1Schema,
  type PluginInvocationClaimsV1,
  type PluginReadableEngineAccessRequestV1,
  type PluginReadableEngineAccessResponseV1,
  type PluginResourceMetadataRequestV1,
  type PluginResourceMetadataResponseV1,
} from '@enterpriseglue/plugin-sdk';
import {
  executePluginIdentityBrokerV1,
  executePluginReadableEngineAccessBrokerV1,
  executePluginDiagnosticCollectionBrokerV1,
  executePluginDiagnosticCollectorStatusBrokerV1,
  executePluginFixedScheduleBrokerV1,
  executePluginNotificationBrokerV1,
  executePluginResourceBrokerV1,
  executePluginStorageBrokerV1,
  HostBrokerErrorV1,
  type HostBrokerPluginRecordV1,
  type PluginDiagnosticCollectorV1,
  type PluginFixedScheduleStoreV1,
  type PluginNotificationPublisherV1,
  type PluginStorageStoreV1,
} from '@enterpriseglue/plugin-runtime/host-broker';
import type { PluginInvocationReplayStoreV1 } from '@enterpriseglue/plugin-runtime/gateway';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineHealth } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineHealth.js';
import { camundaGet } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import { isTenantVisibleForAuthz } from '@enterpriseglue/shared/authz/tenant-scope.js';
import {
  EnginePermissions,
  permissionService,
} from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import type { Express, Request, Response } from 'express';

import type { PluginControlPlaneV1 } from './pluginControlPlane.js';
import { DatabasePluginBrokerReplayStoreV1 } from './secretBrokerReplayStore.js';

interface PluginBrokerRuntimeSourceV1 {
  backendRecord(pluginId: string): Promise<
    | (HostBrokerPluginRecordV1 & {
        resources: unknown;
      })
    | null
    | undefined
  >;
}

export interface PluginHostBrokerRouteOptionsV1 {
  invocationPublicKey: () => Promise<string | Buffer>;
  expectedDeploymentRef: string;
  storageStore: PluginStorageStoreV1;
  notificationPublisher: PluginNotificationPublisherV1;
  scheduleStore: PluginFixedScheduleStoreV1;
  resourceLoader?: (
    request: PluginResourceMetadataRequestV1,
    claims: PluginInvocationClaimsV1,
  ) => Promise<PluginResourceMetadataResponseV1 | undefined>;
  readableEngineAccessLoader?: (
    request: PluginReadableEngineAccessRequestV1,
    claims: PluginInvocationClaimsV1,
  ) => Promise<PluginReadableEngineAccessResponseV1>;
  replayStoreFactory?: (
    pluginId: string,
    callId: string,
  ) => PluginInvocationReplayStoreV1;
  diagnosticCollector?: PluginDiagnosticCollectorV1;
  allowSanitizedBundleAuto?: boolean;
}

export function registerPluginHostBrokerRoutesV1(
  app: Express,
  runtime: PluginBrokerRuntimeSourceV1,
  control: PluginControlPlaneV1,
  options: PluginHostBrokerRouteOptionsV1,
): void {
  const path = (
    suffix: string,
  ) => `/_enterpriseglue/plugin-broker/v1/:pluginId/${suffix}`;

  app.post(path('identity'), (request, response) => {
    handle(request, response, runtime, control, options, 'identity').catch(
      (error) => brokerFailure(response, error),
    );
  });
  app.post(path('resources/read'), (request, response) => {
    handle(request, response, runtime, control, options, 'resource').catch(
      (error) => brokerFailure(response, error),
    );
  });
  app.post(path('engine-access/readable'), (request, response) => {
    handle(request, response, runtime, control, options, 'engineAccess').catch(
      (error) => brokerFailure(response, error),
    );
  });
  app.post(path('storage'), (request, response) => {
    handle(request, response, runtime, control, options, 'storage').catch(
      (error) => brokerFailure(response, error),
    );
  });
  app.post(path('diagnostics/collect'), (request, response) => {
    handle(request, response, runtime, control, options, 'diagnostic').catch(
      (error) => brokerFailure(response, error),
    );
  });
  app.post(path('diagnostics/status'), (request, response) => {
    handle(
      request,
      response,
      runtime,
      control,
      options,
      'diagnosticStatus',
    ).catch((error) => brokerFailure(response, error));
  });
  app.post(path('notifications/publish'), (request, response) => {
    handle(request, response, runtime, control, options, 'notification').catch(
      (error) => brokerFailure(response, error),
    );
  });
  app.post(path('schedules'), (request, response) => {
    handle(request, response, runtime, control, options, 'schedule').catch(
      (error) => brokerFailure(response, error),
    );
  });
}

async function handle(
  request: Request,
  response: Response,
  runtime: PluginBrokerRuntimeSourceV1,
  control: PluginControlPlaneV1,
  options: PluginHostBrokerRouteOptionsV1,
  kind:
    | 'identity'
    | 'engineAccess'
    | 'resource'
    | 'storage'
    | 'diagnostic'
    | 'diagnosticStatus'
    | 'notification'
    | 'schedule',
): Promise<void> {
  const pluginId = first(request.params.pluginId);
  const record = await runtime.backendRecord(pluginId);
  if (!record) throw new HostBrokerErrorV1(404, 'plugin_unavailable');
  const invocationToken = request.header(
    'x-enterpriseglue-plugin-invocation',
  );
  if (!invocationToken) {
    throw new HostBrokerErrorV1(401, 'invocation_invalid');
  }
  const callId = opaqueReferenceSchema.safeParse(
    request.body &&
      typeof request.body === 'object' &&
      !Array.isArray(request.body)
      ? (request.body as Record<string, unknown>).callId
      : undefined,
  );
  if (!callId.success) {
    throw new HostBrokerErrorV1(400, 'request_invalid');
  }
  const common = {
    record,
    request: request.body,
    invocationToken,
    invocationPublicKey: await options.invocationPublicKey(),
    expectedDeploymentRef: options.expectedDeploymentRef,
    replayStore:
      options.replayStoreFactory?.(record.pluginId, callId.data) ??
      new DatabasePluginBrokerReplayStoreV1(record.pluginId, callId.data),
    isExecutionAllowed: (tenantRef: string | undefined) =>
      control.isExecutionAllowed(record.pluginId, tenantRef),
  };
  const result = await (async () => {
    if (kind === 'identity') {
      return executePluginIdentityBrokerV1(common);
    }
    if (kind === 'engineAccess') {
      return executePluginReadableEngineAccessBrokerV1({
        ...common,
        list:
          options.readableEngineAccessLoader ??
          loadPluginReadableEngineAccessV1,
      });
    }
    if (kind === 'resource') {
      return executePluginResourceBrokerV1({
        ...common,
        load: options.resourceLoader ?? loadPluginResourceMetadataV1,
      });
    }
    if (kind === 'storage') {
      return executePluginStorageBrokerV1({
        ...common,
        store: options.storageStore,
      });
    }
    if (kind === 'diagnostic') {
      return executePluginDiagnosticCollectionBrokerV1({
        ...common,
        collector: options.diagnosticCollector,
        allowSanitizedBundleAuto: options.allowSanitizedBundleAuto,
      });
    }
    if (kind === 'diagnosticStatus') {
      return executePluginDiagnosticCollectorStatusBrokerV1({
        ...common,
        collector: options.diagnosticCollector,
      });
    }
    if (kind === 'notification') {
      return executePluginNotificationBrokerV1({
        ...common,
        publisher: options.notificationPublisher,
      });
    }
    return executePluginFixedScheduleBrokerV1({
      ...common,
      store: options.scheduleStore,
    });
  })();
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.status(200).json(result);
}

export async function loadPluginReadableEngineAccessV1(
  request: PluginReadableEngineAccessRequestV1,
  claims: PluginInvocationClaimsV1,
): Promise<PluginReadableEngineAccessResponseV1> {
  if (!claims.tenantRef) {
    throw new HostBrokerErrorV1(403, 'tenant_required');
  }
  const snapshot = await permissionService.getCurrentUserPermissions(
    claims.sub,
    claims.tenantRef,
  );
  const readable = snapshot.engines
    .filter((engine) =>
      engine.permissions.includes(EnginePermissions.INSTANCE_VIEW),
    )
    .map((engine) => engine.resourceId)
    .sort((left, right) => left.localeCompare(right));
  const offset = request.cursor
    ? Number.parseInt(request.cursor.slice('v1:'.length), 10)
    : 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > readable.length) {
    throw new HostBrokerErrorV1(400, 'request_invalid');
  }
  const end = Math.min(offset + request.limit, readable.length);
  return pluginReadableEngineAccessResponseV1Schema.parse({
    apiVersion: 'engine-access.plugin.enterpriseglue.io/v1',
    engineRefs: readable.slice(offset, end),
    ...(end < readable.length ? { nextCursor: `v1:${end}` } : {}),
  });
}

function brokerFailure(response: Response, error: unknown): void {
  if (error instanceof HostBrokerErrorV1) {
    response.setHeader('Cache-Control', 'no-store');
    response.status(error.status).json({ code: error.code });
    return;
  }
  console.error('[Plugin host broker] Operation failed');
  response
    .status(503)
    .setHeader('Cache-Control', 'no-store')
    .json({ code: 'plugin_unavailable' });
}

export async function loadPluginResourceMetadataV1(
  request: PluginResourceMetadataRequestV1,
  claims: PluginInvocationClaimsV1,
): Promise<PluginResourceMetadataResponseV1 | undefined> {
  const dataSource = await getDataSource();
  const engine = await dataSource.getRepository(Engine).findOne({
    where: { id: request.engineRef },
  });
  const engineScopeGranted = claims.resourceRefs?.some(
    (resource) =>
      resource.kind === 'engine' && resource.ref === request.engineRef,
  );
  if (
    !engine ||
    !isTenantVisibleForAuthz(engine.tenantId, claims.tenantRef) ||
    !engineScopeGranted
  ) {
    throw new HostBrokerErrorV1(403, 'resource_denied');
  }

  if (request.kind === 'engine') {
    if (engine.type !== 'operaton' && engine.type !== 'camunda7') {
      return undefined;
    }
    const health = await dataSource.getRepository(EngineHealth).findOne({
      where: { engineId: engine.id },
      order: { checkedAt: 'DESC' },
    });
    return {
      apiVersion: 'resource.plugin.enterpriseglue.io/v1',
      kind: 'engine',
      engineRef: engine.id,
      product: engine.type,
      version: safeCode(engine.version) ?? 'unknown',
      connected: health?.status === 'connected',
      lastSeenAt: timestamp(health?.checkedAt),
    };
  }

  if (request.kind === 'incident') {
    const incident = await camundaGet<Record<string, unknown>>(
      engine.id,
      `/incident/${encodeURIComponent(request.incidentRef)}`,
    );
    if (incident.id !== request.incidentRef) return undefined;
    return {
      apiVersion: 'resource.plugin.enterpriseglue.io/v1',
      kind: 'incident',
      engineRef: engine.id,
      incidentRef: request.incidentRef,
      incidentType: safeCode(incident.incidentType) ?? 'unknown',
      activityId: safeCode(incident.activityId),
      errorCode: safeCode(incident.errorCode),
      processDefinitionRef: opaque(incident.processDefinitionId),
      processInstanceRef: opaque(incident.processInstanceId),
      occurredAt: dateValue(incident.incidentTimestamp),
    };
  }

  if (request.kind === 'failed_job') {
    const job = await camundaGet<Record<string, unknown>>(
      engine.id,
      `/job/${encodeURIComponent(request.jobRef)}`,
    );
    if (job.id !== request.jobRef) return undefined;
    return {
      apiVersion: 'resource.plugin.enterpriseglue.io/v1',
      kind: 'failed_job',
      engineRef: engine.id,
      jobRef: request.jobRef,
      activityId: safeCode(job.activityId),
      processDefinitionRef: opaque(job.processDefinitionId),
      processInstanceRef: opaque(job.processInstanceId),
      retries: boundedInteger(job.retries),
      exceptionClass: safeCode(job.exceptionClass),
      dueAt: dateValue(job.due),
    };
  }

  const processInstance = await camundaGet<Record<string, unknown>>(
    engine.id,
    `/process-instance/${encodeURIComponent(request.processInstanceRef)}`,
  );
  if (processInstance.id !== request.processInstanceRef) return undefined;
  return {
    apiVersion: 'resource.plugin.enterpriseglue.io/v1',
    kind: 'process_instance',
    engineRef: engine.id,
    processInstanceRef: request.processInstanceRef,
    processDefinitionRef:
      opaque(processInstance.definitionId) ??
      opaque(processInstance.processDefinitionId) ??
      'unknown',
    state:
      processInstance.ended === true
        ? 'ended'
        : processInstance.suspended === true
          ? 'suspended'
          : 'active',
    startedAt: dateValue(processInstance.startTime),
    endedAt: dateValue(processInstance.endTime),
  };
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function safeCode(value: unknown): string | undefined {
  return typeof value === 'string' &&
    /^[A-Za-z0-9._:-]{1,200}$/.test(value)
    ? value
    : undefined;
}

function opaque(value: unknown): string | undefined {
  const parsed = opaqueReferenceSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function boundedInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1_000_000
    ? parsed
    : 0;
}

function dateValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function timestamp(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return new Date(numeric).toISOString();
}
