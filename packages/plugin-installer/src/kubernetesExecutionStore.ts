import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  lstat,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  claimPluginLifecycleExecutionV1,
  completePluginLifecyclePhaseV1,
  createPluginLifecycleExecutionV1,
  failPluginLifecycleExecutionV1,
  parsePluginLifecycleExecutionV1,
  parsePluginLifecyclePlanEnvelopeV1,
  recoverExpiredPluginLifecycleExecutionV1,
  renewPluginLifecycleExecutionLeaseV1,
  PluginLifecycleExecutionError,
  type PluginLifecycleExecutionV1,
  type PluginLifecyclePlanEnvelopeV1,
} from './execution.js';
import type { PluginDeploymentLifecyclePhaseV1 } from './index.js';
import type {
  PluginLifecycleExecutionStorePortV1,
} from './executionRunner.js';
import type {
  StoredPluginLifecycleExecutionV1,
} from './executionStore.js';
import { pluginLifecycleExecutionFileName } from './executionStore.js';
import {
  writePluginDeploymentExecutionObservationV1,
} from './executionObservation.js';
import { readBoundedRegularFileV1 } from './secureFile.js';

const MAX_CLUSTER_COMMAND_OUTPUT = 4 * 1024 * 1024;
const MAX_CLUSTER_STATE_BYTES = 512 * 1024;
const namespacePattern =
  /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const resourceNamePattern =
  /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

export type ClusterCommandToolV1 = 'kubectl' | 'helm';

export interface ClusterCommandResultV1 {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ClusterCommandPortV1 {
  run(
    tool: ClusterCommandToolV1,
    args: readonly string[],
    options: {
      cwd: string;
      timeoutMs: number;
      stdin?: string;
    },
  ): Promise<ClusterCommandResultV1>;
}

export type KubernetesLifecycleErrorCodeV1 =
  | 'cluster_command_failed'
  | 'cluster_command_timeout'
  | 'cluster_command_output_exceeded'
  | 'cluster_configuration_invalid'
  | 'cluster_state_invalid'
  | 'cluster_receipt_invalid'
  | 'cluster_job_failed';

export class KubernetesLifecycleErrorV1 extends Error {
  constructor(
    public readonly code: KubernetesLifecycleErrorCodeV1,
    message: string,
  ) {
    super(message);
    this.name = 'KubernetesLifecycleErrorV1';
  }
}

export class SpawnClusterCommandPortV1
  implements ClusterCommandPortV1
{
  async run(
    tool: ClusterCommandToolV1,
    args: readonly string[],
    options: {
      cwd: string;
      timeoutMs: number;
      stdin?: string;
    },
  ): Promise<ClusterCommandResultV1> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(tool, [...args], {
        cwd: options.cwd,
        env: {
          ...process.env,
          // ConfigMap storage keeps Helm release metadata within the same
          // namespace-scoped, non-secret control plane as lifecycle state.
          HELM_DRIVER: process.env.HELM_DRIVER?.trim() || 'configmap',
        },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      const finish = (
        error?: KubernetesLifecycleErrorV1,
        result?: ClusterCommandResultV1,
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
        if (outputBytes > MAX_CLUSTER_COMMAND_OUTPUT) {
          child.kill('SIGKILL');
          finish(
            new KubernetesLifecycleErrorV1(
              'cluster_command_output_exceeded',
              'Cluster command output exceeded the safe worker limit',
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
          new KubernetesLifecycleErrorV1(
            'cluster_command_failed',
            'Cluster command could not be started',
          ),
        );
      });
      child.on('close', (code) => {
        if (settled) return;
        finish(undefined, {
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
      });
      if (options.stdin !== undefined) child.stdin.end(options.stdin);
      else child.stdin.end();
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(
          new KubernetesLifecycleErrorV1(
            'cluster_command_timeout',
            'Cluster command exceeded the configured timeout',
          ),
        );
      }, options.timeoutMs);
      timer.unref();
    });
  }
}

interface KubernetesConfigMapV1 {
  apiVersion: 'v1';
  kind: 'ConfigMap';
  metadata: {
    name: string;
    namespace: string;
    resourceVersion?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  data: Record<string, string>;
}

export interface KubernetesPluginLifecycleExecutionStoreOptionsV1 {
  namespace: string;
  name?: string;
  planPath: string;
  workingDirectory: string;
  context?: string;
  command?: ClusterCommandPortV1;
  commandTimeoutMs?: number;
}

function safeName(
  input: string,
  pattern: RegExp,
  field: string,
): string {
  const value = input.trim();
  if (value.length < 1 || value.length > 63 || !pattern.test(value)) {
    throw new KubernetesLifecycleErrorV1(
      'cluster_configuration_invalid',
      `${field} is not a valid Kubernetes identifier`,
    );
  }
  return value;
}

function parseStored(
  configMap: KubernetesConfigMapV1,
): StoredPluginLifecycleExecutionV1 {
  const serialized = configMap.data['execution-state.json'];
  if (
    typeof serialized !== 'string' ||
    Buffer.byteLength(serialized) > MAX_CLUSTER_STATE_BYTES
  ) {
    throw new KubernetesLifecycleErrorV1(
      'cluster_state_invalid',
      'Cluster lifecycle state is missing or oversized',
    );
  }
  let input: unknown;
  try {
    input = JSON.parse(serialized);
  } catch {
    throw new KubernetesLifecycleErrorV1(
      'cluster_state_invalid',
      'Cluster lifecycle state is invalid JSON',
    );
  }
  if (
    !input ||
    typeof input !== 'object' ||
    (input as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    !Array.isArray((input as { history?: unknown }).history)
  ) {
    throw new KubernetesLifecycleErrorV1(
      'cluster_state_invalid',
      'Cluster lifecycle state schema is invalid',
    );
  }
  const stored = input as StoredPluginLifecycleExecutionV1;
  const envelope = parsePluginLifecyclePlanEnvelopeV1(stored.envelope);
  const execution = parsePluginLifecycleExecutionV1(
    stored.execution,
    envelope,
  );
  const history = stored.history.slice(-100).map((entry) => {
    const historicalEnvelope =
      parsePluginLifecyclePlanEnvelopeV1(entry.envelope);
    return {
      envelope: historicalEnvelope,
      execution: parsePluginLifecycleExecutionV1(
        entry.execution,
        historicalEnvelope,
      ),
    };
  });
  return { schemaVersion: 1, envelope, execution, history };
}

export class KubernetesPluginLifecycleExecutionStoreV1
  implements PluginLifecycleExecutionStorePortV1
{
  private readonly namespace: string;
  private readonly name: string;
  private readonly planPath: string;
  private readonly workingDirectory: string;
  private readonly context?: string;
  private readonly command: ClusterCommandPortV1;
  private readonly commandTimeoutMs: number;

  constructor(
    options: KubernetesPluginLifecycleExecutionStoreOptionsV1,
  ) {
    this.namespace = safeName(
      options.namespace,
      namespacePattern,
      'namespace',
    );
    this.name = safeName(
      options.name ?? 'enterpriseglue-plugin-lifecycle',
      resourceNamePattern,
      'execution ConfigMap name',
    );
    this.planPath = resolve(options.planPath);
    this.workingDirectory = resolve(options.workingDirectory);
    this.context = options.context?.trim() || undefined;
    this.command = options.command ?? new SpawnClusterCommandPortV1();
    this.commandTimeoutMs = options.commandTimeoutMs ?? 60_000;
    if (
      !Number.isInteger(this.commandTimeoutMs) ||
      this.commandTimeoutMs < 1_000 ||
      this.commandTimeoutMs > 300_000
    ) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_configuration_invalid',
        'Cluster state command timeout must be 1-300 seconds',
      );
    }
  }

