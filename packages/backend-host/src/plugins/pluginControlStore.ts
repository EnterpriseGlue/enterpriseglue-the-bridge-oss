import { createHash, randomUUID } from 'node:crypto';

import {
  pluginLifecycleOperationV1Schema,
  pluginPlatformAuditEventV1Schema,
  pluginPlatformEmergencyStateV1Schema,
  pluginSafeSummaryV1Schema,
  pluginTenantApplicationV1Schema,
  pluginTenantEnablementV1Schema,
  type PluginId,
  type PluginLifecycleOperationV1,
  type PluginLifecycleOperationTypeV1,
  type PluginPlatformAuditEventV1,
  type PluginPlatformEmergencyStateV1,
  type PluginSafeSummaryV1,
  type PluginTenantApplicationV1,
  type PluginTenantEnablementV1,
} from '@enterpriseglue/plugin-sdk';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  PluginEmergencyControlOperation,
  PluginInstallation,
  PluginLifecycleOperation as PluginLifecycleOperationEntity,
  PluginPermissionGrant,
  PluginPlatformState,
  PluginPlatformAudit,
  PluginTenantApplicationOperation,
  PluginTenantEnablement,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import type { DataSource, EntityManager } from 'typeorm';

import {
  PluginControlErrorV1,
  type PluginControlMutationV1,
  type PluginControlStoreV1,
  type PluginEmergencyControlMutationV1,
  type PluginTenantApplicationMutationV1,
  type PluginTenantControlMutationV1,
} from './pluginControlPlane.js';
import { findPluginRowForUpdateV1 } from './pluginDatabaseLock.js';
import { runPluginTransactionV1 } from './pluginDatabaseTransaction.js';
import type { PluginControlSourceSnapshotV1 } from './pluginRuntime.js';

const INSTALLER_ACTOR = 'enterpriseglue-plugin-installer';
const INSTALLER_STATE_ID = 'installer-state-v1';

export class DatabasePluginControlStoreV1 implements PluginControlStoreV1 {
  constructor(
    private readonly dataSourceProvider: () => Promise<DataSource> =
      getDataSource,
  ) {}

