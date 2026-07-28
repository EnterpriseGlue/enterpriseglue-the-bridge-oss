import { Column, Entity, Index } from 'typeorm';

import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'plugin_platform_state', schema: 'main' })
export class PluginPlatformState extends AppBaseEntity {
  @Column({ name: 'installer_revision', type: 'bigint', default: 0 })
  installerRevision!: number;

  @Column({ name: 'snapshot_hash', type: 'text' })
  snapshotHash!: string;

  @Column({ name: 'emergency_disabled', type: 'boolean', default: false })
  emergencyDisabled!: boolean;

  @Column({ name: 'emergency_revision', type: 'bigint', default: 0 })
  emergencyRevision!: number;

  @Column({ name: 'emergency_updated_at', type: 'bigint', nullable: true })
  emergencyUpdatedAt!: number | null;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}

@Index(
  'idx_plugin_emergency_operation_idempotency',
  ['idempotencyKeyHash'],
  { unique: true },
)
@Entity({ name: 'plugin_emergency_control_operations', schema: 'main' })
export class PluginEmergencyControlOperation extends AppBaseEntity {
  @Column({ name: 'idempotency_key_hash', type: 'text' })
  idempotencyKeyHash!: string;

  @Column({ name: 'request_hash', type: 'text' })
  requestHash!: string;

  @Column({ type: 'boolean' })
  disabled!: boolean;

  @Column({ type: 'bigint' })
  revision!: number;

  @Column({ name: 'actor_ref', type: 'text' })
  actorRef!: string;

  @Column({ name: 'correlation_id', type: 'text' })
  correlationId!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}

@Index('idx_plugin_install_plugin', ['pluginId'], { unique: true })
@Index('idx_plugin_install_state', ['state'])
@Entity({ name: 'plugin_installations', schema: 'main' })
export class PluginInstallation extends AppBaseEntity {
  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ type: 'text' })
  version!: string;

  @Column({ type: 'text' })
  publisher!: string;

  @Column({ name: 'display_name', type: 'text' })
  displayName!: string;

  @Column({ name: 'manifest_sha256', type: 'text' })
  manifestSha256!: string;

  @Column({ name: 'source_record_hash', type: 'text' })
  sourceRecordHash!: string;

  @Column({ name: 'bundle_digest', type: 'text' })
  bundleDigest!: string;

  @Column({ type: 'text' })
  state!: string;

  @Column({ name: 'reason_code', type: 'text' })
  reasonCode!: string;

  @Column({ name: 'desired_enabled', type: 'boolean', default: false })
  desiredEnabled!: boolean;

  @Column({ name: 'installer_enabled', type: 'boolean', default: false })
  installerEnabled!: boolean;

  @Column({ name: 'enablement_scope', type: 'text', default: 'deployment' })
  enablementScope!: string;

  @Column({ name: 'grant_set_hash', type: 'text' })
  grantSetHash!: string;

  @Column({ name: 'compatible', type: 'boolean', default: false })
  compatible!: boolean;

  @Column({ name: 'healthy', type: 'boolean', default: false })
  healthy!: boolean;

  @Column({ name: 'entitlement_state', type: 'text', default: 'not_required' })
  entitlementState!: string;

  @Column({ type: 'bigint', default: 0 })
  revision!: number;

  @Column({ name: 'installer_revision', type: 'bigint', default: 0 })
  installerRevision!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}

@Index('idx_plugin_grant_identity', ['pluginId', 'permission'], {
  unique: true,
})
@Index('idx_plugin_grant_plugin', ['pluginId'])
@Entity({ name: 'plugin_permission_grants', schema: 'main' })
export class PluginPermissionGrant extends AppBaseEntity {
  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ type: 'text' })
  permission!: string;

  @Column({ type: 'boolean', default: false })
  granted!: boolean;

  @Column({ name: 'granted_by_ref', type: 'text', nullable: true })
  grantedByRef!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}

