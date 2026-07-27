import { createHash, randomUUID } from 'node:crypto';

import {
  pluginDeploymentExecutionObservationV1Schema,
  pluginLifecycleOperationV1Schema,
  pluginPlatformAuditEventV1Schema,
  pluginPlatformAuditListV1Schema,
  pluginPlatformEmergencyStateV1Schema,
  pluginSafeListV1Schema,
  pluginSafeSummaryV1Schema,
  pluginTenantEnablementV1Schema,
  type PluginId,
  type PluginDeploymentExecutionObservationV1,
  type PluginLifecycleOperationV1,
  type PluginLifecycleOperationTypeV1,
  type PluginPlatformAuditEventV1,
  type PluginPlatformAuditListV1,
  type PluginPlatformEmergencyStateV1,
  type PluginSafeReasonCodeV1,
  type PluginSafeSummaryV1,
  type PluginTenantEnablementV1,
} from '@enterpriseglue/plugin-sdk';

import type {
  PluginControlSourceRecordV1,
  PluginControlSourceSnapshotV1,
} from './pluginRuntime.js';

export type PluginControlErrorCodeV1 =
  | 'plugin_not_found'
  | 'operation_not_found'
  | 'revision_conflict'
  | 'idempotency_conflict'
  | 'invalid_state'
  | 'tenant_enablement_not_supported';

export class PluginControlErrorV1 extends Error {
  constructor(
    public readonly status: 404 | 409,
    public readonly code: PluginControlErrorCodeV1,
  ) {
    super(code);
    this.name = 'PluginControlErrorV1';
  }
}

export interface PluginControlMutationV1 {
  pluginId: PluginId;
  enabled: boolean;
  expectedRevision: number;
  idempotencyKeyHash: string;
  requestHash: string;
  actorRef: string;
  correlationId: string;
  reasonCode: PluginSafeReasonCodeV1;
  occurredAt: string;
}

export interface PluginTenantControlMutationV1
  extends PluginControlMutationV1 {
  tenantRef: string;
}

export interface PluginEmergencyControlMutationV1 {
  disabled: boolean;
  expectedRevision: number;
  idempotencyKeyHash: string;
  requestHash: string;
  actorRef: string;
  correlationId: string;
  occurredAt: string;
}

export interface PluginControlStoreV1 {
  reconcile(
    snapshot: PluginControlSourceSnapshotV1,
    defaultTenantRef: string,
    occurredAt: string,
  ): Promise<void>;
  list(): Promise<PluginSafeSummaryV1[]>;
  get(pluginId: PluginId): Promise<PluginSafeSummaryV1 | undefined>;
  setDeploymentEnabled(
    input: PluginControlMutationV1,
  ): Promise<PluginLifecycleOperationV1>;
  setTenantEnabled(
    input: PluginTenantControlMutationV1,
  ): Promise<PluginLifecycleOperationV1>;
  isTenantEnabled(pluginId: PluginId, tenantRef: string): Promise<boolean>;
  listEnabledTenantRefs(pluginId: PluginId): Promise<string[]>;
  getTenantEnablement(
    pluginId: PluginId,
    tenantRef: string,
  ): Promise<PluginTenantEnablementV1 | undefined>;
  getOperation(
    operationId: string,
  ): Promise<PluginLifecycleOperationV1 | undefined>;
  getEmergencyState(): Promise<PluginPlatformEmergencyStateV1>;
  setEmergencyDisabled(
    input: PluginEmergencyControlMutationV1,
  ): Promise<PluginPlatformEmergencyStateV1>;
  listAudit(): Promise<PluginPlatformAuditEventV1[]>;
}

interface MemoryInstallation {
  summary: PluginSafeSummaryV1;
  installerRevision: number;
  installerEnabled: boolean;
  enablementScope: 'deployment' | 'tenant';
  sourceFingerprint: string;
}

interface MemoryTenantEnablement {
  enabled: boolean;
  revision: number;
}

