import { createHash, type KeyObject } from 'node:crypto';

import {
  permissionForResourceKindV1,
  pluginDiagnosticCollectionRequestV1Schema,
  pluginDiagnosticCollectionResponseV1Schema,
  pluginDiagnosticCollectorStatusRequestV1Schema,
  pluginDiagnosticCollectorStatusResponseV1Schema,
  pluginFixedScheduleRequestV1Schema,
  pluginFixedScheduleResponseV1Schema,
  pluginIdentityRequestV1Schema,
  pluginIdentityResponseV1Schema,
  pluginNotificationPublishRequestV1Schema,
  pluginNotificationPublishResponseV1Schema,
  pluginResourceMetadataRequestV1Schema,
  pluginResourceMetadataResponseV1Schema,
  pluginStorageRequestV1Schema,
  pluginStorageResponseV1Schema,
  type EnterpriseGluePluginManifestV1,
  type PluginId,
  type PluginIdentityResponseV1,
  type PluginInvocationClaimsV1,
  type PluginDiagnosticCollectionRequestV1,
  type PluginDiagnosticCollectionResponseV1,
  type PluginDiagnosticCollectorStatusResponseV1,
  type PluginFixedScheduleRequestV1,
  type PluginFixedScheduleResponseV1,
  type PluginNotificationPublishRequestV1,
  type PluginNotificationPublishResponseV1,
  type PluginPermissionV1,
  type PluginResourceMetadataRequestV1,
  type PluginResourceMetadataResponseV1,
  type PluginStorageRequestV1,
  type PluginStorageResponseV1,
} from '@enterpriseglue/plugin-sdk';
import {
  verifyPluginInvocationV1,
  type PluginInvocationReplayStoreV1,
} from './gateway.js';

const IDENTITY_PERMISSION = 'host.identity.read_safe' as const;
const DIAGNOSTIC_PERMISSION =
  'host.engine.diagnostics.collect_sanitized' as const;
const NOTIFICATION_PERMISSION = 'host.notifications.publish_safe' as const;
const FIXED_SCHEDULE_PERMISSION = 'host.jobs.schedule_fixed' as const;
const MAX_STORAGE_VALUE_BYTES = 64 * 1024;

export type HostBrokerErrorCodeV1 =
  | 'request_invalid'
  | 'plugin_unavailable'
  | 'permission_denied'
  | 'invocation_invalid'
  | 'invocation_replayed'
  | 'tenant_required'
  | 'deployment_mismatch'
  | 'resource_denied'
  | 'resource_not_found'
  | 'storage_value_invalid'
  | 'storage_value_too_large'
  | 'storage_revision_conflict'
  | 'storage_quota_exceeded'
  | 'storage_unavailable'
  | 'notification_unavailable'
  | 'schedule_not_declared'
  | 'schedule_interval_denied'
  | 'schedule_unavailable';

export class HostBrokerErrorV1 extends Error {
  constructor(
    readonly status: number,
    readonly code: HostBrokerErrorCodeV1,
  ) {
    super(code);
    this.name = 'HostBrokerErrorV1';
  }
}

export interface HostBrokerPluginRecordV1 {
  pluginId: PluginId;
  manifest: EnterpriseGluePluginManifestV1;
  grantedPermissions: readonly PluginPermissionV1[];
}

interface HostBrokerInvocationInputV1 {
  record: HostBrokerPluginRecordV1;
  operationId: string;
  callId: string;
  requiredPermission: PluginPermissionV1;
  invocationToken: string;
  invocationPublicKey: KeyObject | string | Buffer;
  expectedDeploymentRef: string;
  replayStore: PluginInvocationReplayStoreV1;
  tenantRequired?: boolean;
  isExecutionAllowed?: (tenantRef: string | undefined) => Promise<boolean>;
}

export interface ExecuteIdentityBrokerInputV1
  extends Omit<
    HostBrokerInvocationInputV1,
    'operationId' | 'callId' | 'requiredPermission' | 'tenantRequired'
  > {
  request: unknown;
}

