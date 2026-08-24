import type {
  PluginCatalogV2,
  PluginInstallApprovalV1,
  PluginInstallReviewV1,
  PluginInstallationIntentV1,
  PluginInstallationObservationV1,
  PluginManagerCapabilityV1,
  PluginPlatformCapabilityCatalogV1,
} from '@enterpriseglue/plugin-sdk';

import { apiClient } from '../../../shared/api/client';

export interface PluginSafeSummaryV1 {
  pluginId: string;
  version: string;
  displayName: string;
  state: string;
  enabled: boolean;
  healthy: boolean;
  compatible: boolean;
  entitled:
    | 'not_required'
    | 'active'
    | 'grace'
    | 'expired'
    | 'revoked'
    | 'unavailable';
  reasonCode: string;
  revision: number;
}

export interface PluginSafeListV1 {
  apiVersion: 'control.plugin.enterpriseglue.io/v1';
  revision: number;
  plugins: PluginSafeSummaryV1[];
}

export interface PluginPlatformEmergencyStateV1 {
  apiVersion: 'emergency-control.plugin.enterpriseglue.io/v1';
  disabled: boolean;
  revision: number;
  reasonCode: 'none' | 'emergency_disabled';
  updatedAt: string;
}

export interface PluginPlatformAuditEventV1 {
  eventId: string;
  eventType: string;
  pluginId: string | null;
  tenantScoped: boolean;
  actorRef: string;
  correlationId: string;
  fromState: string | null;
  toState: string | null;
  reasonCode: string;
  occurredAt: string;
}

export interface PluginPlatformAuditListV1 {
  apiVersion: 'audit.plugin.enterpriseglue.io/v1';
  events: PluginPlatformAuditEventV1[];
}

