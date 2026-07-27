import type {
  EnterpriseGluePluginManifestV1,
  PluginId,
  PluginLifecycleStateV1,
  PluginSafeReasonCodeV1,
  SemVer,
} from '@enterpriseglue/plugin-sdk';

export type PluginLifecycleEventTypeV1 =
  | 'plugin_discovered'
  | 'state_changed'
  | 'tenant_enabled'
  | 'tenant_disabled'
  | 'emergency_disable_changed';

export interface PluginLifecycleAuditEventV1 {
  sequence: number;
  type: PluginLifecycleEventTypeV1;
  pluginId?: PluginId;
  actorRef: string;
  correlationId: string;
  occurredAt: string;
  fromState?: PluginLifecycleStateV1;
  toState?: PluginLifecycleStateV1;
  reasonCode: PluginSafeReasonCodeV1;
  tenantRef?: string;
  emergencyDisabled?: boolean;
}

export interface PluginLifecycleRecordV1 {
  pluginId: PluginId;
  version: SemVer;
  displayName: string;
  manifest: EnterpriseGluePluginManifestV1;
  state: PluginLifecycleStateV1;
  reasonCode: PluginSafeReasonCodeV1;
  revision: number;
  enabledTenantRefs: string[];
}

export interface PluginLifecycleMutationContextV1 {
  actorRef: string;
  correlationId: string;
  occurredAt?: string;
}

export type PluginLifecycleRegistryErrorCode =
  | 'plugin_already_exists'
  | 'plugin_not_found'
  | 'invalid_transition'
  | 'revision_conflict'
  | 'tenant_enablement_not_supported'
  | 'tenant_enablement_state_invalid';

export class PluginLifecycleRegistryError extends Error {
  constructor(
    public readonly code: PluginLifecycleRegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PluginLifecycleRegistryError';
  }
}

const allowedTransitions: Readonly<
  Record<PluginLifecycleStateV1, ReadonlySet<PluginLifecycleStateV1>>
> = {
  discovered: new Set(['rejected', 'staged']),
  rejected: new Set(['discovered', 'removed']),
  staged: new Set(['migrating', 'installed_disabled', 'rejected', 'failed']),
  migrating: new Set(['installed_disabled', 'failed']),
  installed_disabled: new Set([
    'enabling',
    'upgrading',
    'uninstalling',
    'rejected',
  ]),
  enabling: new Set(['enabled', 'degraded', 'installed_disabled', 'failed']),
  enabled: new Set(['degraded', 'disabling', 'upgrading']),
  degraded: new Set(['enabled', 'disabling', 'upgrading', 'failed']),
  disabling: new Set(['installed_disabled', 'failed']),
  upgrading: new Set(['enabled', 'installed_disabled', 'rolling_back', 'failed']),
  rolling_back: new Set(['enabled', 'installed_disabled', 'failed']),
  uninstalling: new Set(['removed', 'failed']),
  removed: new Set(['discovered']),
  failed: new Set(['rolling_back', 'uninstalling', 'staged']),
};

function copyRecord(
  record: PluginLifecycleRecordV1,
): PluginLifecycleRecordV1 {
  return {
    ...record,
    enabledTenantRefs: [...record.enabledTenantRefs].sort(),
  };
}

function now(context: PluginLifecycleMutationContextV1): string {
  return context.occurredAt ?? new Date().toISOString();
}

/**
 * Owner-aware lifecycle domain model with optimistic revisions and a
 * platform-wide execution kill switch.
 *
 * Persistence adapters replay/store the returned records and audit events;
 * this class deliberately contains no database or deployment authority.
 */
export class PluginLifecycleRegistry {
  private readonly records = new Map<PluginId, PluginLifecycleRecordV1>();
  private readonly audit: PluginLifecycleAuditEventV1[] = [];
  private sequence = 0;
  private emergencyDisabled = false;

  discover(
    manifest: EnterpriseGluePluginManifestV1,
    context: PluginLifecycleMutationContextV1,
  ): PluginLifecycleRecordV1 {
    const pluginId = manifest.metadata.id;
    if (this.records.has(pluginId)) {
      throw new PluginLifecycleRegistryError(
        'plugin_already_exists',
        `Plugin ${pluginId} already exists`,
      );
    }

    const record: PluginLifecycleRecordV1 = {
      pluginId,
      version: manifest.metadata.version,
      displayName: manifest.metadata.displayName,
      manifest,
      state: 'discovered',
      reasonCode: 'none',
      revision: 0,
      enabledTenantRefs: [],
    };
    this.records.set(pluginId, record);
    this.appendAudit({
      type: 'plugin_discovered',
      pluginId,
      context,
      reasonCode: 'none',
    });
    return copyRecord(record);
  }