@Index('idx_plugin_tenant_identity', ['pluginId', 'tenantRef'], {
  unique: true,
})
@Index('idx_plugin_tenant_plugin', ['pluginId'])
@Entity({ name: 'plugin_tenant_enablements', schema: 'main' })
export class PluginTenantEnablement extends AppBaseEntity {
  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ name: 'tenant_ref', type: 'text' })
  tenantRef!: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ name: 'reason_code', type: 'text', default: 'none' })
  reasonCode!: string;

  @Column({ type: 'bigint', default: 0 })
  revision!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}

@Index('idx_plugin_op_idempotency', ['idempotencyKeyHash'], {
  unique: true,
})
@Index('idx_plugin_op_plugin', ['pluginId'])
@Index('idx_plugin_op_status', ['status'])
@Index('idx_plugin_op_lease', ['leaseExpiresAt'])
@Entity({ name: 'plugin_lifecycle_operations', schema: 'main' })
export class PluginLifecycleOperation extends AppBaseEntity {
  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ type: 'text' })
  type!: string;

  @Column({ type: 'text' })
  status!: string;

  @Column({ name: 'idempotency_key_hash', type: 'text' })
  idempotencyKeyHash!: string;

  @Column({ name: 'request_hash', type: 'text' })
  requestHash!: string;

  @Column({ name: 'target_version', type: 'text', nullable: true })
  targetVersion!: string | null;

  @Column({ name: 'reason_code', type: 'text', default: 'none' })
  reasonCode!: string;

  @Column({ type: 'bigint', default: 0 })
  revision!: number;

  @Column({ name: 'lease_owner', type: 'text', nullable: true })
  leaseOwner!: string | null;

  @Column({ name: 'lease_expires_at', type: 'bigint', nullable: true })
  leaseExpiresAt!: number | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}

@Index('idx_plugin_audit_plugin', ['pluginId'])
@Index('idx_plugin_audit_time', ['occurredAt'])
@Index('idx_plugin_audit_corr', ['correlationId'])
@Entity({ name: 'plugin_platform_audit', schema: 'main' })
export class PluginPlatformAudit extends AppBaseEntity {
  @Column({ name: 'event_type', type: 'text' })
  eventType!: string;

  @Column({ name: 'plugin_id', type: 'text', nullable: true })
  pluginId!: string | null;

  @Column({ name: 'tenant_ref', type: 'text', nullable: true })
  tenantRef!: string | null;

  @Column({ name: 'actor_ref', type: 'text' })
  actorRef!: string;

  @Column({ name: 'correlation_id', type: 'text' })
  correlationId!: string;

  @Column({ name: 'from_state', type: 'text', nullable: true })
  fromState!: string | null;

  @Column({ name: 'to_state', type: 'text', nullable: true })
  toState!: string | null;

  @Column({ name: 'reason_code', type: 'text' })
  reasonCode!: string;

  @Column({ name: 'occurred_at', type: 'bigint' })
  occurredAt!: number;
}

@Index('idx_plugin_broker_replay_key', ['keyHash'], { unique: true })
@Index('idx_plugin_broker_replay_expiry', ['expiresAt'])
@Index('idx_plugin_broker_replay_plugin', ['pluginId'])
@Entity({ name: 'plugin_broker_replays', schema: 'main' })
export class PluginBrokerReplay extends AppBaseEntity {
  @Column({ name: 'key_hash', type: 'text' })
  keyHash!: string;

  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ name: 'invocation_hash', type: 'text' })
  invocationHash!: string;

  @Column({ name: 'call_id_hash', type: 'text' })
  callIdHash!: string;

  @Column({ name: 'expires_at', type: 'bigint' })
  expiresAt!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}

@Index(
  'idx_plugin_storage_identity',
  ['pluginId', 'deploymentRef', 'scope', 'tenantRefKey', 'storageKey'],
  { unique: true },
)
@Index('idx_plugin_storage_namespace', [
  'pluginId',
  'deploymentRef',
  'scope',
  'tenantRefKey',
])
@Entity({ name: 'plugin_storage_entries', schema: 'main' })
export class PluginStorageEntry extends AppBaseEntity {
  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ name: 'deployment_ref', type: 'text' })
  deploymentRef!: string;

  @Column({ type: 'text' })
  scope!: string;

  @Column({ name: 'tenant_ref_key', type: 'text' })
  tenantRefKey!: string;

  @Column({ name: 'storage_key', type: 'text' })
  storageKey!: string;

  @Column({ name: 'value_json', type: 'text' })
  valueJson!: string;

  @Column({ name: 'value_bytes', type: 'bigint' })
  valueBytes!: number;

  @Column({ type: 'bigint', default: 1 })
  revision!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}