interface MemoryOperation {
  operation: PluginLifecycleOperationV1;
  requestHash: string;
}

interface MemoryEmergencyOperation {
  requestHash: string;
  state: PluginPlatformEmergencyStateV1;
}

/**
 * Deterministic in-memory adapter used by contract tests and local embeddings.
 * Production uses the database adapter with the same interface.
 */
export class MemoryPluginControlStoreV1 implements PluginControlStoreV1 {
  private readonly installations = new Map<PluginId, MemoryInstallation>();
  private readonly tenantEnablements = new Map<
    string,
    MemoryTenantEnablement
  >();
  private readonly operations = new Map<string, MemoryOperation>();
  private readonly operationById = new Map<string, PluginLifecycleOperationV1>();
  private readonly emergencyOperations = new Map<
    string,
    MemoryEmergencyOperation
  >();
  private readonly audits: PluginPlatformAuditEventV1[] = [];
  private emergencyState: PluginPlatformEmergencyStateV1 | undefined;
  private installerState:
    | { revision: number; snapshotHash: string }
    | undefined;

  async reconcile(
    snapshot: PluginControlSourceSnapshotV1,
    defaultTenantRef: string,
    occurredAt: string,
  ): Promise<void> {
    this.emergencyState ??= pluginPlatformEmergencyStateV1Schema.parse({
      apiVersion: 'emergency-control.plugin.enterpriseglue.io/v1',
      disabled: false,
      revision: 0,
      reasonCode: 'none',
      updatedAt: occurredAt,
    });
    const snapshotHash = installerSnapshotHash(snapshot);
    if (
      this.installerState &&
      this.installerState.revision > snapshot.revision
    ) {
      throw new Error('plugin_installer_revision_rollback');
    }
    if (
      this.installerState &&
      this.installerState.revision === snapshot.revision &&
      this.installerState.snapshotHash !== snapshotHash
    ) {
      throw new Error('plugin_installer_revision_reused');
    }
    const sourceIds = new Set(snapshot.records.map((record) => record.pluginId));
    for (const source of snapshot.records) {
      const existing = this.installations.get(source.pluginId);
      if (existing && existing.installerRevision > snapshot.revision) {
        throw new Error('plugin_installer_revision_rollback');
      }
      const fingerprint = sourceFingerprint(source);
      if (existing && existing.sourceFingerprint === fingerprint) {
        existing.installerRevision = snapshot.revision;
        existing.summary.compatible = source.compatible;
        existing.summary.healthy = existing.summary.enabled
          ? source.healthy
          : false;
        existing.summary.entitled = source.entitled;
        if (existing.summary.enabled) {
          existing.summary.reasonCode = source.reasonCode;
        }
        continue;
      }
      const summary = pluginSafeSummaryV1Schema.parse({
        pluginId: source.pluginId,
        version: source.version,
        displayName: source.displayName,
        state: source.installerEnabled ? 'enabled' : 'installed_disabled',
        enabled: source.installerEnabled && source.compatible,
        healthy: source.healthy,
        compatible: source.compatible,
        entitled: source.entitled,
        reasonCode: source.reasonCode,
        revision: existing ? existing.summary.revision + 1 : 0,
      });
      this.installations.set(source.pluginId, {
        summary,
        installerRevision: snapshot.revision,
        installerEnabled: source.installerEnabled,
        enablementScope: source.enablementScope,
        sourceFingerprint: fingerprint,
      });
      if (source.enablementScope === 'tenant') {
        const key = tenantKey(source.pluginId, defaultTenantRef);
        const tenant = this.tenantEnablements.get(key);
        this.tenantEnablements.set(key, {
          enabled: summary.enabled,
          revision: tenant ? tenant.revision + 1 : 0,
        });
      }
    }
    for (const [pluginId, existing] of this.installations) {
      if (
        sourceIds.has(pluginId) ||
        existing.installerRevision >= snapshot.revision
      ) {
        continue;
      }
      existing.summary = pluginSafeSummaryV1Schema.parse({
        ...existing.summary,
        state: 'removed',
        enabled: false,
        healthy: false,
        reasonCode: 'administrator_disabled',
        revision: existing.summary.revision + 1,
      });
      existing.installerRevision = snapshot.revision;
    }
    this.installerState = {
      revision: snapshot.revision,
      snapshotHash,
    };
    void occurredAt;
  }