  async reconcile(
    snapshot: PluginControlSourceSnapshotV1,
    defaultTenantRef: string,
    occurredAt: string,
  ): Promise<void> {
    const dataSource = await this.dataSourceProvider();
    await runPluginTransactionV1(dataSource, async (manager) => {
      const stateRepository = manager.getRepository(PluginPlatformState);
      const acceptedState = await stateRepository.findOne({
        where: { id: INSTALLER_STATE_ID },
      });
      const snapshotHash = installerSnapshotHash(snapshot);
      if (
        acceptedState &&
        integer(acceptedState.installerRevision) > snapshot.revision
      ) {
        throw new Error('plugin_installer_revision_rollback');
      }
      if (
        acceptedState &&
        integer(acceptedState.installerRevision) === snapshot.revision &&
        acceptedState.snapshotHash !== snapshotHash
      ) {
        throw new Error('plugin_installer_revision_reused');
      }
      const installations = manager.getRepository(PluginInstallation);
      const existing = await installations.find();
      const existingByPlugin = new Map(
        existing.map((record) => [record.pluginId, record]),
      );
      if (
        existing.some(
          (record) =>
            integer(record.installerRevision) > snapshot.revision,
        )
      ) {
        throw new Error('plugin_installer_revision_rollback');
      }
      const sourceIds = new Set(
        snapshot.records.map((record) => record.pluginId),
      );
      const now = Date.parse(occurredAt);

      for (const source of snapshot.records) {
        const current = existingByPlugin.get(source.pluginId);
        const grantSetHash = hashGrantSet(source.grantedPermissions);
        const sourceChanged =
          !current ||
          current.version !== source.version ||
          current.publisher !== source.publisher ||
          current.displayName !== source.displayName ||
          current.manifestSha256 !== source.manifestSha256 ||
          current.sourceRecordHash !== source.sourceRecordHash ||
          current.bundleDigest !== source.bundleDigest ||
          current.installerEnabled !== source.installerEnabled ||
          current.enablementScope !== source.enablementScope ||
          current.tenantConfigurationPath !==
            (source.tenantConfiguration?.relativePath ?? null) ||
          current.tenantConfigurationSchemaSha256 !==
            (source.tenantConfiguration?.schemaSha256 ?? null) ||
          current.grantSetHash !== grantSetHash;
        if (!current) {
          await installations.insert({
            id: randomUUID(),
            pluginId: source.pluginId,
            version: source.version,
            publisher: source.publisher,
            displayName: source.displayName,
            manifestSha256: source.manifestSha256,
            sourceRecordHash: source.sourceRecordHash,
            bundleDigest: source.bundleDigest,
            state: source.installerEnabled
              ? 'enabled'
              : 'installed_disabled',
            reasonCode: source.reasonCode,
            desiredEnabled:
              source.installerEnabled && source.compatible,
            installerEnabled: source.installerEnabled,
            enablementScope: source.enablementScope,
            tenantConfigurationPath:
              source.tenantConfiguration?.relativePath ?? null,
            tenantConfigurationSchemaSha256:
              source.tenantConfiguration?.schemaSha256 ?? null,
            grantSetHash,
            compatible: source.compatible,
            healthy: source.healthy,
            entitlementState: source.entitled,
            revision: 0,
            installerRevision: snapshot.revision,
            createdAt: now,
            updatedAt: now,
          });
        } else if (sourceChanged) {
          await installations.update(
            { id: current.id },
            {
              version: source.version,
              publisher: source.publisher,
              displayName: source.displayName,
              manifestSha256: source.manifestSha256,
              sourceRecordHash: source.sourceRecordHash,
              bundleDigest: source.bundleDigest,
              state: source.installerEnabled
                ? 'enabled'
                : 'installed_disabled',
              reasonCode: source.reasonCode,
              desiredEnabled:
                source.installerEnabled && source.compatible,
              installerEnabled: source.installerEnabled,
              enablementScope: source.enablementScope,
              tenantConfigurationPath:
                source.tenantConfiguration?.relativePath ?? null,
              tenantConfigurationSchemaSha256:
                source.tenantConfiguration?.schemaSha256 ?? null,
              grantSetHash,
              compatible: source.compatible,
              healthy: current.desiredEnabled ? source.healthy : false,
              entitlementState: source.entitled,
              revision: integer(current.revision) + 1,
              installerRevision: snapshot.revision,
              updatedAt: now,
            },
          );
        } else {
          await installations.update(
            { id: current.id },
            {
              compatible: source.compatible,
              healthy: source.healthy,
              entitlementState: source.entitled,
              reasonCode: current.desiredEnabled
                ? source.reasonCode
                : current.reasonCode,
              installerRevision: snapshot.revision,
              updatedAt: now,
            },
          );
        }

        if (sourceChanged) {
          await reconcilePermissions(manager, source, now);
          if (source.enablementScope === 'tenant') {
            await reconcileDefaultTenant(
              manager,
              source.pluginId,
              defaultTenantRef,
              source.installerEnabled && source.compatible,
              now,
            );
          }
          await appendAudit(manager, {
            eventType: 'installer_reconciled',
            pluginId: source.pluginId,
            actorRef: INSTALLER_ACTOR,
            correlationId: `installer-revision-${snapshot.revision}`,
            fromState: current?.state ?? null,
            toState: source.installerEnabled
              ? 'enabled'
              : 'installed_disabled',
            reasonCode: source.reasonCode,
            occurredAt: now,
          });
        }
      }

      for (const current of existing) {
        if (
          sourceIds.has(current.pluginId as PluginId) ||
          integer(current.installerRevision) >= snapshot.revision
        ) {
          continue;
        }
        await installations.update(
          { id: current.id },
          {
            state: 'removed',
            reasonCode: 'administrator_disabled',
            desiredEnabled: false,
            installerEnabled: false,
            healthy: false,
            revision: integer(current.revision) + 1,
            installerRevision: snapshot.revision,
            updatedAt: now,
          },
        );
        await appendAudit(manager, {
          eventType: 'installer_removed',
          pluginId: current.pluginId,
          actorRef: INSTALLER_ACTOR,
          correlationId: `installer-revision-${snapshot.revision}`,
          fromState: current.state,
          toState: 'removed',
          reasonCode: 'administrator_disabled',
          occurredAt: now,
        });
      }
      if (!acceptedState) {
        await stateRepository.insert({
          id: INSTALLER_STATE_ID,
          installerRevision: snapshot.revision,
          snapshotHash,
          emergencyDisabled: false,
          emergencyRevision: 0,
          emergencyUpdatedAt: now,
          updatedAt: now,
        });
      } else if (
        integer(acceptedState.installerRevision) < snapshot.revision
      ) {
        await stateRepository.update(
          { id: INSTALLER_STATE_ID },
          {
            installerRevision: snapshot.revision,
            snapshotHash,
            updatedAt: now,
          },
        );
      }
    });
  }

  async list(): Promise<PluginSafeSummaryV1[]> {
    const records = await (
      await this.dataSourceProvider()
    ).getRepository(PluginInstallation).find({
      order: { pluginId: 'ASC' },
    });
    return records.map(toSummary);
  }

  async get(pluginId: PluginId): Promise<PluginSafeSummaryV1 | undefined> {
    const record = await (
      await this.dataSourceProvider()
    ).getRepository(PluginInstallation).findOne({
      where: { pluginId },
    });
    return record ? toSummary(record) : undefined;
  }

  async setDeploymentEnabled(
    input: PluginControlMutationV1,
  ): Promise<PluginLifecycleOperationV1> {
    return this.mutateInstallation(input);
  }