  transition(input: {
    pluginId: PluginId;
    toState: PluginLifecycleStateV1;
    expectedRevision: number;
    reasonCode?: PluginSafeReasonCodeV1;
    replacementManifest?: EnterpriseGluePluginManifestV1;
    context: PluginLifecycleMutationContextV1;
  }): PluginLifecycleRecordV1 {
    const record = this.requireRecord(input.pluginId);
    if (record.revision !== input.expectedRevision) {
      throw new PluginLifecycleRegistryError(
        'revision_conflict',
        `Expected revision ${input.expectedRevision}, found ${record.revision}`,
      );
    }
    if (!allowedTransitions[record.state].has(input.toState)) {
      throw new PluginLifecycleRegistryError(
        'invalid_transition',
        `Cannot transition ${input.pluginId} from ${record.state} to ${input.toState}`,
      );
    }

    if (
      input.replacementManifest &&
      input.replacementManifest.metadata.id !== input.pluginId
    ) {
      throw new PluginLifecycleRegistryError(
        'invalid_transition',
        'A replacement manifest must retain the plugin identity',
      );
    }

    const fromState = record.state;
    record.state = input.toState;
    record.reasonCode = input.reasonCode ?? 'none';
    record.revision += 1;
    if (input.replacementManifest) {
      record.manifest = input.replacementManifest;
      record.version = input.replacementManifest.metadata.version;
      record.displayName = input.replacementManifest.metadata.displayName;
    }
    if (
      input.toState === 'installed_disabled' ||
      input.toState === 'removed' ||
      input.toState === 'rejected'
    ) {
      record.enabledTenantRefs = [];
    }

    this.appendAudit({
      type: 'state_changed',
      pluginId: input.pluginId,
      context: input.context,
      fromState,
      toState: input.toState,
      reasonCode: record.reasonCode,
    });
    return copyRecord(record);
  }

  setTenantEnabled(input: {
    pluginId: PluginId;
    tenantRef: string;
    enabled: boolean;
    expectedRevision: number;
    context: PluginLifecycleMutationContextV1;
  }): PluginLifecycleRecordV1 {
    const record = this.requireRecord(input.pluginId);
    if (record.revision !== input.expectedRevision) {
      throw new PluginLifecycleRegistryError(
        'revision_conflict',
        `Expected revision ${input.expectedRevision}, found ${record.revision}`,
      );
    }
    if (record.manifest.scope.enablement !== 'tenant') {
      throw new PluginLifecycleRegistryError(
        'tenant_enablement_not_supported',
        `Plugin ${input.pluginId} does not support tenant enablement`,
      );
    }
    if (record.state !== 'enabled' && record.state !== 'degraded') {
      throw new PluginLifecycleRegistryError(
        'tenant_enablement_state_invalid',
        `Plugin ${input.pluginId} must be enabled before changing tenant enablement`,
      );
    }

    const tenantRefs = new Set(record.enabledTenantRefs);
    if (input.enabled) tenantRefs.add(input.tenantRef);
    else tenantRefs.delete(input.tenantRef);
    record.enabledTenantRefs = [...tenantRefs].sort();
    record.revision += 1;
    this.appendAudit({
      type: input.enabled ? 'tenant_enabled' : 'tenant_disabled',
      pluginId: input.pluginId,
      tenantRef: input.tenantRef,
      context: input.context,
      reasonCode: 'none',
    });
    return copyRecord(record);
  }

  setEmergencyDisabled(
    disabled: boolean,
    context: PluginLifecycleMutationContextV1,
  ): void {
    if (this.emergencyDisabled === disabled) return;
    this.emergencyDisabled = disabled;
    this.appendAudit({
      type: 'emergency_disable_changed',
      context,
      reasonCode: disabled ? 'emergency_disabled' : 'none',
      emergencyDisabled: disabled,
    });
  }

  isExecutionAllowed(pluginId: PluginId, tenantRef?: string): boolean {
    const record = this.records.get(pluginId);
    if (
      !record ||
      this.emergencyDisabled ||
      (record.state !== 'enabled' && record.state !== 'degraded')
    ) {
      return false;
    }

    if (record.manifest.scope.enablement === 'deployment') {
      return true;
    }
    return Boolean(
      tenantRef && record.enabledTenantRefs.includes(tenantRef),
    );
  }

  isEmergencyDisabled(): boolean {
    return this.emergencyDisabled;
  }

  get(pluginId: PluginId): PluginLifecycleRecordV1 | undefined {
    const record = this.records.get(pluginId);
    return record ? copyRecord(record) : undefined;
  }

  list(): PluginLifecycleRecordV1[] {
    return [...this.records.values()]
      .sort((left, right) => left.pluginId.localeCompare(right.pluginId))
      .map(copyRecord);
  }

  auditEvents(afterSequence = 0): PluginLifecycleAuditEventV1[] {
    return this.audit
      .filter((event) => event.sequence > afterSequence)
      .map((event) => ({ ...event }));
  }

  private requireRecord(pluginId: PluginId): PluginLifecycleRecordV1 {
    const record = this.records.get(pluginId);
    if (!record) {
      throw new PluginLifecycleRegistryError(
        'plugin_not_found',
        `Plugin ${pluginId} does not exist`,
      );
    }
    return record;
  }

  private appendAudit(input: {
    type: PluginLifecycleEventTypeV1;
    context: PluginLifecycleMutationContextV1;
    reasonCode: PluginSafeReasonCodeV1;
    pluginId?: PluginId;
    fromState?: PluginLifecycleStateV1;
    toState?: PluginLifecycleStateV1;
    tenantRef?: string;
    emergencyDisabled?: boolean;
  }): void {
    this.sequence += 1;
    this.audit.push({
      sequence: this.sequence,
      type: input.type,
      pluginId: input.pluginId,
      actorRef: input.context.actorRef,
      correlationId: input.context.correlationId,
      occurredAt: now(input.context),
      fromState: input.fromState,
      toState: input.toState,
      reasonCode: input.reasonCode,
      tenantRef: input.tenantRef,
      emergencyDisabled: input.emergencyDisabled,
    });
  }
}
