import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import type { PluginId } from '@enterpriseglue/plugin-sdk';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ComposeLifecycleAdapterErrorV1,
  ComposePluginLifecyclePhaseAdapterV1,
  createPluginLifecyclePlanEnvelopeV1,
  emptyPluginInstallerStateV1,
  FilePluginLifecycleExecutionStoreV1,
  installPluginV1,
  pluginComposeVolumeKeyV1,
  pluginLifecyclePlanFileName,
  renderComposePluginOverlayV1,
  rollbackPluginV1,
  runPluginLifecycleExecutionV1,
  setPluginEnabledV1,
  uninstallPluginV1,
  upgradePluginV1,
  verifyPluginInstallInputV1,
  type DockerCommandPortV1,
  type InstalledPluginRecordV1,
  type PluginInstallerStateV1,
  type PluginLifecyclePhaseExecutionContextV1,
} from './index.js';
import { runPluginInstallerCliV1 } from './cli.js';

const pluginId = 'io.enterpriseglue.example' as PluginId;
const imageHash = '3'.repeat(64);
const migrationHash = '4'.repeat(64);
const utilityImage =
  `registry.example/plugin-installer@sha256:${'5'.repeat(64)}`;
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

class FakeDocker implements DockerCommandPortV1 {
  readonly calls: string[][] = [];
  failReadyOnce = false;

  async run(args: readonly string[]) {
    this.calls.push([...args]);
    if (this.failReadyOnce && args.includes('--wait')) {
      this.failReadyOnce = false;
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_command_failed',
        'synthetic readiness failure',
      );
    }
    if (args.includes('/bin/tar')) {
      const archiveVolume = args.find((value) =>
        value.endsWith(':/archive:rw'),
      );
      const archiveTarget = args.find((value) =>
        value.startsWith('/archive/'),
      );
      if (archiveVolume && archiveTarget) {
        const directory = archiveVolume.slice(
          0,
          -':/archive:rw'.length,
        );
        await mkdir(directory, { recursive: true });
        await writeFile(
          resolve(directory, archiveTarget.slice('/archive/'.length)),
          'synthetic archive',
          { mode: 0o600 },
        );
      }
    }
    return { stdout: '', stderr: '' };
  }
}

