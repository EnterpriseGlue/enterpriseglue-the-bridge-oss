import { z } from 'zod';

import {
  opaqueReferenceSchema,
  pluginEventTypeSchema,
  pluginIdSchema,
  pluginPermissionSchema,
  semVerSchema,
} from './common.js';

export const pluginLifecycleStateValues = [
  'discovered',
  'rejected',
  'staged',
  'migrating',
  'installed_disabled',
  'enabling',
  'enabled',
  'degraded',
  'disabling',
  'upgrading',
  'rolling_back',
  'uninstalling',
  'removed',
  'failed',
] as const;

export const pluginLifecycleStateSchema = z.enum(pluginLifecycleStateValues);

export const pluginSafeReasonCodeValues = [
  'none',
  'signature_invalid',
  'publisher_untrusted',
  'artifact_revoked',
  'manifest_invalid',
  'host_incompatible',
  'sdk_incompatible',
  'protocol_incompatible',
  'shared_runtime_incompatible',
  'dependency_missing',
  'dependency_cycle',
  'plugin_conflict',
  'permission_denied',
  'egress_policy_denied',
  'entitlement_inactive',
  'migration_failed',
  'readiness_failed',
  'health_degraded',
  'runtime_failure',
  'administrator_disabled',
  'emergency_disabled',
] as const;

export const pluginSafeReasonCodeSchema = z.enum(pluginSafeReasonCodeValues);

export const pluginLifecycleOperationTypeValues = [
  'stage',
  'install',
  'enable',
  'disable',
  'upgrade',
  'rollback',
  'uninstall',
] as const;

export const pluginLifecycleOperationTypeSchema = z.enum(
  pluginLifecycleOperationTypeValues,
);

export const pluginDeploymentLifecyclePhaseValues = [
  'stage',
  'checkpoint',
  'migrate',
  'ready',
  'activate',
  'drain',
  'deactivate',
  'retain_data',
  'export_data',
  'delete_data',
  'remove',
  'commit',
] as const;

export const pluginDeploymentLifecyclePhaseSchema = z.enum(
  pluginDeploymentLifecyclePhaseValues,
);

export const pluginDeploymentLifecycleOperationSchema = z.enum([
  'install',
  'enable',
  'disable',
  'upgrade',
  'rollback',
  'uninstall',
]);

export const pluginDeploymentExecutionStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'manual_intervention',
]);

export const pluginDeploymentExecutionReasonSchema = z.enum([
  'none',
  'phase_failed',
  'lease_expired',
  'plan_mismatch',
  'rollback_unavailable',
]);

export const pluginOperationStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
]);

const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

const expectedRevisionSchema = z.number().int().nonnegative();

/**
 * Browser-safe artifact selection. Registry, credentials, publisher keys,
 * bundle URLs, deployment templates, and egress destinations are intentionally
 * absent and remain deployment-owned configuration.
 */
export const pluginCatalogSelectionV1Schema = z
  .object({
    pluginId: pluginIdSchema,
    version: semVerSchema,
  })
  .strict();

export const pluginPermissionGrantSetV1Schema = z
  .object({
    apiVersion: z.literal('permission-grants.plugin.enterpriseglue.io/v1'),
    pluginId: pluginIdSchema,
    permissions: z.array(pluginPermissionSchema).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.permissions).size !== value.permissions.length) {
      context.addIssue({
        code: 'custom',
        path: ['permissions'],
        message: 'Granted permissions must be unique',
      });
    }
  });

export const pluginStageRequestV1Schema = pluginCatalogSelectionV1Schema
  .extend({
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const pluginInstallRequestV1Schema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    permissionGrants: z.array(pluginPermissionSchema).max(100),
  })
  .strict();

export const pluginEnableRequestV1Schema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    expectedRevision: expectedRevisionSchema,
  })
  .strict();

export const pluginUpgradeRequestV1Schema = z
  .object({
    version: semVerSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const pluginRollbackRequestV1Schema = z
  .object({
    version: semVerSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const pluginDisableRequestV1Schema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    expectedRevision: expectedRevisionSchema,
    reason: z.enum(['administrator_request', 'emergency', 'dependency_change']),
  })
  .strict();

export const pluginUninstallRequestV1Schema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    dataAction: z.enum(['retain', 'export', 'delete']),
  })
  .strict();

