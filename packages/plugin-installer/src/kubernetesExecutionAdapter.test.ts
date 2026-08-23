import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { PluginId } from '@enterpriseglue/plugin-sdk';
import { afterEach, describe, expect, it } from 'vitest';

import { runPluginInstallerCliV1 } from './cli.js';
import {
  createPluginLifecyclePlanEnvelopeV1,
  emptyPluginInstallerStateV1,
  installPluginV1,
  KubernetesPluginLifecycleExecutionStoreV1,
  KubernetesPluginLifecyclePhaseAdapterV1,
  pluginKubernetesPvcNameV1,
  pluginLifecyclePlanFileName,
  renderHelmPluginValuesV1,
  rollbackPluginV1,
  runPluginLifecycleExecutionV1,
  setPluginEnabledV1,
  uninstallPluginV1,
  upgradePluginV1,
  verifyPluginInstallInputV1,
  type ClusterCommandPortV1,
  type ClusterCommandResultV1,
  type InstalledPluginRecordV1,
  type PluginInstallerStateV1,
} from './index.js';

const pluginId = 'io.enterpriseglue.example' as PluginId;
const imageHash = '6'.repeat(64);
const migrationHash = '7'.repeat(64);
const utilityImage =
  `registry.example/plugin-installer@sha256:${'8'.repeat(64)}`;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function digest(input: Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

function record(
  version: string,
  migration?: {
    fromSchema: number;
    toSchema: number;
    rollbackThrough: number;
  },
): InstalledPluginRecordV1 {
  const resources = {
    apiVersion: 'resources.plugin.enterpriseglue.io/v1' as const,
    kind: 'EnterpriseGluePluginResources' as const,
    service: {
      containerPort: 8080,
      runAsNonRoot: true as const,
      readOnlyRootFilesystem: true as const,
      tmpfsMiB: 64,
      cpuLimit: '500m',
      memoryLimitMiB: 512,
    },
    configuration: [],
    storage: [
      {
        name: 'data',
        mountPath: '/var/lib/plugin',
        readOnly: false,
        sizeMiB: 512,
      },
    ],
    network: {
      ingress: 'host-gateway-only' as const,
      egressPolicy: 'none',
    },
    probes: {
      healthPath: '/_plugin/health' as const,
      readyPath: '/_plugin/ready' as const,
      initialDelaySeconds: 0,
      periodSeconds: 1,
      timeoutSeconds: 1,
      failureThreshold: 3,
    },
  };
  const resourceBytes = Buffer.from(JSON.stringify(resources));
  const manifest = {
    apiVersion: 'plugin.enterpriseglue.io/v1' as const,
    kind: 'EnterpriseGluePlugin' as const,
    metadata: {
      id: pluginId,
      version,
      displayName: 'Example',
      publisher: 'io.enterpriseglue' as PluginId,
    },
    compatibility: {
      host: '^0.4.0',
      sdk: '^0.1.0',
      backendProtocol: 1 as const,
      requiredSlots: [],
    },
    deployment: {
      backend: {
        image: `registry.example/example@sha256:${imageHash}`,
        healthPath: '/_plugin/health' as const,
        readyPath: '/_plugin/ready' as const,
        protocolPath: '/_plugin/capabilities' as const,
        operations: [],
      },
      migration: migration
        ? {
            image:
              `registry.example/example-migration@sha256:${migrationHash}`,
            ...migration,
          }
        : undefined,
      resources: {
        descriptor: 'deploy/resources.json',
        sha256: digest(resourceBytes),
      },
    },
    scope: {
      installation: 'deployment' as const,
      enablement: 'deployment' as const,
    },
    permissions: { required: [], optional: [] },
    network: { egressPolicy: 'none' },
    entitlement: { provider: 'none' as const },
    dependencies: [],
    conflicts: [],
    events: { subscriptions: [] },
    jobs: { fixedSchedules: [] },
    contributions: [],
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  return verifyPluginInstallInputV1({
    release: {
      version,
      channel: 'stable',
      bundle: `registry.example/example-bundle@sha256:${imageHash}`,
      manifestSha256: digest(manifestBytes),
      hostCompatibility: '^0.4.0',
      testedHostVersions: ['0.4.6'],
      sdkCompatibility: '^0.1.0',
      revoked: false,
      revocationReasonCode: 'none',
    },
    manifest,
    manifestBytes,
    resources,
    resourceBytes,
    grantedPermissions: [],
    stagedAssetPath: `./plugins/${pluginId}/${version}`,
  });
}

class FakeCluster implements ClusterCommandPortV1 {
  readonly calls: Array<{
    tool: 'kubectl' | 'helm';
    args: string[];
    input?: Record<string, unknown>;
  }> = [];
  readonly resources = new Map<string, Record<string, unknown>>();
  private resourceVersion = 0;
  conflictNextReplace = false;
  failReadyOnce = false;
  readyDelayMs = 0;

  async run(
    tool: 'kubectl' | 'helm',
    argsInput: readonly string[],
    options: {
      cwd: string;
      timeoutMs: number;
      stdin?: string;
    },
  ): Promise<ClusterCommandResultV1> {
    const args = [...argsInput];
    const input = options.stdin
      ? (JSON.parse(options.stdin) as Record<string, unknown>)
      : undefined;
    this.calls.push({ tool, args, input });
    if (tool === 'helm') {
      if (args.includes('upgrade')) {
        const name = 'eg-plugin-io-enterpriseglue-example';
        this.resources.set(`deployment/${name}`, {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: { name, resourceVersion: String(++this.resourceVersion) },
        });
      }
      return { exitCode: 0, stdout: 'ok\n', stderr: '' };
    }
    const commandIndex = args.findIndex((arg) =>
      [
        'get',
        'create',
        'replace',
        'apply',
        'delete',
        'wait',
        'scale',
        'rollout',
      ].includes(arg),
    );
    const command = args[commandIndex];
    if (command === 'get') {
      const kind = args[commandIndex + 1]!;
      const name = args[commandIndex + 2]!;
      const resource = this.resources.get(this.key(kind, name));
      return {
        exitCode: 0,
        stdout: resource ? `${JSON.stringify(resource)}\n` : '',
        stderr: '',
      };
    }
    if (command === 'create' || command === 'apply') {
      const resource = structuredClone(input!);
      const metadata = resource.metadata as Record<string, unknown>;
      const kind = String(resource.kind).toLowerCase();
      const name = String(metadata.name);
      const key = this.key(kind, name);
      if (command === 'create' && this.resources.has(key)) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'AlreadyExists',
        };
      }
      metadata.resourceVersion = String(++this.resourceVersion);
      this.resources.set(key, resource);
      return { exitCode: 0, stdout: `${kind}/${name}\n`, stderr: '' };
    }
    if (command === 'replace') {
      if (this.conflictNextReplace) {
        this.conflictNextReplace = false;
        return { exitCode: 1, stdout: '', stderr: 'Conflict' };
      }
      const resource = structuredClone(input!);
      const metadata = resource.metadata as Record<string, unknown>;
      const kind = String(resource.kind).toLowerCase();
      const name = String(metadata.name);
      const existing = this.resources.get(this.key(kind, name));
      if (
        !existing ||
        (existing.metadata as Record<string, unknown>)
          .resourceVersion !== metadata.resourceVersion
      ) {
        return { exitCode: 1, stdout: '', stderr: 'Conflict' };
      }
      metadata.resourceVersion = String(++this.resourceVersion);
      this.resources.set(this.key(kind, name), resource);
      return { exitCode: 0, stdout: `${kind}/${name}\n`, stderr: '' };
    }
    if (command === 'delete') {
      const kind = args[commandIndex + 1]!;
      const name = args[commandIndex + 2]!;
      this.resources.delete(this.key(kind, name));
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (command === 'wait') {
      const jobArg = args.find((arg) => arg.startsWith('job/'))!;
      const job = this.resources.get(this.key('job', jobArg.slice(4)))!;
      job.status = {
        succeeded: 1,
        conditions: [{ type: 'Complete', status: 'True' }],
      };
      return { exitCode: 0, stdout: 'complete\n', stderr: '' };
    }
    if (command === 'rollout') {
      if (this.readyDelayMs > 0) {
        await delay(this.readyDelayMs);
      }
      if (this.failReadyOnce) {
        this.failReadyOnce = false;
        return { exitCode: 1, stdout: '', stderr: 'timeout' };
      }
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  private key(kindInput: string, name: string): string {
    const kind = {
      configmaps: 'configmap',
      jobs: 'job',
      persistentvolumeclaims: 'persistentvolumeclaim',
    }[kindInput] ?? kindInput;
    return `${kind.toLowerCase()}/${name}`;
  }
}

async function fixture(state: PluginInstallerStateV1) {
  const projectDirectory = await mkdtemp(
    resolve(tmpdir(), 'eg-plugin-kubernetes-adapter-'),
  );
  directories.push(projectDirectory);
  const outputDirectory = resolve(projectDirectory, 'generated/plugins');
  const chartPath = resolve(projectDirectory, 'chart');
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await mkdir(resolve(chartPath, 'templates'), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(
    resolve(chartPath, 'Chart.yaml'),
    'apiVersion: v2\nname: test\nversion: 0.1.0\n',
    { mode: 0o600 },
  );
  await writeFile(
    resolve(chartPath, 'templates', 'empty.yaml'),
    '{{- /* test chart */ -}}\n',
    { mode: 0o600 },
  );
  const valuesFile = resolve(
    outputDirectory,
    'helm.plugins.generated.values.yaml',
  );
  await writeFile(valuesFile, renderHelmPluginValuesV1(state), {
    mode: 0o600,
  });
  await writeFile(
    resolve(outputDirectory, 'plugin-installer-state.json'),
    `${JSON.stringify(state, null, 2)}\n`,
    { mode: 0o600 },
  );
  const envelope = createPluginLifecyclePlanEnvelopeV1(
    state.revision,
    state.lifecyclePlan ?? null,
  );
  const planPath = resolve(outputDirectory, pluginLifecyclePlanFileName);
  await writeFile(planPath, `${JSON.stringify(envelope, null, 2)}\n`, {
    mode: 0o600,
  });
  const cluster = new FakeCluster();
  const adapter = new KubernetesPluginLifecyclePhaseAdapterV1({
    outputDirectory,
    projectDirectory,
    chartPath,
    valuesFile,
    namespace: 'enterpriseglue-plugins',
    releaseName: 'enterpriseglue-plugins',
    utilityImage,
    command: cluster,
  });
  const store = new KubernetesPluginLifecycleExecutionStoreV1({
    namespace: 'enterpriseglue-plugins',
    planPath,
    workingDirectory: projectDirectory,
    command: cluster,
  });
  return {
    adapter,
    chartPath,
    cluster,
    envelope,
    outputDirectory,
    planPath,
    projectDirectory,
    store,
    valuesFile,
  };
}

function seedSourcePvc(
  test: Awaited<ReturnType<typeof fixture>>,
  schema: number,
): void {
  const name = pluginKubernetesPvcNameV1(pluginId, schema, 'data');
  test.cluster.resources.set(`persistentvolumeclaim/${name}`, {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: {
      name,
      resourceVersion: 'external',
      annotations: {
        'io.enterpriseglue/plugin-id': pluginId,
        'io.enterpriseglue/data-schema': String(schema),
        'io.enterpriseglue/storage-name': 'data',
      },
    },
  });
}

function seedSourceDeployment(
  test: Awaited<ReturnType<typeof fixture>>,
): void {
  const name = 'eg-plugin-io-enterpriseglue-example';
  test.cluster.resources.set(`deployment/${name}`, {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name,
      resourceVersion: 'external',
    },
  });
}

describe('Kubernetes lifecycle execution', () => {
  it('runs the public apply-kubernetes command and writes its safe local execution mirror', async () => {
    let state = installPluginV1(
      emptyPluginInstallerStateV1(),
      record('1.0.0'),
      '2026-07-25T00:00:00.000Z',
    );
    state = setPluginEnabledV1(
      state,
      pluginId,
      true,
      '2026-07-25T00:01:00.000Z',
    );
    const test = await fixture(state);
    const output: string[] = [];
    expect(
      await runPluginInstallerCliV1(
        [
          'apply-kubernetes',
          '--output',
          test.outputDirectory,
          '--project-directory',
          test.projectDirectory,
          '--chart',
          'chart',
          '--values',
          'generated/plugins/helm.plugins.generated.values.yaml',
          '--namespace',
          'enterpriseglue-plugins',
          '--release-name',
          'enterpriseglue-plugins',
          '--utility-image',
          utilityImage,
          '--rollout-timeout-seconds',
          '37',
          '--platform',
          'openshift',
        ],
        (line) => output.push(line),
        { cluster: test.cluster },
      ),
    ).toBe(0);
    expect(JSON.parse(output.at(-1)!)).toMatchObject({
      pluginId,
      operation: 'enable',
      status: 'succeeded',
    });
    expect(
      JSON.parse(
        await readFile(
          resolve(
            test.outputDirectory,
            'plugin-lifecycle-execution.json',
          ),
          'utf8',
        ),
      ),
    ).toMatchObject({
      execution: {
        pluginId,
        status: 'succeeded',
      },
    });
    expect(
      test.cluster.calls.some(
        (call) =>
          call.tool === 'kubectl' &&
          call.args.includes('rollout') &&
          call.args.includes('--timeout=37s'),
      ),
    ).toBe(true);
  });

  it('uses Kubernetes resourceVersion CAS for durable execution state', async () => {
    const state = installPluginV1(
      emptyPluginInstallerStateV1(),
      record('1.0.0'),
      '2026-07-25T00:00:00.000Z',
    );
    const test = await fixture(state);
    let execution = await test.store.initialize({
      executionId: 'cluster-store-execution',
      occurredAt: '2026-07-25T00:01:00.000Z',
    });
    execution = await test.store.claim({
      expectedRevision: execution.revision,
      owner: 'cluster-worker',
      occurredAt: '2026-07-25T00:01:01.000Z',
      leaseDurationMs: 60_000,
    });
    expect(execution).toMatchObject({
      revision: 1,
      status: 'running',
      leaseOwner: 'cluster-worker',
    });

    test.cluster.conflictNextReplace = true;
    await expect(
      test.store.renew({
        expectedRevision: execution.revision,
        owner: 'cluster-worker',
        occurredAt: '2026-07-25T00:01:02.000Z',
        leaseDurationMs: 60_000,
      }),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await test.store.read()).toEqual(execution);
  });

  it('stages a disabled install with schema PVCs, deny-all jobs, and durable receipts', async () => {
    const state = installPluginV1(
      emptyPluginInstallerStateV1(),
      record('1.0.0'),
      '2026-07-25T00:00:00.000Z',
    );
    const test = await fixture(state);
    await test.store.initialize({
      executionId: 'cluster-install-execution',
      occurredAt: '2026-07-25T00:01:00.000Z',
    });
    const execution = await runPluginLifecycleExecutionV1({
      store: test.store,
      adapter: test.adapter,
      owner: 'cluster-worker',
      leaseDurationMs: 60_000,
    });

    expect(execution).toMatchObject({
      status: 'succeeded',
      completedPhases: ['stage', 'commit'],
    });
    expect(
      test.cluster.resources.has(
        `persistentvolumeclaim/${pluginKubernetesPvcNameV1(
          pluginId,
          0,
          'data',
        )}`,
      ),
    ).toBe(true);
    expect(
      test.cluster.resources.has(
        'networkpolicy/enterpriseglue-plugin-lifecycle-deny-all',
      ),
    ).toBe(true);
    expect(
      [...test.cluster.resources.keys()].filter((key) =>
        key.startsWith('configmap/eg-plugin-effect-'),
      ),
    ).toHaveLength(2);
    expect(
      test.cluster.calls.some(
        (call) =>
          call.tool === 'helm' && call.args.includes('upgrade'),
      ),
    ).toBe(true);
  });

  it('runs stop, checkpoint copy, signed migration, rollout, and commit in safe upgrade order', async () => {
    let state = installPluginV1(
      emptyPluginInstallerStateV1(),
      record('1.0.0'),
      '2026-07-25T00:00:00.000Z',
    );
    state = setPluginEnabledV1(
      state,
      pluginId,
      true,
      '2026-07-25T00:01:00.000Z',
    );
    state = upgradePluginV1(
      state,
      record('2.0.0', {
        fromSchema: 0,
        toSchema: 2,
        rollbackThrough: 0,
      }),
      '2026-07-25T00:02:00.000Z',
    );
    const test = await fixture(state);
    seedSourcePvc(test, 0);
    seedSourceDeployment(test);
    await test.store.initialize({
      executionId: 'cluster-upgrade-execution',
      occurredAt: '2026-07-25T00:03:00.000Z',
    });
    const execution = await runPluginLifecycleExecutionV1({
      store: test.store,
      adapter: test.adapter,
      owner: 'cluster-upgrade-worker',
      leaseDurationMs: 60_000,
    });
    expect(execution.status).toBe('succeeded');

    const flattened = test.cluster.calls.map((call) =>
      `${call.tool} ${call.args.join(' ')}`,
    );
    const drain = flattened.findIndex((call) =>
      call.includes(' scale deployment '),
    );
    const checkpointJob = test.cluster.calls.findIndex(
      (call) =>
        call.input?.kind === 'Job' &&
        JSON.stringify(call.input).includes(
          'ENTERPRISEGLUE_PLUGIN_ARTIFACT_KIND',
        ),
    );
    const migrationJob = test.cluster.calls.findIndex(
      (call) =>
        call.input?.kind === 'Job' &&
        JSON.stringify(call.input).includes(
          'ENTERPRISEGLUE_PLUGIN_OPERATION',
        ),
    );
    const activate = flattened.findIndex(
      (call, index) =>
        index > migrationJob &&
        call.startsWith('helm ') &&
        call.includes(' upgrade '),
    );
    const ready = flattened.findIndex((call) =>
      call.includes(' rollout status '),
    );
    expect(drain).toBeGreaterThan(-1);
    expect(checkpointJob).toBeGreaterThan(drain);
    expect(migrationJob).toBeGreaterThan(checkpointJob);
    expect(activate).toBeGreaterThan(migrationJob);
    expect(ready).toBeGreaterThan(activate);

    const checkpoint = test.cluster.calls[checkpointJob]!.input!;
    expect(JSON.stringify(checkpoint)).toContain(
      `${pluginKubernetesPvcNameV1(
        pluginId,
        0,
        'data',
      )}`,
    );
    expect(JSON.stringify(checkpoint)).toContain(
      `${pluginKubernetesPvcNameV1(
        pluginId,
        2,
        'data',
      )}`,
    );
    expect(JSON.stringify(checkpoint)).toContain(
      '"readOnlyRootFilesystem":true',
    );
    expect(JSON.stringify(checkpoint)).toContain(
      '"automountServiceAccountToken":false',
    );
  });

  it('uses the retained signed migration image to downgrade before rollback activation', async () => {
    let state = installPluginV1(
      emptyPluginInstallerStateV1(),
      record('1.0.0'),
      '2026-07-25T00:00:00.000Z',
    );
    state = setPluginEnabledV1(
      state,
      pluginId,
      true,
      '2026-07-25T00:01:00.000Z',
    );
    state = upgradePluginV1(
      state,
      record('2.0.0', {
        fromSchema: 0,
        toSchema: 2,
        rollbackThrough: 0,
      }),
      '2026-07-25T00:02:00.000Z',
    );
    state = rollbackPluginV1(
      state,
      pluginId,
      '2026-07-25T00:03:00.000Z',
    );
    const test = await fixture(state);
    seedSourcePvc(test, 2);
    await test.store.initialize({
      executionId: 'cluster-rollback-execution',
      occurredAt: '2026-07-25T00:04:00.000Z',
    });
    expect(
      (
        await runPluginLifecycleExecutionV1({
          store: test.store,
          adapter: test.adapter,
          owner: 'cluster-rollback-worker',
          leaseDurationMs: 60_000,
        })
      ).status,
    ).toBe('succeeded');

    const migration = test.cluster.calls.find(
      (call) =>
        call.input?.kind === 'Job' &&
        JSON.stringify(call.input).includes(
          'ENTERPRISEGLUE_PLUGIN_OPERATION',
        ),
    )!.input!;
    expect(JSON.stringify(migration)).toContain(
      `registry.example/example-migration@sha256:${migrationHash}`,
    );
    expect(JSON.stringify(migration)).toContain(
      '"value":"rollback"',
    );
    expect(JSON.stringify(migration)).toContain('"value":"2"');
    expect(JSON.stringify(migration)).toContain('"value":"0"');
  });

  it('removes an unhealthy candidate and resumes readiness without replaying the completed activation phase', async () => {
    let state = installPluginV1(
      emptyPluginInstallerStateV1(),
      record('1.0.0'),
      '2026-07-25T00:00:00.000Z',
    );
    state = setPluginEnabledV1(
      state,
      pluginId,
      true,
      '2026-07-25T00:01:00.000Z',
    );
    const test = await fixture(state);
    test.cluster.failReadyOnce = true;
    await test.store.initialize({
      executionId: 'cluster-ready-recovery',
      occurredAt: '2026-07-25T00:02:00.000Z',
    });
    const failed = await runPluginLifecycleExecutionV1({
      store: test.store,
      adapter: test.adapter,
      owner: 'cluster-worker-one',
      leaseDurationMs: 60_000,
    });
    expect(failed).toMatchObject({
      status: 'failed',
      completedPhases: ['activate'],
      nextPhase: 'ready',
    });
    const upgrades = test.cluster.calls.filter(
      (call) => call.tool === 'helm' && call.args.includes('upgrade'),
    ).length;
    expect(
      test.cluster.calls.some(
        (call) =>
          call.tool === 'kubectl' &&
          call.args.includes('delete') &&
          call.args.includes('deployment'),
      ),
    ).toBe(true);

    expect(
      (
        await runPluginLifecycleExecutionV1({
          store: test.store,
          adapter: test.adapter,
          owner: 'cluster-worker-two',
          leaseDurationMs: 60_000,
        })
      ).status,
    ).toBe('succeeded');
    expect(
      test.cluster.calls.filter(
        (call) =>
          call.tool === 'helm' && call.args.includes('upgrade'),
      ),
    ).toHaveLength(upgrades + 1);
    const activationReceipts = [
      ...test.cluster.resources.values(),
    ].filter((resource) => {
      const receipt = (resource as { data?: Record<string, string> })
        .data?.['receipt.json'];
      return receipt && JSON.parse(receipt).phase === 'activate';
    });
    expect(activationReceipts).toHaveLength(1);
  });

  it('waits for an in-flight heartbeat before reporting a readiness failure', async () => {
    let state = installPluginV1(
      emptyPluginInstallerStateV1(),
      record('1.0.0'),
      '2026-07-25T00:00:00.000Z',
    );
    state = setPluginEnabledV1(
      state,
      pluginId,
      true,
      '2026-07-25T00:01:00.000Z',
    );
    const test = await fixture(state);
    seedSourceDeployment(test);
    test.cluster.failReadyOnce = true;
    test.cluster.readyDelayMs = 300;
    let releaseHeartbeat: (() => void) | undefined;
    let heartbeatCompleted = false;
    const phase = test.adapter.executePhase({
      executionId: 'cluster-heartbeat-failure',
      idempotencyKey: 'cluster-heartbeat-failure:ready',
      desiredRevision: state.revision,
      planSha256: test.envelope.planSha256!,
      pluginId,
      operation: 'enable',
      phase: 'ready',
      leaseDurationMs: 750,
      toVersion: '1.0.0',
      fromDataSchema: 0,
      toDataSchema: 0,
      renewLease: async () =>
        new Promise<void>((resolveHeartbeat) => {
          releaseHeartbeat = () => {
            heartbeatCompleted = true;
            resolveHeartbeat();
          };
        }),
    });
    let settled = false;
    void phase.catch(() => {
      settled = true;
    });
    await delay(350);
    expect(releaseHeartbeat).toBeDefined();
    expect(settled).toBe(false);
    releaseHeartbeat!();
    await expect(phase).rejects.toMatchObject({
      code: 'cluster_job_failed',
    });
    expect(heartbeatCompleted).toBe(true);
  });

  it('exports or deletes tombstone PVC data and rejects symlinked generated values', async () => {
    for (const dataAction of ['export', 'delete'] as const) {
      let state = installPluginV1(
        emptyPluginInstallerStateV1(),
        record('1.0.0'),
        '2026-07-25T00:00:00.000Z',
      );
      state = uninstallPluginV1(
        state,
        pluginId,
        dataAction,
        '2026-07-25T00:01:00.000Z',
      );
      const test = await fixture(state);
      const sourcePvc = pluginKubernetesPvcNameV1(
        pluginId,
        0,
        'data',
      );
      test.cluster.resources.set(
        `persistentvolumeclaim/${sourcePvc}`,
        {
          apiVersion: 'v1',
          kind: 'PersistentVolumeClaim',
          metadata: {
            name: sourcePvc,
            resourceVersion: 'external',
            annotations: {
              'io.enterpriseglue/plugin-id': pluginId,
              'io.enterpriseglue/data-schema': '0',
              'io.enterpriseglue/storage-name': 'data',
            },
          },
        },
      );
      await test.store.initialize({
        executionId: `cluster-${dataAction}`,
        occurredAt: '2026-07-25T00:02:00.000Z',
      });
      expect(
        (
          await runPluginLifecycleExecutionV1({
            store: test.store,
            adapter: test.adapter,
            owner: `cluster-${dataAction}-worker`,
            leaseDurationMs: 60_000,
          })
        ).status,
      ).toBe('succeeded');
      if (dataAction === 'export') {
        expect(
          test.cluster.calls.some(
            (call) =>
              call.input?.kind === 'Job' &&
              JSON.stringify(call.input).includes(
                '"value":"export"',
              ),
          ),
        ).toBe(true);
        expect(
          test.cluster.resources.has(
            `persistentvolumeclaim/${sourcePvc}`,
          ),
        ).toBe(true);
      } else {
        expect(
          test.cluster.resources.has(
            `persistentvolumeclaim/${sourcePvc}`,
          ),
        ).toBe(false);
      }
    }

    const state = installPluginV1(
      emptyPluginInstallerStateV1(),
      record('1.0.0'),
      '2026-07-25T00:00:00.000Z',
    );
    const test = await fixture(state);
    const outside = resolve(test.projectDirectory, 'outside.yaml');
    await writeFile(outside, 'pluginRuntime: {}\n', { mode: 0o600 });
    await unlink(test.valuesFile);
    await symlink(outside, test.valuesFile);
    await expect(
      test.adapter.executePhase({
        executionId: 'cluster-symlink',
        idempotencyKey: 'cluster-symlink:stage',
        desiredRevision: state.revision,
        planSha256: test.envelope.planSha256!,
        pluginId,
        operation: 'install',
        phase: 'stage',
        leaseDurationMs: 60_000,
        toVersion: '1.0.0',
        fromDataSchema: 0,
        toDataSchema: 0,
        renewLease: async () => {},
      }),
    ).rejects.toMatchObject({
      code: 'cluster_configuration_invalid',
    });
  });
});
