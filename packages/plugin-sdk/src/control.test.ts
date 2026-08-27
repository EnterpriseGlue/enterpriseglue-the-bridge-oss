import { describe, expect, it } from 'vitest';

import {
  pluginDeploymentExecutionObservationV1Schema,
  pluginDisableRequestV1Schema,
  pluginEnableRequestV1Schema,
  pluginEventDeadLetterListV1Schema,
  pluginEventDeadLetterRequeueRequestV1Schema,
  pluginEventMetricsV1Schema,
  pluginInstallRequestV1Schema,
  pluginDiagnosticMetricsV1Schema,
  pluginPlatformAuditListV1Schema,
  pluginPlatformEmergencyRequestV1Schema,
  pluginPlatformEmergencyStateV1Schema,
  pluginTenantApplicationDecisionRequestV1Schema,
  pluginTenantApplicationListV1Schema,
  pluginSafeSummaryV1Schema,
  pluginStageRequestV1Schema,
  pluginUninstallRequestV1Schema,
} from './control.js';

describe('plugin control contracts', () => {
  it('exposes only a strict browser-safe deployment execution projection', () => {
    const observation = {
      apiVersion:
        'deployment-execution-observation.plugin.enterpriseglue.io/v1',
      observedFrom: 'local_execution_mirror',
      workloadReconciliation: 'not_checked',
      observationState: 'current',
      observationReason: 'none',
      desiredRevision: 7,
      planSha256: 'a'.repeat(64),
      execution: {
        executionId: 'execution-safe-0001',
        executionRevision: 2,
        desiredRevision: 7,
        planSha256: 'a'.repeat(64),
        pluginId: 'io.enterpriseglue.ion-support',
        operation: 'install',
        status: 'queued',
        completedPhases: ['stage'],
        nextPhase: 'commit',
        reasonCode: 'none',
        updatedAt: '2026-07-25T01:00:00.000Z',
        leaseExpiresAt: null,
      },
    };
    expect(
      pluginDeploymentExecutionObservationV1Schema.safeParse(
        observation,
      ).success,
    ).toBe(true);
    expect(
      pluginDeploymentExecutionObservationV1Schema.safeParse({
        ...observation,
        execution: {
          ...observation.execution,
          leaseOwner: 'worker-secret-identity',
        },
      }).success,
    ).toBe(false);
    expect(
      pluginDeploymentExecutionObservationV1Schema.safeParse({
        ...observation,
        execution: {
          ...observation.execution,
          desiredRevision: 6,
        },
      }).success,
    ).toBe(false);
    expect(
      pluginDeploymentExecutionObservationV1Schema.safeParse({
        ...observation,
        rawPlan: { command: 'must-not-be-exposed' },
      }).success,
    ).toBe(false);
  });

  it('accepts catalog identity but rejects browser-supplied artifact infrastructure', () => {
    const selection = {
      pluginId: 'io.enterpriseglue.ion-support',
      version: '1.0.0',
      idempotencyKey: 'install-request-0001',
    };

    expect(pluginStageRequestV1Schema.safeParse(selection).success).toBe(true);
    expect(
      pluginStageRequestV1Schema.safeParse({
        ...selection,
        ociUrl: 'registry.attacker.invalid/plugin:latest',
      }).success,
    ).toBe(false);
    expect(
      pluginStageRequestV1Schema.safeParse({
        ...selection,
        registryCredential: 'secret',
      }).success,
    ).toBe(false);
  });

  it('requires an explicit plugin-data action on uninstall', () => {
    expect(
      pluginUninstallRequestV1Schema.safeParse({
        idempotencyKey: 'uninstall-request-0001',
      }).success,
    ).toBe(false);
    expect(
      pluginUninstallRequestV1Schema.safeParse({
        idempotencyKey: 'uninstall-request-0001',
        dataAction: 'retain',
      }).success,
    ).toBe(true);
  });

  it('accepts only known permission grants and safe summary fields', () => {
    expect(
      pluginInstallRequestV1Schema.safeParse({
        idempotencyKey: 'install-request-0001',
        permissionGrants: ['host.identity.read_safe'],
      }).success,
    ).toBe(true);
    expect(
      pluginInstallRequestV1Schema.safeParse({
        idempotencyKey: 'install-request-0001',
        permissionGrants: ['host.database.superuser'],
      }).success,
    ).toBe(false);

    expect(
      pluginSafeSummaryV1Schema.safeParse({
        pluginId: 'io.enterpriseglue.ion-support',
        version: '1.0.0',
        displayName: 'ION Support',
        state: 'installed_disabled',
        enabled: false,
        healthy: true,
        compatible: true,
        entitled: 'active',
        reasonCode: 'none',
        revision: 1,
        entitlementDocument: 'must-not-be-exposed',
      }).success,
    ).toBe(false);
  });

  it('requires optimistic revision and a bounded idempotency key for runtime gates', () => {
    expect(
      pluginEnableRequestV1Schema.safeParse({
        idempotencyKey: 'enable-request-0001',
        expectedRevision: 3,
      }).success,
    ).toBe(true);
    expect(
      pluginEnableRequestV1Schema.safeParse({
        idempotencyKey: 'short',
        expectedRevision: 3,
      }).success,
    ).toBe(false);
    expect(
      pluginDisableRequestV1Schema.safeParse({
        idempotencyKey: 'disable-request-0001',
        reason: 'administrator_request',
      }).success,
    ).toBe(false);
  });

  it('keeps tenant marketplace projections strict and infrastructure-free', () => {
    const catalogue = {
      apiVersion: 'tenant-application-list.plugin.enterpriseglue.io/v1',
      revision: 4,
      activationPolicy: 'approval_required',
      applications: [{
        apiVersion: 'tenant-application.plugin.enterpriseglue.io/v1',
        pluginId: 'io.enterpriseglue.ion-support',
        version: '1.2.3',
        displayName: 'ION Support',
        publisher: 'io.enterpriseglue',
        status: 'requested',
        active: false,
        compatible: true,
        healthy: true,
        entitled: 'active',
        reasonCode: 'none',
        revision: 2,
        activationRequest: {
          state: 'pending',
          requestedAt: '2026-08-28T00:00:00.000Z',
          reviewedAt: null,
        },
        configuration: {
          available: true,
          schemaSha256: 'a'.repeat(64),
          href: '/t/acme/settings/ion-support',
          owner: 'plugin',
        },
      }],
    };
    expect(pluginTenantApplicationListV1Schema.safeParse(catalogue).success).toBe(true);
    expect(pluginTenantApplicationListV1Schema.safeParse({
      ...catalogue,
      applications: [{
        ...catalogue.applications[0],
        registryCredential: 'must-not-leak',
      }],
    }).success).toBe(false);
    expect(pluginTenantApplicationDecisionRequestV1Schema.safeParse({
      decision: 'approve',
      expectedRevision: 2,
      idempotencyKey: 'activation-approve-0001',
      tenantRef: 'attacker-selected-tenant',
    }).success).toBe(false);
  });

  it('keeps the platform emergency control strict and revision protected', () => {
    expect(
      pluginPlatformEmergencyRequestV1Schema.safeParse({
        disabled: true,
        expectedRevision: 0,
        idempotencyKey: 'emergency-request-0001',
      }).success,
    ).toBe(true);
    expect(
      pluginPlatformEmergencyRequestV1Schema.safeParse({
        disabled: true,
        expectedRevision: 0,
        idempotencyKey: 'emergency-request-0001',
        pluginId: 'io.enterpriseglue.reference',
      }).success,
    ).toBe(false);
    expect(
      pluginPlatformEmergencyStateV1Schema.safeParse({
        apiVersion: 'emergency-control.plugin.enterpriseglue.io/v1',
        disabled: true,
        revision: 1,
        reasonCode: 'emergency_disabled',
        updatedAt: '2026-07-24T01:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('keeps diagnostic metrics low-cardinality and payload free', () => {
    const metrics = {
      apiVersion: 'diagnostic-metrics.plugin.enterpriseglue.io/v1',
      generatedAt: '2026-07-26T00:00:00.000Z',
      collections: [
        {
          pluginId: 'io.enterpriseglue.ion-support',
          status: 'rejected',
          reasonCode: 'collector_source_format_invalid',
          sanitizedByteClass: 'not_applicable',
          count: 2,
        },
      ],
      statusChecks: [
        {
          pluginId: 'io.enterpriseglue.ion-support',
          state: 'ready',
          reasonCode: 'collector_ready',
          sourceClass: 'multiple',
          count: 1,
        },
      ],
    };
    expect(pluginDiagnosticMetricsV1Schema.safeParse(metrics).success).toBe(
      true,
    );
    expect(
      pluginDiagnosticMetricsV1Schema.safeParse({
        ...metrics,
        collections: [
          {
            ...metrics.collections[0],
            sourcePath: '/var/log/customer.log',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('keeps event lifecycle metrics closed and payload free', () => {
    const metrics = {
      apiVersion: 'event-metrics.plugin.enterpriseglue.io/v1',
      generatedAt: '2026-07-26T00:00:00.000Z',
      enqueues: [
        {
          pluginId: 'io.enterpriseglue.ion-support',
          subscriptionType: 'io.enterpriseglue.host.incident.v1',
          outcome: 'queued',
          reasonCode: 'queued',
          count: 2,
        },
      ],
      deliveries: [
        {
          pluginId: 'io.enterpriseglue.ion-support',
          subscriptionType: 'io.enterpriseglue.host.incident.v1',
          outcome: 'retry_wait',
          receiptStatus: 'retryable_rejected',
          reasonCode: 'delivery_unavailable',
          attemptClass: 'first',
          count: 1,
        },
      ],
      circuits: [
        {
          pluginId: 'io.enterpriseglue.ion-support',
          subscriptionType: 'io.enterpriseglue.host.incident.v1',
          state: 'open',
          reasonCode: 'circuit_open',
          count: 1,
        },
      ],
    };
    expect(pluginEventMetricsV1Schema.safeParse(metrics).success).toBe(true);
    expect(
      pluginEventMetricsV1Schema.safeParse({
        ...metrics,
        deliveries: [
          {
            ...metrics.deliveries[0],
            tenantRef: 'customer-a',
            deliveryId: 'event-private',
            event: { message: 'customer payload' },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('keeps recent platform audit responses bounded and payload free', () => {
    expect(
      pluginPlatformAuditListV1Schema.safeParse({
        apiVersion: 'audit.plugin.enterpriseglue.io/v1',
        events: [
          {
            eventId: 'audit-event-1',
            eventType: 'platform_emergency_disabled',
            pluginId: null,
            tenantScoped: false,
            actorRef: 'admin-1',
            correlationId: 'request-1',
            fromState: 'enabled',
            toState: 'disabled',
            reasonCode: 'emergency_disabled',
            occurredAt: '2026-07-24T01:00:00.000Z',
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      pluginPlatformAuditListV1Schema.safeParse({
        apiVersion: 'audit.plugin.enterpriseglue.io/v1',
        events: [
          {
            eventId: 'audit-event-1',
            eventType: 'platform_emergency_disabled',
            pluginId: null,
            tenantScoped: false,
            actorRef: 'admin-1',
            correlationId: 'request-1',
            fromState: 'enabled',
            toState: 'disabled',
            reasonCode: 'emergency_disabled',
            occurredAt: '2026-07-24T01:00:00.000Z',
            requestBody: 'must-not-be-exposed',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('keeps dead-letter inspection payload-free and replay revision protected', () => {
    const list = {
      apiVersion: 'event-dead-letter-list.plugin.enterpriseglue.io/v1',
      items: [
        {
          deliveryId: 'event-dead-letter-1',
          pluginId: 'io.enterpriseglue.reference',
          tenantScoped: true,
          subscriptionType: 'io.enterpriseglue.host.incident.v1',
          attempt: 3,
          maxAttempts: 3,
          reasonCode: 'delivery_unavailable',
          createdAt: '2026-07-24T01:00:00.000Z',
          updatedAt: '2026-07-24T01:03:00.000Z',
        },
      ],
      nextCursor: null,
    };
    expect(pluginEventDeadLetterListV1Schema.safeParse(list).success).toBe(
      true,
    );
    expect(
      pluginEventDeadLetterListV1Schema.safeParse({
        ...list,
        items: [
          {
            ...list.items[0],
            tenantRef: 'tenant-secret',
            eventPayload: { errorMessage: 'must-not-be-exposed' },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      pluginEventDeadLetterRequeueRequestV1Schema.safeParse({
        expectedAttempt: 3,
      }).success,
    ).toBe(true);
    expect(
      pluginEventDeadLetterRequeueRequestV1Schema.safeParse({
        expectedAttempt: 0,
        destination: 'https://attacker.invalid',
      }).success,
    ).toBe(false);
  });
});