@Index('idx_plugin_gateway_admission_plugin', ['pluginId'], { unique: true })
@Entity({ name: 'plugin_gateway_admission_state', schema: 'main' })
export class PluginGatewayAdmissionState extends AppBaseEntity {
  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ name: 'window_started_at', type: 'bigint' })
  windowStartedAt!: number;

  @Column({ name: 'request_count', type: 'integer', default: 0 })
  requestCount!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}

@Index('idx_plugin_gateway_subject_bucket_hash', ['bucketHash'], {
  unique: true,
})
@Index('idx_plugin_gateway_subject_bucket_plugin', ['pluginId', 'updatedAt'])
@Entity({ name: 'plugin_gateway_subject_buckets', schema: 'main' })
export class PluginGatewaySubjectBucket extends AppBaseEntity {
  @Column({ name: 'bucket_hash', type: 'text' })
  bucketHash!: string;

  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ name: 'operation_id', type: 'text' })
  operationId!: string;

  @Column({ name: 'window_started_at', type: 'bigint' })
  windowStartedAt!: number;

  @Column({ name: 'request_count', type: 'integer', default: 0 })
  requestCount!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}

@Index('idx_plugin_gateway_concurrency_lease', ['leaseId'], {
  unique: true,
})
@Index('idx_plugin_gateway_concurrency_scope', ['pluginId', 'operationId'])
@Index('idx_plugin_gateway_concurrency_expiry', ['expiresAt'])
@Entity({ name: 'plugin_gateway_concurrency_leases', schema: 'main' })
export class PluginGatewayConcurrencyLease extends AppBaseEntity {
  @Column({ name: 'lease_id', type: 'text' })
  leaseId!: string;

  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ name: 'operation_id', type: 'text' })
  operationId!: string;

  @Column({ name: 'expires_at', type: 'bigint' })
  expiresAt!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}

@Index('idx_plugin_event_delivery_identity', ['deliveryId'], { unique: true })
@Index('idx_plugin_event_delivery_due', ['status', 'nextAttemptAt'])
@Index('idx_plugin_event_delivery_plugin', ['pluginId', 'tenantRef'])
@Index('idx_plugin_event_delivery_lease', ['leaseExpiresAt'])
@Entity({ name: 'plugin_event_deliveries', schema: 'main' })
export class PluginEventDelivery extends AppBaseEntity {
  @Column({ name: 'delivery_id', type: 'text' })
  deliveryId!: string;

  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ name: 'deployment_ref', type: 'text' })
  deploymentRef!: string;

  @Column({ name: 'tenant_ref', type: 'text' })
  tenantRef!: string;

  @Column({ name: 'subscription_type', type: 'text' })
  subscriptionType!: string;

  @Column({ name: 'operation_id', type: 'text' })
  operationId!: string;

  @Column({ name: 'event_id', type: 'text' })
  eventId!: string;

  @Column({ name: 'event_sha256', type: 'text' })
  eventSha256!: string;

  @Column({ name: 'event_json', type: 'text' })
  eventJson!: string;

  @Column({ type: 'text' })
  status!: string;

  @Column({ type: 'integer', default: 0 })
  attempt!: number;

  @Column({ name: 'max_attempts', type: 'integer' })
  maxAttempts!: number;

  @Column({ name: 'next_attempt_at', type: 'bigint' })
  nextAttemptAt!: number;

  @Column({ name: 'lease_owner', type: 'text', nullable: true })
  leaseOwner!: string | null;

  @Column({ name: 'lease_expires_at', type: 'bigint', nullable: true })
  leaseExpiresAt!: number | null;

  @Column({ name: 'reason_code', type: 'text' })
  reasonCode!: string;

  @Column({ name: 'delivered_at', type: 'bigint', nullable: true })
  deliveredAt!: number | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}

