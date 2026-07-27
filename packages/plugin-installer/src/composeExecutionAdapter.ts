import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
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
  pluginComposeServiceNameV1,
  pluginComposeVolumeKeyV1,
  type InstalledPluginRecordV1,
  type PluginInstallerStateV1,
} from './index.js';

const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const RECEIPT_SCHEMA_VERSION = 1;

export type ComposeLifecycleAdapterErrorCodeV1 =
  | 'compose_configuration_invalid'
  | 'compose_state_invalid'
  | 'compose_plan_mismatch'
  | 'compose_record_missing'
  | 'compose_storage_incompatible'
  | 'compose_command_failed'
  | 'compose_command_timeout'
  | 'compose_command_output_exceeded'
  | 'compose_receipt_invalid'
  | 'compose_artifact_invalid';

export class ComposeLifecycleAdapterErrorV1 extends Error {
  constructor(
    public readonly code: ComposeLifecycleAdapterErrorCodeV1,
    message: string,
  ) {
    super(message);
    this.name = 'ComposeLifecycleAdapterErrorV1';
  }
}

export interface DockerCommandResultV1 {
  stdout: string;
  stderr: string;
}

export interface DockerCommandPortV1 {
  run(
    args: readonly string[],
    options: {
      cwd: string;
      timeoutMs: number;
    },
  ): Promise<DockerCommandResultV1>;
}

export class SpawnDockerCommandPortV1 implements DockerCommandPortV1 {
  async run(
    args: readonly string[],
    options: {
      cwd: string;
      timeoutMs: number;
    },
  ): Promise<DockerCommandResultV1> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn('docker', [...args], {
        cwd: options.cwd,
        env: process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      const finish = (
        error?: ComposeLifecycleAdapterErrorV1,
        result?: DockerCommandResultV1,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolvePromise(result!);
      };
      const collect = (target: Buffer[], chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        outputBytes += bytes.byteLength;
        if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
          child.kill('SIGKILL');
          finish(
            new ComposeLifecycleAdapterErrorV1(
              'compose_command_output_exceeded',
              'Docker command output exceeded the safe adapter limit',
            ),
          );
          return;
        }
        target.push(bytes);
      };
      child.stdout.on('data', (chunk) => collect(stdout, chunk));
      child.stderr.on('data', (chunk) => collect(stderr, chunk));
      child.on('error', () => {
        finish(
          new ComposeLifecycleAdapterErrorV1(
            'compose_command_failed',
            'Docker command could not be started',
          ),
        );
      });
      child.on('close', (code) => {
        if (settled) return;
        if (code !== 0) {
          finish(
            new ComposeLifecycleAdapterErrorV1(
              'compose_command_failed',
              'Docker command failed',
            ),
          );
          return;
        }
        finish(undefined, {
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(
          new ComposeLifecycleAdapterErrorV1(
            'compose_command_timeout',
            'Docker command exceeded the configured timeout',
          ),
        );
      }, options.timeoutMs);
      timer.unref();
    });
  }
}

export interface ComposePluginLifecyclePhaseAdapterOptionsV1 {
  outputDirectory: string;
  projectDirectory: string;
  composeFiles: readonly string[];
  projectName: string;
  utilityImage: string;
  imageMode: 'pull' | 'local';
  readyTimeoutSeconds?: number;
  stopTimeoutSeconds?: number;
  commandTimeoutMs?: number;
  docker?: DockerCommandPortV1;
}

interface ResolvedExecutionMaterialV1 {
  state: PluginInstallerStateV1;
  envelope: PluginLifecyclePlanEnvelopeV1;
  source?: InstalledPluginRecordV1;
  target?: InstalledPluginRecordV1;
}

interface ComposePhaseReceiptV1 {
  schemaVersion: 1;
  idempotencyKey: string;
  desiredRevision: number;
  planSha256: string;
  pluginId: string;
  operation: PluginLifecyclePhaseExecutionContextV1['operation'];
  phase: PluginLifecyclePhaseExecutionContextV1['phase'];
  completedAt: string;
}

function contained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

function safeProjectName(input: string): string {
  const value = input.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(value)) {
    throw new ComposeLifecycleAdapterErrorV1(
      'compose_configuration_invalid',
      'Compose project name must be a lowercase 1-63 character identifier',
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
    throw new ComposeLifecycleAdapterErrorV1(
      'compose_configuration_invalid',
      `${field} is outside its supported range`,
    );
  }
  return value;
}