  async list(): Promise<PluginSafeSummaryV1[]> {
    return [...this.installations.values()]
      .map((record) => structuredClone(record.summary))
      .sort((left, right) => left.pluginId.localeCompare(right.pluginId));
  }

  async get(pluginId: PluginId): Promise<PluginSafeSummaryV1 | undefined> {
    const record = this.installations.get(pluginId);
    return record ? structuredClone(record.summary) : undefined;
  }

  async setDeploymentEnabled(
    input: PluginControlMutationV1,
  ): Promise<PluginLifecycleOperationV1> {
    const type: PluginLifecycleOperationTypeV1 = input.enabled
      ? 'enable'
      : 'disable';
    const repeated = this.repeatedOperation(input, type);
    if (repeated) return repeated;
    const record = this.installations.get(input.pluginId);
    if (!record) throw new PluginControlErrorV1(404, 'plugin_not_found');
    if (record.summary.revision !== input.expectedRevision) {
      throw new PluginControlErrorV1(409, 'revision_conflict');
    }
    if (input.enabled && !record.installerEnabled) {
      throw new PluginControlErrorV1(409, 'invalid_state');
    }
    if (
      record.summary.state === 'removed' ||
      (!input.enabled &&
        !['enabled', 'degraded', 'installed_disabled'].includes(
          record.summary.state,
        )) ||
      (input.enabled &&
        !['enabled', 'degraded', 'installed_disabled'].includes(
          record.summary.state,
        ))
    ) {
      throw new PluginControlErrorV1(409, 'invalid_state');
    }
    const fromState = record.summary.state;
    record.summary = pluginSafeSummaryV1Schema.parse({
      ...record.summary,
      state: input.enabled ? 'enabled' : 'installed_disabled',
      enabled: input.enabled && record.summary.compatible,
      healthy: input.enabled ? record.summary.healthy : false,
      reasonCode: input.enabled ? 'none' : input.reasonCode,
      revision: record.summary.revision + 1,
    });
    const operation = this.saveOperation(input, type);
    this.appendAudit({
      eventType: input.enabled
        ? 'deployment_enabled'
        : 'deployment_disabled',
      pluginId: input.pluginId,
      tenantScoped: false,
      actorRef: input.actorRef,
      correlationId: input.correlationId,
      fromState,
      toState: record.summary.state,
      reasonCode: input.enabled ? 'none' : input.reasonCode,
      occurredAt: input.occurredAt,
    });
    return operation;
  }

  async setTenantEnabled(
    input: PluginTenantControlMutationV1,
  ): Promise<PluginLifecycleOperationV1> {
    const type: PluginLifecycleOperationTypeV1 = input.enabled
      ? 'enable'
      : 'disable';
    const repeated = this.repeatedOperation(input, type);
    if (repeated) return repeated;
    const installation = this.installations.get(input.pluginId);
    if (!installation) {
      throw new PluginControlErrorV1(404, 'plugin_not_found');
    }
    if (installation.enablementScope !== 'tenant') {
      throw new PluginControlErrorV1(
        409,
        'tenant_enablement_not_supported',
      );
    }
    if (!installation.summary.enabled) {
      throw new PluginControlErrorV1(409, 'invalid_state');
    }
    const key = tenantKey(input.pluginId, input.tenantRef);
    const existing = this.tenantEnablements.get(key) ?? {
      enabled: false,
      revision: 0,
    };
    if (existing.revision !== input.expectedRevision) {
      throw new PluginControlErrorV1(409, 'revision_conflict');
    }
    this.tenantEnablements.set(key, {
      enabled: input.enabled,
      revision: existing.revision + 1,
    });
    const operation = this.saveOperation(input, type);
    this.appendAudit({
      eventType: input.enabled ? 'tenant_enabled' : 'tenant_disabled',
      pluginId: input.pluginId,
      tenantScoped: true,
      actorRef: input.actorRef,
      correlationId: input.correlationId,
      fromState: existing.enabled ? 'enabled' : 'installed_disabled',
      toState: input.enabled ? 'enabled' : 'installed_disabled',
      reasonCode: input.enabled ? 'none' : input.reasonCode,
      occurredAt: input.occurredAt,
    });
    return operation;
  }