async function fixture(state: PluginInstallerStateV1) {
  const projectDirectory = await mkdtemp(
    resolve(tmpdir(), 'eg-plugin-compose-adapter-'),
  );
  directories.push(projectDirectory);
  const outputDirectory = resolve(projectDirectory, 'generated/plugins');
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const baseCompose = resolve(projectDirectory, 'compose.yaml');
  const generatedCompose = resolve(
    outputDirectory,
    'docker-compose.plugins.generated.yaml',
  );
  await writeFile(
    baseCompose,
    'services:\n  backend:\n    image: registry.example/backend@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
    { mode: 0o600 },
  );
  await writeFile(generatedCompose, renderComposePluginOverlayV1(state), {
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
  await writeFile(
    resolve(outputDirectory, pluginLifecyclePlanFileName),
    `${JSON.stringify(envelope, null, 2)}\n`,
    { mode: 0o600 },
  );
  const docker = new FakeDocker();
  const adapter = new ComposePluginLifecyclePhaseAdapterV1({
    outputDirectory,
    projectDirectory,
    composeFiles: [baseCompose, generatedCompose],
    projectName: 'egtest',
    utilityImage,
    imageMode: 'local',
    docker,
  });
  return {
    adapter,
    baseCompose,
    docker,
    envelope,
    generatedCompose,
    outputDirectory,
    projectDirectory,
  };
}

function context(
  state: PluginInstallerStateV1,
  phase: PluginLifecyclePhaseExecutionContextV1['phase'],
  renewLease = async () => {},
): PluginLifecyclePhaseExecutionContextV1 {
  const envelope = createPluginLifecyclePlanEnvelopeV1(
    state.revision,
    state.lifecyclePlan ?? null,
  );
  const plan = envelope.plan!;
  return {
    executionId: `compose-${state.revision}-execution`,
    idempotencyKey: `compose-${state.revision}-execution:${phase}`,
    desiredRevision: state.revision,
    planSha256: envelope.planSha256!,
    pluginId,
    operation: plan.operation,
    phase,
    leaseDurationMs: 60_000,
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    fromDataSchema: plan.fromDataSchema,
    toDataSchema: plan.toDataSchema,
    migrationImage: plan.migrationImage,
    dataAction: plan.dataAction,
    renewLease,
  };
}

describe('ComposePluginLifecyclePhaseAdapterV1', () => {
  it('stages a disabled install once and keeps its service behind a disabled profile', async () => {
    const state = installPluginV1(
      emptyPluginInstallerStateV1(),
      record('1.0.0'),
      '2026-07-25T00:00:00.000Z',
    );
    expect(state.lifecyclePlan?.phases).toEqual(['stage', 'commit']);
    const test = await fixture(state);
    const stage = context(state, 'stage');

    await test.adapter.executePhase(stage);
    const callsAfterFirstRun = test.docker.calls.length;
    await test.adapter.executePhase(stage);

    expect(test.docker.calls).toHaveLength(callsAfterFirstRun);
    expect(test.docker.calls.some((args) => args.includes('config'))).toBe(
      true,
    );
    expect(
      test.docker.calls.some(
        (args) => args[0] === 'image' && args[1] === 'inspect',
      ),
    ).toBe(true);
    expect(
      test.docker.calls.some(
        (args) =>
          args[0] === 'volume' &&
          args.at(-1) ===
            `egtest_${pluginComposeVolumeKeyV1(
              pluginId,
              0,
              'data',
            )}`,
      ),
    ).toBe(true);
    expect(await readFile(test.generatedCompose, 'utf8')).toContain(
      'enterpriseglue-disabled-plugins',
    );
  });

  it('wires the deployment-only apply-compose CLI to the durable runner', async () => {
    const state = installPluginV1(
      emptyPluginInstallerStateV1(),
      record('1.0.0'),
      '2026-07-25T00:00:00.000Z',
    );
    const test = await fixture(state);
    const output: string[] = [];

    await expect(
      runPluginInstallerCliV1(
        [
          'apply-compose',
          '--output',
          test.outputDirectory,
          '--project-directory',
          test.projectDirectory,
          '--compose-files',
          `${test.baseCompose},${test.generatedCompose}`,
          '--project-name',
          'egtest',
          '--utility-image',
          utilityImage,
          '--image-mode',
          'local',
          '--owner',
          'compose-cli-worker-0001',
        ],
        (line) => output.push(line),
        { docker: test.docker },
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(output.at(-1)!)).toMatchObject({
      pluginId,
      operation: 'install',
      status: 'succeeded',
      completedPhases: ['stage', 'commit'],
    });
  });

  it('blocks plan replacement and permits only revision-bound inverse recovery', async () => {
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
    const store = new FilePluginLifecycleExecutionStoreV1(
      test.outputDirectory,
    );
    let execution = await store.initialize({
      executionId: 'compose-enable-to-recover',
      occurredAt: '2026-07-25T00:02:00.000Z',
    });

    await expect(
      runPluginInstallerCliV1([
        'disable',
        '--plugin',
        pluginId,
        '--output',
        test.outputDirectory,
      ]),
    ).rejects.toMatchObject({ code: 'execution_active' });

    execution = await store.claim({
      expectedRevision: execution.revision,
      owner: 'compose-failing-worker',
      occurredAt: '2026-07-25T00:02:01.000Z',
      leaseDurationMs: 60_000,
    });
    execution = await store.fail({
      expectedRevision: execution.revision,
      owner: 'compose-failing-worker',
      occurredAt: '2026-07-25T00:02:02.000Z',
    });

    await expect(
      runPluginInstallerCliV1([
        'rollback',
        '--plugin',
        pluginId,
        '--output',
        test.outputDirectory,
        '--supersede-execution-revision',
        String(execution.revision),
      ]),
    ).rejects.toMatchObject({ code: 'execution_active' });

    await expect(
      runPluginInstallerCliV1([
        'disable',
        '--plugin',
        pluginId,
        '--output',
        test.outputDirectory,
        '--supersede-execution-revision',
        String(execution.revision),
      ]),
    ).resolves.toBe(0);

    const output: string[] = [];
    await expect(
      runPluginInstallerCliV1(
        [
          'apply-compose',
          '--output',
          test.outputDirectory,
          '--project-directory',
          test.projectDirectory,
          '--compose-files',
          `${test.baseCompose},${test.generatedCompose}`,
          '--project-name',
          'egtest',
          '--utility-image',
          utilityImage,
          '--image-mode',
          'local',
          '--owner',
          'compose-recovery-worker',
          '--supersede-execution-revision',
          String(execution.revision),
        ],
        (line) => output.push(line),
        { docker: test.docker },
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(output.at(-1)!)).toMatchObject({
      pluginId,
      operation: 'disable',
      status: 'succeeded',
      completedPhases: ['drain', 'deactivate', 'commit'],
    });
  });

  it('runs an enabled schema upgrade in a safe stop-checkpoint-migrate-start-ready order', async () => {
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
    expect(state.lifecyclePlan?.phases).toEqual([
      'stage',
      'drain',
      'deactivate',
      'checkpoint',
      'migrate',
      'activate',
      'ready',
      'commit',
    ]);
    const test = await fixture(state);
    const store = new FilePluginLifecycleExecutionStoreV1(
      test.outputDirectory,
    );
    await store.initialize({
      executionId: 'compose-upgrade-execution',
      occurredAt: '2026-07-25T00:03:00.000Z',
    });

    const execution = await runPluginLifecycleExecutionV1({
      store,
      adapter: test.adapter,
      owner: 'compose-worker-0001',
      leaseDurationMs: 60_000,
    });

    expect(execution.status).toBe('succeeded');
    const flattened = test.docker.calls.map((args) => args.join(' '));
    const stopIndex = flattened.findIndex((call) =>
      call.includes(' stop --timeout '),
    );
    const checkpointIndex = flattened.findIndex((call) =>
      call.includes('--entrypoint /bin/tar'),
    );
    const migrateIndex = flattened.findIndex(
      (call) =>
        call.includes('ENTERPRISEGLUE_PLUGIN_FROM_SCHEMA=0') &&
        call.includes('ENTERPRISEGLUE_PLUGIN_TO_SCHEMA=2'),
    );
    const activateIndex = flattened.findIndex((call) =>
      call.includes(' up -d --no-deps '),
    );
    const readyIndex = flattened.findIndex((call) =>
      call.includes('--wait-timeout'),
    );
    expect(stopIndex).toBeGreaterThan(-1);
    expect(checkpointIndex).toBeGreaterThan(stopIndex);
    expect(migrateIndex).toBeGreaterThan(checkpointIndex);
    expect(activateIndex).toBeGreaterThan(migrateIndex);
    expect(readyIndex).toBeGreaterThan(activateIndex);
    expect(flattened[migrateIndex]).toContain(
      'egtest_eg-plugin-io-enterpriseglue-example-schema-2-data:/var/lib/plugin:rw',
    );
    const checkpointDirectories = await readdir(
      resolve(test.outputDirectory, 'plugin-lifecycle-backups'),
    );
    expect(
      JSON.parse(
        await readFile(
          resolve(
            test.outputDirectory,
            'plugin-lifecycle-backups',
            checkpointDirectories[0]!,
            'checkpoint-manifest.json',
          ),
          'utf8',
        ),
      ),
    ).toMatchObject({
      kind: 'EnterpriseGluePluginDataCheckpoint',
      fromDataSchema: 0,
      artifacts: [
        {
          storageName: 'data',
          sizeBytes: expect.any(Number),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      ],
    });
    expect(
      await readdir(
        resolve(test.outputDirectory, 'plugin-lifecycle-effects'),
      ),
    ).toHaveLength(state.lifecyclePlan!.phases.length);
  });

  it('copies the source schema and runs the signed downgrade before rollback activation', async () => {
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
    expect(state.lifecyclePlan).toMatchObject({
      operation: 'rollback',
      fromVersion: '2.0.0',
      toVersion: '1.0.0',
      fromDataSchema: 2,
      toDataSchema: 0,
      migrationImage:
        `registry.example/example-migration@sha256:${migrationHash}`,
    });
    const test = await fixture(state);
    const store = new FilePluginLifecycleExecutionStoreV1(
      test.outputDirectory,
    );
    await store.initialize({
      executionId: 'compose-rollback-execution',
      occurredAt: '2026-07-25T00:04:00.000Z',
    });

    const execution = await runPluginLifecycleExecutionV1({
      store,
      adapter: test.adapter,
      owner: 'compose-rollback-worker',
      leaseDurationMs: 60_000,
    });

    expect(execution.status).toBe('succeeded');
    const calls = test.docker.calls.map((args) => args.join(' '));
    const copyIndex = calls.findIndex(
      (call) =>
        call.includes('--entrypoint /bin/cp') &&
        call.includes(
          'egtest_eg-plugin-io-enterpriseglue-example-schema-2-data:/source:ro',
        ) &&
        call.includes(
          'egtest_eg-plugin-io-enterpriseglue-example-data:/target:rw',
        ),
    );
    const migrateIndex = calls.findIndex(
      (call) =>
        call.includes('ENTERPRISEGLUE_PLUGIN_OPERATION=rollback') &&
        call.includes('ENTERPRISEGLUE_PLUGIN_FROM_SCHEMA=2') &&
        call.includes('ENTERPRISEGLUE_PLUGIN_TO_SCHEMA=0'),
    );
    const activateIndex = calls.findIndex((call) =>
      call.includes(' up -d --no-deps '),
    );
    expect(copyIndex).toBeGreaterThan(-1);
    expect(migrateIndex).toBeGreaterThan(copyIndex);
    expect(activateIndex).toBeGreaterThan(migrateIndex);
  });

  it('removes an unhealthy candidate and resumes at readiness without repeating activation', async () => {
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
    test.docker.failReadyOnce = true;
    const store = new FilePluginLifecycleExecutionStoreV1(
      test.outputDirectory,
    );
    await store.initialize({
      executionId: 'compose-enable-execution',
      occurredAt: '2026-07-25T00:02:00.000Z',
    });

    const failed = await runPluginLifecycleExecutionV1({
      store,
      adapter: test.adapter,
      owner: 'compose-worker-0001',
      leaseDurationMs: 60_000,
    });
    expect(failed).toMatchObject({
      status: 'failed',
      completedPhases: ['activate'],
      nextPhase: 'ready',
    });
    const activationCallsBeforeResume = test.docker.calls.filter(
      (args) => args.includes('up') && !args.includes('--wait'),
    ).length;
    expect(
      test.docker.calls.some((args) => args.includes('stop')),
    ).toBe(true);
    expect(test.docker.calls.some((args) => args.includes('rm'))).toBe(
      true,
    );

    const succeeded = await runPluginLifecycleExecutionV1({
      store,
      adapter: test.adapter,
      owner: 'compose-worker-0002',
      leaseDurationMs: 60_000,
    });
    expect(succeeded.status).toBe('succeeded');
    expect(
      test.docker.calls.filter(
        (args) => args.includes('up') && !args.includes('--wait'),
      ),
    ).toHaveLength(activationCallsBeforeResume);
  });

  it('exports or deletes only the retained uninstall tombstone volumes', async () => {
    for (const dataAction of ['export', 'delete'] as const) {
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
      state = uninstallPluginV1(
        state,
        pluginId,
        dataAction,
        '2026-07-25T00:02:00.000Z',
      );
      expect(state.plugins).toEqual({});
      expect(state.previous[pluginId]?.at(-1)?.version).toBe('1.0.0');
      const test = await fixture(state);
      const store = new FilePluginLifecycleExecutionStoreV1(
        test.outputDirectory,
      );
      await store.initialize({
        executionId: `compose-${dataAction}-execution`,
        occurredAt: '2026-07-25T00:03:00.000Z',
      });
      const execution = await runPluginLifecycleExecutionV1({
        store,
        adapter: test.adapter,
        owner: `compose-${dataAction}-worker`,
        leaseDurationMs: 60_000,
      });
      expect(execution.status).toBe('succeeded');
      const calls = test.docker.calls.map((args) => args.join(' '));
      if (dataAction === 'export') {
        expect(
          calls.some((call) => call.includes('--entrypoint /bin/tar')),
        ).toBe(true);
        expect(
          calls.some((call) => call.startsWith('volume rm --force')),
        ).toBe(false);
        const exportDirectories = await readdir(
          resolve(test.outputDirectory, 'plugin-data-exports'),
        );
        expect(
          JSON.parse(
            await readFile(
              resolve(
                test.outputDirectory,
                'plugin-data-exports',
                exportDirectories[0]!,
                'export-manifest.json',
              ),
              'utf8',
            ),
          ).kind,
        ).toBe('EnterpriseGluePluginDataExport');
      } else {
        expect(
          calls.some((call) =>
            call.startsWith(
              'volume rm --force egtest_eg-plugin-io-enterpriseglue-example-data',
            ),
          ),
        ).toBe(true);
      }
      expect(await readFile(test.generatedCompose, 'utf8')).toContain(
        'enterpriseglue-disabled-plugins',
      );
    }
  });

  it('fails closed on a symlinked Compose input before invoking Docker', async () => {
    const state = installPluginV1(
      emptyPluginInstallerStateV1(),
      record('1.0.0'),
      '2026-07-25T00:00:00.000Z',
    );
    const test = await fixture(state);
    const outside = resolve(test.projectDirectory, 'outside.yaml');
    await writeFile(outside, 'services: {}\n', { mode: 0o600 });
    await unlink(test.baseCompose);
    await symlink(outside, test.baseCompose);

    await expect(
      test.adapter.executePhase(context(state, 'stage')),
    ).rejects.toMatchObject({
      code: 'compose_configuration_invalid',
    });
    expect(test.docker.calls).toEqual([]);
  });
});
