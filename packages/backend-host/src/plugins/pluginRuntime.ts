import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';

import {
  createPluginPlatformCapabilityCatalogV1,
  pluginPlatformReleaseIdentityV1,
  parseEnterpriseGluePluginManifestV1,
  ociDigestReferenceSchema,
  pluginDeploymentExecutionObservationV1Schema,
  pluginDeploymentLifecycleOperationSchema,
  pluginIdSchema,
  pluginPermissionGrantSetV1Schema,
  pluginResourceDescriptorV1Schema,
  pluginSecretUseRequestV1Schema,
  semVerSchema,
  sha256Schema,
  type EnterpriseGluePluginManifestV1,
  type PluginId,
  type PluginPlatformCapabilityCatalogV1,
  type PluginSafeReasonCodeV1,
  type PluginResourceDescriptorV1,
  type PluginResourceBindingV1,
  type PluginBackendOperationV1,
  type PluginEventTypeV1,
  type PluginPermissionV1,
  type PluginDeploymentExecutionObservationV1,
  type PluginDeploymentLifecycleOperationV1,
  type PluginContributionAvailabilityProjectionV1,
} from '@enterpriseglue/plugin-sdk';
import {
  assertSafePluginFrontendEntryV1,
  pluginHostCapabilitiesFromCatalogV1,
  resolveIsolatedPluginSetV1,
  type PluginHostCapabilitiesV1,
  type PluginResolutionIssueV1,
} from '@enterpriseglue/plugin-runtime';
import {
  authorizePluginGatewayInvocationV1,
  matchPluginOperationPathV1,
  PluginGatewayAdmissionControllerV1,
  PluginGatewayCircuitBreakerV1,
  PluginGatewayError,
  signPluginInvocationV1,
  validatePluginBackendCapabilitiesV1,
  type PluginGatewayAdmissionV1,
  type PluginGatewayAdmissionLeaseV1,
  type PluginGatewayCircuitLeaseV1,
} from '@enterpriseglue/plugin-runtime/gateway';
import {
  compilePluginOperationSchemaV1,
  PLUGIN_OPERATION_SCHEMA_MAX_BYTES,
  type CompiledPluginOperationSchemaV1,
  type PluginOperationPayloadDirectionV1,
} from '@enterpriseglue/plugin-runtime/json-schema';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { evaluateResolvedAuthzAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { resolveTenantContext } from '@enterpriseglue/shared/middleware/tenant.js';
import { DEFAULT_TENANT_ID } from '@enterpriseglue/shared/middleware/tenant.js';
import { isTenantVisibleForAuthz } from '@enterpriseglue/shared/authz/tenant-scope.js';
import type {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';
import { fetch } from 'undici';

import {
  SecretBrokerErrorV1,
  executePluginSecretUseV1,
  loadPluginSecretBrokerPolicyV1,
} from '@enterpriseglue/plugin-runtime/secret-broker';
import { DatabasePluginBrokerReplayStoreV1 } from './secretBrokerReplayStore.js';
import { PluginControlPlaneV1 } from './pluginControlPlane.js';
import {
  registerPluginControlRoutesV1,
  type PluginControlRouteOptionsV1,
} from './pluginControlRoutes.js';
import { DatabasePluginControlStoreV1 } from './pluginControlStore.js';
import { PluginEventDispatcherV1 } from './pluginEventDispatcher.js';
import { DatabasePluginEventDeliveryStoreV1 } from './pluginEventDeliveryStore.js';
import { PluginEngineEventPollerV1 } from './pluginEngineEventPoller.js';
import { DatabasePluginNotificationPublisherV1 } from './pluginNotificationPublisher.js';
import { PluginScheduleDispatcherV1 } from './pluginScheduleDispatcher.js';
import { DatabasePluginScheduleStoreV1 } from './pluginScheduleStore.js';
import {
  registerPluginHostBrokerRoutesV1,
  type PluginHostBrokerRouteOptionsV1,
} from './pluginHostBrokerRoutes.js';
import { DatabasePluginStorageStoreV1 } from './pluginStorageStore.js';
import { LocalSanitizedDiagnosticCollectorV1 } from './localDiagnosticCollector.js';
import { relayValidatedPluginSseV1 } from './pluginSseProxy.js';
import { DatabasePluginGatewayAdmissionV1 } from './pluginGatewayAdmissionStore.js';
import { PluginContributionAvailabilityDispatcherV1 } from './pluginContributionAvailabilityDispatcher.js';
import {
  DatabasePluginContributionAvailabilityStoreV1,
  type PluginContributionAvailabilityStoreV1,
} from './pluginContributionAvailabilityStore.js';
import { PluginDiagnosticMetricsRegistryV1 } from './pluginDiagnosticMetrics.js';
import { PluginEventMetricsRegistryV1 } from './pluginEventMetrics.js';
import { readSecureRegularFileV1 } from './secureFile.js';

const MAX_STATE_BYTES = 10 * 1024 * 1024;
const MAX_EXECUTION_OBSERVATION_BYTES = 64 * 1024;
const EXECUTION_OBSERVATION_FILE_NAME =
  'plugin-lifecycle-observation.json';
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const DEFAULT_ASSET_ROOT = '/var/lib/enterpriseglue/plugins';
const INVOCATION_PRIVATE_KEY_MAX_BYTES = 32 * 1024;
const CAPABILITY_DOCUMENT_MAX_BYTES = 1024 * 1024;
const DEFAULT_GATEWAY_RATE_WINDOW_SECONDS = 60;
const DEFAULT_GATEWAY_SUBJECT_REQUESTS = 120;
const DEFAULT_GATEWAY_PLUGIN_REQUESTS = 2_000;
const DEFAULT_GATEWAY_CONCURRENT_PER_OPERATION = 32;
const DEFAULT_GATEWAY_CIRCUIT_FAILURE_THRESHOLD = 3;
const DEFAULT_GATEWAY_CIRCUIT_OPEN_SECONDS = 30;

type SafeRuntimeIssueCode =
  | PluginResolutionIssueV1['code']
  | 'state_invalid'
  | 'record_invalid'
  | 'asset_missing'
  | 'asset_digest_invalid'
  | 'asset_policy_invalid';

export interface PluginFrontendBootstrapRecordV1 {
  pluginId: PluginId;
  version: string;
  displayName: string;
  manifest: EnterpriseGluePluginManifestV1;
  entryUrl: string;
  contributionAvailability?: PluginContributionAvailabilityProjectionV1 | null;
}

export interface PluginFrontendBootstrapV1 {
  apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1';
  revision: number;
  plugins: PluginFrontendBootstrapRecordV1[];
  issues: Array<{ pluginId?: PluginId; code: SafeRuntimeIssueCode }>;
}

interface InstallerRecord {
  pluginId: PluginId;
  version: string;
  bundle: string;
  manifestSha256: string;
  manifest: EnterpriseGluePluginManifestV1;
  resources: PluginResourceDescriptorV1;
  grantedPermissions: PluginPermissionV1[];
  enabled: boolean;
}

export interface PluginEventSubscriberRecordV1 {
  pluginId: PluginId;
  version: string;
  manifest: EnterpriseGluePluginManifestV1;
  resources: PluginResourceDescriptorV1;
  grantedPermissions: PluginPermissionV1[];
  subscription: EnterpriseGluePluginManifestV1['events']['subscriptions'][number];
}

interface LoadedState {
  revision: number;
  records: InstallerRecord[];
  lifecyclePlan: {
    pluginId: PluginId;
    operation: PluginDeploymentLifecycleOperationV1;
  } | null;
}

export interface PluginControlSourceRecordV1 {
  pluginId: PluginId;
  version: string;
  displayName: string;
  publisher: PluginId;
  bundleDigest: string;
  manifestSha256: string;
  sourceRecordHash: string;
  installerEnabled: boolean;
  enablementScope: 'deployment' | 'tenant';
  compatible: boolean;
  healthy: boolean;
  entitled:
    | 'not_required'
    | 'active'
    | 'grace'
    | 'expired'
    | 'revoked'
    | 'unavailable';
  reasonCode: PluginSafeReasonCodeV1;
  grantedPermissions: PluginPermissionV1[];
}

export interface PluginControlSourceSnapshotV1 {
  revision: number;
  records: PluginControlSourceRecordV1[];
  deploymentExecution?: PluginDeploymentExecutionObservationV1;
}

interface ActiveAsset {
  pluginId: PluginId;
  version: string;
  root: string;
  entry: string;
  entryAssetPath: string;
  entrySha256: string;
}

export interface PluginHostRuntimeOptions {
  stateFile?: string;
  executionObservationFile?: string;
  assetRoot?: string;
  hostCapabilities?: PluginHostCapabilitiesV1;
}

export interface PluginResourceAuthorizationInputV1 {
  pluginId: PluginId;
  operationId: string;
  subjectRef: string;
  tenantRef?: string;
  resourceKind: PluginResourceBindingV1['kind'];
  resourceRef: string;
}

export type PluginResourceAuthorizerV1 = (
  input: PluginResourceAuthorizationInputV1,
) => Promise<boolean>;

/**
 * A host-owned projection of a manifest operation into a static FGA action.
 * The plugin controls neither the subject nor the resource identity.
 */
export interface PluginOperationAuthorizationInputV1 {
  pluginId: PluginId;
  operationId: string;
  actionId: string;
  subjectRef: string;
  tenantRef?: string;
  resourceType: 'platform' | 'engine';
  resourceRef?: string;
}

export type PluginOperationAuthorizerV1 = (
  input: PluginOperationAuthorizationInputV1,
) => Promise<boolean>;

export interface PluginPlatformRouteOptionsV1 {
  gatewayAdmission?: PluginGatewayAdmissionV1;
  gatewayCircuitBreaker?: PluginGatewayCircuitBreakerV1;
  operationMiddleware?: RequestHandler[];
  /**
   * Trusted host-composition authorization for manifest-bound resources.
   * A plugin manifest, frontend, or request cannot provide this callback.
   */
  resourceAuthorizer?: PluginResourceAuthorizerV1;
  /**
   * FGA/ABAC authorization for every interactive plugin operation. This is
   * deliberately separate from `resourceAuthorizer`, which is retained as an
   * optional additional host policy for resource bindings.
   */
  operationAuthorizer?: PluginOperationAuthorizerV1;
  hostBroker?: Partial<PluginHostBrokerRouteOptionsV1>;
  eventDispatcher?: PluginEventDispatcherV1;
  startEventWorker?: boolean;
  scheduleDispatcher?: PluginScheduleDispatcherV1;
  startScheduleWorker?: boolean;
  availabilityStore?: PluginContributionAvailabilityStoreV1;
  availabilityDispatcher?: PluginContributionAvailabilityDispatcherV1;
  startAvailabilityWorker?: boolean;
  engineEventPoller?: PluginEngineEventPollerV1;
  startEngineEventPoller?: boolean;
  diagnosticMetrics?: PluginDiagnosticMetricsRegistryV1;
  eventMetrics?: PluginEventMetricsRegistryV1;
  /**
   * Host-composition authentication hooks for the generic control routes.
   * These are trusted OSS backend inputs and can never come from a plugin
   * manifest, frontend contribution, or customer request.
   */
  controlRouteMiddleware?: Pick<
    PluginControlRouteOptionsV1,
    'deploymentAdminMiddleware' | 'tenantAdminMiddleware'
  >;
}

function csvSet(value: string | undefined, defaults: string[] = []): Set<string> {
  const entries = value
    ? value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : defaults;
  return new Set(entries);
}

function positiveEnvironmentInteger(
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return value;
}

function defaultPluginGatewayAdmissionV1(): PluginGatewayAdmissionV1 {
  const policy = {
    windowMs:
      positiveEnvironmentInteger(
        'ENTERPRISEGLUE_PLUGIN_GATEWAY_RATE_WINDOW_SECONDS',
        DEFAULT_GATEWAY_RATE_WINDOW_SECONDS,
        3_600,
      ) * 1_000,
    maxRequestsPerSubjectOperation: positiveEnvironmentInteger(
      'ENTERPRISEGLUE_PLUGIN_GATEWAY_SUBJECT_REQUESTS_PER_WINDOW',
      DEFAULT_GATEWAY_SUBJECT_REQUESTS,
      100_000,
    ),
    maxRequestsPerPlugin: positiveEnvironmentInteger(
      'ENTERPRISEGLUE_PLUGIN_GATEWAY_PLUGIN_REQUESTS_PER_WINDOW',
      DEFAULT_GATEWAY_PLUGIN_REQUESTS,
      1_000_000,
    ),
    maxConcurrentPerOperation: positiveEnvironmentInteger(
      'ENTERPRISEGLUE_PLUGIN_GATEWAY_MAX_CONCURRENT_PER_OPERATION',
      DEFAULT_GATEWAY_CONCURRENT_PER_OPERATION,
      10_000,
    ),
  };
  return process.env.NODE_ENV === 'test'
    ? new PluginGatewayAdmissionControllerV1(policy)
    : new DatabasePluginGatewayAdmissionV1(policy);
}

function defaultPluginGatewayCircuitBreakerV1(): PluginGatewayCircuitBreakerV1 {
  return new PluginGatewayCircuitBreakerV1({
    failureThreshold: positiveEnvironmentInteger(
      'ENTERPRISEGLUE_PLUGIN_GATEWAY_CIRCUIT_FAILURE_THRESHOLD',
      DEFAULT_GATEWAY_CIRCUIT_FAILURE_THRESHOLD,
      100,
    ),
    openMs:
      positiveEnvironmentInteger(
        'ENTERPRISEGLUE_PLUGIN_GATEWAY_CIRCUIT_OPEN_SECONDS',
        DEFAULT_GATEWAY_CIRCUIT_OPEN_SECONDS,
        3_600,
      ) * 1_000,
  });
}

export function defaultPluginPlatformCapabilityCatalogV1(): PluginPlatformCapabilityCatalogV1 {
  const configuredPublishers =
    process.env.ENTERPRISEGLUE_PLUGIN_TRUSTED_PUBLISHERS;
  const defaultPublishers = configuredPublishers
    ? []
    : (['io.enterpriseglue'] as PluginId[]);
  return createPluginPlatformCapabilityCatalogV1({
    hostVersion:
      process.env.ENTERPRISEGLUE_HOST_VERSION?.trim() ||
      pluginPlatformReleaseIdentityV1.hostVersion,
    sdkVersion: pluginPlatformReleaseIdentityV1.sdkVersion,
    supportedSdkVersions:
      pluginPlatformReleaseIdentityV1.supportedSdkVersions,
    sharedFrontend: pluginPlatformReleaseIdentityV1.sharedFrontend,
    egressPolicies: [
      ...csvSet(process.env.ENTERPRISEGLUE_PLUGIN_EGRESS_POLICIES),
    ],
    trustedPublishers: [
      ...csvSet(configuredPublishers, defaultPublishers),
    ] as PluginId[],
    defaultTrustedPublishers: defaultPublishers,
  });
}

export function defaultPluginHostCapabilitiesV1(): PluginHostCapabilitiesV1 {
  return pluginHostCapabilitiesFromCatalogV1(
    defaultPluginPlatformCapabilityCatalogV1(),
  );
}

function safeRecord(input: unknown, key: string): InstallerRecord {
  if (!input || typeof input !== 'object') {
    throw new Error('Plugin record must be an object');
  }
  const candidate = input as Record<string, unknown>;
  const pluginId = pluginIdSchema.parse(candidate.pluginId);
  const version = semVerSchema.parse(candidate.version);
  const bundle = ociDigestReferenceSchema.parse(candidate.bundle);
  const manifestSha256 = sha256Schema.parse(candidate.manifestSha256);
  const manifest = parseEnterpriseGluePluginManifestV1(candidate.manifest);
  const resources = pluginResourceDescriptorV1Schema.parse(candidate.resources);
  const grantSet = pluginPermissionGrantSetV1Schema.parse({
    apiVersion: 'permission-grants.plugin.enterpriseglue.io/v1',
    pluginId,
    permissions: candidate.grantedPermissions,
  });
  const granted = new Set(grantSet.permissions);
  const declared = new Set([
    ...manifest.permissions.required,
    ...manifest.permissions.optional,
  ]);
  if (
    key !== pluginId ||
    manifest.metadata.id !== pluginId ||
    manifest.metadata.version !== version ||
    manifest.network.egressPolicy !== resources.network.egressPolicy ||
    typeof candidate.enabled !== 'boolean' ||
    manifest.permissions.required.some((permission) => !granted.has(permission)) ||
    grantSet.permissions.some((permission) => !declared.has(permission))
  ) {
    throw new Error('Plugin record is inconsistent');
  }
  return {
    pluginId,
    version,
    bundle,
    manifestSha256,
    manifest,
    resources,
    grantedPermissions: grantSet.permissions,
    enabled: candidate.enabled,
  };
}

async function loadStateFile(path: string | undefined): Promise<LoadedState> {
  if (!path) return { revision: 0, records: [], lifecyclePlan: null };
  const bytes = await readSecureRegularFileV1(path, {
    maxBytes: MAX_STATE_BYTES,
  });
  const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Plugin installer state must be an object');
  }
  const state = parsed as Record<string, unknown>;
  if (
    state.schemaVersion !== 1 ||
    !Number.isInteger(state.revision) ||
    Number(state.revision) < 0 ||
    !state.plugins ||
    typeof state.plugins !== 'object' ||
    Array.isArray(state.plugins)
  ) {
    throw new Error('Plugin installer state has an invalid structure');
  }
  const records = Object.entries(state.plugins as Record<string, unknown>).map(
    ([key, value]) => safeRecord(value, key),
  );
  let lifecyclePlan: LoadedState['lifecyclePlan'] = null;
  if (state.lifecyclePlan !== undefined) {
    if (
      !state.lifecyclePlan ||
      typeof state.lifecyclePlan !== 'object' ||
      Array.isArray(state.lifecyclePlan)
    ) {
      throw new Error('Plugin installer lifecycle plan is invalid');
    }
    const plan = state.lifecyclePlan as Record<string, unknown>;
    lifecyclePlan = {
      pluginId: pluginIdSchema.parse(plan.pluginId),
      operation: pluginDeploymentLifecycleOperationSchema.parse(
        plan.operation,
      ),
    };
  }
  return {
    revision: Number(state.revision),
    records,
    lifecyclePlan,
  };
}

function notStartedExecutionObservation(
  desiredRevision: number,
): PluginDeploymentExecutionObservationV1 {
  return pluginDeploymentExecutionObservationV1Schema.parse({
    apiVersion:
      'deployment-execution-observation.plugin.enterpriseglue.io/v1',
    observedFrom: 'local_execution_mirror',
    workloadReconciliation: 'not_checked',
    observationState: 'not_started',
    observationReason: 'execution_not_found',
    desiredRevision,
    planSha256: null,
    execution: null,
  });
}

function unavailableExecutionObservation(
  desiredRevision: number,
  state: 'stale' | 'invalid',
  reason:
    | 'desired_revision_mismatch'
    | 'plan_mismatch'
    | 'observation_invalid',
): PluginDeploymentExecutionObservationV1 {
  return pluginDeploymentExecutionObservationV1Schema.parse({
    apiVersion:
      'deployment-execution-observation.plugin.enterpriseglue.io/v1',
    observedFrom: 'local_execution_mirror',
    workloadReconciliation: 'not_checked',
    observationState: state,
    observationReason: reason,
    desiredRevision,
    planSha256: null,
    execution: null,
  });
}

async function loadExecutionObservationFile(
  path: string | undefined,
  state: LoadedState,
): Promise<PluginDeploymentExecutionObservationV1> {
  if (!path) return notStartedExecutionObservation(state.revision);
  let bytes: Buffer;
  try {
    bytes = await readSecureRegularFileV1(path, {
      maxBytes: MAX_EXECUTION_OBSERVATION_BYTES,
      followSymlinks: false,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return notStartedExecutionObservation(state.revision);
    }
    return unavailableExecutionObservation(
      state.revision,
      'invalid',
      'observation_invalid',
    );
  }
  let input: unknown;
  try {
    input = JSON.parse(bytes.toString('utf8'));
  } catch {
    return unavailableExecutionObservation(
      state.revision,
      'invalid',
      'observation_invalid',
    );
  }
  const parsed =
    pluginDeploymentExecutionObservationV1Schema.safeParse(input);
  if (!parsed.success) {
    return unavailableExecutionObservation(
      state.revision,
      'invalid',
      'observation_invalid',
    );
  }
  const observation = parsed.data;
  if (observation.desiredRevision !== state.revision) {
    return unavailableExecutionObservation(
      state.revision,
      'stale',
      'desired_revision_mismatch',
    );
  }
  if (
    Boolean(state.lifecyclePlan) !==
    Boolean(observation.planSha256)
  ) {
    return unavailableExecutionObservation(
      state.revision,
      'stale',
      'plan_mismatch',
    );
  }
  if (
    observation.execution &&
    (!state.lifecyclePlan ||
      observation.execution.pluginId !==
        state.lifecyclePlan.pluginId ||
      observation.execution.operation !==
        state.lifecyclePlan.operation)
  ) {
    return unavailableExecutionObservation(
      state.revision,
      'stale',
      'plan_mismatch',
    );
  }
  return observation;
}

function digest(input: Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

function isContained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

function pluginAssetUrl(pluginId: PluginId, version: string, asset: string): string {
  return `/_enterpriseglue/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(
    version,
  )}/${asset
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

function firstRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export class PluginHostRuntimeV1 {
  private readonly stateFile: string | undefined;
  private readonly executionObservationFile: string | undefined;
  private readonly assetRoot: string;
  private readonly hostCapabilities: PluginHostCapabilitiesV1;
  private readonly capabilityCatalog: PluginPlatformCapabilityCatalogV1;
  private activeAssets = new Map<PluginId, ActiveAsset>();
  private activeRecords = new Map<PluginId, InstallerRecord>();
  private readonly operationSchemas = new Map<
    string,
    CompiledPluginOperationSchemaV1
  >();

  constructor(options: PluginHostRuntimeOptions = {}) {
    this.stateFile =
      options.stateFile ?? process.env.ENTERPRISEGLUE_PLUGIN_STATE_FILE?.trim();
    this.executionObservationFile =
      options.executionObservationFile ??
      process.env.ENTERPRISEGLUE_PLUGIN_EXECUTION_OBSERVATION_FILE?.trim() ??
      (this.stateFile
        ? resolve(dirname(this.stateFile), EXECUTION_OBSERVATION_FILE_NAME)
        : undefined);
    this.assetRoot =
      options.assetRoot ??
      process.env.ENTERPRISEGLUE_PLUGIN_ASSET_ROOT?.trim() ??
      DEFAULT_ASSET_ROOT;
    if (options.hostCapabilities) {
      this.hostCapabilities = options.hostCapabilities;
      this.capabilityCatalog = createPluginPlatformCapabilityCatalogV1({
        hostVersion: options.hostCapabilities.hostVersion,
        sdkVersion: options.hostCapabilities.sdkVersion,
        supportedSdkVersions: [
          ...options.hostCapabilities.supportedSdkVersions,
        ],
        sharedFrontend: options.hostCapabilities.sharedFrontend,
        permissions: [...options.hostCapabilities.permissions],
        slots: [...options.hostCapabilities.slots],
        egressPolicies: [...options.hostCapabilities.egressPolicies],
        trustedPublishers: [...options.hostCapabilities.trustedPublishers],
      });
    } else {
      this.capabilityCatalog =
        defaultPluginPlatformCapabilityCatalogV1();
      this.hostCapabilities = pluginHostCapabilitiesFromCatalogV1(
        this.capabilityCatalog,
      );
    }
  }

  platformCapabilities(): PluginPlatformCapabilityCatalogV1 {
    return structuredClone(this.capabilityCatalog);
  }

  async frontendBootstrap(): Promise<PluginFrontendBootstrapV1> {
    let state: LoadedState;
    try {
      state = await loadStateFile(this.stateFile);
    } catch {
      this.activeAssets = new Map();
      this.activeRecords = new Map();
      return {
        apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1',
        revision: 0,
        plugins: [],
        issues: [{ code: 'state_invalid' }],
      };
    }

    const enabled = state.records
      .filter((record) => record.enabled)
      .sort((left, right) => left.pluginId.localeCompare(right.pluginId));
    const resolution = resolveIsolatedPluginSetV1(
      enabled.map((record) => record.manifest),
      this.hostCapabilities,
    );

    const byId = new Map(enabled.map((record) => [record.pluginId, record]));
    const activeRecords = new Map(
      resolution.activationOrder.flatMap((pluginId) => {
        const record = byId.get(pluginId);
        return record ? [[pluginId, record] as const] : [];
      }),
    );
    const activeAssets = new Map<PluginId, ActiveAsset>();
    const plugins: PluginFrontendBootstrapRecordV1[] = [];
    const issues: PluginFrontendBootstrapV1['issues'] =
      resolution.issues.map((issue) => ({
        pluginId: issue.pluginId,
        code: issue.code,
      }));

    for (const pluginId of resolution.activationOrder) {
      const record = byId.get(pluginId);
      const frontend = record?.manifest.deployment.frontend;
      if (!record || !frontend) continue;
      try {
        const root = await realpath(resolve(this.assetRoot, pluginId));
        const expectedRoot = await realpath(this.assetRoot);
        if (!isContained(expectedRoot, root)) {
          throw new Error('Plugin asset root escapes configured storage');
        }
        const entry = await realpath(resolve(root, frontend.entry));
        if (!isContained(root, entry)) {
          throw new Error('Plugin entry escapes its asset root');
        }
        const entryBytes = await readSecureRegularFileV1(entry, {
          maxBytes: MAX_ASSET_BYTES,
          followSymlinks: false,
        });
        if (digest(entryBytes) !== frontend.sha256) {
          issues.push({ pluginId, code: 'asset_digest_invalid' });
          activeRecords.delete(pluginId);
          continue;
        }
        try {
          await assertSafePluginFrontendEntryV1(entryBytes);
        } catch {
          issues.push({ pluginId, code: 'asset_policy_invalid' });
          activeRecords.delete(pluginId);
          continue;
        }
        activeAssets.set(pluginId, {
          pluginId,
          version: record.version,
          root,
          entry,
          entryAssetPath: frontend.entry,
          entrySha256: frontend.sha256,
        });
        plugins.push({
          pluginId,
          version: record.version,
          displayName: record.manifest.metadata.displayName,
          manifest: record.manifest,
          entryUrl: pluginAssetUrl(pluginId, record.version, frontend.entry),
        });
      } catch {
        issues.push({ pluginId, code: 'asset_missing' });
        activeRecords.delete(pluginId);
      }
    }
    this.activeAssets = activeAssets;
    this.activeRecords = activeRecords;
    return {
      apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1',
      revision: state.revision,
      plugins,
      issues,
    };
  }

  async readAsset(
    pluginIdInput: string,
    versionInput: string,
    assetPathInput: string,
  ): Promise<{ bytes: Buffer; contentType: string } | null> {
    const pluginId = pluginIdSchema.safeParse(pluginIdInput);
    const version = semVerSchema.safeParse(versionInput);
    if (
      !pluginId.success ||
      !version.success ||
      assetPathInput.length === 0 ||
      assetPathInput.length > 500 ||
      assetPathInput.includes('\\') ||
      assetPathInput.includes('\0') ||
      assetPathInput.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      return null;
    }
    await this.frontendBootstrap();
    const active = this.activeAssets.get(pluginId.data);
    if (!active || active.version !== version.data) return null;
    if (assetPathInput !== active.entryAssetPath) return null;

    try {
      const bytes = await readSecureRegularFileV1(active.entry, {
        maxBytes: MAX_ASSET_BYTES,
        followSymlinks: false,
      });
      const contentType = contentTypeFor(active.entry);
      if (!contentType) return null;
      if (digest(bytes) !== active.entrySha256) return null;
      return { bytes, contentType };
    } catch {
      return null;
    }
  }

  async backendRecord(pluginIdInput: string): Promise<InstallerRecord | null> {
    const pluginId = pluginIdSchema.safeParse(pluginIdInput);
    if (!pluginId.success) return null;
    await this.frontendBootstrap();
    const record = this.activeRecords.get(pluginId.data);
    if (!record?.manifest.deployment.backend) return null;
    return structuredClone(record);
  }

  async eventSubscribers(
    eventType: PluginEventTypeV1,
  ): Promise<PluginEventSubscriberRecordV1[]> {
    await this.frontendBootstrap();
    return [...this.activeRecords.values()]
      .sort((left, right) => left.pluginId.localeCompare(right.pluginId))
      .flatMap((record) =>
        record.manifest.events.subscriptions
          .filter((subscription) => subscription.type === eventType)
          .map((subscription) => ({
            pluginId: record.pluginId,
            version: record.version,
            manifest: structuredClone(record.manifest),
            resources: structuredClone(record.resources),
            grantedPermissions: [...record.grantedPermissions],
            subscription: structuredClone(subscription),
          })),
      );
  }

  async assertOperationPayload(
    pluginIdInput: string,
    operationId: string,
    direction: PluginOperationPayloadDirectionV1,
    value: unknown,
  ): Promise<void> {
    const pluginId = pluginIdSchema.safeParse(pluginIdInput);
    if (!pluginId.success) {
      throw new PluginGatewayError(
        'schema_document_invalid',
        'Plugin operation schema is unavailable',
      );
    }
    await this.frontendBootstrap();
    const record = this.activeRecords.get(pluginId.data);
    const operation = record?.manifest.deployment.backend?.operations.find(
      (candidate) => candidate.operationId === operationId,
    );
    if (!record || !operation) {
      throw new PluginGatewayError(
        'schema_document_invalid',
        'Plugin operation schema is unavailable',
      );
    }
    const reference =
      direction === 'request'
        ? operation.requestSchema
        : operation.responseSchema;
    const cacheKey = [
      record.pluginId,
      record.version,
      direction,
      reference.sha256,
    ].join('\0');
    let compiled = this.operationSchemas.get(cacheKey);
    if (!compiled) {
      const expectedRoot = await realpath(this.assetRoot);
      const root = await realpath(resolve(expectedRoot, record.pluginId));
      if (!isContained(expectedRoot, root)) {
        throw new PluginGatewayError(
          'schema_document_invalid',
          'Plugin operation schema escapes configured storage',
        );
      }
      const path = await realpath(resolve(root, reference.path));
      if (!isContained(root, path)) {
        throw new PluginGatewayError(
          'schema_document_invalid',
          'Plugin operation schema escapes its bundle',
        );
      }
      let bytes: Buffer;
      try {
        bytes = await readSecureRegularFileV1(path, {
          minBytes: 1,
          maxBytes: PLUGIN_OPERATION_SCHEMA_MAX_BYTES,
          followSymlinks: false,
        });
      } catch {
        throw new PluginGatewayError(
          'schema_document_invalid',
          'Plugin operation schema has an invalid size',
        );
      }
      compiled = compilePluginOperationSchemaV1({
        bytes,
        expectedSha256: reference.sha256,
        direction,
      });
      if (this.operationSchemas.size >= 1_000) {
        this.operationSchemas.clear();
      }
      this.operationSchemas.set(cacheKey, compiled);
    }
    compiled.assert(value);
  }

  async controlSnapshot(): Promise<PluginControlSourceSnapshotV1> {
    const state = await loadStateFile(this.stateFile);
    await this.frontendBootstrap();
    const resolution = resolveIsolatedPluginSetV1(
      state.records.map((record) => record.manifest),
      this.hostCapabilities,
    );
    const issueByPlugin = new Map<PluginId, PluginResolutionIssueV1>();
    for (const issue of resolution.issues) {
      if (!issueByPlugin.has(issue.pluginId)) {
        issueByPlugin.set(issue.pluginId, issue);
      }
    }
    return {
      revision: state.revision,
      deploymentExecution: await loadExecutionObservationFile(
        this.executionObservationFile,
        state,
      ),
      records: state.records
        .sort((left, right) => left.pluginId.localeCompare(right.pluginId))
        .map((record) => {
          const issue = issueByPlugin.get(record.pluginId);
          const compatible = !issue;
          return {
            pluginId: record.pluginId,
            version: record.version,
            displayName: record.manifest.metadata.displayName,
            publisher: record.manifest.metadata.publisher,
            bundleDigest: record.bundle,
            manifestSha256: record.manifestSha256,
            sourceRecordHash: digest(
              Buffer.from(
                JSON.stringify({
                  pluginId: record.pluginId,
                  version: record.version,
                  bundle: record.bundle,
                  manifestSha256: record.manifestSha256,
                  manifest: record.manifest,
                  resources: record.resources,
                  grantedPermissions: [...record.grantedPermissions].sort(),
                  enabled: record.enabled,
                }),
                'utf8',
              ),
            ),
            installerEnabled: record.enabled,
            enablementScope: record.manifest.scope.enablement,
            compatible,
            healthy:
              compatible &&
              record.enabled &&
              this.activeRecords.has(record.pluginId),
            entitled:
              record.manifest.entitlement.provider === 'none'
                ? 'not_required'
                : 'unavailable',
            reasonCode: issue ? safeReasonForResolutionIssue(issue.code) : 'none',
            grantedPermissions: [...record.grantedPermissions],
          };
        }),
    };
  }

}

function safeReasonForResolutionIssue(
  code: PluginResolutionIssueV1['code'],
): PluginSafeReasonCodeV1 {
  return (
    {
      duplicate_plugin: 'plugin_conflict',
      untrusted_publisher: 'publisher_untrusted',
      invalid_version_range: 'manifest_invalid',
      incompatible_host: 'host_incompatible',
      incompatible_sdk: 'sdk_incompatible',
      unsupported_frontend_protocol: 'protocol_incompatible',
      unsupported_backend_protocol: 'protocol_incompatible',
      incompatible_shared_runtime: 'shared_runtime_incompatible',
      missing_slot: 'host_incompatible',
      unknown_permission: 'permission_denied',
      unapproved_egress_policy: 'egress_policy_denied',
      missing_dependency: 'dependency_missing',
      incompatible_dependency: 'dependency_missing',
      dependency_cycle: 'dependency_cycle',
      plugin_conflict: 'plugin_conflict',
    } satisfies Record<
      PluginResolutionIssueV1['code'],
      PluginSafeReasonCodeV1
    >
  )[code];
}

function contentTypeFor(path: string): string | null {
  const extension = extname(path).toLowerCase();
  return (
    {
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.map': 'application/json; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    } as Record<string, string | undefined>
  )[extension] ?? null;
}

let defaultRuntime: PluginHostRuntimeV1 | undefined;
let defaultControlPlane: PluginControlPlaneV1 | undefined;

function requestParam(
  request: Request,
  name: string,
): string {
  return firstRouteParam(request.params[name]);
}

function safeCorrelationId(request: Request): string {
  const value =
    firstRouteParam(request.headers['x-request-id']) ||
    firstRouteParam(request.headers['x-correlation-id']);
  return /^[A-Za-z0-9._:-]{1,256}$/.test(value) ? value : randomUUID();
}

function bodyField(body: unknown, field: string): string | undefined {
  let value: unknown = body;
  for (const segment of field.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value)
    ? value
    : undefined;
}

function pluginServiceBaseUrl(
  pluginId: PluginId,
  resources: PluginResourceDescriptorV1,
): string {
  return `http://eg-plugin-${pluginId.replace(/\./g, '-')}:${
    resources.service.containerPort
  }`;
}

function operationAuthorizationV1(input: {
  operation: PluginBackendOperationV1;
  boundRef?: string;
}): { actionId: string; resourceType: 'platform' | 'engine'; resourceRef?: string } | null {
  const declared = input.operation.authorization;
  if (declared?.resource === 'platform.self') {
    return {
      actionId: declared.actionId,
      resourceType: 'platform',
    };
  }
  if (declared?.resource === 'engine.binding' && input.boundRef) {
    return {
      actionId: declared.actionId,
      resourceType: 'engine',
      resourceRef: input.boundRef,
    };
  }

  // SDK 0.1/0.2 manifests did not yet declare an end-user action. Preserve
  // their wire compatibility but make the host choose a conservative static
  // FGA baseline; a plugin never receives an implicit bypass.
  if (input.operation.resourceBinding?.kind === 'engine' && input.boundRef) {
    return {
      actionId: 'engine.instances.read',
      resourceType: 'engine',
      resourceRef: input.boundRef,
    };
  }
  if (!input.operation.resourceBinding) {
    return {
      actionId: 'platform.dashboard.read',
      resourceType: 'platform',
    };
  }
  return null;
}

async function defaultPluginOperationAuthorizerV1(
  input: PluginOperationAuthorizationInputV1,
): Promise<boolean> {
  if (input.resourceType === 'engine') {
    if (!input.resourceRef) return false;
    const dataSource = await getDataSource();
    const engine = await dataSource.getRepository(Engine).findOne({
      where: { id: input.resourceRef },
      select: ['id', 'tenantId'],
    });
    if (
      !engine ||
      !isTenantVisibleForAuthz(engine.tenantId, input.tenantRef)
    ) {
      return false;
    }
  }
  const decision = await evaluateResolvedAuthzAction({
    actionId: input.actionId,
    userId: input.subjectRef,
    tenantId: input.tenantRef,
    resource: {
      type: input.resourceType,
      ...(input.resourceRef ? { id: input.resourceRef } : {}),
    },
  });
  return decision.allowed;
}

async function readInvocationPrivateKey(): Promise<string> {
  const path =
    process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE?.trim();
  if (!path) throw new Error('Plugin invocation signing key is not configured');
  try {
    const bytes = await readSecureRegularFileV1(path, {
      maxBytes: INVOCATION_PRIVATE_KEY_MAX_BYTES,
    });
    return bytes.toString('utf8');
  } catch {
    throw new Error('Plugin invocation signing key file is invalid');
  }
}

async function readInvocationPublicKey(): Promise<string> {
  return createPublicKey(await readInvocationPrivateKey())
    .export({ type: 'spki', format: 'pem' })
    .toString();
}

async function handlePluginSecretUse(
  runtime: PluginHostRuntimeV1,
  control: PluginControlPlaneV1,
  request: Request,
  response: Response,
): Promise<void> {
  const pluginId = requestParam(request, 'pluginId');
  const record = await runtime.backendRecord(pluginId);
  if (!record) {
    throw new SecretBrokerErrorV1(404, 'plugin_unavailable');
  }
  if (
    !(await control.isExecutionAllowed(record.pluginId, DEFAULT_TENANT_ID))
  ) {
    throw new SecretBrokerErrorV1(404, 'plugin_unavailable');
  }
  const parsed = pluginSecretUseRequestV1Schema.safeParse(request.body);
  if (!parsed.success) {
    throw new SecretBrokerErrorV1(400, 'request_invalid');
  }
  const invocationToken = request.header(
    'x-enterpriseglue-plugin-invocation',
  );
  if (!invocationToken) {
    throw new SecretBrokerErrorV1(401, 'invocation_invalid');
  }
  const policyFile =
    process.env.ENTERPRISEGLUE_PLUGIN_SECRET_BROKER_POLICY_FILE?.trim();
  if (!policyFile) {
    throw new SecretBrokerErrorV1(503, 'policy_unavailable');
  }
  const result = await executePluginSecretUseV1({
    record,
    request: parsed.data,
    invocationToken,
    invocationPublicKey: await readInvocationPublicKey(),
    expectedDeploymentRef:
      process.env.ENTERPRISEGLUE_DEPLOYMENT_REF?.trim() || 'oss-deployment',
    policy: await loadPluginSecretBrokerPolicyV1(policyFile),
    replayStore: new DatabasePluginBrokerReplayStoreV1(
      record.pluginId,
      parsed.data.callId,
    ),
    secretRoot:
      process.env.ENTERPRISEGLUE_PLUGIN_SECRET_BROKER_SECRET_ROOT?.trim(),
    allowInsecureLoopback:
      process.env.ENTERPRISEGLUE_PLUGIN_SECRET_BROKER_ALLOW_INSECURE_LOOPBACK ===
      'true',
  });
  response.setHeader('Cache-Control', 'no-store');
  response.status(200).json(result);
}

async function handlePluginOperation(
  runtime: PluginHostRuntimeV1,
  control: PluginControlPlaneV1,
  admission: PluginGatewayAdmissionV1,
  circuitBreaker: PluginGatewayCircuitBreakerV1,
  operationAuthorizer: PluginOperationAuthorizerV1,
  resourceAuthorizer: PluginResourceAuthorizerV1 | undefined,
  request: Request,
  response: Response,
): Promise<void> {
  const pluginId = requestParam(request, 'pluginId');
  const operationId = requestParam(request, 'operationId');
  const record = await runtime.backendRecord(pluginId);
  if (!record) {
    response.status(404).json({ error: 'Plugin operation not available' });
    return;
  }
  if (
    !(await control.isExecutionAllowed(
      record.pluginId,
      request.tenant?.tenantId,
    ))
  ) {
    response.status(404).json({ error: 'Plugin operation not available' });
    return;
  }
  const backend = record.manifest.deployment.backend;
  if (!backend) {
    response.status(404).json({ error: 'Plugin operation not available' });
    return;
  }
  const operation = backend.operations.find(
    (candidate) => candidate.operationId === operationId,
  );
  if (!operation) {
    response.status(404).json({ error: 'Plugin operation not available' });
    return;
  }
  if (operation.streaming === 'upload') {
    response.status(501).json({ error: 'Upload plugin operation unavailable' });
    return;
  }

  const envelope =
    request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? (request.body as Record<string, unknown>)
      : {};
  const forwardedBody =
    request.method === 'GET' || request.method === 'DELETE'
      ? undefined
      : envelope.body;
  const requestedPath =
    typeof envelope.path === 'string'
      ? envelope.path
      : typeof request.query.path === 'string'
        ? request.query.path
        : operation.path;
  const requestBytes =
    forwardedBody === undefined
      ? 0
      : Buffer.byteLength(JSON.stringify(forwardedBody), 'utf8');
  try {
    authorizePluginGatewayInvocationV1({
      manifest: record.manifest,
      pluginId: record.pluginId,
      operationId,
      method: request.method,
      relativePath: requestedPath,
      requestBytes,
      grantedPermissions: record.grantedPermissions,
    });
  } catch (error) {
    if (error instanceof PluginGatewayError) {
      if (error.code === 'permission_denied') {
        response.status(403).json({ error: 'Plugin permission denied' });
        return;
      }
      if (error.code === 'request_too_large') {
        response.status(413).json({ error: 'Plugin request is too large' });
        return;
      }
      if (
        error.code === 'operation_unknown' ||
        error.code === 'operation_method_invalid' ||
        error.code === 'operation_path_invalid'
      ) {
        response.status(404).json({ error: 'Plugin operation not available' });
        return;
      }
    }
    throw error;
  }
  let admissionLease: PluginGatewayAdmissionLeaseV1;
  try {
    admissionLease = await admission.acquire({
      pluginId: record.pluginId,
      operationId,
      tenantRef: request.tenant?.tenantId,
      subjectRef: request.user!.userId,
      leaseTtlMs: Math.min(operation.timeoutMs + 10_000, 10 * 60_000),
    });
  } catch (error) {
    if (
      error instanceof PluginGatewayError &&
      (error.code === 'rate_limited' ||
        error.code === 'concurrency_limited')
    ) {
      response.status(429).json({ error: 'Plugin operation is busy' });
      return;
    }
    if (
      error instanceof PluginGatewayError &&
      error.code === 'admission_unavailable'
    ) {
      response.status(503).json({ error: 'Plugin operation unavailable' });
      return;
    }
    throw error;
  }
  try {
  try {
    await runtime.assertOperationPayload(
      record.pluginId,
      operationId,
      'request',
      forwardedBody ?? null,
    );
  } catch (error) {
    if (
      error instanceof PluginGatewayError &&
      error.code === 'request_schema_invalid'
    ) {
      response.status(400).json({
        error: 'Plugin request does not satisfy the operation contract',
      });
      return;
    }
    throw error;
  }

  const pathParameters = matchPluginOperationPathV1(
    operation.path,
    requestedPath,
  );
  const boundRef = operation.resourceBinding
    ? operation.resourceBinding.source === 'body'
      ? bodyField(forwardedBody, operation.resourceBinding.field)
      : pathParameters?.[operation.resourceBinding.field]
    : undefined;
  if (operation.resourceBinding && !boundRef) {
    response.status(400).json({ error: 'Required resource reference is missing' });
    return;
  }
  const operationAuthorization = operationAuthorizationV1({
    operation,
    ...(boundRef ? { boundRef } : {}),
  });
  if (!operationAuthorization) {
    response.status(403).json({ error: 'Plugin operation is not authorized' });
    return;
  }
  if (
    !(await operationAuthorizer({
      pluginId: record.pluginId,
      operationId,
      actionId: operationAuthorization.actionId,
      subjectRef: request.user!.userId,
      tenantRef: request.tenant?.tenantId,
      resourceType: operationAuthorization.resourceType,
      resourceRef: operationAuthorization.resourceRef,
    }))
  ) {
    response.status(403).json({ error: 'Plugin operation is not authorized' });
    return;
  }
  if (
    operation.resourceBinding &&
    boundRef &&
    resourceAuthorizer &&
    !(await resourceAuthorizer({
      pluginId: record.pluginId,
      operationId,
      subjectRef: request.user!.userId,
      tenantRef: request.tenant?.tenantId,
      resourceKind: operation.resourceBinding.kind,
      resourceRef: boundRef,
    }))
  ) {
    response.status(403).json({ error: 'Plugin resource is not accessible' });
    return;
  }

  let circuitLease: PluginGatewayCircuitLeaseV1;
  try {
    circuitLease = circuitBreaker.acquire(record.pluginId, operationId);
  } catch (error) {
    if (
      error instanceof PluginGatewayError &&
      error.code === 'circuit_open'
    ) {
      response.status(503).json({ error: 'Plugin operation unavailable' });
      return;
    }
    throw error;
  }
  try {
  const baseUrl = pluginServiceBaseUrl(record.pluginId, record.resources);
  const capabilityResponse = await fetch(`${baseUrl}${backend.protocolPath}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(Math.min(operation.timeoutMs, 5_000)),
  });
  if (!capabilityResponse.ok) {
    throw new Error('Plugin capability handshake failed');
  }
  const capabilityLength = Number(
    capabilityResponse.headers.get('content-length'),
  );
  if (
    Number.isFinite(capabilityLength) &&
    capabilityLength > CAPABILITY_DOCUMENT_MAX_BYTES
  ) {
    throw new Error('Plugin capability document is too large');
  }
  const capabilityBytes = Buffer.from(await capabilityResponse.arrayBuffer());
  if (capabilityBytes.byteLength > CAPABILITY_DOCUMENT_MAX_BYTES) {
    throw new Error('Plugin capability document is too large');
  }
  validatePluginBackendCapabilitiesV1(
    record.manifest,
    JSON.parse(capabilityBytes.toString('utf8')),
  );

  const now = Math.floor(Date.now() / 1_000);
  const correlationId = safeCorrelationId(request);
  const token = signPluginInvocationV1(
    {
      iss: 'enterpriseglue-oss',
      aud: record.pluginId,
      sub: request.user!.userId,
      iat: now,
      exp: now + 30,
      jti: randomUUID(),
      tenantRef: request.tenant?.tenantId,
      deploymentRef:
        process.env.ENTERPRISEGLUE_DEPLOYMENT_REF?.trim() || 'oss-deployment',
      operationId,
      grantedPermissions: record.grantedPermissions,
      resourceRefs:
        operation.resourceBinding && boundRef
          ? [{ kind: operation.resourceBinding.kind, ref: boundRef }]
          : undefined,
      correlationId,
    },
    await readInvocationPrivateKey(),
  );

  const streamController =
    operation.streaming === 'sse' ? new AbortController() : undefined;
  let clientDisconnected = false;
  const onClientDisconnect = (): void => {
    if (response.writableEnded) return;
    clientDisconnected = true;
    streamController?.abort();
  };
  if (streamController) response.once('close', onClientDisconnect);
  const streamTimeout = streamController
    ? setTimeout(() => streamController.abort(), operation.timeoutMs)
    : undefined;
  let pluginResponse: Awaited<ReturnType<typeof fetch>>;
  try {
    pluginResponse = await fetch(`${baseUrl}/${requestedPath}`, {
      method: operation.method,
      redirect: 'error',
      headers: {
        Accept:
          operation.streaming === 'sse'
            ? 'text/event-stream'
            : 'application/json',
        'Content-Type': 'application/json',
        'X-EnterpriseGlue-Plugin-Invocation': token,
        'X-Correlation-ID': correlationId,
      },
      body:
        forwardedBody === undefined ? undefined : JSON.stringify(forwardedBody),
      signal:
        streamController?.signal ?? AbortSignal.timeout(operation.timeoutMs),
    });
    if (operation.streaming === 'sse') {
      if (pluginResponse.status >= 500) {
        throw new Error('Plugin operation failed');
      }
      if (pluginResponse.status < 200 || pluginResponse.status >= 300) {
        circuitLease.succeed();
        response
          .status(pluginResponse.status)
          .json({ error: 'Plugin operation rejected' });
        return;
      }
      const relayResult = await relayValidatedPluginSseV1({
        upstream: pluginResponse,
        downstream: response,
        maximumBytes: operation.maxResponseBytes,
        assertEvent: (payload) =>
          runtime.assertOperationPayload(
            record.pluginId,
            operationId,
            'response',
            payload,
          ),
        isClientDisconnected: () => clientDisconnected,
      });
      if (relayResult === 'upstream_invalid') {
        circuitLease.fail();
        if (!response.headersSent) {
          response
            .status(502)
            .json({ error: 'Plugin stream violated its operation contract' });
        }
        return;
      }
      circuitLease.succeed();
      return;
    }
  } catch (error) {
    if (clientDisconnected) {
      circuitLease.succeed();
      return;
    }
    throw error;
  } finally {
    if (streamTimeout) clearTimeout(streamTimeout);
    if (streamController) {
      response.removeListener('close', onClientDisconnect);
    }
  }
  const declaredLength = Number(pluginResponse.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > operation.maxResponseBytes
  ) {
    throw new Error('Plugin response exceeds its declared maximum');
  }
  const bytes = Buffer.from(await pluginResponse.arrayBuffer());
  if (bytes.byteLength > operation.maxResponseBytes) {
    throw new Error('Plugin response exceeds its declared maximum');
  }
  if (pluginResponse.status >= 500) {
    throw new Error('Plugin operation failed');
  }
  if (pluginResponse.status < 200 || pluginResponse.status >= 300) {
    circuitLease.succeed();
    response
      .status(pluginResponse.status)
      .json({ error: 'Plugin operation rejected' });
    return;
  }
  const contentType = pluginResponse.headers.get('content-type');
  if (
    !contentType ||
    !/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(contentType)
  ) {
    throw new PluginGatewayError(
      'response_schema_invalid',
      'Plugin operation returned a non-JSON success response',
    );
  }
  let responseBody: unknown;
  try {
    responseBody = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new PluginGatewayError(
      'response_schema_invalid',
      'Plugin operation returned invalid JSON',
    );
  }
  await runtime.assertOperationPayload(
    record.pluginId,
    operationId,
    'response',
    responseBody,
  );
  circuitLease.succeed();
  response.status(pluginResponse.status);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.json(responseBody);
  } catch (error) {
    circuitLease.fail();
    throw error;
  }
  } finally {
    await admissionLease.release();
  }
}