export const pluginTenantEnablementRequestV1Schema = z
  .object({
    enabled: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
    expectedRevision: expectedRevisionSchema,
  })
  .strict();

export const pluginPlatformEmergencyRequestV1Schema = z
  .object({
    disabled: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
    expectedRevision: expectedRevisionSchema,
  })
  .strict();

export const pluginPlatformEmergencyStateV1Schema = z
  .object({
    apiVersion: z.literal(
      'emergency-control.plugin.enterpriseglue.io/v1',
    ),
    disabled: z.boolean(),
    revision: z.number().int().nonnegative(),
    reasonCode: z.enum(['none', 'emergency_disabled']),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const pluginDiagnosticMetricReasonValues = [
  'collector_ready',
  'collector_not_configured',
  'collector_policy_disabled',
  'collector_status_unsupported',
  'collector_status_unavailable',
  'collector_policy_path_invalid',
  'collector_policy_invalid',
  'collector_contract_invalid',
  'collector_policy_unavailable',
  'collector_source_not_approved',
  'collector_source_invalid',
  'collector_source_encoding_invalid',
  'collector_source_format_invalid',
  'collector_source_processing_failed',
  'collector_post_redaction_verification_failed',
  'collector_sanitized_output_too_large',
  'collector_profile_trigger_mismatch',
  'collector_signing_key_invalid',
  'collector_bundle_signing_failed',
  'collector_handoff_credential_invalid',
  'collector_handoff_endpoint_invalid',
  'collector_handoff_rejected',
  'collector_handoff_response_invalid',
  'collector_handoff_response_too_large',
  'collector_handoff_unavailable',
  'collector_unavailable',
  'locally_filtered_and_handed_off',
  'other',
] as const;

export const pluginDiagnosticMetricReasonSchema = z.enum(
  pluginDiagnosticMetricReasonValues,
);

export const pluginDiagnosticMetricsV1Schema = z
  .object({
    apiVersion: z.literal(
      'diagnostic-metrics.plugin.enterpriseglue.io/v1',
    ),
    generatedAt: z.string().datetime(),
    collections: z
      .array(
        z
          .object({
            pluginId: pluginIdSchema,
            status: z.enum(['sanitized_bundle_ready', 'rejected']),
            reasonCode: pluginDiagnosticMetricReasonSchema,
            sanitizedByteClass: z.enum([
              'not_applicable',
              'empty',
              'up_to_4_kib',
              'up_to_64_kib',
              'up_to_256_kib',
            ]),
            count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          })
          .strict(),
      )
      .max(1_000),
    statusChecks: z
      .array(
        z
          .object({
            pluginId: pluginIdSchema,
            state: z.enum([
              'ready',
              'disabled',
              'degraded',
              'unavailable',
            ]),
            reasonCode: pluginDiagnosticMetricReasonSchema,
            sourceClass: z.enum(['none', 'single', 'multiple']),
            count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          })
          .strict(),
      )
      .max(1_000),
  })
  .strict();

export const pluginEventMetricReasonValues = [
  'none',
  'queued',
  'duplicate',
  'event_invalid',
  'event_too_large',
  'idempotency_conflict',
  'circuit_open',
  'plugin_backlog_full',
  'subscription_backlog_full',
  'enqueue_unavailable',
  'accepted',
  'retryable_rejected',
  'permanent_rejected',
  'delivery_unavailable',
  'administrator_requeued',
  'delivery_failure',
  'delivery_recovered',
  'half_open_probe',
  'other',
] as const;

export const pluginEventMetricReasonSchema = z.enum(
  pluginEventMetricReasonValues,
);

export const pluginEventMetricsV1Schema = z
  .object({
    apiVersion: z.literal('event-metrics.plugin.enterpriseglue.io/v1'),
    generatedAt: z.string().datetime(),
    enqueues: z
      .array(
        z
          .object({
            pluginId: pluginIdSchema,
            subscriptionType: pluginEventTypeSchema,
            outcome: z.enum(['queued', 'duplicate', 'rejected']),
            reasonCode: pluginEventMetricReasonSchema,
            count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          })
          .strict(),
      )
      .max(1_000),
    deliveries: z
      .array(
        z
          .object({
            pluginId: pluginIdSchema,
            subscriptionType: pluginEventTypeSchema,
            outcome: z.enum([
              'delivered',
              'retry_wait',
              'dead_letter',
              'requeued',
            ]),
            receiptStatus: z.enum([
              'none',
              'accepted',
              'duplicate',
              'retryable_rejected',
              'permanent_rejected',
            ]),
            reasonCode: pluginEventMetricReasonSchema,
            attemptClass: z.enum([
              'not_applicable',
              'first',
              'retry',
              'exhausted',
            ]),
            count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          })
          .strict(),
      )
      .max(1_000),
    circuits: z
      .array(
        z
          .object({
            pluginId: pluginIdSchema,
            subscriptionType: pluginEventTypeSchema,
            state: z.enum(['closed', 'open', 'half_open']),
            reasonCode: pluginEventMetricReasonSchema,
            count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          })
          .strict(),
      )
      .max(1_000),
  })
  .strict();

export const pluginPlatformAuditEventTypeValues = [
  'installer_reconciled',
  'installer_removed',
  'deployment_enabled',
  'deployment_disabled',
  'tenant_enabled',
  'tenant_disabled',
  'platform_emergency_disabled',
  'platform_emergency_enabled',
  'event_dead_letter_requeued',
] as const;

export const pluginPlatformAuditEventTypeSchema = z.enum(
  pluginPlatformAuditEventTypeValues,
);

export const pluginPlatformAuditEventV1Schema = z
  .object({
    eventId: opaqueReferenceSchema,
    eventType: pluginPlatformAuditEventTypeSchema,
    pluginId: pluginIdSchema.nullable(),
    tenantScoped: z.boolean(),
    actorRef: opaqueReferenceSchema,
    correlationId: opaqueReferenceSchema,
    fromState: z.string().min(1).max(50).nullable(),
    toState: z.string().min(1).max(50).nullable(),
    reasonCode: pluginSafeReasonCodeSchema,
    occurredAt: z.string().datetime(),
  })
  .strict();

export const pluginPlatformAuditListV1Schema = z
  .object({
    apiVersion: z.literal('audit.plugin.enterpriseglue.io/v1'),
    events: z.array(pluginPlatformAuditEventV1Schema).max(100),
  })
  .strict();

export const pluginEventDeadLetterRequeueRequestV1Schema = z
  .object({
    expectedAttempt: z.number().int().min(1).max(100),
  })
  .strict();

export const pluginEventDeadLetterSafeSummaryV1Schema = z
  .object({
    deliveryId: opaqueReferenceSchema,
    pluginId: pluginIdSchema,
    tenantScoped: z.literal(true),
    subscriptionType: pluginEventTypeSchema,
    attempt: z.number().int().min(1).max(100),
    maxAttempts: z.number().int().min(1).max(100),
    reasonCode: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z][a-z0-9_]*$/),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const pluginEventDeadLetterListV1Schema = z
  .object({
    apiVersion: z.literal(
      'event-dead-letter-list.plugin.enterpriseglue.io/v1',
    ),
    items: z.array(pluginEventDeadLetterSafeSummaryV1Schema).max(100),
    nextCursor: opaqueReferenceSchema.nullable(),
  })
  .strict();

export const pluginEventDeadLetterRequeueResultV1Schema = z
  .object({
    apiVersion: z.literal(
      'event-dead-letter-requeue.plugin.enterpriseglue.io/v1',
    ),
    deliveryId: opaqueReferenceSchema,
    pluginId: pluginIdSchema,
    status: z.literal('pending'),
    attempt: z.literal(0),
    reasonCode: z.literal('administrator_requeued'),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const pluginLifecycleOperationV1Schema = z
  .object({
    operationId: opaqueReferenceSchema,
    pluginId: pluginIdSchema,
    type: pluginLifecycleOperationTypeSchema,
    status: pluginOperationStatusSchema,
    reasonCode: pluginSafeReasonCodeSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const pluginSafeSummaryV1Schema = z
  .object({
    pluginId: pluginIdSchema,
    version: semVerSchema,
    displayName: z.string().min(1).max(100),
    state: pluginLifecycleStateSchema,
    enabled: z.boolean(),
    healthy: z.boolean(),
    compatible: z.boolean(),
    entitled: z.enum([
      'not_required',
      'active',
      'grace',
      'expired',
      'revoked',
      'unavailable',
    ]),
    reasonCode: pluginSafeReasonCodeSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const pluginSafeListV1Schema = z
  .object({
    apiVersion: z.literal('control.plugin.enterpriseglue.io/v1'),
    revision: z.number().int().nonnegative(),
    plugins: z.array(pluginSafeSummaryV1Schema).max(1_000),
  })
  .strict();

/**
 * Browser-safe projection of one deployment-owned lifecycle execution.
 * Worker identity, commands, paths, raw plans, history, and cluster details
 * are intentionally excluded.
 */
export const pluginDeploymentExecutionSummaryV1Schema = z
  .object({
    executionId: opaqueReferenceSchema,
    executionRevision: z.number().int().nonnegative(),
    desiredRevision: z.number().int().nonnegative(),
    planSha256: z.string().regex(/^[a-f0-9]{64}$/),
    pluginId: pluginIdSchema,
    operation: pluginDeploymentLifecycleOperationSchema,
    status: pluginDeploymentExecutionStatusSchema,
    completedPhases: z
      .array(pluginDeploymentLifecyclePhaseSchema)
      .max(pluginDeploymentLifecyclePhaseValues.length),
    nextPhase: pluginDeploymentLifecyclePhaseSchema.nullable(),
    reasonCode: pluginDeploymentExecutionReasonSchema,
    updatedAt: z.string().datetime(),
    leaseExpiresAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.completedPhases).size !==
      value.completedPhases.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['completedPhases'],
        message: 'Completed lifecycle phases must be unique',
      });
    }
    if (
      (value.status === 'running') !==
      (value.leaseExpiresAt !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['leaseExpiresAt'],
        message:
          'Only a running lifecycle execution may expose a lease expiry',
      });
    }
    if (
      (value.status === 'succeeded') !==
      (value.nextPhase === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['nextPhase'],
        message:
          'Only a succeeded lifecycle execution may have no next phase',
      });
    }
  });

export const pluginDeploymentExecutionObservationStateSchema = z.enum([
  'not_started',
  'current',
  'stale',
  'invalid',
]);

export const pluginDeploymentExecutionObservationReasonSchema = z.enum([
  'none',
  'execution_not_found',
  'desired_revision_mismatch',
  'plan_mismatch',
  'observation_invalid',
]);

/**
 * Display-only deployment observation. It never participates in plugin
 * admission or enablement decisions, and it does not assert workload health.
 */
export const pluginDeploymentExecutionObservationV1Schema = z
  .object({
    apiVersion: z.literal(
      'deployment-execution-observation.plugin.enterpriseglue.io/v1',
    ),
    observedFrom: z.literal('local_execution_mirror'),
    workloadReconciliation: z.literal('not_checked'),
    observationState: pluginDeploymentExecutionObservationStateSchema,
    observationReason:
      pluginDeploymentExecutionObservationReasonSchema,
    desiredRevision: z.number().int().nonnegative(),
    planSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    execution: pluginDeploymentExecutionSummaryV1Schema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.observationState === 'current') {
      if (
        value.observationReason !== 'none' ||
        !value.execution ||
        value.execution.desiredRevision !== value.desiredRevision ||
        value.execution.planSha256 !== value.planSha256
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'A current observation must contain one matching execution',
        });
      }
      return;
    }
    if (value.execution !== null) {
      context.addIssue({
        code: 'custom',
        path: ['execution'],
        message: 'Only a current observation may contain execution details',
      });
    }
    if (
      value.observationState === 'not_started' &&
      value.observationReason !== 'execution_not_found'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observationReason'],
        message:
          'A not-started observation must use execution_not_found',
      });
    }
    if (
      value.observationState === 'stale' &&
      ![
        'desired_revision_mismatch',
        'plan_mismatch',
      ].includes(value.observationReason)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observationReason'],
        message: 'A stale observation must describe its mismatch',
      });
    }
    if (
      value.observationState === 'invalid' &&
      value.observationReason !== 'observation_invalid'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observationReason'],
        message:
          'An invalid observation must use observation_invalid',
      });
    }
  });