export interface ExecuteResourceBrokerInputV1
  extends Omit<
    HostBrokerInvocationInputV1,
    'operationId' | 'callId' | 'requiredPermission' | 'tenantRequired'
  > {
  request: unknown;
  load: (
    request: PluginResourceMetadataRequestV1,
    claims: PluginInvocationClaimsV1,
  ) => Promise<PluginResourceMetadataResponseV1 | undefined>;
}

export type PluginStorageStoreInputV1 = PluginStorageRequestV1 & {
  pluginId: PluginId;
  deploymentRef: string;
  tenantRef?: string;
};

export interface PluginStorageStoreV1 {
  execute(input: PluginStorageStoreInputV1): Promise<PluginStorageResponseV1>;
}

export interface ExecuteStorageBrokerInputV1
  extends Omit<
    HostBrokerInvocationInputV1,
    'operationId' | 'callId' | 'requiredPermission' | 'tenantRequired'
  > {
  request: unknown;
  store: PluginStorageStoreV1;
}

export interface PluginDiagnosticCollectorV1 {
  collect(input: {
    pluginId: PluginId;
    claims: PluginInvocationClaimsV1;
    request: PluginDiagnosticCollectionRequestV1;
  }): Promise<
    Pick<
      PluginDiagnosticCollectionResponseV1,
      | 'intentRef'
      | 'status'
      | 'filteringBoundary'
      | 'reasonCode'
      | 'consumerContextRef'
      | 'artifactRef'
    >
  >;
  status?(input: {
    pluginId: PluginId;
    claims: PluginInvocationClaimsV1;
  }): Promise<
    Pick<
      PluginDiagnosticCollectorStatusResponseV1,
      | 'state'
      | 'reasonCode'
      | 'sourceClass'
      | 'filteringBoundary'
      | 'checkedAt'
    >
  >;
}

export interface ExecuteDiagnosticCollectionBrokerInputV1
  extends Omit<
    HostBrokerInvocationInputV1,
    'operationId' | 'callId' | 'requiredPermission' | 'tenantRequired'
  > {
  request: unknown;
  collector?: PluginDiagnosticCollectorV1;
  allowSanitizedBundleAuto?: boolean;
}

export interface ExecuteDiagnosticCollectorStatusBrokerInputV1
  extends Omit<
    HostBrokerInvocationInputV1,
    'operationId' | 'callId' | 'requiredPermission' | 'tenantRequired'
  > {
  request: unknown;
  collector?: PluginDiagnosticCollectorV1;
  now?: () => Date;
}

export interface PluginNotificationPublisherV1 {
  publish(input: {
    pluginId: PluginId;
    deploymentRef: string;
    tenantRef: string;
    subjectRef: string;
    request: PluginNotificationPublishRequestV1;
  }): Promise<PluginNotificationPublishResponseV1>;
}

export interface ExecuteNotificationBrokerInputV1
  extends Omit<
    HostBrokerInvocationInputV1,
    'operationId' | 'callId' | 'requiredPermission' | 'tenantRequired'
  > {
  request: unknown;
  publisher: PluginNotificationPublisherV1;
}

export interface PluginFixedScheduleStoreV1 {
  execute(input: {
    pluginId: PluginId;
    deploymentRef: string;
    tenantRef: string;
    subjectRef: string;
    deliveryOperationId: string;
    allowedIntervalsSeconds: readonly number[];
    maxAttempts: number;
    request: PluginFixedScheduleRequestV1;
  }): Promise<PluginFixedScheduleResponseV1>;
}

export interface ExecuteFixedScheduleBrokerInputV1
  extends Omit<
    HostBrokerInvocationInputV1,
    'operationId' | 'callId' | 'requiredPermission' | 'tenantRequired'
  > {
  request: unknown;
  store: PluginFixedScheduleStoreV1;
}