  async setTenantEnabled(
    input: PluginTenantControlMutationV1,
  ): Promise<PluginLifecycleOperationV1> {
    const operationType: PluginLifecycleOperationTypeV1 = input.enabled
      ? 'enable'
      : 'disable';
    try {
      return await runPluginTransactionV1(
        await this.dataSourceProvider(),
        async (manager) => {
        const repeated = await repeatedOperation(
          manager,
          input,
          operationType,
        );
        if (repeated) return repeated;
        const installation = await manager
          .getRepository(PluginInstallation)
          .findOne({ where: { pluginId: input.pluginId } });
        if (!installation) {
          throw new PluginControlErrorV1(404, 'plugin_not_found');
        }
        if (
          !installation.desiredEnabled ||
          !['enabled', 'degraded'].includes(installation.state)
        ) {
          throw new PluginControlErrorV1(409, 'invalid_state');
        }
        if (installation.enablementScope !== 'tenant') {
          throw new PluginControlErrorV1(
            409,
            'tenant_enablement_not_supported',
          );
        }
        const tenants = manager.getRepository(PluginTenantEnablement);
        const tenant = await tenants.findOne({
          where: {
            pluginId: input.pluginId,
            tenantRef: input.tenantRef,
          },
        });
        if ((!tenant && input.expectedRevision !== 0) ||
          (tenant && integer(tenant.revision) !== input.expectedRevision)) {
          throw new PluginControlErrorV1(409, 'revision_conflict');
        }
        if (!tenant) {
          await tenants.insert({
            id: randomUUID(),
            pluginId: input.pluginId,
            tenantRef: input.tenantRef,
            enabled: input.enabled,
            reasonCode: input.reasonCode,
            activationRequestState: 'none',
            requestedByRef: null,
            requestedAt: null,
            reviewedByRef: null,
            reviewedAt: null,
            revision: 1,
            createdAt: Date.parse(input.occurredAt),
            updatedAt: Date.parse(input.occurredAt),
          });
        } else {
          const updated = await tenants.update(
            { id: tenant.id, revision: input.expectedRevision },
            {
              enabled: input.enabled,
              reasonCode: input.reasonCode,
              revision: input.expectedRevision + 1,
              updatedAt: Date.parse(input.occurredAt),
            },
          );
          if (updated.affected !== 1) {
            throw new PluginControlErrorV1(409, 'revision_conflict');
          }
        }
        const operation = await insertOperation(
          manager,
          input,
          operationType,
        );
        await appendAudit(manager, {
          eventType: input.enabled
            ? 'tenant_enabled'
            : 'tenant_disabled',
          pluginId: input.pluginId,
          tenantRef: input.tenantRef,
          actorRef: input.actorRef,
          correlationId: input.correlationId,
          fromState: tenant?.enabled ? 'enabled' : 'installed_disabled',
          toState: input.enabled ? 'enabled' : 'installed_disabled',
          reasonCode: input.reasonCode,
          occurredAt: Date.parse(input.occurredAt),
        });
        return operation;
      });
    } catch (error) {
      return recoverRepeatedOperation(
        this.dataSourceProvider,
        error,
        input,
        operationType,
      );
    }
  }

  async isTenantEnabled(
    pluginId: PluginId,
    tenantRef: string,
  ): Promise<boolean> {
    const record = await (
      await this.dataSourceProvider()
    ).getRepository(PluginTenantEnablement).findOne({
      where: { pluginId, tenantRef },
    });
    return record?.enabled ?? false;
  }

  async listEnabledTenantRefs(pluginId: PluginId): Promise<string[]> {
    const records = await (
      await this.dataSourceProvider()
    ).getRepository(PluginTenantEnablement).find({
      where: { pluginId, enabled: true },
      order: { tenantRef: 'ASC' },
    });
    return records.map((record) => record.tenantRef);
  }

  async getTenantEnablement(
    pluginId: PluginId,
    tenantRef: string,
  ): Promise<PluginTenantEnablementV1 | undefined> {
    const installations = (
      await this.dataSourceProvider()
    ).getRepository(PluginInstallation);
    const installation = await installations.findOne({ where: { pluginId } });
    if (!installation) return undefined;
    if (installation?.enablementScope !== 'tenant') {
      throw new PluginControlErrorV1(
        409,
        'tenant_enablement_not_supported',
      );
    }
    const record = await (
      await this.dataSourceProvider()
    ).getRepository(PluginTenantEnablement).findOne({
      where: { pluginId, tenantRef },
    });
    if (!record) {
      throw new PluginControlErrorV1(
        409,
        'tenant_enablement_not_supported',
      );
    }
    return pluginTenantEnablementV1Schema.parse({
      apiVersion: 'tenant-enablement.plugin.enterpriseglue.io/v1',
      pluginId,
      enabled: record.enabled,
      revision: integer(record.revision),
    });
  }