  async isTenantEnabled(
    pluginId: PluginId,
    tenantRef: string,
  ): Promise<boolean> {
    return this.tenantEnablements.get(tenantKey(pluginId, tenantRef))?.enabled ??
      false;
  }

  async listEnabledTenantRefs(pluginId: PluginId): Promise<string[]> {
    const prefix = `${pluginId}\0`;
    return [...this.tenantEnablements.entries()]
      .filter(([key, value]) => key.startsWith(prefix) && value.enabled)
      .map(([key]) => key.slice(prefix.length))
      .sort();
  }

  async getTenantEnablement(
    pluginId: PluginId,
    tenantRef: string,
  ): Promise<PluginTenantEnablementV1 | undefined> {
    const installation = this.installations.get(pluginId);
    if (!installation) return undefined;
    if (installation.enablementScope !== 'tenant') {
      throw new PluginControlErrorV1(
        409,
        'tenant_enablement_not_supported',
      );
    }
    const record = this.tenantEnablements.get(tenantKey(pluginId, tenantRef));
    return pluginTenantEnablementV1Schema.parse({
      apiVersion: 'tenant-enablement.plugin.enterpriseglue.io/v1',
      pluginId,
      enabled: record?.enabled ?? false,
      revision: record?.revision ?? 0,
    });
  }

  async getOperation(
    operationId: string,
  ): Promise<PluginLifecycleOperationV1 | undefined> {
    const operation = this.operationById.get(operationId);
    return operation ? structuredClone(operation) : undefined;
  }

  async getEmergencyState(): Promise<PluginPlatformEmergencyStateV1> {
    if (!this.emergencyState) {
      throw new Error('plugin_control_not_reconciled');
    }
    return structuredClone(this.emergencyState);
  }

  async setEmergencyDisabled(
    input: PluginEmergencyControlMutationV1,
  ): Promise<PluginPlatformEmergencyStateV1> {
    if (!this.emergencyState) {
      throw new Error('plugin_control_not_reconciled');
    }
    const repeated = this.emergencyOperations.get(input.idempotencyKeyHash);
    if (repeated) {
      if (repeated.requestHash !== input.requestHash) {
        throw new PluginControlErrorV1(409, 'idempotency_conflict');
      }
      return structuredClone(repeated.state);
    }
    if (this.emergencyState.revision !== input.expectedRevision) {
      throw new PluginControlErrorV1(409, 'revision_conflict');
    }
    const wasDisabled = this.emergencyState.disabled;
    this.emergencyState = pluginPlatformEmergencyStateV1Schema.parse({
      apiVersion: 'emergency-control.plugin.enterpriseglue.io/v1',
      disabled: input.disabled,
      revision: input.expectedRevision + 1,
      reasonCode: input.disabled ? 'emergency_disabled' : 'none',
      updatedAt: input.occurredAt,
    });
    this.emergencyOperations.set(input.idempotencyKeyHash, {
      requestHash: input.requestHash,
      state: structuredClone(this.emergencyState),
    });
    this.appendAudit({
      eventType: input.disabled
        ? 'platform_emergency_disabled'
        : 'platform_emergency_enabled',
      pluginId: null,
      tenantScoped: false,
      actorRef: input.actorRef,
      correlationId: input.correlationId,
      fromState: wasDisabled ? 'disabled' : 'enabled',
      toState: input.disabled ? 'disabled' : 'enabled',
      reasonCode: input.disabled ? 'emergency_disabled' : 'none',
      occurredAt: input.occurredAt,
    });
    return structuredClone(this.emergencyState);
  }