export interface PluginEventDeadLetterSafeSummaryV1 {
  deliveryId: string;
  pluginId: string;
  tenantScoped: true;
  subscriptionType:
    | 'io.enterpriseglue.host.incident.v1'
    | 'io.enterpriseglue.host.failed-job.v1';
  attempt: number;
  maxAttempts: number;
  reasonCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface PluginEventDeadLetterListV1 {
  apiVersion: 'event-dead-letter-list.plugin.enterpriseglue.io/v1';
  items: PluginEventDeadLetterSafeSummaryV1[];
  nextCursor: string | null;
}

export interface PluginDeploymentExecutionSummaryV1 {
  executionId: string;
  executionRevision: number;
  desiredRevision: number;
  planSha256: string;
  pluginId: string;
  operation:
    | 'install'
    | 'enable'
    | 'disable'
    | 'upgrade'
    | 'rollback'
    | 'uninstall';
  status:
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'manual_intervention';
  completedPhases: string[];
  nextPhase: string | null;
  reasonCode: string;
  updatedAt: string;
  leaseExpiresAt: string | null;
}

export interface PluginDeploymentExecutionObservationV1 {
  apiVersion:
    'deployment-execution-observation.plugin.enterpriseglue.io/v1';
  observedFrom: 'local_execution_mirror';
  workloadReconciliation: 'not_checked';
  observationState: 'not_started' | 'current' | 'stale' | 'invalid';
  observationReason:
    | 'none'
    | 'execution_not_found'
    | 'desired_revision_mismatch'
    | 'plan_mismatch'
    | 'observation_invalid';
  desiredRevision: number;
  planSha256: string | null;
  execution: PluginDeploymentExecutionSummaryV1 | null;
}

export interface PluginManagerStatusV1 {
  apiVersion: 'manager-status.plugin.enterpriseglue.io/v1';
  available: boolean;
  capability: PluginManagerCapabilityV1 | null;
}

export interface PluginCatalogProjectionV1 {
  apiVersion: 'catalog-projection.plugin.enterpriseglue.io/v1';
  catalog: PluginCatalogV2 | null;
}

export interface PluginInstallationSummaryV1 {
  intent: PluginInstallationIntentV1;
  state: string;
  reasonCode: string;
  revision: number;
  review: PluginInstallReviewV1 | null;
  approval: PluginInstallApprovalV1 | null;
  latestObservation: PluginInstallationObservationV1 | null;
  updatedAt: string;
}

export interface PluginInstallationPageV1 {
  items: PluginInstallationSummaryV1[];
  total: number;
}

export async function listPluginPlatformPlugins(): Promise<PluginSafeListV1> {
  return apiClient.get<PluginSafeListV1>(
    '/api/plugin-platform/v1/plugins',
    undefined,
    { credentials: 'include' },
  );
}

export async function getPluginPlatformCapabilities(): Promise<PluginPlatformCapabilityCatalogV1> {
  return apiClient.get<PluginPlatformCapabilityCatalogV1>(
    '/api/plugin-platform/v1/capabilities',
    undefined,
    { credentials: 'include' },
  );
}

export async function getPluginPlatformEmergencyState(): Promise<PluginPlatformEmergencyStateV1> {
  return apiClient.get<PluginPlatformEmergencyStateV1>(
    '/api/plugin-platform/v1/emergency-control',
    undefined,
    { credentials: 'include' },
  );
}

export async function listPluginPlatformAudit(): Promise<PluginPlatformAuditListV1> {
  return apiClient.get<PluginPlatformAuditListV1>(
    '/api/plugin-platform/v1/audit',
    undefined,
    { credentials: 'include' },
  );
}

export async function listPluginEventDeadLetters(
  limit = 25,
): Promise<PluginEventDeadLetterListV1> {
  return apiClient.get<PluginEventDeadLetterListV1>(
    `/api/plugin-platform/v1/events/dead-letters?limit=${limit}`,
    undefined,
    { credentials: 'include' },
  );
}

export async function getPluginDeploymentExecution(): Promise<PluginDeploymentExecutionObservationV1> {
  return apiClient.get<PluginDeploymentExecutionObservationV1>(
    '/api/plugin-platform/v1/deployment-execution',
    undefined,
    { credentials: 'include' },
  );
}

export async function getPluginManagerStatus(): Promise<PluginManagerStatusV1> {
  return apiClient.get<PluginManagerStatusV1>(
    '/api/plugin-platform/v1/manager',
    undefined,
    { credentials: 'include' },
  );
}

export async function getPluginCatalog(): Promise<PluginCatalogProjectionV1> {
  return apiClient.get<PluginCatalogProjectionV1>(
    '/api/plugin-platform/v1/catalog',
    undefined,
    { credentials: 'include' },
  );
}

export async function listPluginInstallations(input: {
  limit: number;
  offset: number;
}): Promise<PluginInstallationPageV1> {
  return apiClient.get<PluginInstallationPageV1>(
    `/api/plugin-platform/v1/installations?limit=${input.limit}&offset=${input.offset}`,
    undefined,
    { credentials: 'include' },
  );
}

export async function getPluginInstallation(
  installationId: string,
): Promise<PluginInstallationSummaryV1> {
  return apiClient.get<PluginInstallationSummaryV1>(
    `/api/plugin-platform/v1/installations/${encodeURIComponent(installationId)}`,
    undefined,
    { credentials: 'include' },
  );
}

export async function createPluginInstallation(input: {
  pluginId: string;
  release: string;
  operation?: 'install' | 'upgrade';
  fromVersion?: string;
  currentEnabled?: boolean;
  source: 'connected_registry' | 'offline_delivery' | 'static_catalog';
  deploymentMode: 'compose_planner' | 'compose_managed' | 'kubernetes' | 'openshift';
  expectedPlatformRevision: number;
  idempotencyKey: string;
}): Promise<PluginInstallationIntentV1> {
  return apiClient.post<PluginInstallationIntentV1>(
    '/api/plugin-platform/v1/installations',
    input,
    {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export async function decidePluginInstallation(input: {
  installationId: string;
  decision: 'approve' | 'reject';
  reviewSha256: string;
  planSha256: string;
  expectedRevision: number;
}): Promise<{ approval: PluginInstallApprovalV1; revision: number }> {
  const { installationId, ...body } = input;
  return apiClient.post<{ approval: PluginInstallApprovalV1; revision: number }>(
    `/api/plugin-platform/v1/installations/${encodeURIComponent(installationId)}/approval`,
    body,
    {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export async function recoverPluginInstallation(input: {
  installationId: string;
  action: 'cancel' | 'retry';
  expectedRevision: number;
}): Promise<{ revision: number }> {
  return apiClient.post<{ revision: number }>(
    `/api/plugin-platform/v1/installations/${encodeURIComponent(input.installationId)}/${input.action}`,
    { expectedRevision: input.expectedRevision },
    {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export async function setPluginPlatformEmergencyState(input: {
  disabled: boolean;
  expectedRevision: number;
  idempotencyKey: string;
}): Promise<PluginPlatformEmergencyStateV1> {
  return apiClient.put<PluginPlatformEmergencyStateV1>(
    '/api/plugin-platform/v1/emergency-control',
    input,
    {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export async function setPluginDeploymentEnabled(input: {
  pluginId: string;
  enabled: boolean;
  expectedRevision: number;
  idempotencyKey: string;
}): Promise<void> {
  const operation = input.enabled ? 'enable' : 'disable';
  const body = input.enabled
    ? {
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
      }
    : {
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
        reason: 'administrator_request',
      };
  await apiClient.post(
    `/api/plugin-platform/v1/plugins/${encodeURIComponent(input.pluginId)}/${operation}`,
    body,
    {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export async function requeuePluginEventDeadLetter(input: {
  pluginId: string;
  deliveryId: string;
  expectedAttempt: number;
}): Promise<void> {
  await apiClient.post(
    `/api/plugin-platform/v1/plugins/${encodeURIComponent(
      input.pluginId,
    )}/events/dead-letters/${encodeURIComponent(
      input.deliveryId,
    )}/requeue`,
    { expectedAttempt: input.expectedAttempt },
    {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
