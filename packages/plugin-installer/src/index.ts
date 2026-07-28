import { createHash } from 'node:crypto';

import {
  ociDigestReferenceSchema,
  parseEnterpriseGluePluginManifestV1,
  pluginIdSchema,
  pluginPermissionGrantSetV1Schema,
  pluginResourceDescriptorV1Schema,
  type EnterpriseGluePluginManifestV1,
  type PluginCatalogReleaseV1,
  type PluginId,
  type PluginPermissionV1,
  type PluginResourceDescriptorV1,
} from '@enterpriseglue/plugin-sdk';
import {
  resolvePluginRelationshipsV1,
  type PluginResolutionIssueV1,
} from '@enterpriseglue/plugin-runtime';
import { stringify } from 'yaml';

export type PluginInstallerErrorCode =
  | 'manifest_digest_invalid'
  | 'manifest_identity_invalid'
  | 'resource_digest_invalid'
  | 'resource_policy_mismatch'
  | 'permission_grant_invalid'
  | 'backend_required'
  | 'plugin_already_installed'
  | 'plugin_not_installed'
  | 'no_rollback_version'
  | 'dependency_missing'
  | 'dependency_incompatible'
  | 'dependency_cycle'
  | 'plugin_conflict'
  | 'plugin_relationship_invalid'
  | 'migration_schema_incompatible'
  | 'migration_rollback_unsupported'
  | 'storage_layout_incompatible'
  | 'unsafe_asset_path';

export class PluginInstallerError extends Error {
  constructor(
    public readonly code: PluginInstallerErrorCode,
    message: string,
    public readonly issues: readonly PluginResolutionIssueV1[] = [],
  ) {
    super(message);
    this.name = 'PluginInstallerError';
  }
}

export interface VerifiedPluginInstallInputV1 {
  release: PluginCatalogReleaseV1;
  manifestBytes: Uint8Array;
  manifest: unknown;
  resourceBytes: Uint8Array;
  resources: unknown;
  grantedPermissions: readonly PluginPermissionV1[];
  stagedAssetPath: string;
}

export interface InstalledPluginRecordV1 {
  pluginId: PluginId;
  version: string;
  bundle: string;
  manifestSha256: string;
  manifest: EnterpriseGluePluginManifestV1;
  resources: PluginResourceDescriptorV1;
  grantedPermissions: PluginPermissionV1[];
  stagedAssetPath: string;
  dataSchemaVersion: number;
  enabled: boolean;
  installedAt: string;
}

export interface PluginInstallerHistoryV1 {
  operation: 'install' | 'upgrade' | 'rollback' | 'disable' | 'enable' | 'uninstall';
  pluginId: PluginId;
  fromVersion?: string;
  toVersion?: string;
  dataAction?: 'retain' | 'export' | 'delete';
  occurredAt: string;
}

export type PluginDeploymentLifecyclePhaseV1 =
  | 'stage'
  | 'checkpoint'
  | 'migrate'
  | 'ready'
  | 'activate'
  | 'drain'
  | 'deactivate'
  | 'retain_data'
  | 'export_data'
  | 'delete_data'
  | 'remove'
  | 'commit';

export interface PluginDeploymentLifecyclePlanV1 {
  apiVersion: 'lifecycle-plan.plugin.enterpriseglue.io/v1';
  kind: 'EnterpriseGluePluginLifecyclePlan';
  operation: PluginInstallerHistoryV1['operation'];
  pluginId: PluginId;
  fromVersion?: string;
  toVersion?: string;
  fromDataSchema: number;
  toDataSchema: number;
  migrationImage?: string;
  rollbackSupported: boolean;
  phases: PluginDeploymentLifecyclePhaseV1[];
  dataAction?: 'retain' | 'export' | 'delete';
}

export interface PluginInstallerStateV1 {
  schemaVersion: 1;
  revision: number;
  imageMappings: Record<string, string>;
  plugins: Record<string, InstalledPluginRecordV1>;
  previous: Record<string, InstalledPluginRecordV1[]>;
  history: PluginInstallerHistoryV1[];
  lifecyclePlan?: PluginDeploymentLifecyclePlanV1;
}

export interface PluginOverlayRenderOptionsV1 {
  hostBackendService: string;
  assetMountRoot: string;
  stateSourcePath: string;
  stateMountPath: string;
  executionObservationSourcePath: string;
  executionObservationMountPath: string;
  invocationPrivateKeySourcePath: string;
  invocationPrivateKeyMountPath: string;
  invocationPublicKeySourcePath: string;
  invocationPublicKeyMountPath: string;
  secretBrokerPolicySourcePath: string;
  secretBrokerPolicyMountPath: string;
  secretBrokerSecretRootSourcePath: string;
  secretBrokerSecretRootMountPath: string;
  deploymentFileSourceRoot: string;
  deploymentFileMountRoot: string;
  hostBackendInternalUrl: string;
  gatewayNetwork: string;
  egressNetworkPrefix: string;
  engineEventPollingEnabled: boolean;
}