export function registerPluginPlatformRoutes(
  app: Express,
  runtime = (defaultRuntime ??= new PluginHostRuntimeV1()),
  control?: PluginControlPlaneV1,
  options: PluginPlatformRouteOptionsV1 = {},
): void {
  const activeControl =
    control ??
    (runtime === defaultRuntime
      ? (defaultControlPlane ??= new PluginControlPlaneV1(
          runtime,
          new DatabasePluginControlStoreV1(),
          { defaultTenantRef: DEFAULT_TENANT_ID },
        ))
      : new PluginControlPlaneV1(
          runtime,
          new DatabasePluginControlStoreV1(),
          { defaultTenantRef: DEFAULT_TENANT_ID },
        ));
  const gatewayAdmission =
    options.gatewayAdmission ?? defaultPluginGatewayAdmissionV1();
  const gatewayCircuitBreaker =
    options.gatewayCircuitBreaker ?? defaultPluginGatewayCircuitBreakerV1();
  const diagnosticMetrics =
    options.diagnosticMetrics ?? new PluginDiagnosticMetricsRegistryV1();
  const eventMetrics =
    options.eventMetrics ?? new PluginEventMetricsRegistryV1();
  const availabilityStore =
    options.availabilityDispatcher?.store ??
    options.availabilityStore ??
    new DatabasePluginContributionAvailabilityStoreV1();
  const availabilityDispatcher =
    options.availabilityDispatcher ??
    new PluginContributionAvailabilityDispatcherV1(runtime, activeControl, {
      deploymentRef:
        process.env.ENTERPRISEGLUE_DEPLOYMENT_REF?.trim() ?? 'oss-deployment',
      invocationPrivateKey: readInvocationPrivateKey,
      admission: gatewayAdmission,
      circuitBreaker: gatewayCircuitBreaker,
      store: availabilityStore,
    });
  app.locals.enterpriseGluePluginContributionAvailabilityDispatcher =
    availabilityDispatcher;
  if (options.startAvailabilityWorker ?? process.env.NODE_ENV !== 'test') {
    availabilityDispatcher.start();
  }
  const eventStore = new DatabasePluginEventDeliveryStoreV1(
    undefined,
    undefined,
    undefined,
    eventMetrics,
  );
  const eventDispatcher =
    options.eventDispatcher ??
    new PluginEventDispatcherV1(runtime, activeControl, {
      deploymentRef:
        process.env.ENTERPRISEGLUE_DEPLOYMENT_REF?.trim() ?? 'oss-deployment',
      invocationPrivateKey: readInvocationPrivateKey,
      store: eventStore,
    });
  app.locals.enterpriseGluePluginEventDispatcher = eventDispatcher;
  if (
    options.startEventWorker ??
    process.env.NODE_ENV !== 'test'
  ) {
    eventDispatcher.start();
  }
  const defaultScheduleStore = new DatabasePluginScheduleStoreV1();
  const scheduleStore =
    options.hostBroker?.scheduleStore ?? defaultScheduleStore;
  const scheduleDispatcher =
    options.scheduleDispatcher ??
    new PluginScheduleDispatcherV1(runtime, activeControl, {
      deploymentRef:
        process.env.ENTERPRISEGLUE_DEPLOYMENT_REF?.trim() ?? 'oss-deployment',
      invocationPrivateKey: readInvocationPrivateKey,
      store: defaultScheduleStore,
    });
  app.locals.enterpriseGluePluginScheduleDispatcher = scheduleDispatcher;
  if (options.startScheduleWorker ?? process.env.NODE_ENV !== 'test') {
    scheduleDispatcher.start();
  }
  const engineEventPoller =
    options.engineEventPoller ?? new PluginEngineEventPollerV1(eventDispatcher);
  app.locals.enterpriseGluePluginEngineEventPoller = engineEventPoller;
  if (
    options.startEngineEventPoller ??
    process.env.ENTERPRISEGLUE_PLUGIN_ENGINE_EVENT_POLLING_ENABLED === 'true'
  ) {
    engineEventPoller.start();
  }
  const frontendBootstrapHandler = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
      try {
        const bootstrap = await runtime.frontendBootstrap();
        const tenantRef = req.tenant?.tenantId ?? DEFAULT_TENANT_ID;
        const enabled = await activeControl.enabledPluginIds(tenantRef);
        const plugins = await Promise.all(
          bootstrap.plugins
            .filter((plugin) => enabled.has(plugin.pluginId))
            .map(async (plugin) => {
              if (!plugin.manifest.contributionAvailability) return plugin;
              let contributionAvailability:
                | PluginContributionAvailabilityProjectionV1
                | null = null;
              try {
                contributionAvailability = await availabilityStore.readCurrent({
                  deploymentRef:
                    process.env.ENTERPRISEGLUE_DEPLOYMENT_REF?.trim() ??
                    'oss-deployment',
                  tenantRef,
                  pluginId: plugin.pluginId,
                  pluginVersion: plugin.version,
                  installerRevision: bootstrap.revision,
                  now: Date.now(),
                });
              } catch {
                contributionAvailability = null;
              }
              return { ...plugin, contributionAvailability };
            }),
        );
        res.setHeader('Cache-Control', 'no-store');
        res.json({
          ...bootstrap,
          plugins,
        });
      } catch (error) {
        next(error);
      }
  };
  app.get(
    '/api/plugins/v1/frontend',
    frontendBootstrapHandler,
  );
  app.get(
    '/t/:tenantSlug/api/plugins/v1/frontend',
    requireAuth,
    resolveTenantContext({ required: true }),
    frontendBootstrapHandler,
  );

  app.get(
    '/_enterpriseglue/plugins/:pluginId/:version/*assetPath',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const rawAssetPath = (req.params as Record<string, string | string[]>)
          .assetPath;
        const assetPath = Array.isArray(rawAssetPath)
          ? rawAssetPath.join('/')
          : rawAssetPath;
        const asset = await runtime.readAsset(
          firstRouteParam(req.params.pluginId),
          firstRouteParam(req.params.version),
          assetPath ?? '',
        );
        if (!asset) {
          res.status(404).json({ error: 'Plugin asset not available' });
          return;
        }
        res.setHeader('Content-Type', asset.contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.send(asset.bytes);
      } catch (error) {
        next(error);
      }
    },
  );

  const operationMiddleware = options.operationMiddleware ?? [
    requireAuth,
    resolveTenantContext({ required: true }),
  ];
  const operationHandler = (
    request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
    handlePluginOperation(
      runtime,
      activeControl,
      gatewayAdmission,
      gatewayCircuitBreaker,
      options.operationAuthorizer ?? defaultPluginOperationAuthorizerV1,
      options.resourceAuthorizer,
      request,
      response,
    ).catch(() => {
      console.error('[Plugin gateway] Operation failed');
      if (!response.headersSent) {
        response.status(502).json({ error: 'Plugin gateway unavailable' });
      }
    });
  };
  app.all(
    '/api/plugins/v1/:pluginId/operations/:operationId',
    ...operationMiddleware,
    operationHandler,
  );
  app.all(
    '/t/:tenantSlug/api/plugins/v1/:pluginId/operations/:operationId',
    ...operationMiddleware,
    operationHandler,
  );

  app.post(
    '/_enterpriseglue/plugin-broker/v1/:pluginId/secrets/use',
    (request: Request, response: Response) => {
      handlePluginSecretUse(runtime, activeControl, request, response).catch(
        (error: unknown) => {
          if (error instanceof SecretBrokerErrorV1) {
            response.status(error.status).json({ code: error.code });
            return;
          }
          console.error('[Plugin secret broker] Operation failed');
          response.status(503).json({ code: 'upstream_unavailable' });
        },
      );
    },
  );
  registerPluginHostBrokerRoutesV1(app, runtime, activeControl, {
    invocationPublicKey:
      options.hostBroker?.invocationPublicKey ?? readInvocationPublicKey,
    expectedDeploymentRef:
      options.hostBroker?.expectedDeploymentRef ??
      process.env.ENTERPRISEGLUE_DEPLOYMENT_REF?.trim() ??
      'oss-deployment',
    storageStore:
      options.hostBroker?.storageStore ?? new DatabasePluginStorageStoreV1(),
    notificationPublisher:
      options.hostBroker?.notificationPublisher ??
      new DatabasePluginNotificationPublisherV1(),
    scheduleStore,
    resourceLoader: options.hostBroker?.resourceLoader,
    replayStoreFactory: options.hostBroker?.replayStoreFactory,
    diagnosticCollector:
      options.hostBroker?.diagnosticCollector ??
      configuredLocalDiagnosticCollector(diagnosticMetrics),
    allowSanitizedBundleAuto:
      options.hostBroker?.allowSanitizedBundleAuto ??
      process.env
        .ENTERPRISEGLUE_PLUGIN_DIAGNOSTIC_AUTO_COLLECTION_ENABLED === 'true',
  });
  registerPluginControlRoutesV1(app, activeControl, {
    ...options.controlRouteMiddleware,
    diagnosticMetrics,
    eventMetrics,
    eventOperations: eventStore,
    capabilityCatalog: runtime.platformCapabilities(),
  });
}

function configuredLocalDiagnosticCollector(
  metrics: PluginDiagnosticMetricsRegistryV1,
):
  | LocalSanitizedDiagnosticCollectorV1
  | undefined {
  const policyFile =
    process.env.ENTERPRISEGLUE_PLUGIN_DIAGNOSTIC_COLLECTOR_POLICY_FILE?.trim();
  return policyFile
    ? new LocalSanitizedDiagnosticCollectorV1(policyFile, { metrics })
    : undefined;
}