export const pluginTenantEnablementV1Schema = z
  .object({
    apiVersion: z.literal('tenant-enablement.plugin.enterpriseglue.io/v1'),
    pluginId: pluginIdSchema,
    enabled: z.boolean(),
    revision: z.number().int().nonnegative(),
  })
  .strict();

export type PluginTenantEnablementV1 = z.infer<
  typeof pluginTenantEnablementV1Schema
>;

export type PluginLifecycleStateV1 = z.infer<
  typeof pluginLifecycleStateSchema
>;
export type PluginSafeReasonCodeV1 = z.infer<
  typeof pluginSafeReasonCodeSchema
>;
export type PluginLifecycleOperationTypeV1 = z.infer<
  typeof pluginLifecycleOperationTypeSchema
>;
export type PluginDeploymentLifecyclePhaseV1 = z.infer<
  typeof pluginDeploymentLifecyclePhaseSchema
>;
export type PluginDeploymentLifecycleOperationV1 = z.infer<
  typeof pluginDeploymentLifecycleOperationSchema
>;
export type PluginDeploymentExecutionStatusV1 = z.infer<
  typeof pluginDeploymentExecutionStatusSchema
>;
export type PluginDeploymentExecutionReasonV1 = z.infer<
  typeof pluginDeploymentExecutionReasonSchema