  async listAudit(): Promise<PluginPlatformAuditEventV1[]> {
    return structuredClone(this.audits);
  }

  private appendAudit(
    input: Omit<PluginPlatformAuditEventV1, 'eventId'>,
  ): void {
    this.audits.unshift(
      pluginPlatformAuditEventV1Schema.parse({
        eventId: randomUUID(),
        ...input,
      }),
    );
    if (this.audits.length > 100) this.audits.length = 100;
  }

  private repeatedOperation(
    input: PluginControlMutationV1,
    type: PluginLifecycleOperationTypeV1,
  ): PluginLifecycleOperationV1 | undefined {
    const existing = this.operations.get(input.idempotencyKeyHash);
    if (!existing) return undefined;
    if (
      existing.requestHash !== input.requestHash ||
      existing.operation.pluginId !== input.pluginId ||
      existing.operation.type !== type
    ) {
      throw new PluginControlErrorV1(409, 'idempotency_conflict');
    }
    return structuredClone(existing.operation);
  }

  private saveOperation(
    input: PluginControlMutationV1,
    type: PluginLifecycleOperationTypeV1,
  ): PluginLifecycleOperationV1 {
    const operation = pluginLifecycleOperationV1Schema.parse({
      operationId: randomUUID(),
      pluginId: input.pluginId,
      type,
      status: 'succeeded',
      reasonCode: input.enabled ? 'none' : input.reasonCode,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    });
    this.operations.set(input.idempotencyKeyHash, {
      operation,
      requestHash: input.requestHash,
    });
    this.operationById.set(operation.operationId, operation);
    return structuredClone(operation);
  }
}

export interface PluginControlSourceV1 {
  controlSnapshot(): Promise<PluginControlSourceSnapshotV1>;
}

export interface PluginControlPlaneOptionsV1 {
  defaultTenantRef: string;
  now?: () => Date;
}

export class PluginControlPlaneV1 {
  private readonly now: () => Date;
  private readonly defaultTenantRef: string;

  constructor(
    private readonly source: PluginControlSourceV1,
    private readonly store: PluginControlStoreV1,
    options: PluginControlPlaneOptionsV1,
  ) {
    this.defaultTenantRef = options.defaultTenantRef;
    this.now = options.now ?? (() => new Date());
  }

  async list() {
    const snapshot = await this.synchronize();
    return pluginSafeListV1Schema.parse({
      apiVersion: 'control.plugin.enterpriseglue.io/v1',
      revision: snapshot.revision,
      plugins: await this.store.list(),
    });
  }

  async get(pluginId: PluginId): Promise<PluginSafeSummaryV1> {
    await this.synchronize();
    const summary = await this.store.get(pluginId);
    if (!summary) throw new PluginControlErrorV1(404, 'plugin_not_found');
    return pluginSafeSummaryV1Schema.parse(summary);
  }

  async getDeploymentExecution(): Promise<PluginDeploymentExecutionObservationV1> {
    const snapshot = await this.synchronize();
    return pluginDeploymentExecutionObservationV1Schema.parse(
      snapshot.deploymentExecution ?? {
        apiVersion:
          'deployment-execution-observation.plugin.enterpriseglue.io/v1',
        observedFrom: 'local_execution_mirror',
        workloadReconciliation: 'not_checked',
        observationState: 'not_started',
        observationReason: 'execution_not_found',
        desiredRevision: snapshot.revision,
        planSha256: null,
        execution: null,
      },
    );
  }