@Index(
  'idx_plugin_event_subscription_identity',
  ['pluginId', 'deploymentRef', 'tenantRef', 'subscriptionType'],
  { unique: true },
)
@Index('idx_plugin_event_subscription_plugin', ['pluginId', 'tenantRef'])
@Entity({ name: 'plugin_event_subscription_state', schema: 'main' })
export class PluginEventSubscriptionState extends AppBaseEntity {
  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ name: 'deployment_ref', type: 'text' })
  deploymentRef!: string;

  @Column({ name: 'tenant_ref', type: 'text' })
  tenantRef!: string;

  @Column({ name: 'subscription_type', type: 'text' })
  subscriptionType!: string;

  @Column({ type: 'boolean', default: false })
  paused!: boolean;

  @Column({ type: 'bigint', default: 0 })
  revision!: number;

  @Column({ name: 'reason_code', type: 'text' })
  reasonCode!: string;

  @Column({ name: 'circuit_state', type: 'text', default: 'closed' })
  circuitState!: string;

  @Column({ name: 'consecutive_failures', type: 'integer', default: 0 })
  consecutiveFailures!: number;

  @Column({ name: 'circuit_open_until', type: 'bigint', nullable: true })
  circuitOpenUntil!: number | null;

  @Column({ name: 'probe_delivery_id', type: 'text', nullable: true })
  probeDeliveryId!: string | null;

  @Column({ name: 'circuit_reason_code', type: 'text', default: 'none' })
  circuitReasonCode!: string;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}

@Index('idx_plugin_event_queue_state_plugin', ['pluginId'], { unique: true })
@Entity({ name: 'plugin_event_queue_state', schema: 'main' })
export class PluginEventQueueState extends AppBaseEntity {
  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}

@Index('idx_plugin_notification_idempotency', ['idempotencyKeyHash'], {
  unique: true,
})
@Index('idx_plugin_notification_subject', [
  'pluginId',
  'tenantRef',
  'subjectRef',
])
@Entity({ name: 'plugin_notification_publications', schema: 'main' })
export class PluginNotificationPublication extends AppBaseEntity {
  @Column({ name: 'idempotency_key_hash', type: 'text' })
  idempotencyKeyHash!: string;

  @Column({ name: 'request_hash', type: 'text' })
  requestHash!: string;

  @Column({ name: 'notification_ref', type: 'text' })
  notificationRef!: string;

  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ name: 'deployment_ref', type: 'text' })
  deploymentRef!: string;

  @Column({ name: 'tenant_ref', type: 'text' })
  tenantRef!: string;

  @Column({ name: 'subject_ref', type: 'text' })
  subjectRef!: string;

  @Column({ name: 'template_id', type: 'text' })
  templateId!: string;

  @Column({ name: 'reason_code', type: 'text' })
  reasonCode!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}

@Index('idx_plugin_scheduled_job_identity', ['jobRef'], { unique: true })
@Index('idx_plugin_scheduled_job_due', ['status', 'nextRunAt'])
@Index('idx_plugin_scheduled_job_scope', [
  'pluginId',
  'deploymentRef',
  'tenantRef',
])
@Index('idx_plugin_scheduled_job_lease', ['leaseExpiresAt'])
@Entity({ name: 'plugin_scheduled_jobs', schema: 'main' })
export class PluginScheduledJob extends AppBaseEntity {
  @Column({ name: 'job_ref', type: 'text' })
  jobRef!: string;

  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ name: 'deployment_ref', type: 'text' })
  deploymentRef!: string;

  @Column({ name: 'tenant_ref', type: 'text' })
  tenantRef!: string;

  @Column({ name: 'job_type', type: 'text' })
  jobType!: string;

  @Column({ name: 'operation_id', type: 'text' })
  operationId!: string;

  @Column({ name: 'interval_seconds', type: 'integer' })
  intervalSeconds!: number;

  @Column({ name: 'max_attempts', type: 'integer' })
  maxAttempts!: number;

  @Column({ type: 'text' })
  status!: string;

  @Column({ type: 'bigint', default: 1 })
  revision!: number;

  @Column({ type: 'integer', default: 0 })
  attempt!: number;

  @Column({ name: 'next_run_at', type: 'bigint' })
  nextRunAt!: number;

  @Column({ name: 'lease_owner', type: 'text', nullable: true })
  leaseOwner!: string | null;

  @Column({ name: 'lease_expires_at', type: 'bigint', nullable: true })
  leaseExpiresAt!: number | null;

  @Column({ name: 'reason_code', type: 'text' })
  reasonCode!: string;

  @Column({ name: 'scheduled_by_ref', type: 'text' })
  scheduledByRef!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}