  async listTenantApplications(
    tenantRef: string,
    tenantSlug: string,
  ): Promise<PluginTenantApplicationV1[]> {
    const dataSource = await this.dataSourceProvider();
    const installations = await dataSource.getRepository(PluginInstallation)
      .find({ where: { enablementScope: 'tenant' }, order: { pluginId: 'ASC' } });
    const enablements = await dataSource.getRepository(PluginTenantEnablement)
      .find({ where: { tenantRef } });
    const byPlugin = new Map(enablements.map((row) => [row.pluginId, row]));
    return installations.map((installation) =>
      databaseTenantApplication(
        installation,
        byPlugin.get(installation.pluginId),
        tenantSlug,
      ),
    );
  }

  async getTenantApplication(
    pluginId: PluginId,
    tenantRef: string,
    tenantSlug: string,
  ): Promise<PluginTenantApplicationV1 | undefined> {
    const dataSource = await this.dataSourceProvider();
    const installation = await dataSource.getRepository(PluginInstallation)
      .findOne({ where: { pluginId, enablementScope: 'tenant' } });
    if (!installation) return undefined;
    const enablement = await dataSource.getRepository(PluginTenantEnablement)
      .findOne({ where: { pluginId, tenantRef } });
    return databaseTenantApplication(installation, enablement, tenantSlug);
  }

  async mutateTenantActivationRequest(
    input: PluginTenantApplicationMutationV1,
  ): Promise<PluginTenantApplicationV1> {
    try {
      return await runPluginTransactionV1(
        await this.dataSourceProvider(),
        async (manager) => {
          const operations = manager.getRepository(
            PluginTenantApplicationOperation,
          );
          const repeated = await operations.findOne({
            where: { idempotencyKeyHash: input.idempotencyKeyHash },
          });
          if (repeated) {
            if (
              repeated.requestHash !== input.requestHash ||
              repeated.pluginId !== input.pluginId ||
              repeated.tenantRef !== input.tenantRef ||
              repeated.type !== input.operation
            ) {
              throw new PluginControlErrorV1(409, 'idempotency_conflict');
            }
            return pluginTenantApplicationV1Schema.parse(
              JSON.parse(repeated.receiptJson),
            );
          }

          const installation = await manager.getRepository(PluginInstallation)
            .findOne({ where: { pluginId: input.pluginId, enablementScope: 'tenant' } });
          if (!installation) {
            throw new PluginControlErrorV1(404, 'plugin_not_found');
          }
          if (
            !installation.desiredEnabled ||
            !installation.compatible ||
            !['enabled', 'degraded'].includes(installation.state)
          ) {
            throw new PluginControlErrorV1(409, 'invalid_state');
          }

          const enablements = manager.getRepository(PluginTenantEnablement);
          const current = await enablements.findOne({
            where: { pluginId: input.pluginId, tenantRef: input.tenantRef },
          });
          if (
            (!current && input.expectedRevision !== 0) ||
            (current && integer(current.revision) !== input.expectedRevision)
          ) {
            throw new PluginControlErrorV1(409, 'revision_conflict');
          }
          if (
            input.operation !== 'request' &&
            current?.activationRequestState !== 'pending'
          ) {
            throw new PluginControlErrorV1(409, 'activation_request_not_pending');
          }

          const now = Date.parse(input.occurredAt);
          const next = enablements.create({
            ...(current ?? {}),
            id: current?.id ?? randomUUID(),
            pluginId: input.pluginId,
            tenantRef: input.tenantRef,
            enabled:
              input.operation === 'approve'
                ? true
                : input.operation === 'reject'
                  ? false
                  : current?.enabled ?? false,
            reasonCode: 'none',
            activationRequestState:
              input.operation === 'request'
                ? 'pending'
                : input.operation === 'approve'
                  ? 'approved'
                  : 'rejected',
            requestedByRef:
              input.operation === 'request'
                ? input.actorRef
                : current?.requestedByRef ?? null,
            requestedAt:
              input.operation === 'request'
                ? now
                : current?.requestedAt ?? null,
            reviewedByRef:
              input.operation === 'request' ? null : input.actorRef,
            reviewedAt: input.operation === 'request' ? null : now,
            revision: input.expectedRevision + 1,
            createdAt: current?.createdAt ?? now,
            updatedAt: now,
          });
          if (!current) {
            await enablements.insert(next);
          } else {
            const updated = await enablements.update(
              { id: current.id, revision: input.expectedRevision },
              next,
            );
            if (updated.affected !== 1) {
              throw new PluginControlErrorV1(409, 'revision_conflict');
            }
          }

          const application = databaseTenantApplication(
            installation,
            next,
            input.tenantSlug,
          );
          await operations.insert({
            id: randomUUID(),
            pluginId: input.pluginId,
            tenantRef: input.tenantRef,
            type: input.operation,
            idempotencyKeyHash: input.idempotencyKeyHash,
            requestHash: input.requestHash,
            receiptJson: JSON.stringify(application),
            actorRef: input.actorRef,
            correlationId: input.correlationId,
            createdAt: now,
          });
          await appendAudit(manager, {
            eventType:
              input.operation === 'request'
                ? 'tenant_activation_requested'
                : input.operation === 'approve'
                  ? 'tenant_activation_approved'
                  : 'tenant_activation_rejected',
            pluginId: input.pluginId,
            tenantRef: input.tenantRef,
            actorRef: input.actorRef,
            correlationId: input.correlationId,
            fromState: databaseTenantApplicationStatus(installation, current),
            toState: application.status,
            reasonCode: 'none',
            occurredAt: now,
          });
          return application;
        },
      );
    } catch (error) {
      const repeated = await (await this.dataSourceProvider())
        .getRepository(PluginTenantApplicationOperation)
        .findOne({ where: { idempotencyKeyHash: input.idempotencyKeyHash } });
      if (repeated) {
        if (
          repeated.requestHash !== input.requestHash ||
          repeated.pluginId !== input.pluginId ||
          repeated.tenantRef !== input.tenantRef ||
          repeated.type !== input.operation
        ) {
          throw new PluginControlErrorV1(409, 'idempotency_conflict');
        }
        return pluginTenantApplicationV1Schema.parse(
          JSON.parse(repeated.receiptJson),
        );
      }
      throw error;
    }
  }