function receiptIdentity(
  context: PluginLifecyclePhaseExecutionContextV1,
): Omit<ComposePhaseReceiptV1, 'completedAt'> {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    idempotencyKey: context.idempotencyKey,
    desiredRevision: context.desiredRevision,
    planSha256: context.planSha256,
    pluginId: context.pluginId,
    operation: context.operation,
    phase: context.phase,
  };
}

function sameReceipt(
  receipt: ComposePhaseReceiptV1,
  context: PluginLifecyclePhaseExecutionContextV1,
): boolean {
  const { completedAt: _completedAt, ...identity } = receipt;
  return JSON.stringify(identity) === JSON.stringify(receiptIdentity(context));
}

function storageShape(
  record: InstalledPluginRecordV1,
): PluginResourceDescriptorV1['storage'] {
  return [...record.resources.storage].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function storageCompatible(
  source: InstalledPluginRecordV1,
  target: InstalledPluginRecordV1,
): boolean {
  return (
    JSON.stringify(storageShape(source)) ===
    JSON.stringify(storageShape(target))
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

export class ComposePluginLifecyclePhaseAdapterV1
  implements PluginLifecyclePhaseAdapterV1
{
  private readonly outputDirectory: string;
  private readonly projectDirectory: string;
  private readonly composeFiles: string[];
  private readonly projectName: string;
  private readonly utilityImage: string;
  private readonly imageMode: 'pull' | 'local';
  private readonly readyTimeoutSeconds: number;
  private readonly stopTimeoutSeconds: number;
  private readonly commandTimeoutMs: number;
  private readonly docker: DockerCommandPortV1;

  constructor(options: ComposePluginLifecyclePhaseAdapterOptionsV1) {
    this.outputDirectory = resolve(options.outputDirectory);
    this.projectDirectory = resolve(options.projectDirectory);
    this.composeFiles = options.composeFiles.map((path) => resolve(path));
    if (this.composeFiles.length === 0 || this.composeFiles.length > 10) {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_configuration_invalid',
        'Compose execution requires 1-10 fixed Compose files',
      );
    }
    this.projectName = safeProjectName(options.projectName);
    this.utilityImage = ociDigestReferenceSchema.parse(options.utilityImage);
    this.imageMode = options.imageMode;
    this.readyTimeoutSeconds = boundedInteger(
      options.readyTimeoutSeconds,
      120,
      1,
      600,
      'readyTimeoutSeconds',
    );
    this.stopTimeoutSeconds = boundedInteger(
      options.stopTimeoutSeconds,
      30,
      1,
      300,
      'stopTimeoutSeconds',
    );
    this.commandTimeoutMs = boundedInteger(
      options.commandTimeoutMs,
      15 * 60_000,
      1_000,
      30 * 60_000,
      'commandTimeoutMs',
    );
    this.docker = options.docker ?? new SpawnDockerCommandPortV1();
  }

  async executePhase(
    context: PluginLifecyclePhaseExecutionContextV1,
  ): Promise<void> {
    await this.validateDeploymentPaths();
    const receiptPath = await this.receiptPath(context);
    if (await this.receiptExists(receiptPath, context)) return;
    const material = await this.loadMaterial(context);

    await this.withHeartbeat(context, async () => {
      switch (context.phase) {
        case 'stage':
          await this.stage(material);
          break;
        case 'drain':
          await this.compose([
            'stop',
            '--timeout',
            String(this.stopTimeoutSeconds),
            pluginComposeServiceNameV1(context.pluginId),
          ]);
          break;
        case 'deactivate':
          await this.compose([
            'rm',
            '--stop',
            '--force',
            pluginComposeServiceNameV1(context.pluginId),
          ]);
          break;
        case 'checkpoint':
          await this.checkpoint(context, material);
          break;
        case 'migrate':
          await this.migrate(context, material);
          break;
        case 'activate':
          await this.compose([
            'up',
            '-d',
            '--no-deps',
            pluginComposeServiceNameV1(context.pluginId),
          ]);
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
          await this.compose([
            'rm',
            '--stop',
            '--force',
            pluginComposeServiceNameV1(context.pluginId),
          ]);
          break;
        case 'commit':
          await this.compose(['config', '--quiet']);
          break;
      }
    });

    await this.writeReceipt(receiptPath, context);
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
    try {
      const result = await work();
      await heartbeat;
      if (heartbeatError) throw heartbeatError;
      await context.renewLease();
      return result;
    } finally {
      clearInterval(timer);
    }
  }

  private async validateDeploymentPaths(): Promise<void> {
    const project = await lstat(this.projectDirectory).catch(() => undefined);
    const output = await lstat(this.outputDirectory).catch(() => undefined);
    if (
      !project?.isDirectory() ||
      project.isSymbolicLink() ||
      !output?.isDirectory() ||
      output.isSymbolicLink()
    ) {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_configuration_invalid',
        'Compose project and installer output must be regular directories',
      );
    }
    const projectReal = await realpath(this.projectDirectory);
    const outputReal = await realpath(this.outputDirectory);
    if (!contained(projectReal, outputReal)) {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_configuration_invalid',
        'Installer output must remain inside the Compose project directory',
      );
    }
    for (const path of this.composeFiles) {
      const details = await lstat(path).catch(() => undefined);
      if (
        !details?.isFile() ||
        details.isSymbolicLink() ||
        details.size > MAX_STATE_BYTES
      ) {
        throw new ComposeLifecycleAdapterErrorV1(
          'compose_configuration_invalid',
          'Compose inputs must be bounded regular non-symlink files',
        );
      }
      const pathReal = await realpath(path);
      if (!contained(projectReal, pathReal)) {
        throw new ComposeLifecycleAdapterErrorV1(
          'compose_configuration_invalid',
          'Compose inputs must remain inside the project directory',
        );
      }
    }
    const generated = resolve(
      this.outputDirectory,
      'docker-compose.plugins.generated.yaml',
    );
    if (!this.composeFiles.includes(generated)) {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_configuration_invalid',
        'Compose inputs must include the generated plugin overlay',
      );
    }
  }

  private async loadMaterial(
    context: PluginLifecyclePhaseExecutionContextV1,
  ): Promise<ResolvedExecutionMaterialV1> {
    const [stateInput, envelopeInput] = await Promise.all([
      this.readBoundedJson(
        resolve(this.outputDirectory, 'plugin-installer-state.json'),
      ),
      this.readBoundedJson(
        resolve(this.outputDirectory, 'plugin-lifecycle-plan.json'),
      ),
    ]);
    let state: PluginInstallerStateV1;
    let envelope: PluginLifecyclePlanEnvelopeV1;
    try {
      state = parsePluginInstallerStateV1(stateInput);
      envelope = parsePluginLifecyclePlanEnvelopeV1(envelopeInput);
    } catch {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_state_invalid',
        'Compose lifecycle state or plan is invalid',
      );
    }
    if (
      state.revision !== context.desiredRevision ||
      envelope.desiredRevision !== context.desiredRevision ||
      envelope.planSha256 !== context.planSha256 ||
      envelope.plan?.pluginId !== context.pluginId ||
      envelope.plan.operation !== context.operation ||
      envelope.plan.phases.includes(context.phase) !== true
    ) {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_plan_mismatch',
        'Compose lifecycle material does not match the claimed execution',
      );
    }

    const current = state.plugins[context.pluginId];
    const previous = state.previous[context.pluginId] ?? [];
    const target =
      current &&
      current.version === context.toVersion &&
      current.dataSchemaVersion === context.toDataSchema
        ? current
        : findRecord(previous, context.toVersion, context.toDataSchema);
    const source =
      current &&
      current.version === context.fromVersion &&
      current.dataSchemaVersion === context.fromDataSchema
        ? current
        : findRecord(previous, context.fromVersion, context.fromDataSchema);

    if (
      ['stage', 'migrate', 'activate', 'ready'].includes(context.phase) &&
      !target
    ) {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_record_missing',
        'Target plugin deployment record is unavailable',
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
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_record_missing',
        'Source plugin deployment record is unavailable',
      );
    }
    if (
      source &&
      target &&
      (context.operation === 'upgrade' ||
        context.operation === 'rollback') &&
      !storageCompatible(source, target)
    ) {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_storage_incompatible',
        'Plugin storage declarations changed across the lifecycle boundary',
      );
    }
    return { state, envelope, source, target };
  }

  private async stage(material: ResolvedExecutionMaterialV1): Promise<void> {
    await this.compose(['config', '--quiet']);
    const target = material.target!;
    const backendImage =
      material.state.imageMappings[
        target.manifest.deployment.backend!.image
      ] ?? target.manifest.deployment.backend!.image;
    await this.ensureImage(backendImage);
    if (material.envelope.plan?.migrationImage) {
      await this.ensureImage(material.envelope.plan.migrationImage);
    }
    if (target.resources.storage.some((storage) => !storage.readOnly)) {
      await this.ensureImage(this.utilityImage);
    }
    for (const storage of target.resources.storage) {
      const volume = this.volumeName(target, storage.name);
      await this.dockerCommand(['volume', 'create', volume]);
      if (!storage.readOnly) await this.initializeWritableVolume(volume);
    }
  }

  private async checkpoint(
    context: PluginLifecyclePhaseExecutionContextV1,
    material: ResolvedExecutionMaterialV1,
  ): Promise<void> {
    const source = material.source;
    if (!source) return;
    await this.ensureImage(this.utilityImage);
    const backupRoot = await this.privateArtifactDirectory(
      'plugin-lifecycle-backups',
      context,
    );
    const artifacts = [];
    for (const storage of storageShape(source)) {
      artifacts.push({
        storageName: storage.name,
        ...(await this.archiveVolume(
          this.volumeName(source, storage.name),
          backupRoot,
          `${storage.name}.tgz`,
        )),
      });
    }
    await this.writeArtifactManifest(
      backupRoot,
      'checkpoint',
      context,
      artifacts,
    );
    const target = material.target;
    if (
      !target ||
      source.dataSchemaVersion === target.dataSchemaVersion
    ) {
      return;
    }
    for (const storage of storageShape(source)) {
      const sourceVolume = this.volumeName(source, storage.name);
      const targetVolume = this.volumeName(target, storage.name);
      await this.dockerCommand(['volume', 'rm', '--force', targetVolume]);
      await this.dockerCommand(['volume', 'create', targetVolume]);
      if (!storage.readOnly) {
        await this.initializeWritableVolume(targetVolume);
      }
      await this.utility(
        '/bin/cp',
        ['-a', '/source/.', '/target/'],
        [
          `${sourceVolume}:/source:ro`,
          `${targetVolume}:/target:rw`,
        ],
      );
    }
  }

  private async migrate(
    context: PluginLifecyclePhaseExecutionContextV1,
    material: ResolvedExecutionMaterialV1,
  ): Promise<void> {
    const target = material.target!;
    if (!context.migrationImage) {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_plan_mismatch',
        'Migration phase has no immutable migration image',
      );
    }
    await this.dockerCommand([
      'run',
      '--rm',
      '--pull',
      'never',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--user',
      '65532:65532',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,nodev,size=64m',
      '--env',
      `ENTERPRISEGLUE_PLUGIN_ID=${context.pluginId}`,
      '--env',
      `ENTERPRISEGLUE_PLUGIN_OPERATION=${context.operation}`,
      '--env',
      `ENTERPRISEGLUE_PLUGIN_FROM_SCHEMA=${context.fromDataSchema}`,
      '--env',
      `ENTERPRISEGLUE_PLUGIN_TO_SCHEMA=${context.toDataSchema}`,
      '--env',
      `ENTERPRISEGLUE_PLUGIN_IDEMPOTENCY_KEY=${context.idempotencyKey}`,
      ...storageShape(target).flatMap((storage) => [
        '--volume',
        `${this.volumeName(target, storage.name)}:${storage.mountPath}:${
          storage.readOnly ? 'ro' : 'rw'
        }`,
      ]),
      context.migrationImage,
    ]);
  }

  private async ready(
    context: PluginLifecyclePhaseExecutionContextV1,
  ): Promise<void> {
    const service = pluginComposeServiceNameV1(context.pluginId);
    try {
      await this.compose([
        'up',
        '-d',
        '--no-deps',
        '--wait',
        '--wait-timeout',
        String(this.readyTimeoutSeconds),
        service,
      ]);
    } catch {
      await this.compose([
        'stop',
        '--timeout',
        String(this.stopTimeoutSeconds),
        service,
      ]).catch(() => undefined);
      await this.compose(['rm', '--stop', '--force', service]).catch(
        () => undefined,
      );
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_command_failed',
        'Plugin readiness failed and the candidate service was removed',
      );
    }
  }

  private async exportData(
    context: PluginLifecyclePhaseExecutionContextV1,
    material: ResolvedExecutionMaterialV1,
  ): Promise<void> {
    const source = material.source!;
    await this.ensureImage(this.utilityImage);
    const exportRoot = await this.privateArtifactDirectory(
      'plugin-data-exports',
      context,
    );
    const artifacts = [];
    for (const storage of storageShape(source)) {
      artifacts.push({
        storageName: storage.name,
        ...(await this.archiveVolume(
          this.volumeName(source, storage.name),
          exportRoot,
          `${storage.name}.tgz`,
        )),
      });
    }
    await this.writeArtifactManifest(
      exportRoot,
      'export',
      context,
      artifacts,
    );
  }

  private async deleteData(
    material: ResolvedExecutionMaterialV1,
  ): Promise<void> {
    const source = material.source!;
    for (const storage of storageShape(source)) {
      await this.dockerCommand([
        'volume',
        'rm',
        '--force',
        this.volumeName(source, storage.name),
      ]);
    }
  }

  private volumeName(
    record: InstalledPluginRecordV1,
    storageName: string,
  ): string {
    return `${this.projectName}_${pluginComposeVolumeKeyV1(
      record.pluginId,
      record.dataSchemaVersion,
      storageName,
    )}`;
  }

  private async archiveVolume(
    volume: string,
    directory: string,
    filename: string,
  ): Promise<{
    filename: string;
    sizeBytes: number;
    sha256: string;
  }> {
    // The plugin data volume is owned by the fixed plugin UID. Give that
    // one-shot utility UID write-only access to this unguessable private
    // execution directory, then restore the deployment-owner-only mode.
    await chmod(directory, 0o1733);
    try {
      await this.utility(
        '/bin/tar',
        ['-C', '/source', '-czf', `/archive/${filename}`, '.'],
        [`${volume}:/source:ro`, `${directory}:/archive:rw`],
      );
    } finally {
      await chmod(directory, 0o700);
    }
    const path = resolve(directory, filename);
    const details = await lstat(path).catch(() => undefined);
    if (
      !details?.isFile() ||
      details.isSymbolicLink() ||
      details.size < 1
    ) {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_artifact_invalid',
        'Compose lifecycle archive was not created as a regular file',
      );
    }
    const digest = createHash('sha256');
    let sizeBytes = 0;
    for await (const chunk of createReadStream(path)) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += bytes.byteLength;
      digest.update(bytes);
    }
    return {
      filename,
      sizeBytes,
      sha256: digest.digest('hex'),
    };
  }

  private async writeArtifactManifest(
    directory: string,
    kind: 'checkpoint' | 'export',
    context: PluginLifecyclePhaseExecutionContextV1,
    artifacts: Array<{
      storageName: string;
      filename: string;
      sizeBytes: number;
      sha256: string;
    }>,
  ): Promise<void> {
    const path = resolve(directory, `${kind}-manifest.json`);
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(
      temporary,
      `${JSON.stringify(
        {
          apiVersion:
            'compose-data-artifact.plugin.enterpriseglue.io/v1',
          kind:
            kind === 'checkpoint'
              ? 'EnterpriseGluePluginDataCheckpoint'
              : 'EnterpriseGluePluginDataExport',
          executionId: context.executionId,
          desiredRevision: context.desiredRevision,
          planSha256: context.planSha256,
          pluginId: context.pluginId,
          fromDataSchema: context.fromDataSchema,
          artifacts,
        },
        null,
        2,
      )}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      },
    );
    try {
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async utility(
    entrypoint: '/bin/tar' | '/bin/cp' | '/bin/chown',
    args: readonly string[],
    volumes: readonly string[],
    options: {
      user?: '0:0' | '65532:65532';
      capAdd?: 'CHOWN';
    } = {},
  ): Promise<void> {
    await this.dockerCommand([
      'run',
      '--rm',
      '--pull',
      'never',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      ...(options.capAdd ? ['--cap-add', options.capAdd] : []),
      '--security-opt',
      'no-new-privileges:true',
      '--user',
      options.user ?? '65532:65532',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,nodev,size=16m',
      '--entrypoint',
      entrypoint,
      ...volumes.flatMap((volume) => ['--volume', volume]),
      this.utilityImage,
      ...args,
    ]);
  }

  private initializeWritableVolume(volume: string): Promise<void> {
    return this.utility(
      '/bin/chown',
      ['65532:65532', '/target'],
      [`${volume}:/target:rw`],
      { user: '0:0', capAdd: 'CHOWN' },
    );
  }

  private async ensureImage(image: string): Promise<void> {
    ociDigestReferenceSchema.parse(image);
    await this.dockerCommand([
      'image',
      this.imageMode === 'pull' ? 'pull' : 'inspect',
      image,
    ]);
  }

  private compose(command: readonly string[]): Promise<DockerCommandResultV1> {
    return this.dockerCommand([
      'compose',
      '--project-directory',
      this.projectDirectory,
      '--project-name',
      this.projectName,
      ...this.composeFiles.flatMap((path) => ['--file', path]),
      ...command,
    ]);
  }

  private dockerCommand(
    args: readonly string[],
  ): Promise<DockerCommandResultV1> {
    return this.docker.run(args, {
      cwd: this.projectDirectory,
      timeoutMs: this.commandTimeoutMs,
    });
  }

  private async privateArtifactDirectory(
    kind: 'plugin-lifecycle-backups' | 'plugin-data-exports',
    context: PluginLifecyclePhaseExecutionContextV1,
  ): Promise<string> {
    const token = createHash('sha256')
      .update(`${context.executionId}:${context.pluginId}`)
      .digest('hex');
    const root = resolve(this.outputDirectory, kind);
    const target = resolve(root, token);
    await mkdir(target, { recursive: true, mode: 0o700 });
    const details = await lstat(target);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_artifact_invalid',
        'Compose lifecycle artifact directory is invalid',
      );
    }
    await chmod(target, 0o700);
    return target;
  }

  private async receiptPath(
    context: PluginLifecyclePhaseExecutionContextV1,
  ): Promise<string> {
    const root = resolve(
      this.outputDirectory,
      'plugin-lifecycle-effects',
    );
    await mkdir(root, { recursive: true, mode: 0o700 });
    const details = await lstat(root);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_receipt_invalid',
        'Compose lifecycle receipt directory is invalid',
      );
    }
    await chmod(root, 0o700);
    const token = createHash('sha256')
      .update(context.idempotencyKey)
      .digest('hex');
    return resolve(root, `${token}.json`);
  }

  private async receiptExists(
    path: string,
    context: PluginLifecyclePhaseExecutionContextV1,
  ): Promise<boolean> {
    let details;
    try {
      details = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    if (
      !details.isFile() ||
      details.isSymbolicLink() ||
      details.size > 64 * 1024
    ) {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_receipt_invalid',
        'Compose lifecycle receipt is not a bounded regular file',
      );
    }
    let receipt: ComposePhaseReceiptV1;
    try {
      receipt = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_receipt_invalid',
        'Compose lifecycle receipt is invalid JSON',
      );
    }
    if (
      !receipt ||
      receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
      typeof receipt.completedAt !== 'string' ||
      !Number.isFinite(Date.parse(receipt.completedAt)) ||
      !sameReceipt(receipt, context)
    ) {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_receipt_invalid',
        'Compose lifecycle receipt does not match the current phase',
      );
    }
    return true;
  }

  private async writeReceipt(
    path: string,
    context: PluginLifecyclePhaseExecutionContextV1,
  ): Promise<void> {
    const receipt: ComposePhaseReceiptV1 = {
      ...receiptIdentity(context),
      completedAt: new Date().toISOString(),
    };
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    try {
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async readBoundedJson(path: string): Promise<unknown> {
    const details = await lstat(path).catch(() => undefined);
    if (
      !details?.isFile() ||
      details.isSymbolicLink() ||
      details.size > MAX_STATE_BYTES
    ) {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_state_invalid',
        'Compose lifecycle input must be a bounded regular non-symlink file',
      );
    }
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch {
      throw new ComposeLifecycleAdapterErrorV1(
        'compose_state_invalid',
        'Compose lifecycle input is invalid JSON',
      );
    }
  }
}