>;
export type PluginDeploymentExecutionSummaryV1 = z.infer<
  typeof pluginDeploymentExecutionSummaryV1Schema
>;
export type PluginDeploymentExecutionObservationV1 = z.infer<
  typeof pluginDeploymentExecutionObservationV1Schema
>;
export type PluginLifecycleOperationV1 = z.infer<
  typeof pluginLifecycleOperationV1Schema
>;
export type PluginSafeSummaryV1 = z.infer<typeof pluginSafeSummaryV1Schema>;
export type PluginPermissionGrantSetV1 = z.infer<
  typeof pluginPermissionGrantSetV1Schema
>;
export type PluginEnableRequestV1 = z.infer<
  typeof pluginEnableRequestV1Schema
>;
export type PluginDisableRequestV1 = z.infer<
  typeof pluginDisableRequestV1Schema
>;
export type PluginTenantEnablementRequestV1 = z.infer<
  typeof pluginTenantEnablementRequestV1Schema
>;
export type PluginPlatformEmergencyRequestV1 = z.infer<
  typeof pluginPlatformEmergencyRequestV1Schema
>;
export type PluginPlatformEmergencyStateV1 = z.infer<
  typeof pluginPlatformEmergencyStateV1Schema
>;
export type PluginDiagnosticMetricReasonV1 = z.infer<
  typeof pluginDiagnosticMetricReasonSchema
>;
export type PluginDiagnosticMetricsV1 = z.infer<
  typeof pluginDiagnosticMetricsV1Schema
>;
export type PluginEventMetricReasonV1 = z.infer<
  typeof pluginEventMetricReasonSchema
>;
export type PluginEventMetricsV1 = z.infer<
  typeof pluginEventMetricsV1Schema
>;
export type PluginPlatformAuditEventV1 = z.infer<
  typeof pluginPlatformAuditEventV1Schema
>;
export type PluginPlatformAuditListV1 = z.infer<
  typeof pluginPlatformAuditListV1Schema
>;
export type PluginEventDeadLetterRequeueRequestV1 = z.infer<
  typeof pluginEventDeadLetterRequeueRequestV1Schema
>;
export type PluginEventDeadLetterSafeSummaryV1 = z.infer<
  typeof pluginEventDeadLetterSafeSummaryV1Schema
>;
export type PluginEventDeadLetterListV1 = z.infer<
  typeof pluginEventDeadLetterListV1Schema
>;
export type PluginEventDeadLetterRequeueResultV1 = z.infer<
  typeof pluginEventDeadLetterRequeueResultV1Schema
>;