export const defaultPluginOverlayRenderOptionsV1: PluginOverlayRenderOptionsV1 =
  {
    hostBackendService: 'backend',
    assetMountRoot: '/var/lib/enterpriseglue/plugins',
    stateSourcePath: './plugin-installer-state.json',
    stateMountPath: '/etc/enterpriseglue/plugins/plugin-installer-state.json',
    executionObservationSourcePath:
      './plugin-lifecycle-observation.json',
    executionObservationMountPath:
      '/etc/enterpriseglue/plugins/plugin-lifecycle-observation.json',
    invocationPrivateKeySourcePath: './plugin-invocation-private.pem',
    invocationPrivateKeyMountPath:
      '/run/enterpriseglue/plugin-gateway/invocation-private.pem',
    invocationPublicKeySourcePath: './plugin-invocation-public.pem',
    invocationPublicKeyMountPath:
      '/etc/enterpriseglue/plugin-gateway/invocation-public.pem',
    secretBrokerPolicySourcePath: './plugin-secret-broker-policy.json',
    secretBrokerPolicyMountPath:
      '/etc/enterpriseglue/plugins/plugin-secret-broker-policy.json',
    secretBrokerSecretRootSourcePath: './plugin-broker-secrets',
    secretBrokerSecretRootMountPath:
      '/run/enterpriseglue/plugin-broker/secrets',
    deploymentFileSourceRoot: './plugin-config-files',
    deploymentFileMountRoot: '/etc/enterpriseglue/plugin-config',
    hostBackendInternalUrl: 'http://backend:8787',
    gatewayNetwork: 'enterpriseglue-plugin-gateway',
    egressNetworkPrefix: 'enterpriseglue-plugin-egress-',
    engineEventPollingEnabled: false,
  };

function hash(payload: Uint8Array): string {
  return createHash('sha256').update(payload).digest('hex');
}

function slug(pluginId: string): string {
  return pluginId.replace(/\./g, '-');
}

export function pluginComposeServiceNameV1(pluginId: PluginId): string {
  return `eg-plugin-${slug(pluginId)}`;
}

export function pluginComposeVolumeKeyV1(
  pluginId: PluginId,
  dataSchemaVersion: number,
  storageName: string,
): string {
  if (!Number.isInteger(dataSchemaVersion) || dataSchemaVersion < 0) {
    throw new Error('Plugin data-schema version must be a non-negative integer');
  }
  if (!/^[a-z][a-z0-9-]*$/.test(storageName)) {
    throw new Error('Plugin storage name is invalid');
  }
  const schema =
    dataSchemaVersion === 0 ? '' : `-schema-${dataSchemaVersion}`;
  return `eg-plugin-${slug(pluginId)}${schema}-${storageName}`;
}

function kubernetesBoundedName(
  base: string,
  identity: string,
): string {
  if (base.length <= 63) return base;
  const suffix = hash(Buffer.from(identity)).slice(0, 10);
  return `${base.slice(0, 52).replace(/-+$/g, '')}-${suffix}`;
}

export function pluginKubernetesResourceNameV1(
  pluginId: PluginId,
): string {
  return kubernetesBoundedName(
    `eg-plugin-${slug(pluginId)}`,
    pluginId,
  );
}

export function pluginKubernetesPvcNameV1(
  pluginId: PluginId,
  dataSchemaVersion: number,
  storageName: string,
): string {
  if (!Number.isInteger(dataSchemaVersion) || dataSchemaVersion < 0) {
    throw new Error('Plugin data-schema version must be a non-negative integer');
  }
  if (!/^[a-z][a-z0-9-]*$/.test(storageName)) {
    throw new Error('Plugin storage name is invalid');
  }
  const schema =
    dataSchemaVersion === 0 ? '' : `-schema-${dataSchemaVersion}`;
  return kubernetesBoundedName(
    `${pluginKubernetesResourceNameV1(
      pluginId,
    )}${schema}-${storageName}`,
    `${pluginId}:${dataSchemaVersion}:${storageName}`,
  );
}

function assertSafeStagedAssetPath(path: string): void {
  if (
    !path.startsWith('./') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((segment) => segment === '..')
  ) {
    throw new PluginInstallerError(
      'unsafe_asset_path',
      'Staged asset path must be a safe relative deployment-owned path',
    );
  }
}

export function emptyPluginInstallerStateV1(): PluginInstallerStateV1 {
  return {
    schemaVersion: 1,
    revision: 0,
    imageMappings: {},
    plugins: {},
    previous: {},
    history: [],
  };
}

const lifecycleOperations = new Set<PluginInstallerHistoryV1['operation']>([
  'install',
  'upgrade',
  'rollback',
  'disable',
  'enable',
  'uninstall',
]);
const lifecyclePhases = new Set<PluginDeploymentLifecyclePhaseV1>([
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
]);

function expectedLifecyclePlanPhases(
  plan: PluginDeploymentLifecyclePlanV1,
): PluginDeploymentLifecyclePhaseV1[] | undefined {
  const migrate = plan.migrationImage ? (['migrate'] as const) : [];
  if (plan.operation === 'install') {
    return ['stage', ...migrate, 'commit'];
  }
  if (plan.operation === 'upgrade' || plan.operation === 'rollback') {
    const withoutRuntime: PluginDeploymentLifecyclePhaseV1[] = [
      'stage',
      'checkpoint',
      ...migrate,
      'commit',
    ];
    const withRuntime: PluginDeploymentLifecyclePhaseV1[] = [
      'stage',
      'drain',
      'deactivate',
      'checkpoint',
      ...migrate,
      'activate',
      'ready',
      'commit',
    ];
    return plan.phases.length === withRuntime.length
      ? withRuntime
      : withoutRuntime;
  }
  if (plan.operation === 'enable') return ['activate', 'ready', 'commit'];
  if (plan.operation === 'disable') {
    return ['drain', 'deactivate', 'commit'];
  }
  if (!plan.dataAction) return undefined;
  const dataPhase = {
    retain: 'retain_data',
    export: 'export_data',
    delete: 'delete_data',
  } as const;
  const withoutRuntime: PluginDeploymentLifecyclePhaseV1[] = [
    dataPhase[plan.dataAction],
    'remove',
    'commit',
  ];
  const withRuntime = [
    'drain',
    'deactivate',
    ...withoutRuntime,
  ] as PluginDeploymentLifecyclePhaseV1[];
  return plan.phases.length === withRuntime.length
    ? withRuntime
    : withoutRuntime;
}