  async initialize(input: {
    executionId: string;
    occurredAt: string;
    supersedeExecutionRevision?: number;
  }): Promise<PluginLifecycleExecutionV1> {
    const envelope = await this.readPlan();
    if (!envelope.plan) {
      throw new PluginLifecycleExecutionError(
        'plan_unavailable',
        'Lifecycle plan is empty; there is nothing to execute',
      );
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.readConfigMap();
      let history: StoredPluginLifecycleExecutionV1['history'] = [];
      if (current) {
        const stored = parseStored(current);
        if (
          stored.envelope.desiredRevision === envelope.desiredRevision &&
          stored.envelope.planSha256 === envelope.planSha256
        ) {
          await this.writeLocalMirror(stored);
          return structuredClone(stored.execution);
        }
        if (
          stored.execution.status !== 'succeeded' &&
          !(
            (stored.execution.status === 'failed' ||
              stored.execution.status === 'manual_intervention') &&
            input.supersedeExecutionRevision ===
              stored.execution.revision
          )
        ) {
          throw new PluginLifecycleExecutionError(
            'execution_active',
            'A non-succeeded cluster lifecycle execution must be resolved before another plan is initialized',
          );
        }
        history = [
          ...stored.history,
          {
            envelope: stored.envelope,
            execution: stored.execution,
          },
        ].slice(-100);
      }
      const execution = createPluginLifecycleExecutionV1({
        envelope,
        executionId: input.executionId,
        occurredAt: input.occurredAt,
      });
      const next: StoredPluginLifecycleExecutionV1 = {
        schemaVersion: 1,
        envelope,
        execution,
        history,
      };
      const written = await this.writeConfigMap(current, next);
      if (written) return structuredClone(execution);
    }
    throw new PluginLifecycleExecutionError(
      'revision_conflict',
      'Cluster lifecycle initialization conflicted repeatedly',
    );
  }