  async listTenantApplicationAudit(
    pluginId: PluginId,
    tenantRef: string,
  ): Promise<PluginPlatformAuditEventV1[]> {
    const records = await (await this.dataSourceProvider())
      .getRepository(PluginPlatformAudit)
      .find({
        where: { pluginId, tenantRef },
        order: { occurredAt: 'DESC' },
        take: 100,
      });
    return records.map(toAudit);
  }

  async getOperation(
    operationId: string,
  ): Promise<PluginLifecycleOperationV1 | undefined> {
    const record = await (
      await this.dataSourceProvider()
    ).getRepository(PluginLifecycleOperationEntity).findOne({
      where: { id: operationId },
    });
    return record ? toOperation(record) : undefined;
  }

  async getEmergencyState(): Promise<PluginPlatformEmergencyStateV1> {
    const state = await (
      await this.dataSourceProvider()
    ).getRepository(PluginPlatformState).findOne({
      where: { id: INSTALLER_STATE_ID },
    });
    if (!state) throw new Error('plugin_control_not_reconciled');
    return toEmergencyState({
      disabled: state.emergencyDisabled,
      revision: integer(state.emergencyRevision),
      occurredAt: integer(state.emergencyUpdatedAt ?? state.updatedAt),
    });
  }

  async setEmergencyDisabled(
    input: PluginEmergencyControlMutationV1,
  ): Promise<PluginPlatformEmergencyStateV1> {
    try {
      return await runPluginTransactionV1(
        await this.dataSourceProvider(),
        async (manager) => {
        const repeatedBeforeLock = await repeatedEmergencyOperation(
          manager,
          input,
        );
        if (repeatedBeforeLock) return repeatedBeforeLock;

        const states = manager.getRepository(PluginPlatformState);
        const state = await findPluginRowForUpdateV1(states, {
          id: INSTALLER_STATE_ID,
        });
        if (!state) throw new Error('plugin_control_not_reconciled');

        const repeatedAfterLock = await repeatedEmergencyOperation(
          manager,
          input,
        );
        if (repeatedAfterLock) return repeatedAfterLock;
        if (integer(state.emergencyRevision) !== input.expectedRevision) {
          throw new PluginControlErrorV1(409, 'revision_conflict');
        }

        const occurredAt = Date.parse(input.occurredAt);
        const revision = input.expectedRevision + 1;
        const updated = await states.update(
          {
            id: INSTALLER_STATE_ID,
            emergencyRevision: input.expectedRevision,
          },
          {
            emergencyDisabled: input.disabled,
            emergencyRevision: revision,
            emergencyUpdatedAt: occurredAt,
            updatedAt: occurredAt,
          },
        );
        if (updated.affected !== 1) {
          throw new PluginControlErrorV1(409, 'revision_conflict');
        }
        await manager.getRepository(PluginEmergencyControlOperation).insert({
          id: randomUUID(),
          idempotencyKeyHash: input.idempotencyKeyHash,
          requestHash: input.requestHash,
          disabled: input.disabled,
          revision,
          actorRef: input.actorRef,
          correlationId: input.correlationId,
          createdAt: occurredAt,
        });
        await appendAudit(manager, {
          eventType: input.disabled
            ? 'platform_emergency_disabled'
            : 'platform_emergency_enabled',
          pluginId: null,
          actorRef: input.actorRef,
          correlationId: input.correlationId,
          fromState: state.emergencyDisabled ? 'disabled' : 'enabled',
          toState: input.disabled ? 'disabled' : 'enabled',
          reasonCode: input.disabled ? 'emergency_disabled' : 'none',
          occurredAt,
        });
        return toEmergencyState({
          disabled: input.disabled,
          revision,
          occurredAt,
        });
      });
    } catch (error) {
      const recovered = await recoverRepeatedEmergencyOperation(
        this.dataSourceProvider,
        input,
      );
      if (recovered) return recovered;
      throw error;
    }
  }