async function verifyBrokerInvocationV1(
  input: HostBrokerInvocationInputV1,
): Promise<PluginInvocationClaimsV1> {
  const operation = input.record.manifest.deployment.backend?.operations.find(
    (candidate) => candidate.operationId === input.operationId,
  );
  const declared = new Set([
    ...input.record.manifest.permissions.required,
    ...input.record.manifest.permissions.optional,
  ]);
  if (
    !operation ||
    !operation.requiredPermissions.includes(input.requiredPermission) ||
    !declared.has(input.requiredPermission) ||
    !input.record.grantedPermissions.includes(input.requiredPermission)
  ) {
    throw new HostBrokerErrorV1(403, 'permission_denied');
  }
  let claims: PluginInvocationClaimsV1;
  try {
    claims = await verifyPluginInvocationV1({
      token: input.invocationToken,
      publicKey: input.invocationPublicKey,
      expectedAudience: input.record.pluginId,
      expectedOperationId: input.operationId,
      replayStore: input.replayStore,
      maximumLifetimeSeconds: 60,
    });
  } catch (error) {
    const replayed =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'token_replayed';
    throw new HostBrokerErrorV1(
      401,
      replayed ? 'invocation_replayed' : 'invocation_invalid',
    );
  }
  if (!claims.grantedPermissions.includes(input.requiredPermission)) {
    throw new HostBrokerErrorV1(403, 'permission_denied');
  }
  if (claims.deploymentRef !== input.expectedDeploymentRef) {
    throw new HostBrokerErrorV1(403, 'deployment_mismatch');
  }
  if (input.tenantRequired && !claims.tenantRef) {
    throw new HostBrokerErrorV1(403, 'tenant_required');
  }
  if (
    input.isExecutionAllowed &&
    !(await input.isExecutionAllowed(claims.tenantRef))
  ) {
    throw new HostBrokerErrorV1(404, 'plugin_unavailable');
  }
  return claims;
}

export async function executePluginIdentityBrokerV1(
  input: ExecuteIdentityBrokerInputV1,
): Promise<PluginIdentityResponseV1> {
  const parsed = pluginIdentityRequestV1Schema.safeParse(input.request);
  if (!parsed.success) {
    throw new HostBrokerErrorV1(400, 'request_invalid');
  }
  const claims = await verifyBrokerInvocationV1({
    ...input,
    operationId: parsed.data.operationId,
    callId: parsed.data.callId,
    requiredPermission: IDENTITY_PERMISSION,
  });
  return pluginIdentityResponseV1Schema.parse({
    apiVersion: 'identity.plugin.enterpriseglue.io/v1',
    subjectRef: claims.sub,
    tenantRef: claims.tenantRef,
    deploymentRef: claims.deploymentRef,
    grantedPermissions: claims.grantedPermissions,
  });
}

function resourceBoundToInvocation(
  request: PluginResourceMetadataRequestV1,
  claims: PluginInvocationClaimsV1,
): boolean {
  const refs = claims.resourceRefs ?? [];
  if (
    refs.some(
      (reference) =>
        reference.kind === 'engine' && reference.ref === request.engineRef,
    )
  ) {
    return true;
  }
  const targetRef =
    request.kind === 'incident'
      ? request.incidentRef
      : request.kind === 'failed_job'
        ? request.jobRef
        : request.kind === 'process_instance'
          ? request.processInstanceRef
          : request.engineRef;
  return refs.some(
    (reference) =>
      reference.kind === request.kind && reference.ref === targetRef,
  );
}

export async function executePluginResourceBrokerV1(
  input: ExecuteResourceBrokerInputV1,
): Promise<PluginResourceMetadataResponseV1> {
  const parsed = pluginResourceMetadataRequestV1Schema.safeParse(input.request);
  if (!parsed.success) {
    throw new HostBrokerErrorV1(400, 'request_invalid');
  }
  const request = parsed.data;
  const claims = await verifyBrokerInvocationV1({
    ...input,
    operationId: request.operationId,
    callId: request.callId,
    requiredPermission: permissionForResourceKindV1(request.kind),
    tenantRequired: true,
  });
  if (!resourceBoundToInvocation(request, claims)) {
    throw new HostBrokerErrorV1(403, 'resource_denied');
  }
  const result = await input.load(request, claims);
  if (!result) {
    throw new HostBrokerErrorV1(404, 'resource_not_found');
  }
  const parsedResult = pluginResourceMetadataResponseV1Schema.safeParse(result);
  if (
    !parsedResult.success ||
    parsedResult.data.kind !== request.kind ||
    parsedResult.data.engineRef !== request.engineRef
  ) {
    throw new HostBrokerErrorV1(503, 'plugin_unavailable');
  }
  return parsedResult.data;
}