  async read(): Promise<PluginLifecycleExecutionV1> {
    const configMap = await this.readConfigMap();
    if (!configMap) {
      throw new PluginLifecycleExecutionError(
        'execution_not_found',
        'No cluster lifecycle execution has been initialized',
      );
    }
    const stored = parseStored(configMap);
    await this.assertCurrentPlan(stored);
    await this.writeLocalMirror(stored);
    return structuredClone(stored.execution);
  }

  async readPlan(): Promise<PluginLifecyclePlanEnvelopeV1> {
    let input: unknown;
    try {
      input = JSON.parse(
        await readBoundedRegularFileV1(
          this.planPath,
          MAX_CLUSTER_STATE_BYTES,
        ),
      );
    } catch {
      throw new PluginLifecycleExecutionError(
        'plan_unavailable',
        'Cluster lifecycle plan is invalid JSON',
      );
    }
    return parsePluginLifecyclePlanEnvelopeV1(input);
  }

  claim(input: {
    expectedRevision: number;
    owner: string;
    occurredAt: string;
    leaseDurationMs: number;
  }): Promise<PluginLifecycleExecutionV1> {
    return this.mutate(input.expectedRevision, (stored) =>
      claimPluginLifecycleExecutionV1({
        execution: stored.execution,
        envelope: stored.envelope,
        owner: input.owner,
        occurredAt: input.occurredAt,
        leaseDurationMs: input.leaseDurationMs,
      }),
    );
  }

  renew(input: {
    expectedRevision: number;
    owner: string;
    occurredAt: string;
    leaseDurationMs: number;
  }): Promise<PluginLifecycleExecutionV1> {
    return this.mutate(input.expectedRevision, (stored) =>
      renewPluginLifecycleExecutionLeaseV1({
        execution: stored.execution,
        envelope: stored.envelope,
        owner: input.owner,
        occurredAt: input.occurredAt,
        leaseDurationMs: input.leaseDurationMs,
      }),
    );
  }

  complete(input: {
    expectedRevision: number;
    owner: string;
    phase: PluginDeploymentLifecyclePhaseV1;
    occurredAt: string;
  }): Promise<PluginLifecycleExecutionV1> {
    return this.mutate(input.expectedRevision, (stored) =>
      completePluginLifecyclePhaseV1({
        execution: stored.execution,
        envelope: stored.envelope,
        owner: input.owner,
        phase: input.phase,
        occurredAt: input.occurredAt,
      }),
    );
  }

  fail(input: {
    expectedRevision: number;
    owner: string;
    occurredAt: string;
  }): Promise<PluginLifecycleExecutionV1> {
    return this.mutate(input.expectedRevision, (stored) =>
      failPluginLifecycleExecutionV1({
        execution: stored.execution,
        envelope: stored.envelope,
        owner: input.owner,
        occurredAt: input.occurredAt,
      }),
    );
  }

  recover(input: {
    expectedRevision: number;
    occurredAt: string;
  }): Promise<PluginLifecycleExecutionV1> {
    return this.mutate(input.expectedRevision, (stored) =>
      recoverExpiredPluginLifecycleExecutionV1({
        execution: stored.execution,
        envelope: stored.envelope,
        occurredAt: input.occurredAt,
      }),
    );
  }

