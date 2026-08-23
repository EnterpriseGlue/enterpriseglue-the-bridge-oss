import { createHash } from 'node:crypto';
import {
  lstat,
  readFile,
  realpath,
} from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import {
  ociDigestReferenceSchema,
  type PluginResourceDescriptorV1,
} from '@enterpriseglue/plugin-sdk';

import {
  parsePluginLifecyclePlanEnvelopeV1,
  type PluginLifecyclePlanEnvelopeV1,
} from './execution.js';
import type {
  PluginLifecyclePhaseAdapterV1,
  PluginLifecyclePhaseExecutionContextV1,
} from './executionRunner.js';
import {
  parsePluginInstallerStateV1,
  pluginKubernetesPvcNameV1,
  pluginKubernetesResourceNameV1,
  type InstalledPluginRecordV1,
  type PluginInstallerStateV1,
} from './index.js';
import {
  KubernetesLifecycleErrorV1,
  SpawnClusterCommandPortV1,
  type ClusterCommandPortV1,
  type ClusterCommandResultV1,
} from './kubernetesExecutionStore.js';

const MAX_CLUSTER_INPUT_BYTES = 8 * 1024 * 1024;
const kubernetesNamePattern =
  /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

interface ResolvedClusterMaterialV1 {
  state: PluginInstallerStateV1;
  envelope: PluginLifecyclePlanEnvelopeV1;
  source?: InstalledPluginRecordV1;
  target?: InstalledPluginRecordV1;
}

interface KubernetesReceiptV1 {
  schemaVersion: 1;
  idempotencyKey: string;
  desiredRevision: number;
  planSha256: string;
  pluginId: string;
  operation: PluginLifecyclePhaseExecutionContextV1['operation'];
  phase: PluginLifecyclePhaseExecutionContextV1['phase'];
  completedAt: string;
}

interface KubernetesObjectV1 {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  [key: string]: unknown;
}

export interface KubernetesPluginLifecyclePhaseAdapterOptionsV1 {
  outputDirectory: string;
  projectDirectory: string;
  chartPath: string;
  valuesFile: string;
  namespace: string;
  releaseName: string;
  utilityImage: string;
  context?: string;
  artifactStorageMiB?: number;
  storageClassName?: string;
  imagePullSecrets?: readonly string[];
  runAsUser?: number | null;
  jobTimeoutSeconds?: number;
  rolloutTimeoutSeconds?: number;
  commandTimeoutMs?: number;
  command?: ClusterCommandPortV1;
}

function contained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

function safeKubernetesName(input: string, field: string): string {
  const value = input.trim();
  if (
    value.length < 1 ||
    value.length > 63 ||
    !kubernetesNamePattern.test(value)
  ) {
    throw new KubernetesLifecycleErrorV1(
      'cluster_configuration_invalid',
      `${field} is not a valid Kubernetes identifier`,
    );
  }
  return value;
}

function boundedInteger(
  input: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const value = input ?? fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new KubernetesLifecycleErrorV1(
      'cluster_configuration_invalid',
      `${field} is outside its supported range`,
    );
  }
  return value;
}