function assertJsonStorageValue(value: unknown): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new HostBrokerErrorV1(400, 'storage_value_invalid');
  }
  if (serialized === undefined) {
    throw new HostBrokerErrorV1(400, 'storage_value_invalid');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STORAGE_VALUE_BYTES) {
    throw new HostBrokerErrorV1(413, 'storage_value_too_large');
  }
}

export async function executePluginStorageBrokerV1(
  input: ExecuteStorageBrokerInputV1,
): Promise<PluginStorageResponseV1> {
  const parsed = pluginStorageRequestV1Schema.safeParse(input.request);
  if (!parsed.success) {
    throw new HostBrokerErrorV1(400, 'request_invalid');
  }
  const request = parsed.data;
  const requiredPermission =
    request.scope === 'tenant'
      ? 'host.plugin_storage.tenant'
      : 'host.plugin_storage.deployment';
  const claims = await verifyBrokerInvocationV1({
    ...input,
    operationId: request.operationId,
    callId: request.callId,
    requiredPermission,
    tenantRequired: request.scope === 'tenant',
  });
  if (request.action === 'put') {
    assertJsonStorageValue(request.value);
  }
  try {
    return pluginStorageResponseV1Schema.parse(
      await input.store.execute({
        ...request,
        pluginId: input.record.pluginId,
        deploymentRef: claims.deploymentRef,
        tenantRef:
          request.scope === 'tenant' ? claims.tenantRef : undefined,
      }),
    );
  } catch (error) {
    if (error instanceof HostBrokerErrorV1) throw error;
    throw new HostBrokerErrorV1(503, 'storage_unavailable');
  }
}

export async function executePluginDiagnosticCollectorStatusBrokerV1(
  input: ExecuteDiagnosticCollectorStatusBrokerInputV1,
): Promise<PluginDiagnosticCollectorStatusResponseV1> {
  const parsed = pluginDiagnosticCollectorStatusRequestV1Schema.safeParse(
    input.request,
  );
  if (!parsed.success) {
    throw new HostBrokerErrorV1(400, 'request_invalid');
  }
  const request = parsed.data;
  const claims = await verifyBrokerInvocationV1({
    ...input,
    operationId: request.operationId,
    callId: request.callId,
    requiredPermission: IDENTITY_PERMISSION,
    tenantRequired: true,
  });
  const checkedAt = (input.now ?? (() => new Date()))().toISOString();
  const collectionPermission = input.record.grantedPermissions.includes(
    DIAGNOSTIC_PERMISSION,
  )
    ? 'granted' as const
    : 'not_granted' as const;
  if (!input.collector) {
    return diagnosticCollectorStatusResponse({
      state: 'disabled',
      reasonCode: 'collector_not_configured',
      collectionPermission,
      sourceClass: 'none',
      filteringBoundary: 'enterpriseglue_backend',
      checkedAt,
    });
  }
  if (!input.collector.status) {
    return diagnosticCollectorStatusResponse({
      state: 'unavailable',
      reasonCode: 'collector_status_unsupported',
      collectionPermission,
      sourceClass: 'none',
      filteringBoundary: 'enterpriseglue_backend',
      checkedAt,
    });
  }
  try {
    return diagnosticCollectorStatusResponse({
      ...(await input.collector.status({
        pluginId: input.record.pluginId,
        claims,
      })),
      collectionPermission,
    });
  } catch {
    return diagnosticCollectorStatusResponse({
      state: 'unavailable',
      reasonCode: 'collector_status_unavailable',
      collectionPermission,
      sourceClass: 'none',
      filteringBoundary: 'enterpriseglue_backend',
      checkedAt,
    });
  }
}