  async listAudit(): Promise<PluginPlatformAuditEventV1[]> {
    const records = await (
      await this.dataSourceProvider()
    ).getRepository(PluginPlatformAudit).find({
      order: { occurredAt: 'DESC', id: 'DESC' },
      take: 100,
    });
    return records.map(toAudit);
  }

  private async mutateInstallation(
    input: PluginControlMutationV1,
  ): Promise<PluginLifecycleOperationV1> {
    const operationType: PluginLifecycleOperationTypeV1 = input.enabled
      ? 'enable'
      : 'disable';
    try {
      return await runPluginTransactionV1(
        await this.dataSourceProvider(),
        async (manager) => {
        const repeated = await repeatedOperation(
          manager,
          input,
          operationType,
        );
        if (repeated) return repeated;
        const installations = manager.getRepository(PluginInstallation);
        const installation = await installations.findOne({
          where: { pluginId: input.pluginId },
        });
        if (!installation) {
          throw new PluginControlErrorV1(404, 'plugin_not_found');
        }
        if (integer(installation.revision) !== input.expectedRevision) {
          throw new PluginControlErrorV1(409, 'revision_conflict');
        }
        if (input.enabled && !installation.installerEnabled) {
          throw new PluginControlErrorV1(409, 'invalid_state');
        }
        if (
          installation.state === 'removed' ||
          !['enabled', 'degraded', 'installed_disabled'].includes(
            installation.state,
          )
        ) {
          throw new PluginControlErrorV1(409, 'invalid_state');
        }
        const now = Date.parse(input.occurredAt);
        const targetState = input.enabled
          ? 'enabled'
          : 'installed_disabled';
        const updated = await installations.update(
          { id: installation.id, revision: input.expectedRevision },
          {
            state: targetState,
            reasonCode: input.enabled ? 'none' : input.reasonCode,
            desiredEnabled: input.enabled && installation.compatible,
            healthy: input.enabled ? installation.healthy : false,
            revision: input.expectedRevision + 1,
            updatedAt: now,
          },
        );
        if (updated.affected !== 1) {
          throw new PluginControlErrorV1(409, 'revision_conflict');
        }
        const operation = await insertOperation(
          manager,
          input,
          operationType,
        );
        await appendAudit(manager, {
          eventType: input.enabled
            ? 'deployment_enabled'
            : 'deployment_disabled',
          pluginId: input.pluginId,
          actorRef: input.actorRef,
          correlationId: input.correlationId,
          fromState: installation.state,
          toState: targetState,
          reasonCode: input.enabled ? 'none' : input.reasonCode,
          occurredAt: now,
        });
        return operation;
      });
    } catch (error) {
      return recoverRepeatedOperation(
        this.dataSourceProvider,
        error,
        input,
        operationType,
      );
    }
  }
}