function storageShape(
  record: InstalledPluginRecordV1,
): PluginResourceDescriptorV1['storage'] {
  return [...record.resources.storage].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function findRecord(
  records: readonly InstalledPluginRecordV1[],
  version: string | undefined,
  dataSchemaVersion: number,
): InstalledPluginRecordV1 | undefined {
  if (!version) return undefined;
  return [...records]
    .reverse()
    .find(
      (record) =>
        record.version === version &&
        record.dataSchemaVersion === dataSchemaVersion,
    );
}

function sameStorage(
  source: InstalledPluginRecordV1,
  target: InstalledPluginRecordV1,
): boolean {
  return (
    JSON.stringify(storageShape(source)) ===
    JSON.stringify(storageShape(target))
  );
}

function receiptIdentity(
  context: PluginLifecyclePhaseExecutionContextV1,
): Omit<KubernetesReceiptV1, 'completedAt'> {
  return {
    schemaVersion: 1,
    idempotencyKey: context.idempotencyKey,
    desiredRevision: context.desiredRevision,
    planSha256: context.planSha256,
    pluginId: context.pluginId,
    operation: context.operation,
    phase: context.phase,
  };
}

function stableToken(input: string, length = 40): string {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

export class KubernetesPluginLifecyclePhaseAdapterV1
  implements PluginLifecyclePhaseAdapterV1
{
  private readonly outputDirectory: string;
  private readonly projectDirectory: string;
  private readonly chartPath: string;
  private readonly valuesFile: string;
  private readonly namespace: string;
  private readonly releaseName: string;
  private readonly utilityImage: string;
  private readonly context?: string;
  private readonly artifactStorageMiB: number;
  private readonly storageClassName?: string;
  private readonly imagePullSecrets: string[];
  private readonly runAsUser: number | null;
  private readonly jobTimeoutSeconds: number;
  private readonly rolloutTimeoutSeconds: number;
  private readonly commandTimeoutMs: number;
  private readonly command: ClusterCommandPortV1;

  constructor(
    options: KubernetesPluginLifecyclePhaseAdapterOptionsV1,
  ) {
    this.outputDirectory = resolve(options.outputDirectory);
    this.projectDirectory = resolve(options.projectDirectory);
    this.chartPath = resolve(options.chartPath);
    this.valuesFile = resolve(options.valuesFile);
    this.namespace = safeKubernetesName(
      options.namespace,
      'namespace',
    );
    this.releaseName = safeKubernetesName(
      options.releaseName,
      'Helm release name',
    );
    this.utilityImage = ociDigestReferenceSchema.parse(
      options.utilityImage,
    );
    this.context = options.context?.trim() || undefined;
    this.artifactStorageMiB = boundedInteger(
      options.artifactStorageMiB,
      2_048,
      64,
      1_048_576,
      'artifactStorageMiB',
    );
    this.storageClassName =
      options.storageClassName?.trim() || undefined;
    if (
      this.storageClassName &&
      (this.storageClassName.length > 253 ||
        !/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(
          this.storageClassName,
        ))
    ) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_configuration_invalid',
        'StorageClass name is invalid',
      );
    }
    this.imagePullSecrets = [
      ...new Set(options.imagePullSecrets ?? []),
    ].map((name) => safeKubernetesName(name, 'image pull secret'));
    if (this.imagePullSecrets.length > 8) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_configuration_invalid',
        'At most eight image pull secrets are supported',
      );
    }
    if (
      options.runAsUser !== null &&
      options.runAsUser !== undefined &&
      (!Number.isInteger(options.runAsUser) ||
        options.runAsUser < 1 ||
        options.runAsUser > 2_147_483_647)
    ) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_configuration_invalid',
        'runAsUser is invalid',
      );
    }
    this.runAsUser =
      options.runAsUser === undefined ? 65_532 : options.runAsUser;
    this.jobTimeoutSeconds = boundedInteger(
      options.jobTimeoutSeconds,
      900,
      30,
      7_200,
      'jobTimeoutSeconds',
    );
    this.rolloutTimeoutSeconds = boundedInteger(
      options.rolloutTimeoutSeconds,
      300,
      10,
      1_800,
      'rolloutTimeoutSeconds',
    );
    this.commandTimeoutMs = boundedInteger(
      options.commandTimeoutMs,
      20 * 60_000,
      1_000,
      30 * 60_000,
      'commandTimeoutMs',
    );
    this.command = options.command ?? new SpawnClusterCommandPortV1();
  }

  async executePhase(
    context: PluginLifecyclePhaseExecutionContextV1,
  ): Promise<void> {
    await this.validateDeploymentPaths();
    if (await this.receiptExists(context)) return;
    const material = await this.loadMaterial(context);
    await this.withHeartbeat(context, async () => {
      switch (context.phase) {
        case 'stage':
          await this.stage(context, material);
          break;
        case 'drain':
          await this.drain(context.pluginId);
          break;
        case 'deactivate':
          await this.deleteRuntime(context.pluginId, false);
          break;
        case 'checkpoint':
          await this.checkpoint(context, material);
          break;
        case 'migrate':
          await this.migrate(context, material);
          break;
        case 'activate':
          await this.helmUpgrade();
          break;
        case 'ready':
          await this.ready(context);
          break;
        case 'retain_data':
          break;
        case 'export_data':
          await this.exportData(context, material);
          break;
        case 'delete_data':
          await this.deleteData(material);
          break;
        case 'remove':
          await this.deleteRuntime(context.pluginId, true);
          break;
        case 'commit':
          if (material.envelope.plan?.phases.includes('activate')) {
            await this.helm([
              'status',
              this.releaseName,
              '--namespace',
              this.namespace,
            ]);
          } else {
            await this.helmUpgrade();
          }
          break;
      }
    });
    await this.writeReceipt(context);
  }

  private async withHeartbeat<T>(
    context: PluginLifecyclePhaseExecutionContextV1,
    work: () => Promise<T>,
  ): Promise<T> {
    const intervalMs = Math.max(
      250,
      Math.min(10_000, Math.floor(context.leaseDurationMs / 3)),
    );
    let heartbeat = Promise.resolve();
    let heartbeatError: unknown;
    const timer = setInterval(() => {
      heartbeat = heartbeat
        .then(() => context.renewLease())
        .catch((error) => {
          heartbeatError = error;
        });
    }, intervalMs);
    timer.unref();
    let result: T | undefined;
    let workFailed = false;
    let workError: unknown;
    try {
      result = await work();
    } catch (error) {
      workFailed = true;
      workError = error;
    } finally {
      clearInterval(timer);
    }
    await heartbeat;
    if (heartbeatError) throw heartbeatError;
    if (workFailed) throw workError;
    await context.renewLease();
    return result as T;
  }

  private async validateDeploymentPaths(): Promise<void> {
    const project = await lstat(this.projectDirectory).catch(
      () => undefined,
    );
    const output = await lstat(this.outputDirectory).catch(
      () => undefined,
    );
    const chart = await lstat(this.chartPath).catch(() => undefined);
    const values = await lstat(this.valuesFile).catch(() => undefined);
    if (
      !project?.isDirectory() ||
      project.isSymbolicLink() ||
      !output?.isDirectory() ||
      output.isSymbolicLink() ||
      !chart?.isDirectory() ||
      chart.isSymbolicLink() ||
      !values?.isFile() ||
      values.isSymbolicLink() ||
      values.size > MAX_CLUSTER_INPUT_BYTES
    ) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_configuration_invalid',
        'Cluster project, output, chart, and values inputs are invalid',
      );
    }
    const projectReal = await realpath(this.projectDirectory);
    for (const path of [
      await realpath(this.outputDirectory),
      await realpath(this.chartPath),
      await realpath(this.valuesFile),
    ]) {
      if (!contained(projectReal, path)) {
        throw new KubernetesLifecycleErrorV1(
          'cluster_configuration_invalid',
          'Cluster lifecycle inputs must remain inside the project directory',
        );
      }
    }
    if (
      this.valuesFile !==
      resolve(
        this.outputDirectory,
        'helm.plugins.generated.values.yaml',
      )
    ) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_configuration_invalid',
        'Cluster lifecycle must use the generated Helm values file',
      );
    }
  }

  private async loadMaterial(
    context: PluginLifecyclePhaseExecutionContextV1,
  ): Promise<ResolvedClusterMaterialV1> {
    let state: PluginInstallerStateV1;
    let envelope: PluginLifecyclePlanEnvelopeV1;
    try {
      state = parsePluginInstallerStateV1(
        await this.readBoundedJson(
          resolve(
            this.outputDirectory,
            'plugin-installer-state.json',
          ),
        ),
      );
      envelope = parsePluginLifecyclePlanEnvelopeV1(
        await this.readBoundedJson(
          resolve(
            this.outputDirectory,
            'plugin-lifecycle-plan.json',
          ),
        ),
      );
    } catch {
      throw new KubernetesLifecycleErrorV1(
        'cluster_state_invalid',
        'Cluster lifecycle state or plan is invalid',
      );
    }
    if (
      state.revision !== context.desiredRevision ||
      envelope.desiredRevision !== context.desiredRevision ||
      envelope.planSha256 !== context.planSha256 ||
      envelope.plan?.pluginId !== context.pluginId ||
      envelope.plan.operation !== context.operation ||
      !envelope.plan.phases.includes(context.phase)
    ) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_state_invalid',
        'Cluster lifecycle material differs from the claimed execution',
      );
    }
    const current = state.plugins[context.pluginId];
    const previous = state.previous[context.pluginId] ?? [];
    const target =
      current &&
      current.version === context.toVersion &&
      current.dataSchemaVersion === context.toDataSchema
        ? current
        : findRecord(
            previous,
            context.toVersion,
            context.toDataSchema,
          );
    const source =
      current &&
      current.version === context.fromVersion &&
      current.dataSchemaVersion === context.fromDataSchema
        ? current
        : findRecord(
            previous,
            context.fromVersion,
            context.fromDataSchema,
          );
    if (
      ['stage', 'migrate', 'activate', 'ready'].includes(
        context.phase,
      ) &&
      !target
    ) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_state_invalid',
        'Target plugin record is unavailable',
      );
    }
    if (
      [
        'drain',
        'deactivate',
        'checkpoint',
        'retain_data',
        'export_data',
        'delete_data',
        'remove',
      ].includes(context.phase) &&
      context.operation !== 'install' &&
      !source
    ) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_state_invalid',
        'Source plugin record is unavailable',
      );
    }
    if (
      source &&
      target &&
      (context.operation === 'upgrade' ||
        context.operation === 'rollback') &&
      !sameStorage(source, target)
    ) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_state_invalid',
        'Plugin storage changed across the lifecycle boundary',
      );
    }
    return { state, envelope, source, target };
  }

  private async stage(
    context: PluginLifecyclePhaseExecutionContextV1,
    material: ResolvedClusterMaterialV1,
  ): Promise<void> {
    await this.helm(['lint', this.chartPath, '--values', this.valuesFile]);
    await this.helm([
      'template',
      this.releaseName,
      this.chartPath,
      '--namespace',
      this.namespace,
      '--values',
      this.valuesFile,
    ]);
    await this.ensureLifecycleNetworkPolicy();
    const target = material.target!;
    for (const storage of storageShape(target)) {
      await this.ensurePvc(
        pluginKubernetesPvcNameV1(
          target.pluginId,
          target.dataSchemaVersion,
          storage.name,
        ),
        target.pluginId,
        String(target.dataSchemaVersion),
        storage.name,
        storage.sizeMiB,
      );
    }
    if (target.resources.storage.length > 0) {
      await this.ensureArtifactPvc(context.pluginId);
    }
  }

  private async drain(
    pluginId: InstalledPluginRecordV1['pluginId'],
  ): Promise<void> {
    const deployment = pluginKubernetesResourceNameV1(pluginId);
    if (!(await this.getJson('deployment', deployment))) return;
    await this.kubectl([
      'scale',
      'deployment',
      deployment,
      '--replicas',
      '0',
    ]);
  }

  private async checkpoint(
    context: PluginLifecyclePhaseExecutionContextV1,
    material: ResolvedClusterMaterialV1,
  ): Promise<void> {
    const source = material.source;
    if (!source || source.resources.storage.length === 0) return;
    await this.requireStoragePvcs(source);
    await this.ensureArtifactPvc(context.pluginId);
    const target = material.target;
    const copyTarget =
      Boolean(target) &&
      source.dataSchemaVersion !== target!.dataSchemaVersion;
    if (copyTarget) {
      for (const storage of storageShape(target!)) {
        await this.ensurePvc(
          pluginKubernetesPvcNameV1(
            target!.pluginId,
            target!.dataSchemaVersion,
            storage.name,
          ),
          target!.pluginId,
          String(target!.dataSchemaVersion),
          storage.name,
          storage.sizeMiB,
        );
      }
    }
    await this.runJob(
      context,
      this.utilityJob(
        context,
        source,
        target,
        'checkpoint',
        copyTarget,
      ),
    );
  }

  private async exportData(
    context: PluginLifecyclePhaseExecutionContextV1,
    material: ResolvedClusterMaterialV1,
  ): Promise<void> {
    const source = material.source!;
    if (source.resources.storage.length === 0) return;
    await this.requireStoragePvcs(source);
    await this.ensureArtifactPvc(context.pluginId);
    await this.runJob(
      context,
      this.utilityJob(context, source, undefined, 'export', false),
    );
  }

  private async migrate(
    context: PluginLifecyclePhaseExecutionContextV1,
    material: ResolvedClusterMaterialV1,
  ): Promise<void> {
    const target = material.target!;
    if (!context.migrationImage) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_state_invalid',
        'Migration phase has no immutable image',
      );
    }
    ociDigestReferenceSchema.parse(context.migrationImage);
    const volumes = storageShape(target).map((storage) => ({
      name: storage.name,
      persistentVolumeClaim: {
        claimName: pluginKubernetesPvcNameV1(
          target.pluginId,
          target.dataSchemaVersion,
          storage.name,
        ),
      },
    }));
    const job = this.jobBase(context, context.migrationImage, {
      env: [
        ['ENTERPRISEGLUE_PLUGIN_ID', context.pluginId],
        ['ENTERPRISEGLUE_PLUGIN_OPERATION', context.operation],
        [
          'ENTERPRISEGLUE_PLUGIN_FROM_SCHEMA',
          String(context.fromDataSchema),
        ],
        [
          'ENTERPRISEGLUE_PLUGIN_TO_SCHEMA',
          String(context.toDataSchema),
        ],
        [
          'ENTERPRISEGLUE_PLUGIN_IDEMPOTENCY_KEY',
          context.idempotencyKey,
        ],
      ],
      volumeMounts: storageShape(target).map((storage) => ({
        name: storage.name,
        mountPath: storage.mountPath,
        readOnly: storage.readOnly,
      })),
      volumes,
    });
    await this.runJob(context, job);
  }

  private async ready(
    context: PluginLifecyclePhaseExecutionContextV1,
  ): Promise<void> {
    const deployment = pluginKubernetesResourceNameV1(
      context.pluginId,
    );
    if (!(await this.getJson('deployment', deployment))) {
      // A previous readiness attempt removes an unhealthy candidate. Re-run
      // the idempotent Helm activation so the ready phase can be resumed
      // without repeating or rewriting the completed activation receipt.
      await this.helmUpgrade();
    }
    try {
      await this.kubectl([
        'rollout',
        'status',
        `deployment/${deployment}`,
        `--timeout=${this.rolloutTimeoutSeconds}s`,
      ]);
    } catch {
      await this.kubectl([
        'delete',
        'deployment',
        deployment,
        '--ignore-not-found',
        '--wait=true',
      ]).catch(() => undefined);
      throw new KubernetesLifecycleErrorV1(
        'cluster_job_failed',
        'Plugin rollout failed and the candidate Deployment was removed',
      );
    }
  }

  private async deleteData(
    material: ResolvedClusterMaterialV1,
  ): Promise<void> {
    const source = material.source!;
    await this.requireStoragePvcs(source);
    for (const storage of storageShape(source)) {
      await this.kubectl([
        'delete',
        'persistentvolumeclaim',
        pluginKubernetesPvcNameV1(
          source.pluginId,
          source.dataSchemaVersion,
          storage.name,
        ),
        '--ignore-not-found',
        '--wait=true',
      ]);
    }
  }

  private async deleteRuntime(
    pluginId: InstalledPluginRecordV1['pluginId'],
    includeService: boolean,
  ): Promise<void> {
    const name = pluginKubernetesResourceNameV1(pluginId);
    await this.kubectl([
      'delete',
      'deployment',
      name,
      '--ignore-not-found',
      '--wait=true',
    ]);
    if (includeService) {
      await this.kubectl([
        'delete',
        'service',
        name,
        '--ignore-not-found',
        '--wait=true',
      ]);
    }
  }

  private utilityJob(
    context: PluginLifecyclePhaseExecutionContextV1,
    source: InstalledPluginRecordV1,
    target: InstalledPluginRecordV1 | undefined,
    kind: 'checkpoint' | 'export',
    copyTarget: boolean,
  ): KubernetesObjectV1 {
    const sourceStorage = storageShape(source);
    const volumes: Array<Record<string, unknown>> = [
      {
        name: 'artifacts',
        persistentVolumeClaim: {
          claimName: this.artifactPvcName(context.pluginId),
        },
      },
      ...sourceStorage.map((storage) => ({
        name: `source-${storage.name}`,
        persistentVolumeClaim: {
          claimName: pluginKubernetesPvcNameV1(
            source.pluginId,
            source.dataSchemaVersion,
            storage.name,
          ),
        },
      })),
    ];
    const volumeMounts: Array<Record<string, unknown>> = [
      {
        name: 'artifacts',
        mountPath: '/artifacts',
        readOnly: false,
      },
      ...sourceStorage.map((storage) => ({
        name: `source-${storage.name}`,
        mountPath: `/source/${storage.name}`,
        readOnly: true,
      })),
    ];
    if (copyTarget && target) {
      for (const storage of storageShape(target)) {
        volumes.push({
          name: `target-${storage.name}`,
          persistentVolumeClaim: {
            claimName: pluginKubernetesPvcNameV1(
              target.pluginId,
              target.dataSchemaVersion,
              storage.name,
            ),
          },
        });
        volumeMounts.push({
          name: `target-${storage.name}`,
          mountPath: `/target/${storage.name}`,
          readOnly: false,
        });
      }
    }
    return this.jobBase(context, this.utilityImage, {
      command: [
        'node',
        '/opt/enterpriseglue/plugin-installer/node_modules/@enterpriseglue/plugin-installer/dist/clusterUtility.js',
      ],
      env: [
        ['ENTERPRISEGLUE_PLUGIN_ARTIFACT_KIND', kind],
        ['ENTERPRISEGLUE_PLUGIN_EXECUTION_ID', context.executionId],
        ['ENTERPRISEGLUE_PLUGIN_ID', context.pluginId],
        ['ENTERPRISEGLUE_PLUGIN_PLAN_SHA256', context.planSha256],
        [
          'ENTERPRISEGLUE_PLUGIN_DESIRED_REVISION',
          String(context.desiredRevision),
        ],
        [
          'ENTERPRISEGLUE_PLUGIN_FROM_SCHEMA',
          String(context.fromDataSchema),
        ],
        [
          'ENTERPRISEGLUE_PLUGIN_TO_SCHEMA',
          String(context.toDataSchema),
        ],
        [
          'ENTERPRISEGLUE_PLUGIN_STORAGE_NAMES',
          sourceStorage.map((storage) => storage.name).join(','),
        ],
        [
          'ENTERPRISEGLUE_PLUGIN_COPY_TARGET',
          copyTarget ? 'true' : 'false',
        ],
      ],
      volumeMounts,
      volumes,
    });
  }

  private jobBase(
    context: PluginLifecyclePhaseExecutionContextV1,
    image: string,
    input: {
      command?: string[];
      env: Array<[string, string]>;
      volumeMounts: Array<Record<string, unknown>>;
      volumes: Array<Record<string, unknown>>;
    },
  ): KubernetesObjectV1 {
    const name = this.jobName(context);
    const fixedUser =
      this.runAsUser === null
        ? {}
        : {
            runAsUser: this.runAsUser,
            runAsGroup: this.runAsUser,
          };
    return {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name,
        namespace: this.namespace,
        labels: this.lifecycleLabels(context.pluginId),
        annotations: this.executionAnnotations(context),
      },
      spec: {
        backoffLimit: 0,
        activeDeadlineSeconds: this.jobTimeoutSeconds,
        ttlSecondsAfterFinished: 86_400,
        template: {
          metadata: {
            labels: {
              ...this.lifecycleLabels(context.pluginId),
              'io.enterpriseglue/lifecycle-job': 'true',
            },
            annotations: this.executionAnnotations(context),
          },
          spec: {
            restartPolicy: 'Never',
            automountServiceAccountToken: false,
            enableServiceLinks: false,
            securityContext: {
              runAsNonRoot: true,
              ...fixedUser,
              ...(this.runAsUser === null
                ? {}
                : { fsGroup: this.runAsUser }),
              seccompProfile: { type: 'RuntimeDefault' },
            },
            imagePullSecrets: this.imagePullSecrets.map((name) => ({
              name,
            })),
            containers: [
              {
                name: 'lifecycle',
                image,
                imagePullPolicy: 'IfNotPresent',
                ...(input.command ? { command: input.command } : {}),
                env: input.env.map(([name, value]) => ({
                  name,
                  value,
                })),
                securityContext: {
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  runAsNonRoot: true,
                  ...fixedUser,
                  capabilities: { drop: ['ALL'] },
                },
                resources: {
                  requests: { cpu: '10m', memory: '32Mi' },
                  limits: { cpu: '1', memory: '1Gi' },
                },
                volumeMounts: [
                  ...input.volumeMounts,
                  {
                    name: 'tmp',
                    mountPath: '/tmp',
                  },
                ],
              },
            ],
            volumes: [
              ...input.volumes,
              {
                name: 'tmp',
                emptyDir: {
                  medium: 'Memory',
                  sizeLimit: '64Mi',
                },
              },
            ],
          },
        },
      },
    };
  }

  private async runJob(
    context: PluginLifecyclePhaseExecutionContextV1,
    job: KubernetesObjectV1,
  ): Promise<void> {
    await this.ensureLifecycleNetworkPolicy();
    const name = job.metadata.name;
    let existing = await this.getJson('job', name);
    if (existing && !this.sameExecutionObject(existing, context)) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_job_failed',
        'Existing lifecycle Job does not match the current execution',
      );
    }
    if (existing && this.jobSucceeded(existing)) return;
    if (existing && this.jobFailed(existing)) {
      await this.kubectl([
        'delete',
        'job',
        name,
        '--wait=true',
      ]);
      existing = undefined;
    }
    if (!existing) {
      await this.createObject(job);
      existing = await this.getJson('job', name);
      if (!existing || !this.sameExecutionObject(existing, context)) {
        throw new KubernetesLifecycleErrorV1(
          'cluster_job_failed',
          'Created lifecycle Job does not match the current execution',
        );
      }
    }
    const wait = await this.kubectlResult([
      'wait',
      '--for=jsonpath={.status.conditions[0].status}=True',
      `job/${name}`,
      `--timeout=${this.jobTimeoutSeconds}s`,
    ]);
    const completed = await this.getJson('job', name);
    if (
      wait.exitCode !== 0 ||
      !completed ||
      !this.jobSucceeded(completed)
    ) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_job_failed',
        'Lifecycle Job did not complete successfully',
      );
    }
  }

  private async ensurePvc(
    name: string,
    pluginId: string,
    schema: string,
    storageName: string,
    sizeMiB: number,
  ): Promise<void> {
    const existing = await this.getJson(
      'persistentvolumeclaim',
      name,
    );
    if (existing) {
      const annotations = (
        existing.metadata as
          | {
              annotations?: Record<string, string>;
            }
          | undefined
      )?.annotations;
      if (
        annotations?.['io.enterpriseglue/plugin-id'] !== pluginId ||
        annotations?.['io.enterpriseglue/data-schema'] !== schema ||
        annotations?.['io.enterpriseglue/storage-name'] !==
          storageName
      ) {
        throw new KubernetesLifecycleErrorV1(
          'cluster_state_invalid',
          'Existing plugin PVC identity does not match desired storage',
        );
      }
      return;
    }
    await this.createObject({
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/part-of':
            'enterpriseglue-plugin-runtime',
          'app.kubernetes.io/managed-by':
            'enterpriseglue-plugin-installer',
        },
        annotations: {
          'helm.sh/resource-policy': 'keep',
          'io.enterpriseglue/plugin-id': pluginId,
          'io.enterpriseglue/data-schema': schema,
          'io.enterpriseglue/storage-name': storageName,
        },
      },
      spec: {
        accessModes: ['ReadWriteOnce'],
        ...(this.storageClassName
          ? { storageClassName: this.storageClassName }
          : {}),
        resources: {
          requests: { storage: `${sizeMiB}Mi` },
        },
      },
    });
    const created = await this.getJson(
      'persistentvolumeclaim',
      name,
    );
    const createdAnnotations = (
      created?.metadata as
        | {
            annotations?: Record<string, string>;
          }
        | undefined
    )?.annotations;
    if (
      createdAnnotations?.['io.enterpriseglue/plugin-id'] !==
        pluginId ||
      createdAnnotations?.['io.enterpriseglue/data-schema'] !==
        schema ||
      createdAnnotations?.['io.enterpriseglue/storage-name'] !==
        storageName
    ) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_state_invalid',
        'Created plugin PVC identity does not match desired storage',
      );
    }
  }

  private async requireStoragePvcs(
    record: InstalledPluginRecordV1,
  ): Promise<void> {
    for (const storage of storageShape(record)) {
      const resource = await this.getJson(
        'persistentvolumeclaim',
        pluginKubernetesPvcNameV1(
          record.pluginId,
          record.dataSchemaVersion,
          storage.name,
        ),
      );
      const annotations = (
        resource?.metadata as
          | {
              annotations?: Record<string, string>;
            }
          | undefined
      )?.annotations;
      if (
        annotations?.['io.enterpriseglue/plugin-id'] !==
          record.pluginId ||
        annotations?.['io.enterpriseglue/data-schema'] !==
          String(record.dataSchemaVersion) ||
        annotations?.['io.enterpriseglue/storage-name'] !==
          storage.name
      ) {
        throw new KubernetesLifecycleErrorV1(
          'cluster_state_invalid',
          'Required source plugin PVC is missing or has the wrong identity',
        );
      }
    }
  }

  private ensureArtifactPvc(pluginId: string): Promise<void> {
    return this.ensurePvc(
      this.artifactPvcName(pluginId),
      pluginId,
      'artifacts',
      'lifecycle-artifacts',
      this.artifactStorageMiB,
    );
  }

  private artifactPvcName(pluginId: string): string {
    return `eg-plugin-artifacts-${stableToken(pluginId, 32)}`;
  }

  private async ensureLifecycleNetworkPolicy(): Promise<void> {
    await this.applyObject({
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: {
        name: 'enterpriseglue-plugin-lifecycle-deny-all',
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/part-of':
            'enterpriseglue-plugin-runtime',
          'app.kubernetes.io/managed-by':
            'enterpriseglue-plugin-installer',
        },
      },
      spec: {
        podSelector: {
          matchLabels: {
            'io.enterpriseglue/lifecycle-job': 'true',
          },
        },
        policyTypes: ['Ingress', 'Egress'],
      },
    });
  }

  private async helmUpgrade(): Promise<void> {
    await this.helm([
      'upgrade',
      '--install',
      this.releaseName,
      this.chartPath,
      '--namespace',
      this.namespace,
      '--values',
      this.valuesFile,
      '--history-max',
      '10',
    ]);
  }

  private async receiptExists(
    context: PluginLifecyclePhaseExecutionContextV1,
  ): Promise<boolean> {
    const resource = await this.getJson(
      'configmap',
      this.receiptName(context),
    );
    if (!resource) return false;
    const serialized = (
      resource as { data?: Record<string, string> }
    ).data?.['receipt.json'];
    let receipt: KubernetesReceiptV1;
    try {
      receipt = JSON.parse(serialized ?? '');
    } catch {
      throw new KubernetesLifecycleErrorV1(
        'cluster_receipt_invalid',
        'Cluster lifecycle receipt is invalid',
      );
    }
    const { completedAt: _completedAt, ...identity } = receipt;
    if (
      typeof receipt.completedAt !== 'string' ||
      !Number.isFinite(Date.parse(receipt.completedAt)) ||
      JSON.stringify(identity) !==
        JSON.stringify(receiptIdentity(context))
    ) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_receipt_invalid',
        'Cluster lifecycle receipt differs from the current phase',
      );
    }
    return true;
  }

  private async writeReceipt(
    context: PluginLifecyclePhaseExecutionContextV1,
  ): Promise<void> {
    const receipt: KubernetesReceiptV1 = {
      ...receiptIdentity(context),
      completedAt: new Date().toISOString(),
    };
    const resource: KubernetesObjectV1 = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: this.receiptName(context),
        namespace: this.namespace,
        labels: this.lifecycleLabels(context.pluginId),
        annotations: this.executionAnnotations(context),
      },
      data: {
        'receipt.json': `${JSON.stringify(receipt, null, 2)}\n`,
      },
    };
    const result = await this.clusterResult(
      'kubectl',
      [
        ...this.kubectlPrefix(),
        '--namespace',
        this.namespace,
        'create',
        '--filename',
        '-',
        '--output',
        'name',
      ],
      `${JSON.stringify(resource)}\n`,
    );
    if (result.exitCode === 0) return;
    if (
      /alreadyexists|already exists/i.test(result.stderr) &&
      (await this.receiptExists(context))
    ) {
      return;
    }
    throw new KubernetesLifecycleErrorV1(
      'cluster_receipt_invalid',
      'Cluster lifecycle receipt could not be persisted',
    );
  }

  private receiptName(
    context: PluginLifecyclePhaseExecutionContextV1,
  ): string {
    return `eg-plugin-effect-${stableToken(
      context.idempotencyKey,
      40,
    )}`;
  }

  private jobName(
    context: PluginLifecyclePhaseExecutionContextV1,
  ): string {
    return `eg-plugin-job-${stableToken(
      context.idempotencyKey,
      43,
    )}`;
  }

  private lifecycleLabels(
    pluginId: string,
  ): Record<string, string> {
    return {
      'app.kubernetes.io/part-of':
        'enterpriseglue-plugin-runtime',
      'app.kubernetes.io/managed-by':
        'enterpriseglue-plugin-installer',
      'io.enterpriseglue/plugin-token': stableToken(pluginId, 32),
    };
  }

  private executionAnnotations(
    context: PluginLifecyclePhaseExecutionContextV1,
  ): Record<string, string> {
    return {
      'io.enterpriseglue/execution-token': stableToken(
        context.executionId,
        32,
      ),
      'io.enterpriseglue/idempotency-token': stableToken(
        context.idempotencyKey,
        32,
      ),
      'io.enterpriseglue/desired-revision': String(
        context.desiredRevision,
      ),
      'io.enterpriseglue/plan-sha256': context.planSha256,
      'io.enterpriseglue/phase': context.phase,
    };
  }

  private sameExecutionObject(
    input: Record<string, unknown>,
    context: PluginLifecyclePhaseExecutionContextV1,
  ): boolean {
    const annotations = (
      input.metadata as {
        annotations?: Record<string, string>;
      }
    )?.annotations;
    const expected = this.executionAnnotations(context);
    return Object.entries(expected).every(
      ([name, value]) => annotations?.[name] === value,
    );
  }

  private jobSucceeded(input: Record<string, unknown>): boolean {
    const status = input.status as {
      succeeded?: number;
      conditions?: Array<{ type?: string; status?: string }>;
    };
    return (
      (status?.succeeded ?? 0) > 0 ||
      status?.conditions?.some(
        (condition) =>
          condition.type === 'Complete' &&
          condition.status === 'True',
      ) === true
    );
  }

  private jobFailed(input: Record<string, unknown>): boolean {
    const status = input.status as {
      failed?: number;
      conditions?: Array<{ type?: string; status?: string }>;
    };
    return (
      (status?.failed ?? 0) > 0 ||
      status?.conditions?.some(
        (condition) =>
          condition.type === 'Failed' &&
          condition.status === 'True',
      ) === true
    );
  }

  private async createObject(
    resource: KubernetesObjectV1,
  ): Promise<void> {
    const result = await this.clusterResult(
      'kubectl',
      [
        ...this.kubectlPrefix(),
        '--namespace',
        this.namespace,
        'create',
        '--filename',
        '-',
        '--output',
        'name',
      ],
      `${JSON.stringify(resource)}\n`,
    );
    if (result.exitCode === 0) return;
    if (/alreadyexists|already exists/i.test(result.stderr)) return;
    throw new KubernetesLifecycleErrorV1(
      'cluster_command_failed',
      `Kubernetes ${resource.kind} could not be created`,
    );
  }

  private async applyObject(
    resource: KubernetesObjectV1,
  ): Promise<void> {
    const result = await this.clusterResult(
      'kubectl',
      [
        ...this.kubectlPrefix(),
        '--namespace',
        this.namespace,
        'apply',
        '--server-side',
        '--field-manager',
        'enterpriseglue-plugin-installer',
        '--filename',
        '-',
        '--output',
        'name',
      ],
      `${JSON.stringify(resource)}\n`,
    );
    if (result.exitCode !== 0) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_command_failed',
        `Kubernetes ${resource.kind} could not be applied`,
      );
    }
  }

  private async getJson(
    kind: string,
    name: string,
  ): Promise<Record<string, unknown> | undefined> {
    const result = await this.kubectlResult([
      'get',
      kind,
      name,
      '--ignore-not-found',
      '--output',
      'json',
    ]);
    if (result.exitCode !== 0) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_command_failed',
        'Kubernetes lifecycle object could not be read',
      );
    }
    if (!result.stdout.trim()) return undefined;
    try {
      const parsed = JSON.parse(result.stdout);
      if (!parsed || typeof parsed !== 'object') throw new Error();
      return parsed;
    } catch {
      throw new KubernetesLifecycleErrorV1(
        'cluster_state_invalid',
        'Kubernetes returned invalid object JSON',
      );
    }
  }

  private kubectl(args: readonly string[]): Promise<ClusterCommandResultV1> {
    return this.cluster('kubectl', [
      ...this.kubectlPrefix(),
      '--namespace',
      this.namespace,
      ...args,
    ]);
  }

  private kubectlResult(
    args: readonly string[],
  ): Promise<ClusterCommandResultV1> {
    return this.clusterResult('kubectl', [
      ...this.kubectlPrefix(),
      '--namespace',
      this.namespace,
      ...args,
    ]);
  }

  private helm(args: readonly string[]): Promise<ClusterCommandResultV1> {
    return this.cluster('helm', [
      ...(this.context ? ['--kube-context', this.context] : []),
      ...args,
    ]);
  }

  private kubectlPrefix(): string[] {
    return this.context ? ['--context', this.context] : [];
  }

  private async cluster(
    tool: 'kubectl' | 'helm',
    args: readonly string[],
    stdin?: string,
  ): Promise<ClusterCommandResultV1> {
    const result = await this.clusterResult(tool, args, stdin);
    if (result.exitCode !== 0) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_command_failed',
        `${tool} lifecycle command failed`,
      );
    }
    return result;
  }

  private clusterResult(
    tool: 'kubectl' | 'helm',
    args: readonly string[],
    stdin?: string,
  ): Promise<ClusterCommandResultV1> {
    return this.command.run(tool, args, {
      cwd: this.projectDirectory,
      timeoutMs: this.commandTimeoutMs,
      ...(stdin === undefined ? {} : { stdin }),
    });
  }

  private async readBoundedJson(path: string): Promise<unknown> {
    const details = await lstat(path).catch(() => undefined);
    if (
      !details?.isFile() ||
      details.isSymbolicLink() ||
      details.size > MAX_CLUSTER_INPUT_BYTES
    ) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_state_invalid',
        'Cluster lifecycle input must be a bounded regular file',
      );
    }
    const outputReal = await realpath(this.outputDirectory);
    const pathReal = await realpath(path);
    if (!contained(outputReal, pathReal)) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_state_invalid',
        'Cluster lifecycle input escaped its output directory',
      );
    }
    return JSON.parse(await readFile(path, 'utf8'));
  }
}

export function relativeClusterInputPathV1(
  projectDirectory: string,
  path: string,
): string {
  const value = relative(resolve(projectDirectory), resolve(path));
  if (
    value === '..' ||
    value.startsWith(`..${sep}`) ||
    value.startsWith('/')
  ) {
    throw new KubernetesLifecycleErrorV1(
      'cluster_configuration_invalid',
      'Cluster input path escapes the project directory',
    );
  }
  return value || '.';
}