export async function executePluginDiagnosticCollectionBrokerV1(
  input: ExecuteDiagnosticCollectionBrokerInputV1,
): Promise<PluginDiagnosticCollectionResponseV1> {
  const parsed = pluginDiagnosticCollectionRequestV1Schema.safeParse(
    input.request,
  );
  if (!parsed.success) {
    throw new HostBrokerErrorV1(400, 'request_invalid');
  }
  const request = parsed.data;
  const claims = await verifyBrokerInvocationV1({
    ...input,
    operationId: request.operationId,
    callId: request.callId,
    requiredPermission: DIAGNOSTIC_PERMISSION,
    tenantRequired: true,
  });
  if (!diagnosticBoundToInvocation(request, claims)) {
    throw new HostBrokerErrorV1(403, 'resource_denied');
  }

  if (request.mode === 'manual') {
    return diagnosticResponse({
      intentRef: diagnosticIntentRef(input.record.pluginId, request),
      status: 'requires_confirmation',
      filteringBoundary: 'not_applicable',
      reasonCode: 'confirmation_required',
      ...(request.consumerContextRef
        ? { consumerContextRef: request.consumerContextRef }
        : {}),
    });
  }
  if (request.mode === 'metadata_auto') {
    return diagnosticResponse({
      intentRef: diagnosticIntentRef(input.record.pluginId, request),
      status: 'metadata_ready',
      filteringBoundary: 'not_applicable',
      reasonCode: 'metadata_only',
      ...(request.consumerContextRef
        ? { consumerContextRef: request.consumerContextRef }
        : {}),
    });
  }
  if (!input.allowSanitizedBundleAuto) {
    return diagnosticResponse({
      intentRef: diagnosticIntentRef(input.record.pluginId, request),
      status: 'rejected',
      filteringBoundary: 'enterpriseglue_backend',
      reasonCode: 'automatic_collection_disabled',
      ...(request.consumerContextRef
        ? { consumerContextRef: request.consumerContextRef }
        : {}),
    });
  }
  if (!input.collector) {
    return diagnosticResponse({
      intentRef: diagnosticIntentRef(input.record.pluginId, request),
      status: 'rejected',
      filteringBoundary: 'enterpriseglue_backend',
      reasonCode: 'collector_unavailable',
      ...(request.consumerContextRef
        ? { consumerContextRef: request.consumerContextRef }
        : {}),
    });
  }
  const result = await input.collector.collect({
    pluginId: input.record.pluginId,
    claims,
    request,
  });
  if (
    result.filteringBoundary === 'not_applicable' ||
    result.status === 'requires_confirmation' ||
    result.status === 'metadata_ready'
  ) {
    throw new HostBrokerErrorV1(503, 'plugin_unavailable');
  }
  return diagnosticResponse(result);
}

export async function executePluginNotificationBrokerV1(
  input: ExecuteNotificationBrokerInputV1,
): Promise<PluginNotificationPublishResponseV1> {
  const parsed = pluginNotificationPublishRequestV1Schema.safeParse(
    input.request,
  );
  if (!parsed.success) {
    throw new HostBrokerErrorV1(400, 'request_invalid');
  }
  const request = parsed.data;
  const claims = await verifyBrokerInvocationV1({
    ...input,
    operationId: request.operationId,
    callId: request.callId,
    requiredPermission: NOTIFICATION_PERMISSION,
    tenantRequired: true,
  });
  if (
    request.resource &&
    !(claims.resourceRefs ?? []).some(
      (reference) =>
        reference.kind === request.resource?.kind &&
        reference.ref === request.resource.ref,
    )
  ) {
    throw new HostBrokerErrorV1(403, 'resource_denied');
  }
  try {
    return pluginNotificationPublishResponseV1Schema.parse(
      await input.publisher.publish({
        pluginId: input.record.pluginId,
        deploymentRef: claims.deploymentRef,
        tenantRef: claims.tenantRef!,
        subjectRef: claims.sub,
        request,
      }),
    );
  } catch (error) {
    if (error instanceof HostBrokerErrorV1) throw error;
    throw new HostBrokerErrorV1(503, 'notification_unavailable');
  }
}