export function parsePluginDeploymentLifecyclePlanV1(
  input: unknown,
): PluginDeploymentLifecyclePlanV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Plugin deployment lifecycle plan must be an object');
  }
  const plan = input as Partial<PluginDeploymentLifecyclePlanV1>;
  if (
    plan.apiVersion !== 'lifecycle-plan.plugin.enterpriseglue.io/v1' ||
    plan.kind !== 'EnterpriseGluePluginLifecyclePlan' ||
    !lifecycleOperations.has(plan.operation!) ||
    !Number.isInteger(plan.fromDataSchema) ||
    (plan.fromDataSchema ?? -1) < 0 ||
    !Number.isInteger(plan.toDataSchema) ||
    (plan.toDataSchema ?? -1) < 0 ||
    typeof plan.rollbackSupported !== 'boolean' ||
    !Array.isArray(plan.phases) ||
    plan.phases.length === 0 ||
    plan.phases.some((phase) => !lifecyclePhases.has(phase)) ||
    plan.phases.at(-1) !== 'commit' ||
    plan.phases.includes('migrate') !==
      (plan.migrationImage !== undefined) ||
    (plan.fromVersion !== undefined && typeof plan.fromVersion !== 'string') ||
    (plan.toVersion !== undefined && typeof plan.toVersion !== 'string') ||
    (plan.dataAction !== undefined &&
      !['retain', 'export', 'delete'].includes(plan.dataAction))
  ) {
    throw new Error('Plugin deployment lifecycle plan is invalid');
  }
  pluginIdSchema.parse(plan.pluginId);
  if (plan.migrationImage !== undefined) {
    ociDigestReferenceSchema.parse(plan.migrationImage);
  }
  const expectedPhases = expectedLifecyclePlanPhases(
    plan as PluginDeploymentLifecyclePlanV1,
  );
  if (
    !expectedPhases ||
    expectedPhases.length !== plan.phases.length ||
    expectedPhases.some(
      (phase, index) => plan.phases![index] !== phase,
    ) ||
    (plan.operation === 'uninstall') !==
      (plan.dataAction !== undefined)
  ) {
    throw new Error('Plugin deployment lifecycle plan semantics are invalid');
  }
  return structuredClone(plan as PluginDeploymentLifecyclePlanV1);
}

export function parsePluginInstallerStateV1(
  input: unknown,
): PluginInstallerStateV1 {
  if (!input || typeof input !== 'object') {
    throw new Error('Plugin installer state must be an object');
  }
  const candidate = input as Partial<PluginInstallerStateV1>;
  if (
    candidate.schemaVersion !== 1 ||
    !Number.isInteger(candidate.revision) ||
    (candidate.revision ?? -1) < 0 ||
    (candidate.imageMappings !== undefined &&
      (!candidate.imageMappings ||
        typeof candidate.imageMappings !== 'object' ||
        Array.isArray(candidate.imageMappings))) ||
    !candidate.plugins ||
    typeof candidate.plugins !== 'object' ||
    Array.isArray(candidate.plugins) ||
    !candidate.previous ||
    typeof candidate.previous !== 'object' ||
    Array.isArray(candidate.previous) ||
    !Array.isArray(candidate.history)
  ) {
    throw new Error('Plugin installer state has an invalid structure');
  }
  const imageMappings = validatePluginImageMappingsV1(
    candidate.imageMappings ?? {},
  );
  const lifecyclePlan =
    candidate.lifecyclePlan === undefined
      ? undefined
      : parsePluginDeploymentLifecyclePlanV1(candidate.lifecyclePlan);

  for (const [pluginId, record] of Object.entries(candidate.plugins)) {
    if (
      !record ||
      record.pluginId !== pluginId ||
      typeof record.version !== 'string' ||
      typeof record.bundle !== 'string' ||
      typeof record.manifestSha256 !== 'string' ||
      typeof record.stagedAssetPath !== 'string' ||
      (record.dataSchemaVersion !== undefined &&
        (!Number.isInteger(record.dataSchemaVersion) ||
          record.dataSchemaVersion < 0)) ||
      !Array.isArray(record.grantedPermissions) ||
      typeof record.enabled !== 'boolean' ||
      typeof record.installedAt !== 'string'
    ) {
      throw new Error(`Plugin installer record ${pluginId} is invalid`);
    }
    const manifest = parseEnterpriseGluePluginManifestV1(record.manifest);
    const resources = pluginResourceDescriptorV1Schema.parse(record.resources);
    const grants = pluginPermissionGrantSetV1Schema.parse({
      apiVersion: 'permission-grants.plugin.enterpriseglue.io/v1',
      pluginId,
      permissions: record.grantedPermissions,
    });
    if (
      manifest.metadata.id !== pluginId ||
      manifest.metadata.version !== record.version ||
      manifest.network.egressPolicy !== resources.network.egressPolicy ||
      (manifest.deployment.migration &&
        record.dataSchemaVersion !== undefined &&
        record.dataSchemaVersion !== manifest.deployment.migration.toSchema)
    ) {
      throw new Error(`Plugin installer record ${pluginId} is inconsistent`);
    }
    assertPermissionGrants(manifest, grants.permissions);
    assertSafeStagedAssetPath(record.stagedAssetPath);
  }
  for (const [pluginId, records] of Object.entries(candidate.previous)) {
    if (!Array.isArray(records) || records.length > 3) {
      throw new Error(`Plugin installer history for ${pluginId} is invalid`);
    }
    for (const record of records) {
      if (
        !record ||
        record.pluginId !== pluginId ||
        typeof record.version !== 'string' ||
        typeof record.bundle !== 'string' ||
        typeof record.manifestSha256 !== 'string' ||
        typeof record.stagedAssetPath !== 'string' ||
        typeof record.enabled !== 'boolean' ||
        typeof record.installedAt !== 'string'
      ) {
        throw new Error(`Plugin installer history for ${pluginId} is inconsistent`);
      }
      const manifest = parseEnterpriseGluePluginManifestV1(record.manifest);
      const resources = pluginResourceDescriptorV1Schema.parse(record.resources);
      if (
        !Array.isArray(record.grantedPermissions) ||
        (record.dataSchemaVersion !== undefined &&
          (!Number.isInteger(record.dataSchemaVersion) ||
            record.dataSchemaVersion < 0))
      ) {
        throw new Error(`Plugin installer history for ${pluginId} has invalid grants`);
      }
      if (
        manifest.metadata.id !== pluginId ||
        manifest.metadata.version !== record.version ||
        manifest.network.egressPolicy !== resources.network.egressPolicy ||
        (manifest.deployment.migration &&
          record.dataSchemaVersion !== undefined &&
          record.dataSchemaVersion !== manifest.deployment.migration.toSchema)
      ) {
        throw new Error(`Plugin installer history for ${pluginId} is inconsistent`);
      }
      assertPermissionGrants(manifest, record.grantedPermissions);
      assertSafeStagedAssetPath(record.stagedAssetPath);
    }
  }

  const state = structuredClone({
    ...(candidate as PluginInstallerStateV1),
    imageMappings,
    lifecyclePlan,
  });
  for (const record of Object.values(state.plugins)) {
    record.dataSchemaVersion ??=
      record.manifest.deployment.migration?.toSchema ?? 0;
  }
  for (const records of Object.values(state.previous)) {
    for (const record of records) {
      record.dataSchemaVersion ??=
        record.manifest.deployment.migration?.toSchema ?? 0;
    }
  }
  assertDesiredPluginState(state);
  return state;
}