@Index('idx_plugin_schedule_command_idempotency', ['idempotencyKeyHash'], {
  unique: true,
})
@Index('idx_plugin_schedule_command_scope', [
  'pluginId',
  'deploymentRef',
  'tenantRef',
])
@Entity({ name: 'plugin_schedule_commands', schema: 'main' })
export class PluginScheduleCommand extends AppBaseEntity {
  @Column({ name: 'idempotency_key_hash', type: 'text' })
  idempotencyKeyHash!: string;

  @Column({ name: 'request_hash', type: 'text' })
  requestHash!: string;

  @Column({ name: 'response_json', type: 'text' })
  responseJson!: string;

  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ name: 'deployment_ref', type: 'text' })
  deploymentRef!: string;

  @Column({ name: 'tenant_ref', type: 'text' })
  tenantRef!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}

@Index(
  'idx_plugin_contribution_availability_identity',
  ['deploymentRef', 'tenantRef', 'pluginId'],
  { unique: true },
)
@Index(
  'idx_plugin_contribution_availability_due',
  ['nextRefreshAt', 'leaseExpiresAt'],
)
@Entity({ name: 'plugin_contribution_availability', schema: 'main' })
export class PluginContributionAvailabilityState extends AppBaseEntity {
  @Column({ name: 'deployment_ref', type: 'text' })
  deploymentRef!: string;

  @Column({ name: 'tenant_ref', type: 'text' })
  tenantRef!: string;

  @Column({ name: 'plugin_id', type: 'text' })
  pluginId!: string;

  @Column({ name: 'plugin_version', type: 'text' })
  pluginVersion!: string;

  @Column({ name: 'installer_revision', type: 'bigint' })
  installerRevision!: number;

  @Column({ name: 'refresh_interval_seconds', type: 'integer' })
  refreshIntervalSeconds!: number;

  @Column({ name: 'maximum_staleness_seconds', type: 'integer' })
  maximumStalenessSeconds!: number;

  @Column({ name: 'projection_json', type: 'text', nullable: true })
  projectionJson!: string | null;

  @Column({ name: 'evaluated_at', type: 'bigint', nullable: true })
  evaluatedAt!: number | null;

  @Column({ name: 'valid_until', type: 'bigint', nullable: true })
  validUntil!: number | null;

  @Column({ name: 'next_refresh_at', type: 'bigint' })
  nextRefreshAt!: number;

  @Column({ name: 'lease_owner', type: 'text', nullable: true })
  leaseOwner!: string | null;

  @Column({ name: 'lease_expires_at', type: 'bigint', nullable: true })
  leaseExpiresAt!: number | null;

  @Column({ name: 'reason_code', type: 'text' })
  reasonCode!: string;

  @Column({ name: 'consecutive_failures', type: 'integer', default: 0 })
  consecutiveFailures!: number;

  @Column({ type: 'bigint', default: 0 })
  revision!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}

export const pluginPlatformEntities = [
  PluginPlatformState,
  PluginEmergencyControlOperation,
  PluginInstallation,
  PluginPermissionGrant,
  PluginTenantEnablement,
  PluginLifecycleOperation,
  PluginPlatformAudit,
  PluginBrokerReplay,
  PluginStorageEntry,
  PluginGatewayAdmissionState,
  PluginGatewaySubjectBucket,
  PluginGatewayConcurrencyLease,
  PluginEventDelivery,
  PluginEventSubscriptionState,
  PluginEventQueueState,
  PluginNotificationPublication,
  PluginScheduledJob,
  PluginScheduleCommand,
  PluginContributionAvailabilityState,
] as const;