  private async mutate(
    expectedRevision: number,
    mutation: (
      stored: StoredPluginLifecycleExecutionV1,
    ) => PluginLifecycleExecutionV1,
  ): Promise<PluginLifecycleExecutionV1> {
    const current = await this.readConfigMap();
    if (!current) {
      throw new PluginLifecycleExecutionError(
        'execution_not_found',
        'No cluster lifecycle execution has been initialized',
      );
    }
    const stored = parseStored(current);
    await this.assertCurrentPlan(stored);
    if (stored.execution.revision !== expectedRevision) {
      throw new PluginLifecycleExecutionError(
        'revision_conflict',
        `Expected cluster lifecycle revision ${expectedRevision}, found ${stored.execution.revision}`,
      );
    }
    const execution = mutation(structuredClone(stored));
    parsePluginLifecycleExecutionV1(execution, stored.envelope);
    if (execution.revision === stored.execution.revision) {
      return structuredClone(execution);
    }
    if (execution.revision !== stored.execution.revision + 1) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_state_invalid',
        'Cluster lifecycle mutation must advance exactly one revision',
      );
    }
    const written = await this.writeConfigMap(current, {
      ...stored,
      execution,
    });
    if (!written) {
      throw new PluginLifecycleExecutionError(
        'revision_conflict',
        'Cluster lifecycle state changed concurrently',
      );
    }
    return structuredClone(execution);
  }

  private async assertCurrentPlan(
    stored: StoredPluginLifecycleExecutionV1,
  ): Promise<void> {
    const current = await this.readPlan();
    if (
      current.desiredRevision !== stored.envelope.desiredRevision ||
      current.planSha256 !== stored.envelope.planSha256
    ) {
      throw new PluginLifecycleExecutionError(
        'plan_mismatch',
        'Current desired-state lifecycle plan differs from the cluster execution',
      );
    }
  }

  private kubectlArgs(args: readonly string[]): string[] {
    return [
      ...(this.context ? ['--context', this.context] : []),
      ...args,
    ];
  }

  private async readConfigMap(): Promise<
    KubernetesConfigMapV1 | undefined
  > {
    const result = await this.command.run(
      'kubectl',
      this.kubectlArgs([
        '--namespace',
        this.namespace,
        'get',
        'configmap',
        this.name,
        '--ignore-not-found',
        '--output',
        'json',
      ]),
      {
        cwd: this.workingDirectory,
        timeoutMs: this.commandTimeoutMs,
      },
    );
    if (result.exitCode !== 0) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_command_failed',
        'Cluster lifecycle state could not be read',
      );
    }
    if (!result.stdout.trim()) return undefined;
    let input: unknown;
    try {
      input = JSON.parse(result.stdout);
    } catch {
      throw new KubernetesLifecycleErrorV1(
        'cluster_state_invalid',
        'Cluster returned invalid lifecycle state JSON',
      );
    }
    if (
      !input ||
      typeof input !== 'object' ||
      (input as { apiVersion?: unknown }).apiVersion !== 'v1' ||
      (input as { kind?: unknown }).kind !== 'ConfigMap' ||
      typeof (input as { metadata?: { resourceVersion?: unknown } })
        .metadata?.resourceVersion !== 'string' ||
      !(input as { data?: unknown }).data ||
      typeof (input as { data?: unknown }).data !== 'object'
    ) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_state_invalid',
        'Cluster lifecycle ConfigMap is malformed',
      );
    }
    return input as KubernetesConfigMapV1;
  }

  private async writeConfigMap(
    current: KubernetesConfigMapV1 | undefined,
    stored: StoredPluginLifecycleExecutionV1,
  ): Promise<boolean> {
    const serialized = `${JSON.stringify(stored, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > MAX_CLUSTER_STATE_BYTES) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_state_invalid',
        'Cluster lifecycle state exceeded its safe limit',
      );
    }
    const resource: KubernetesConfigMapV1 = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: this.name,
        namespace: this.namespace,
        ...(current?.metadata.resourceVersion
          ? { resourceVersion: current.metadata.resourceVersion }
          : {}),
        labels: {
          'app.kubernetes.io/part-of':
            'enterpriseglue-plugin-runtime',
          'app.kubernetes.io/managed-by':
            'enterpriseglue-plugin-installer',
        },
        annotations: {
          'io.enterpriseglue/desired-revision': String(
            stored.envelope.desiredRevision,
          ),
          'io.enterpriseglue/plan-sha256':
            stored.envelope.planSha256 ?? 'none',
        },
      },
      data: {
        'execution-state.json': serialized,
      },
    };
    const action = current ? 'replace' : 'create';
    const result = await this.command.run(
      'kubectl',
      this.kubectlArgs([
        '--namespace',
        this.namespace,
        action,
        '--filename',
        '-',
        '--output',
        'name',
      ]),
      {
        cwd: this.workingDirectory,
        timeoutMs: this.commandTimeoutMs,
        stdin: `${JSON.stringify(resource)}\n`,
      },
    );
    if (result.exitCode === 0) {
      await this.writeLocalMirror(stored);
      return true;
    }
    if (
      /conflict|alreadyexists|already exists/i.test(result.stderr)
    ) {
      return false;
    }
    throw new KubernetesLifecycleErrorV1(
      'cluster_command_failed',
      `Cluster lifecycle state ${action} failed (${randomUUID().slice(
        0,
        8,
      )})`,
    );
  }

  private async writeLocalMirror(
    stored: StoredPluginLifecycleExecutionV1,
  ): Promise<void> {
    const root = dirname(this.planPath);
    const rootDetails = await lstat(root).catch(() => undefined);
    if (
      !rootDetails?.isDirectory() ||
      rootDetails.isSymbolicLink()
    ) {
      throw new KubernetesLifecycleErrorV1(
        'cluster_state_invalid',
        'Cluster lifecycle mirror root is invalid',
      );
    }
    const path = resolve(root, pluginLifecycleExecutionFileName);
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(
      temporary,
      `${JSON.stringify(stored, null, 2)}\n`,
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
    await writePluginDeploymentExecutionObservationV1(
      root,
      stored.envelope,
      stored.execution,
    );
  }
}