  async setDeploymentEnabled(input: {
    pluginId: PluginId;
    enabled: boolean;
    expectedRevision: number;
    idempotencyKey: string;
    actorRef: string;
    correlationId: string;
    reasonCode?: PluginSafeReasonCodeV1;
  }): Promise<PluginLifecycleOperationV1> {
    await this.synchronize();
    const occurredAt = this.now().toISOString();
    const type = input.enabled ? 'enable' : 'disable';
    return this.store.setDeploymentEnabled({
      ...input,
      idempotencyKeyHash: digest(
        `${input.actorRef}\0${input.pluginId}\0deployment\0${type}\0${input.idempotencyKey}`,
      ),
      requestHash: digest(
        JSON.stringify({
          pluginId: input.pluginId,
          enabled: input.enabled,
          expectedRevision: input.expectedRevision,
          reasonCode: input.reasonCode ?? 'administrator_disabled',
        }),
      ),
      reasonCode: input.reasonCode ?? 'administrator_disabled',
      occurredAt,
    });
  }

  async setTenantEnabled(input: {
    pluginId: PluginId;
    tenantRef: string;
    enabled: boolean;
    expectedRevision: number;
    idempotencyKey: string;
    actorRef: string;
    correlationId: string;
  }): Promise<PluginLifecycleOperationV1> {
    await this.synchronize();
    const occurredAt = this.now().toISOString();
    return this.store.setTenantEnabled({
      ...input,
      idempotencyKeyHash: digest(
        `${input.actorRef}\0${input.pluginId}\0${input.tenantRef}\0tenant\0${input.idempotencyKey}`,
      ),
      requestHash: digest(
        JSON.stringify({
          pluginId: input.pluginId,
          tenantRef: input.tenantRef,
          enabled: input.enabled,
          expectedRevision: input.expectedRevision,
        }),
      ),
      reasonCode: input.enabled ? 'none' : 'administrator_disabled',
      occurredAt,
    });
  }

  async getTenantEnablement(
    pluginId: PluginId,
    tenantRef: string,
  ): Promise<PluginTenantEnablementV1> {
    await this.synchronize();
    const summary = await this.store.getTenantEnablement(pluginId, tenantRef);
    if (!summary) throw new PluginControlErrorV1(404, 'plugin_not_found');
    return pluginTenantEnablementV1Schema.parse(summary);
  }

  async getOperation(operationId: string): Promise<PluginLifecycleOperationV1> {
    const operation = await this.store.getOperation(operationId);
    if (!operation) {
      throw new PluginControlErrorV1(404, 'operation_not_found');
    }
    return pluginLifecycleOperationV1Schema.parse(operation);
  }

  async getEmergencyState(): Promise<PluginPlatformEmergencyStateV1> {
    await this.synchronize();
    return pluginPlatformEmergencyStateV1Schema.parse(
      await this.store.getEmergencyState(),
    );
  }

  async listAudit(): Promise<PluginPlatformAuditListV1> {
    await this.synchronize();
    return pluginPlatformAuditListV1Schema.parse({
      apiVersion: 'audit.plugin.enterpriseglue.io/v1',
      events: await this.store.listAudit(),
    });
  }

  async setEmergencyDisabled(input: {
    disabled: boolean;
    expectedRevision: number;
    idempotencyKey: string;
    actorRef: string;
    correlationId: string;
  }): Promise<PluginPlatformEmergencyStateV1> {
    await this.synchronize();
    const occurredAt = this.now().toISOString();
    return pluginPlatformEmergencyStateV1Schema.parse(
      await this.store.setEmergencyDisabled({
        disabled: input.disabled,
        expectedRevision: input.expectedRevision,
        idempotencyKeyHash: digest(
          `${input.actorRef}\0platform-emergency\0${input.idempotencyKey}`,
        ),
        requestHash: digest(
          JSON.stringify({
            disabled: input.disabled,
            expectedRevision: input.expectedRevision,
          }),
        ),
        actorRef: input.actorRef,
        correlationId: input.correlationId,
        occurredAt,
      }),
    );
  }