export async function executePluginFixedScheduleBrokerV1(
  input: ExecuteFixedScheduleBrokerInputV1,
): Promise<PluginFixedScheduleResponseV1> {
  const parsed = pluginFixedScheduleRequestV1Schema.safeParse(input.request);
  if (!parsed.success) {
    throw new HostBrokerErrorV1(400, 'request_invalid');
  }
  const request = parsed.data;
  const declaration = input.record.manifest.jobs.fixedSchedules.find(
    (schedule) => schedule.jobType === request.jobType,
  );
  if (!declaration) {
    throw new HostBrokerErrorV1(403, 'schedule_not_declared');
  }
  if (
    request.action === 'upsert' &&
    !declaration.allowedIntervalsSeconds.includes(request.intervalSeconds)
  ) {
    throw new HostBrokerErrorV1(403, 'schedule_interval_denied');
  }
  const claims = await verifyBrokerInvocationV1({
    ...input,
    operationId: request.operationId,
    callId: request.callId,
    requiredPermission: FIXED_SCHEDULE_PERMISSION,
    tenantRequired: true,
  });
  try {
    return pluginFixedScheduleResponseV1Schema.parse(
      await input.store.execute({
        pluginId: input.record.pluginId,
        deploymentRef: claims.deploymentRef,
        tenantRef: claims.tenantRef!,
        subjectRef: claims.sub,
        deliveryOperationId: declaration.deliveryOperationId,
        allowedIntervalsSeconds: declaration.allowedIntervalsSeconds,
        maxAttempts: declaration.maxAttempts,
        request,
      }),
    );
  } catch (error) {
    if (error instanceof HostBrokerErrorV1) throw error;
    throw new HostBrokerErrorV1(503, 'schedule_unavailable');
  }
}

function diagnosticBoundToInvocation(
  request: PluginDiagnosticCollectionRequestV1,
  claims: PluginInvocationClaimsV1,
): boolean {
  const refs = claims.resourceRefs ?? [];
  const engineBound = refs.some(
    (reference) =>
      reference.kind === 'engine' && reference.ref === request.engineRef,
  );
  if (engineBound) return true;
  if (request.trigger.kind === 'incident') {
    const incidentRef = request.trigger.incidentRef;
    return refs.some(
      (reference) =>
        reference.kind === 'incident' &&
        reference.ref === incidentRef,
    );
  }
  if (request.trigger.kind === 'failed_job') {
    const jobRef = request.trigger.jobRef;
    return refs.some(
      (reference) =>
        reference.kind === 'failed_job' &&
        reference.ref === jobRef,
    );
  }
  return false;
}

function diagnosticIntentRef(
  pluginId: PluginId,
  request: PluginDiagnosticCollectionRequestV1,
): string {
  const value = [
    pluginId,
    request.engineRef,
    request.trigger.kind,
    request.idempotencyKey,
    request.consumerContextRef ?? '',
  ].join('\0');
  return `diagnostic-${createHash('sha256')
    .update(value, 'utf8')
    .digest('hex')}`;
}

function diagnosticResponse(
  result: Pick<
    PluginDiagnosticCollectionResponseV1,
    | 'intentRef'
    | 'status'
    | 'filteringBoundary'
    | 'reasonCode'
    | 'consumerContextRef'
    | 'artifactRef'
  >,
): PluginDiagnosticCollectionResponseV1 {
  return pluginDiagnosticCollectionResponseV1Schema.parse({
    apiVersion:
      'diagnostic-collection-result.plugin.enterpriseglue.io/v1',
    ...result,
    rawUploadPermitted: false,
  });
}

function diagnosticCollectorStatusResponse(
  result: Pick<
    PluginDiagnosticCollectorStatusResponseV1,
    | 'state'
    | 'reasonCode'
    | 'collectionPermission'
    | 'sourceClass'
    | 'filteringBoundary'
    | 'checkedAt'
  >,
): PluginDiagnosticCollectorStatusResponseV1 {
  return pluginDiagnosticCollectorStatusResponseV1Schema.parse({
    apiVersion:
      'diagnostic-collector-status.plugin.enterpriseglue.io/v1',
    ...result,
    rawUploadPermitted: false,
    browserEditable: false,
  });
}