async function reconcilePermissions(
  manager: EntityManager,
  source: PluginControlSourceSnapshotV1['records'][number],
  now: number,
): Promise<void> {
  const grants = manager.getRepository(PluginPermissionGrant);
  await grants.delete({ pluginId: source.pluginId });
  if (source.grantedPermissions.length === 0) return;
  await grants.insert(
    source.grantedPermissions.map((permission) => ({
      id: randomUUID(),
      pluginId: source.pluginId,
      permission,
      granted: true,
      grantedByRef: INSTALLER_ACTOR,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

async function reconcileDefaultTenant(
  manager: EntityManager,
  pluginId: PluginId,
  tenantRef: string,
  enabled: boolean,
  now: number,
): Promise<void> {
  const tenants = manager.getRepository(PluginTenantEnablement);
  const existing = await tenants.findOne({
    where: { pluginId, tenantRef },
  });
  if (!existing) {
    await tenants.insert({
      id: randomUUID(),
      pluginId,
      tenantRef,
      enabled,
      reasonCode: enabled ? 'none' : 'administrator_disabled',
      activationRequestState: 'none',
      requestedByRef: null,
      requestedAt: null,
      reviewedByRef: null,
      reviewedAt: null,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }
  await tenants.update(
    { id: existing.id },
    {
      enabled,
      reasonCode: enabled ? 'none' : 'administrator_disabled',
      revision: integer(existing.revision) + 1,
      updatedAt: now,
    },
  );
}

async function repeatedOperation(
  manager: EntityManager,
  input: PluginControlMutationV1,
  type: PluginLifecycleOperationTypeV1,
): Promise<PluginLifecycleOperationV1 | undefined> {
  const existing = await manager
    .getRepository(PluginLifecycleOperationEntity)
    .findOne({
      where: { idempotencyKeyHash: input.idempotencyKeyHash },
    });
  if (!existing) return undefined;
  if (
    existing.requestHash !== input.requestHash ||
    existing.pluginId !== input.pluginId ||
    existing.type !== type
  ) {
    throw new PluginControlErrorV1(409, 'idempotency_conflict');
  }
  return toOperation(existing);
}

async function insertOperation(
  manager: EntityManager,
  input: PluginControlMutationV1,
  type: PluginLifecycleOperationTypeV1,
): Promise<PluginLifecycleOperationV1> {
  const now = Date.parse(input.occurredAt);
  const id = randomUUID();
  await manager.getRepository(PluginLifecycleOperationEntity).insert({
    id,
    pluginId: input.pluginId,
    type,
    status: 'succeeded',
    idempotencyKeyHash: input.idempotencyKeyHash,
    requestHash: input.requestHash,
    targetVersion: null,
    reasonCode: input.enabled ? 'none' : input.reasonCode,
    revision: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  });
  return pluginLifecycleOperationV1Schema.parse({
    operationId: id,
    pluginId: input.pluginId,
    type,
    status: 'succeeded',
    reasonCode: input.enabled ? 'none' : input.reasonCode,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
  });
}

async function recoverRepeatedOperation(
  dataSourceProvider: () => Promise<DataSource>,
  error: unknown,
  input: PluginControlMutationV1,
  type: PluginLifecycleOperationTypeV1,
): Promise<PluginLifecycleOperationV1> {
  const existing = await (
    await dataSourceProvider()
  ).getRepository(PluginLifecycleOperationEntity).findOne({
    where: { idempotencyKeyHash: input.idempotencyKeyHash },
  });
  if (existing) {
    if (
      existing.requestHash !== input.requestHash ||
      existing.pluginId !== input.pluginId ||
      existing.type !== type
    ) {
      throw new PluginControlErrorV1(409, 'idempotency_conflict');
    }
    return toOperation(existing);
  }
  throw error;
}

async function repeatedEmergencyOperation(
  manager: EntityManager,
  input: PluginEmergencyControlMutationV1,
): Promise<PluginPlatformEmergencyStateV1 | undefined> {
  const existing = await manager
    .getRepository(PluginEmergencyControlOperation)
    .findOne({
      where: { idempotencyKeyHash: input.idempotencyKeyHash },
    });
  if (!existing) return undefined;
  if (existing.requestHash !== input.requestHash) {
    throw new PluginControlErrorV1(409, 'idempotency_conflict');
  }
  return toEmergencyState({
    disabled: existing.disabled,
    revision: integer(existing.revision),
    occurredAt: integer(existing.createdAt),
  });
}

async function recoverRepeatedEmergencyOperation(
  dataSourceProvider: () => Promise<DataSource>,
  input: PluginEmergencyControlMutationV1,
): Promise<PluginPlatformEmergencyStateV1 | undefined> {
  const existing = await (
    await dataSourceProvider()
  ).getRepository(PluginEmergencyControlOperation).findOne({
    where: { idempotencyKeyHash: input.idempotencyKeyHash },
  });
  if (!existing) return undefined;
  if (existing.requestHash !== input.requestHash) {
    throw new PluginControlErrorV1(409, 'idempotency_conflict');
  }
  return toEmergencyState({
    disabled: existing.disabled,
    revision: integer(existing.revision),
    occurredAt: integer(existing.createdAt),
  });
}

function toSummary(record: PluginInstallation): PluginSafeSummaryV1 {
  return pluginSafeSummaryV1Schema.parse({
    pluginId: record.pluginId,
    version: record.version,
    displayName: record.displayName,
    state: record.state,
    enabled: record.desiredEnabled,
    healthy: record.healthy,
    compatible: record.compatible,
    entitled: record.entitlementState,
    reasonCode: record.reasonCode,
    revision: integer(record.revision),
  });
}

function databaseTenantApplicationStatus(
  installation: PluginInstallation,
  enablement?: PluginTenantEnablement | null,
): PluginTenantApplicationV1['status'] {
  if (installation.entitlementState === 'revoked') return 'revoked';
  if (
    !installation.compatible ||
    ['expired', 'unavailable'].includes(installation.entitlementState)
  ) {
    return 'blocked';
  }
  if (
    !installation.desiredEnabled ||
    !['enabled', 'degraded'].includes(installation.state)
  ) {
    return ['active', 'grace'].includes(installation.entitlementState)
      ? 'entitled'
      : 'install-pending';
  }
  if (enablement?.activationRequestState === 'pending') return 'requested';
  if (enablement?.enabled) return 'active';
  return enablement ? 'inactive' : 'available';
}

function databaseTenantApplication(
  installation: PluginInstallation,
  enablement: PluginTenantEnablement | null | undefined,
  tenantSlug: string,
): PluginTenantApplicationV1 {
  return pluginTenantApplicationV1Schema.parse({
    apiVersion: 'tenant-application.plugin.enterpriseglue.io/v1',
    pluginId: installation.pluginId,
    version: installation.version,
    displayName: installation.displayName,
    publisher: installation.publisher,
    status: databaseTenantApplicationStatus(installation, enablement),
    active: enablement?.enabled ?? false,
    compatible: installation.compatible,
    healthy: installation.healthy,
    entitled: installation.entitlementState,
    reasonCode: installation.reasonCode,
    revision: enablement ? integer(enablement.revision) : 0,
    activationRequest: {
      state: enablement?.activationRequestState ?? 'none',
      requestedAt: enablement?.requestedAt === null || enablement?.requestedAt === undefined
        ? null
        : new Date(integer(enablement.requestedAt)).toISOString(),
      reviewedAt: enablement?.reviewedAt === null || enablement?.reviewedAt === undefined
        ? null
        : new Date(integer(enablement.reviewedAt)).toISOString(),
    },
    configuration: {
      available: Boolean(installation.tenantConfigurationPath),
      schemaSha256: installation.tenantConfigurationSchemaSha256,
      href: installation.tenantConfigurationPath
        ? `/t/${encodeURIComponent(tenantSlug)}/${installation.tenantConfigurationPath}`
        : null,
      owner: 'plugin',
    },
  });
}

function toAudit(record: PluginPlatformAudit): PluginPlatformAuditEventV1 {
  return pluginPlatformAuditEventV1Schema.parse({
    eventId: record.id,
    eventType: record.eventType,
    pluginId: record.pluginId,
    tenantScoped: record.tenantRef !== null,
    actorRef: record.actorRef,
    correlationId: record.correlationId,
    fromState: record.fromState,
    toState: record.toState,
    reasonCode: record.reasonCode,
    occurredAt: new Date(integer(record.occurredAt)).toISOString(),
  });
}

function toOperation(
  record: PluginLifecycleOperationEntity,
): PluginLifecycleOperationV1 {
  return pluginLifecycleOperationV1Schema.parse({
    operationId: record.id,
    pluginId: record.pluginId,
    type: record.type,
    status: record.status,
    reasonCode: record.reasonCode,
    createdAt: new Date(integer(record.createdAt)).toISOString(),
    updatedAt: new Date(integer(record.updatedAt)).toISOString(),
  });
}

function toEmergencyState(input: {
  disabled: boolean;
  revision: number;
  occurredAt: number;
}): PluginPlatformEmergencyStateV1 {
  return pluginPlatformEmergencyStateV1Schema.parse({
    apiVersion: 'emergency-control.plugin.enterpriseglue.io/v1',
    disabled: input.disabled,
    revision: input.revision,
    reasonCode: input.disabled ? 'emergency_disabled' : 'none',
    updatedAt: new Date(input.occurredAt).toISOString(),
  });
}

async function appendAudit(
  manager: EntityManager,
  input: {
    eventType: string;
    pluginId: string | null;
    tenantRef?: string;
    actorRef: string;
    correlationId: string;
    fromState: string | null;
    toState: string | null;
    reasonCode: string;
    occurredAt: number;
  },
): Promise<void> {
  await manager.getRepository(PluginPlatformAudit).insert({
    id: randomUUID(),
    eventType: input.eventType,
    pluginId: input.pluginId,
    tenantRef: input.tenantRef ?? null,
    actorRef: input.actorRef,
    correlationId: input.correlationId,
    fromState: input.fromState,
    toState: input.toState,
    reasonCode: input.reasonCode,
    occurredAt: input.occurredAt,
  });
}

function integer(value: number | string | null): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Plugin control persistence contains an invalid integer');
  }
  return parsed;
}

function hashGrantSet(permissions: readonly string[]): string {
  return createHash('sha256')
    .update([...permissions].sort().join('\0'), 'utf8')
    .digest('hex');
}

function installerSnapshotHash(
  snapshot: PluginControlSourceSnapshotV1,
): string {
  const fingerprints = [...snapshot.records]
    .sort((left, right) => left.pluginId.localeCompare(right.pluginId))
    .map((source) =>
      createHash('sha256')
        .update(
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
            tenantConfiguration: source.tenantConfiguration ?? null,
            grantSetHash: hashGrantSet(source.grantedPermissions),
          }),
          'utf8',
        )
        .digest('hex'),
    );
  return createHash('sha256')
    .update(JSON.stringify(fingerprints), 'utf8')
    .digest('hex');
}