  async isExecutionAllowed(
    pluginId: PluginId,
    tenantRef?: string,
  ): Promise<boolean> {
    const snapshot = await this.synchronize();
    if ((await this.store.getEmergencyState()).disabled) return false;
    const source = snapshot.records.find(
      (record) => record.pluginId === pluginId,
    );
    const summary = await this.store.get(pluginId);
    if (
      !source ||
      !summary?.enabled ||
      !summary.compatible ||
      !['enabled', 'degraded'].includes(summary.state)
    ) {
      return false;
    }
    if (source.enablementScope === 'deployment') return true;
    return Boolean(
      tenantRef &&
        (await this.store.isTenantEnabled(pluginId, tenantRef)),
    );
  }

  async enabledPluginIds(tenantRef: string): Promise<Set<PluginId>> {
    const snapshot = await this.synchronize();
    const result = new Set<PluginId>();
    if ((await this.store.getEmergencyState()).disabled) return result;
    for (const source of snapshot.records) {
      if (await this.isExecutionAllowedWithoutSync(source, tenantRef)) {
        result.add(source.pluginId);
      }
    }
    return result;
  }

  async enabledTenantRefs(pluginId: PluginId): Promise<string[]> {
    const snapshot = await this.synchronize();
    if ((await this.store.getEmergencyState()).disabled) return [];
    const source = snapshot.records.find(
      (record) => record.pluginId === pluginId,
    );
    if (!source) return [];
    if (source.enablementScope === 'deployment') {
      return (await this.isExecutionAllowedWithoutSync(
        source,
        this.defaultTenantRef,
      ))
        ? [this.defaultTenantRef]
        : [];
    }
    const tenantRefs = await this.store.listEnabledTenantRefs(pluginId);
    const enabled = await Promise.all(
      tenantRefs.map(async (tenantRef) => ({
        tenantRef,
        allowed: await this.isExecutionAllowedWithoutSync(source, tenantRef),
      })),
    );
    return enabled
      .filter((candidate) => candidate.allowed)
      .map((candidate) => candidate.tenantRef);
  }

  private async isExecutionAllowedWithoutSync(
    source: PluginControlSourceRecordV1,
    tenantRef: string,
  ): Promise<boolean> {
    const summary = await this.store.get(source.pluginId);
    if (
      !summary?.enabled ||
      !summary.compatible ||
      !['enabled', 'degraded'].includes(summary.state)
    ) {
      return false;
    }
    return source.enablementScope === 'deployment'
      ? true
      : this.store.isTenantEnabled(source.pluginId, tenantRef);
  }

  private async synchronize(): Promise<PluginControlSourceSnapshotV1> {
    const snapshot = await this.source.controlSnapshot();
    await this.store.reconcile(
      snapshot,
      this.defaultTenantRef,
      this.now().toISOString(),
    );
    return snapshot;
  }
}

function tenantKey(pluginId: PluginId, tenantRef: string): string {
  return `${pluginId}\0${tenantRef}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sourceFingerprint(source: PluginControlSourceRecordV1): string {
  return digest(
    JSON.stringify({
      pluginId: source.pluginId,
      version: source.version,
      displayName: source.displayName,
      publisher: source.publisher,
      bundleDigest: source.bundleDigest,
      manifestSha256: source.manifestSha256,
      sourceRecordHash: source.sourceRecordHash,
      installerEnabled: source.installerEnabled,
      enablementScope: source.enablementScope,
      grantedPermissions: [...source.grantedPermissions].sort(),
    }),
  );
}

function installerSnapshotHash(
  snapshot: PluginControlSourceSnapshotV1,
): string {
  return digest(
    JSON.stringify(
      [...snapshot.records]
        .sort((left, right) => left.pluginId.localeCompare(right.pluginId))
        .map((record) => sourceFingerprint(record)),
    ),
  );
}