function digestFromReference(reference: string): string {
  return reference.slice(reference.lastIndexOf('@sha256:') + 8);
}

export function validatePluginImageMappingsV1(
  input: Record<string, string>,
): Record<string, string> {
  const mappings: Record<string, string> = {};
  for (const [sourceInput, targetInput] of Object.entries(input)) {
    const source = ociDigestReferenceSchema.parse(sourceInput);
    const target = ociDigestReferenceSchema.parse(targetInput);
    if (digestFromReference(source) !== digestFromReference(target)) {
      throw new Error(
        'Air-gap image mapping must preserve the immutable source digest',
      );
    }
    mappings[source] = target;
  }
  return Object.fromEntries(
    Object.entries(mappings).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export function withPluginImageMappingsV1(
  state: PluginInstallerStateV1,
  mappings: Record<string, string>,
): PluginInstallerStateV1 {
  return {
    ...structuredClone(state),
    imageMappings: validatePluginImageMappingsV1(mappings),
  };
}

function mappedImageReference(
  state: PluginInstallerStateV1,
  source: string,
): string {
  return state.imageMappings[source] ?? source;
}

function assertPermissionGrants(
  manifest: EnterpriseGluePluginManifestV1,
  grantedPermissions: readonly PluginPermissionV1[],
): void {
  const granted = new Set(grantedPermissions);
  const declared = new Set([
    ...manifest.permissions.required,
    ...manifest.permissions.optional,
  ]);
  if (
    granted.size !== grantedPermissions.length ||
    manifest.permissions.required.some((permission) => !granted.has(permission)) ||
    grantedPermissions.some((permission) => !declared.has(permission))
  ) {
    throw new PluginInstallerError(
      'permission_grant_invalid',
      'Permission grants must include every required permission and only declared optional permissions',
    );
  }
}

export function verifyPluginInstallInputV1(
  input: VerifiedPluginInstallInputV1,
): InstalledPluginRecordV1 {
  if (hash(input.manifestBytes) !== input.release.manifestSha256) {
    throw new PluginInstallerError(
      'manifest_digest_invalid',
      'Plugin manifest digest differs from the verified catalog',
    );
  }
  const manifest = parseEnterpriseGluePluginManifestV1(input.manifest);
  if (
    manifest.metadata.version !== input.release.version ||
    manifest.compatibility.host !== input.release.hostCompatibility ||
    manifest.compatibility.sdk !== input.release.sdkCompatibility
  ) {
    throw new PluginInstallerError(
      'manifest_identity_invalid',
      'Plugin manifest identity/compatibility differs from the verified catalog',
    );
  }
  if (!manifest.deployment.backend || !manifest.deployment.resources) {
    throw new PluginInstallerError(
      'backend_required',
      'Initial plugin installation requires isolated backend and resource descriptors',
    );
  }
  if (hash(input.resourceBytes) !== manifest.deployment.resources.sha256) {
    throw new PluginInstallerError(
      'resource_digest_invalid',
      'Plugin resource descriptor differs from the signed manifest',
    );
  }
  const resources = pluginResourceDescriptorV1Schema.parse(input.resources);
  if (resources.network.egressPolicy !== manifest.network.egressPolicy) {
    throw new PluginInstallerError(
      'resource_policy_mismatch',
      'Resource descriptor egress policy differs from the signed manifest',
    );
  }
  assertSafeStagedAssetPath(input.stagedAssetPath);
  assertPermissionGrants(manifest, input.grantedPermissions);

  return {
    pluginId: manifest.metadata.id,
    version: manifest.metadata.version,
    bundle: input.release.bundle,
    manifestSha256: input.release.manifestSha256,
    manifest,
    resources,
    grantedPermissions: [...input.grantedPermissions].sort(),
    stagedAssetPath: input.stagedAssetPath,
    dataSchemaVersion: manifest.deployment.migration?.toSchema ?? 0,
    enabled: false,
    installedAt: new Date(0).toISOString(),
  };
}

function copyState(state: PluginInstallerStateV1): PluginInstallerStateV1 {
  return structuredClone(state);
}

function lifecyclePlan(
  input: Omit<
    PluginDeploymentLifecyclePlanV1,
    'apiVersion' | 'kind'
  >,
): PluginDeploymentLifecyclePlanV1 {
  return {
    apiVersion: 'lifecycle-plan.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginLifecyclePlan',
    ...input,
  };
}

function assertStorageLayoutCompatible(
  source: InstalledPluginRecordV1,
  target: InstalledPluginRecordV1,
): void {
  const normalize = (record: InstalledPluginRecordV1) =>
    [...record.resources.storage].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  if (JSON.stringify(normalize(source)) !== JSON.stringify(normalize(target))) {
    throw new PluginInstallerError(
      'storage_layout_incompatible',
      `Plugin ${source.pluginId} storage declarations cannot change during upgrade or rollback`,
    );
  }
}

export function planPluginInstallV1(
  record: InstalledPluginRecordV1,
): PluginDeploymentLifecyclePlanV1 {
  const migration = record.manifest.deployment.migration;
  if (migration && migration.fromSchema !== 0) {
    throw new PluginInstallerError(
      'migration_schema_incompatible',
      `Plugin ${record.pluginId} initial install migration must start at schema 0`,
    );
  }
  const toDataSchema = migration?.toSchema ?? 0;
  return lifecyclePlan({
    operation: 'install',
    pluginId: record.pluginId,
    toVersion: record.version,
    fromDataSchema: 0,
    toDataSchema,
    migrationImage: migration?.image,
    rollbackSupported: true,
    phases: ['stage', ...(migration ? (['migrate'] as const) : []), 'commit'],
  });
}

export function planPluginUpgradeV1(
  current: InstalledPluginRecordV1,
  target: InstalledPluginRecordV1,
): PluginDeploymentLifecyclePlanV1 {
  assertStorageLayoutCompatible(current, target);
  const migration = target.manifest.deployment.migration;
  if (migration && migration.fromSchema !== current.dataSchemaVersion) {
    throw new PluginInstallerError(
      'migration_schema_incompatible',
      `Plugin ${target.pluginId} migration starts at schema ${migration.fromSchema}, but installed schema is ${current.dataSchemaVersion}`,
    );
  }
  const toDataSchema = migration?.toSchema ?? current.dataSchemaVersion;
  const rollbackSupported =
    toDataSchema === current.dataSchemaVersion ||
    Boolean(
      migration &&
        current.dataSchemaVersion >= migration.rollbackThrough,
    );
  return lifecyclePlan({
    operation: 'upgrade',
    pluginId: target.pluginId,
    fromVersion: current.version,
    toVersion: target.version,
    fromDataSchema: current.dataSchemaVersion,
    toDataSchema,
    migrationImage: migration?.image,
    rollbackSupported,
    phases: [
      'stage',
      ...(current.enabled ? (['drain', 'deactivate'] as const) : []),
      'checkpoint',
      ...(migration ? (['migrate'] as const) : []),
      ...(current.enabled ? (['activate', 'ready'] as const) : []),
      'commit',
    ],
  });
}

export function planPluginRollbackV1(
  current: InstalledPluginRecordV1,
  target: InstalledPluginRecordV1,
): PluginDeploymentLifecyclePlanV1 {
  assertStorageLayoutCompatible(current, target);
  const schemaChanged = current.dataSchemaVersion !== target.dataSchemaVersion;
  const migration = current.manifest.deployment.migration;
  if (
    schemaChanged &&
    (!migration ||
      target.dataSchemaVersion < migration.rollbackThrough ||
      target.dataSchemaVersion > current.dataSchemaVersion)
  ) {
    throw new PluginInstallerError(
      'migration_rollback_unsupported',
      `Plugin ${current.pluginId} cannot roll schema ${current.dataSchemaVersion} back to ${target.dataSchemaVersion}`,
    );
  }
  return lifecyclePlan({
    operation: 'rollback',
    pluginId: current.pluginId,
    fromVersion: current.version,
    toVersion: target.version,
    fromDataSchema: current.dataSchemaVersion,
    toDataSchema: target.dataSchemaVersion,
    migrationImage: schemaChanged ? migration?.image : undefined,
    rollbackSupported: true,
    phases: [
      'stage',
      ...(current.enabled ? (['drain', 'deactivate'] as const) : []),
      'checkpoint',
      ...(schemaChanged ? (['migrate'] as const) : []),
      ...(current.enabled ? (['activate', 'ready'] as const) : []),
      'commit',
    ],
  });
}

export function planPluginEnablementV1(
  record: InstalledPluginRecordV1,
  enabled: boolean,
): PluginDeploymentLifecyclePlanV1 {
  return lifecyclePlan({
    operation: enabled ? 'enable' : 'disable',
    pluginId: record.pluginId,
    fromVersion: record.version,
    toVersion: record.version,
    fromDataSchema: record.dataSchemaVersion,
    toDataSchema: record.dataSchemaVersion,
    rollbackSupported: true,
    phases: enabled
      ? ['activate', 'ready', 'commit']
      : ['drain', 'deactivate', 'commit'],
  });
}

export function planPluginUninstallV1(
  record: InstalledPluginRecordV1,
  dataAction: 'retain' | 'export' | 'delete',
): PluginDeploymentLifecyclePlanV1 {
  const dataPhase = {
    retain: 'retain_data',
    export: 'export_data',
    delete: 'delete_data',
  } as const;
  return lifecyclePlan({
    operation: 'uninstall',
    pluginId: record.pluginId,
    fromVersion: record.version,
    fromDataSchema: record.dataSchemaVersion,
    toDataSchema: 0,
    rollbackSupported: dataAction !== 'delete',
    dataAction,
    phases: [
      ...(record.enabled
        ? (['drain', 'deactivate'] as const)
        : []),
      dataPhase[dataAction],
      'remove',
      'commit',
    ],
  });
}

function relationshipErrorCode(
  issue: PluginResolutionIssueV1,
): PluginInstallerErrorCode {
  switch (issue.code) {
    case 'missing_dependency':
      return 'dependency_missing';
    case 'incompatible_dependency':
      return 'dependency_incompatible';
    case 'dependency_cycle':
      return 'dependency_cycle';
    case 'plugin_conflict':
      return 'plugin_conflict';
    default:
      return 'plugin_relationship_invalid';
  }
}

function assertPluginRelationships(
  records: readonly InstalledPluginRecordV1[],
  scope: 'installed' | 'enabled',
): void {
  const resolution = resolvePluginRelationshipsV1(
    records.map((record) => record.manifest),
  );
  if (resolution.compatible) return;

  const primary = resolution.issues[0]!;
  const related = primary.relatedPluginId
    ? ` and ${primary.relatedPluginId}`
    : '';
  throw new PluginInstallerError(
    relationshipErrorCode(primary),
    `Plugin ${scope} set is invalid: ${primary.pluginId}${related} (${primary.code})`,
    resolution.issues,
  );
}

function assertDesiredPluginState(state: PluginInstallerStateV1): void {
  const records = Object.values(state.plugins);
  assertPluginRelationships(records, 'installed');
  assertPluginRelationships(
    records.filter((record) => record.enabled),
    'enabled',
  );
}

function addHistory(
  state: PluginInstallerStateV1,
  event: PluginInstallerHistoryV1,
): void {
  state.history.push(event);
  if (state.history.length > 1_000) {
    state.history = state.history.slice(-1_000);
  }
}

export function installPluginV1(
  stateInput: PluginInstallerStateV1,
  recordInput: InstalledPluginRecordV1,
  occurredAt: string,
): PluginInstallerStateV1 {
  const state = copyState(stateInput);
  if (state.plugins[recordInput.pluginId]) {
    throw new PluginInstallerError(
      'plugin_already_installed',
      `Plugin ${recordInput.pluginId} is already installed`,
    );
  }
  const record = structuredClone(recordInput);
  const plan = planPluginInstallV1(record);
  record.dataSchemaVersion = plan.toDataSchema;
  record.installedAt = occurredAt;
  state.plugins[record.pluginId] = record;
  state.previous[record.pluginId] = [];
  assertDesiredPluginState(state);
  state.lifecyclePlan = plan;
  state.revision += 1;
  addHistory(state, {
    operation: 'install',
    pluginId: record.pluginId,
    toVersion: record.version,
    occurredAt,
  });
  return state;
}

export function upgradePluginV1(
  stateInput: PluginInstallerStateV1,
  recordInput: InstalledPluginRecordV1,
  occurredAt: string,
): PluginInstallerStateV1 {
  const state = copyState(stateInput);
  const current = state.plugins[recordInput.pluginId];
  if (!current) {
    throw new PluginInstallerError(
      'plugin_not_installed',
      `Plugin ${recordInput.pluginId} is not installed`,
    );
  }
  const plan = planPluginUpgradeV1(current, recordInput);
  const previous = state.previous[recordInput.pluginId] ?? [];
  previous.push(structuredClone(current));
  state.previous[recordInput.pluginId] = previous.slice(-3);

  const replacement = structuredClone(recordInput);
  replacement.dataSchemaVersion = plan.toDataSchema;
  replacement.enabled = current.enabled;
  replacement.installedAt = occurredAt;
  state.plugins[replacement.pluginId] = replacement;
  assertDesiredPluginState(state);
  state.lifecyclePlan = plan;
  state.revision += 1;
  addHistory(state, {
    operation: 'upgrade',
    pluginId: replacement.pluginId,
    fromVersion: current.version,
    toVersion: replacement.version,
    occurredAt,
  });
  return state;
}

export function rollbackPluginV1(
  stateInput: PluginInstallerStateV1,
  pluginId: PluginId,
  occurredAt: string,
): PluginInstallerStateV1 {
  const state = copyState(stateInput);
  const current = state.plugins[pluginId];
  if (!current) {
    throw new PluginInstallerError(
      'plugin_not_installed',
      `Plugin ${pluginId} is not installed`,
    );
  }
  const previous = state.previous[pluginId] ?? [];
  const replacement = previous.pop();
  if (!replacement) {
    throw new PluginInstallerError(
      'no_rollback_version',
      `Plugin ${pluginId} has no rollback version`,
    );
  }
  const plan = planPluginRollbackV1(current, replacement);
  replacement.enabled = current.enabled;
  state.plugins[pluginId] = replacement;
  state.previous[pluginId] = [
    ...previous,
    structuredClone(current),
  ].slice(-3);
  assertDesiredPluginState(state);
  state.lifecyclePlan = plan;
  state.revision += 1;
  addHistory(state, {
    operation: 'rollback',
    pluginId,
    fromVersion: current.version,
    toVersion: replacement.version,
    occurredAt,
  });
  return state;
}

export function setPluginEnabledV1(
  stateInput: PluginInstallerStateV1,
  pluginId: PluginId,
  enabled: boolean,
  occurredAt: string,
): PluginInstallerStateV1 {
  const state = copyState(stateInput);
  const record = state.plugins[pluginId];
  if (!record) {
    throw new PluginInstallerError(
      'plugin_not_installed',
      `Plugin ${pluginId} is not installed`,
    );
  }
  const plan = planPluginEnablementV1(record, enabled);
  record.enabled = enabled;
  assertDesiredPluginState(state);
  state.lifecyclePlan = plan;
  state.revision += 1;
  addHistory(state, {
    operation: enabled ? 'enable' : 'disable',
    pluginId,
    fromVersion: record.version,
    toVersion: record.version,
    occurredAt,
  });
  return state;
}

export function uninstallPluginV1(
  stateInput: PluginInstallerStateV1,
  pluginId: PluginId,
  dataAction: 'retain' | 'export' | 'delete',
  occurredAt: string,
): PluginInstallerStateV1 {
  const state = copyState(stateInput);
  const current = state.plugins[pluginId];
  if (!current) {
    throw new PluginInstallerError(
      'plugin_not_installed',
      `Plugin ${pluginId} is not installed`,
    );
  }
  const plan = planPluginUninstallV1(current, dataAction);
  delete state.plugins[pluginId];
  state.previous[pluginId] = [
    ...(state.previous[pluginId] ?? []),
    structuredClone(current),
  ].slice(-3);
  assertDesiredPluginState(state);
  state.lifecyclePlan = plan;
  state.revision += 1;
  addHistory(state, {
    operation: 'uninstall',
    pluginId,
    fromVersion: current.version,
    dataAction,
    occurredAt,
  });
  return state;
}

function composeService(
  record: InstalledPluginRecordV1,
  options: PluginOverlayRenderOptionsV1,
  state: PluginInstallerStateV1,
  enabled: boolean,
) {
  const resources = record.resources;
  const configEnvironment: Record<string, string> = {};
  const configurationVolumes: string[] = [];
  for (const item of resources.configuration) {
    if (item.source === 'deployment_config') {
      const variable = `EG_PLUGIN_CONFIG_${item.reference
        .toUpperCase()
        .replace(/[.-]/g, '_')}`;
      configEnvironment[item.name] = item.required
        ? `\${${variable}:?}`
        : `\${${variable}:-}`;
    } else if (item.source === 'deployment_file') {
      const mountPath = `${options.deploymentFileMountRoot}/${item.reference}`;
      configEnvironment[`${item.name}_FILE`] = mountPath;
      configurationVolumes.push(
        `${options.deploymentFileSourceRoot}/${record.pluginId}/${item.reference}:${mountPath}:ro`,
      );
    } else {
      // This is an opaque broker reference, never a secret value or mounted
      // Docker secret. The plugin must call the host secret-reference broker.
      configEnvironment[`${item.name}_REFERENCE`] = item.reference;
    }
  }
  configEnvironment.ENTERPRISEGLUE_PLUGIN_INVOCATION_PUBLIC_KEY_FILE =
    options.invocationPublicKeyMountPath;
  configEnvironment.ENTERPRISEGLUE_PLUGIN_BROKER_URL =
    options.hostBackendInternalUrl;

  const networks = [options.gatewayNetwork];
  if (resources.network.egressPolicy !== 'none') {
    networks.push(
      `${options.egressNetworkPrefix}${resources.network.egressPolicy}`,
    );
  }
  const volumes = resources.storage.map(
    (storage) =>
      `${pluginComposeVolumeKeyV1(
        record.pluginId,
        record.dataSchemaVersion,
        storage.name,
      )}:${storage.mountPath}${
        storage.readOnly ? ':ro' : ''
      }`,
  );
  volumes.push(
    `${options.invocationPublicKeySourcePath}:${options.invocationPublicKeyMountPath}:ro`,
    ...configurationVolumes,
  );

  return {
    image: mappedImageReference(
      state,
      record.manifest.deployment.backend!.image,
    ),
    profiles: enabled ? undefined : ['enterpriseglue-disabled-plugins'],
    restart: 'unless-stopped',
    user: '65532:65532',
    read_only: true,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    tmpfs: [
      `/tmp:rw,noexec,nosuid,nodev,size=${resources.service.tmpfsMiB}m`,
    ],
    expose: [resources.service.containerPort],
    environment: configEnvironment,
    volumes: volumes.length > 0 ? volumes : undefined,
    networks,
    healthcheck: {
      test: ['CMD', '/usr/local/bin/plugin-healthcheck'],
      interval: `${resources.probes.periodSeconds}s`,
      timeout: `${resources.probes.timeoutSeconds}s`,
      retries: resources.probes.failureThreshold,
      start_period: `${resources.probes.initialDelaySeconds}s`,
    },
    deploy: {
      resources: {
        limits: {
          cpus: resources.service.cpuLimit.endsWith('m')
            ? String(
                Number(resources.service.cpuLimit.slice(0, -1)) / 1_000,
              )
            : resources.service.cpuLimit,
          memory: `${resources.service.memoryLimitMiB}M`,
        },
      },
    },
    labels: {
      'io.enterpriseglue.plugin.id': record.pluginId,
      'io.enterpriseglue.plugin.version': record.version,
      'io.enterpriseglue.plugin.manifest-sha256': record.manifestSha256,
    },
  };
}

export function renderComposePluginOverlayV1(
  state: PluginInstallerStateV1,
  optionsInput: Partial<PluginOverlayRenderOptionsV1> = {},
): string {
  const options = {
    ...defaultPluginOverlayRenderOptionsV1,
    ...optionsInput,
  };
  const enabled = Object.values(state.plugins)
    .filter((record) => record.enabled)
    .sort((left, right) => left.pluginId.localeCompare(right.pluginId));
  const lifecycleTombstone =
    state.lifecyclePlan?.operation === 'uninstall'
      ? state.previous[state.lifecyclePlan.pluginId]?.at(-1)
      : undefined;
  const serviceRecords = [
    ...Object.values(state.plugins),
    ...(lifecycleTombstone &&
    !state.plugins[lifecycleTombstone.pluginId]
      ? [lifecycleTombstone]
      : []),
  ].sort((left, right) => left.pluginId.localeCompare(right.pluginId));
  const trustedPublishers = [
    ...new Set(enabled.map((record) => record.manifest.metadata.publisher)),
  ].sort();
  const egressPolicies = [
    ...new Set(
      enabled
        .map((record) => record.resources.network.egressPolicy)
        .filter((policy) => policy !== 'none'),
    ),
  ].sort();
  const hostBackend: Record<string, unknown> = {
    networks: [options.gatewayNetwork],
    environment: {
      ENTERPRISEGLUE_PLUGIN_STATE_FILE: options.stateMountPath,
      ENTERPRISEGLUE_PLUGIN_EXECUTION_OBSERVATION_FILE:
        options.executionObservationMountPath,
      ENTERPRISEGLUE_PLUGIN_ASSET_ROOT: options.assetMountRoot,
      ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE:
        options.invocationPrivateKeyMountPath,
      ENTERPRISEGLUE_PLUGIN_TRUSTED_PUBLISHERS: trustedPublishers.join(','),
      ENTERPRISEGLUE_PLUGIN_EGRESS_POLICIES: egressPolicies.join(','),
      ENTERPRISEGLUE_PLUGIN_GATEWAY_RATE_WINDOW_SECONDS: '60',
      ENTERPRISEGLUE_PLUGIN_GATEWAY_SUBJECT_REQUESTS_PER_WINDOW: '120',
      ENTERPRISEGLUE_PLUGIN_GATEWAY_PLUGIN_REQUESTS_PER_WINDOW: '2000',
      ENTERPRISEGLUE_PLUGIN_GATEWAY_MAX_CONCURRENT_PER_OPERATION: '32',
      ENTERPRISEGLUE_PLUGIN_GATEWAY_CIRCUIT_FAILURE_THRESHOLD: '3',
      ENTERPRISEGLUE_PLUGIN_GATEWAY_CIRCUIT_OPEN_SECONDS: '30',
      ENTERPRISEGLUE_PLUGIN_EVENT_MAX_OUTSTANDING_PER_PLUGIN: '10000',
      ENTERPRISEGLUE_PLUGIN_EVENT_MAX_OUTSTANDING_PER_SUBSCRIPTION: '1000',
      ENTERPRISEGLUE_PLUGIN_ENGINE_EVENT_POLLING_ENABLED:
        options.engineEventPollingEnabled ? 'true' : 'false',
    },
    volumes: [
      `${options.stateSourcePath}:${options.stateMountPath}:ro`,
      `${options.executionObservationSourcePath}:${options.executionObservationMountPath}:ro`,
      `${options.invocationPrivateKeySourcePath}:${options.invocationPrivateKeyMountPath}:ro`,
      ...enabled.map(
        (record) =>
          `${record.stagedAssetPath}:${options.assetMountRoot}/${record.pluginId}:ro`,
      ),
    ],
  };
  const usesSecretBroker = enabled.some((record) =>
    record.resources.configuration.some(
      (item) => item.source === 'secret_reference',
    ),
  );
  if (usesSecretBroker) {
    const environment = hostBackend.environment as Record<string, string>;
    environment.ENTERPRISEGLUE_PLUGIN_SECRET_BROKER_POLICY_FILE =
      options.secretBrokerPolicyMountPath;
    environment.ENTERPRISEGLUE_PLUGIN_SECRET_BROKER_SECRET_ROOT =
      options.secretBrokerSecretRootMountPath;
    const hostVolumes = hostBackend.volumes as string[];
    hostVolumes.push(
      `${options.secretBrokerPolicySourcePath}:${options.secretBrokerPolicyMountPath}:ro`,
      `${options.secretBrokerSecretRootSourcePath}:${options.secretBrokerSecretRootMountPath}:ro`,
    );
  }
  const services: Record<string, unknown> = {
    [options.hostBackendService]: hostBackend,
  };
  const networks: Record<string, { external: true; name: string }> = {
    [options.gatewayNetwork]: {
      external: true,
      name: options.gatewayNetwork,
    },
  };
  const volumes: Record<string, Record<string, never>> = {};

  for (const record of serviceRecords) {
    const recordEnabled = Boolean(
      state.plugins[record.pluginId]?.enabled,
    );
    services[pluginComposeServiceNameV1(record.pluginId)] = composeService(
      record,
      options,
      state,
      recordEnabled,
    );
    for (const storage of record.resources.storage) {
      volumes[
        pluginComposeVolumeKeyV1(
          record.pluginId,
          record.dataSchemaVersion,
          storage.name,
        )
      ] = {};
    }
    if (record.resources.network.egressPolicy !== 'none') {
      const networkName = `${options.egressNetworkPrefix}${record.resources.network.egressPolicy}`;
      networks[networkName] = { external: true, name: networkName };
    }
  }

  return stringify({
    services,
    networks,
    volumes: Object.keys(volumes).length > 0 ? volumes : undefined,
  });
}

export function renderHelmPluginValuesV1(
  state: PluginInstallerStateV1,
): string {
  const plugins = Object.values(state.plugins)
    .filter((record) => record.enabled)
    .sort((left, right) => left.pluginId.localeCompare(right.pluginId))
    .map((record) => ({
      id: record.pluginId,
      version: record.version,
      dataSchemaVersion: record.dataSchemaVersion,
      manifestSha256: record.manifestSha256,
      bundle: mappedImageReference(state, record.bundle),
      image: mappedImageReference(
        state,
        record.manifest.deployment.backend!.image,
      ),
      migration: record.manifest.deployment.migration
        ? {
            ...record.manifest.deployment.migration,
            image: mappedImageReference(
              state,
              record.manifest.deployment.migration.image,
            ),
          }
        : undefined,
      assets: {
        stagedPath: record.stagedAssetPath,
      },
      service: record.resources.service,
      configuration: record.resources.configuration,
      storage: record.resources.storage,
      network: record.resources.network,
      probes: record.resources.probes,
      grantedPermissions: record.grantedPermissions,
    }));

  return stringify({
    pluginRuntime: {
      schemaVersion: 1,
      stateRevision: state.revision,
      plugins,
    },
  });
}

export * from './execution.js';
export * from './executionObservation.js';
export * from './executionStore.js';
export * from './executionRunner.js';
export * from './composeExecutionAdapter.js';
export * from './kubernetesExecutionStore.js';
export * from './ociAcquisition.js';
export * from './airgapImport.js';
export * from './kubernetesExecutionAdapter.js';
