import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';

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
import {
  writePluginDeploymentExecutionObservationV1,
} from './executionObservation.js';
import { readBoundedRegularFileV1 } from './secureFile.js';

export const pluginLifecycleExecutionFileName =
  'plugin-lifecycle-execution.json';
export const pluginLifecycleExecutionLockFileName =
  'plugin-lifecycle-execution.lock';
export const pluginLifecyclePlanFileName = 'plugin-lifecycle-plan.json';

export interface StoredPluginLifecycleExecutionV1 {
  schemaVersion: 1;
  envelope: PluginLifecyclePlanEnvelopeV1;
  execution: PluginLifecycleExecutionV1;
  history: Array<{
    envelope: PluginLifecyclePlanEnvelopeV1;
    execution: PluginLifecycleExecutionV1;
  }>;
}

export interface FilePluginLifecycleExecutionStoreOptionsV1 {
  staleLockMs?: number;
}

function storeError(
  code:
    | 'execution_not_found'
    | 'execution_active'
    | 'revision_conflict'
    | 'store_locked'
    | 'store_corrupt'
    | 'plan_unavailable'
    | 'plan_mismatch',
  message: string,
): PluginLifecycleExecutionError {
  return new PluginLifecycleExecutionError(code, message);
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object'
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

export class FilePluginLifecycleExecutionStoreV1 {
  private readonly root: string;
  private readonly staleLockMs: number;

  constructor(
    root: string,
    options: FilePluginLifecycleExecutionStoreOptionsV1 = {},
  ) {
    this.root = resolve(root);
    this.staleLockMs = options.staleLockMs ?? 30_000;
    if (
      !Number.isInteger(this.staleLockMs) ||
      this.staleLockMs < 1_000 ||
      this.staleLockMs > 300_000
    ) {
      throw storeError(
        'store_corrupt',
        'Lifecycle store stale-lock threshold must be 1-300 seconds',
      );
    }
  }

  async initialize(input: {
    executionId: string;
    occurredAt: string;
    supersedeExecutionRevision?: number;
  }): Promise<PluginLifecycleExecutionV1> {
    return this.withLock(async () => {
      const envelope = await this.readCurrentPlan();
      if (!envelope.plan) {
        throw storeError(
          'plan_unavailable',
          'Lifecycle plan is empty; there is nothing to execute',
        );
      }
      const existing = await this.readStored();
      if (existing) {
        if (
          existing.envelope.desiredRevision === envelope.desiredRevision &&
          existing.envelope.planSha256 === envelope.planSha256
        ) {
          return structuredClone(existing.execution);
        }
        if (
          existing.execution.status !== 'succeeded' &&
          !(
            ['failed', 'manual_intervention'].includes(
              existing.execution.status,
            ) &&
            input.supersedeExecutionRevision ===
              existing.execution.revision
          )
        ) {
          throw storeError(
            'execution_active',
            'A non-succeeded lifecycle execution must be resolved before another plan is initialized',
          );
        }
      }
      const execution = createPluginLifecycleExecutionV1({
        envelope,
        executionId: input.executionId,
        occurredAt: input.occurredAt,
      });
      const history = existing
        ? [
            ...existing.history,
            {
              envelope: existing.envelope,
              execution: existing.execution,
            },
          ].slice(-100)
        : [];
      await this.writeStored({
        schemaVersion: 1,
        envelope,
        execution,
        history,
      });
      return structuredClone(execution);
    });
  }

  async read(): Promise<PluginLifecycleExecutionV1> {
    const stored = await this.readStored();
    if (!stored) {
      throw storeError(
        'execution_not_found',
        'No lifecycle execution has been initialized',
      );
    }
    await this.assertCurrentPlan(stored);
    return structuredClone(stored.execution);
  }

  async readPlan(): Promise<PluginLifecyclePlanEnvelopeV1> {
    return this.readCurrentPlan();
  }

  async claim(input: {
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

  async renew(input: {
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

  async complete(input: {
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

  async fail(input: {
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

  async recover(input: {
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
    return this.withLock(async () => {
      const stored = await this.readStored();
      if (!stored) {
        throw storeError(
          'execution_not_found',
          'No lifecycle execution has been initialized',
        );
      }
      await this.assertCurrentPlan(stored);
      if (stored.execution.revision !== expectedRevision) {
        throw storeError(
          'revision_conflict',
          `Expected lifecycle execution revision ${expectedRevision}, found ${stored.execution.revision}`,
        );
      }
      const execution = mutation(structuredClone(stored));
      parsePluginLifecycleExecutionV1(execution, stored.envelope);
      if (execution.revision === stored.execution.revision) {
        return structuredClone(execution);
      }
      if (execution.revision !== stored.execution.revision + 1) {
        throw storeError(
          'store_corrupt',
          'Lifecycle execution mutation must advance exactly one revision',
        );
      }
      await this.writeStored({
        schemaVersion: 1,
        envelope: stored.envelope,
        execution,
        history: stored.history,
      });
      return structuredClone(execution);
    });
  }

  private async assertCurrentPlan(
    stored: StoredPluginLifecycleExecutionV1,
  ): Promise<void> {
    const current = await this.readCurrentPlan();
    if (
      current.desiredRevision !== stored.envelope.desiredRevision ||
      current.planSha256 !== stored.envelope.planSha256
    ) {
      throw storeError(
        'plan_mismatch',
        'Current desired-state lifecycle plan differs from the active execution',
      );
    }
  }

  private async readCurrentPlan(): Promise<PluginLifecyclePlanEnvelopeV1> {
    const path = resolve(this.root, pluginLifecyclePlanFileName);
    const input = await this.readJson(path, 'plan_unavailable');
    return parsePluginLifecyclePlanEnvelopeV1(input);
  }

  private async readStored(): Promise<
    StoredPluginLifecycleExecutionV1 | undefined
  > {
    const path = resolve(this.root, pluginLifecycleExecutionFileName);
    let input: unknown;
    try {
      input = await this.readJson(path, 'execution_not_found');
    } catch (error) {
      if (
        error instanceof PluginLifecycleExecutionError &&
        error.code === 'execution_not_found'
      ) {
        return undefined;
      }
      throw error;
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw storeError(
        'store_corrupt',
        'Lifecycle execution store record must be an object',
      );
    }
    const candidate = input as Partial<StoredPluginLifecycleExecutionV1>;
    if (candidate.schemaVersion !== 1) {
      throw storeError(
        'store_corrupt',
        'Lifecycle execution store schema is unsupported',
      );
    }
    const envelope = parsePluginLifecyclePlanEnvelopeV1(
      candidate.envelope,
    );
    const execution = parsePluginLifecycleExecutionV1(
      candidate.execution,
      envelope,
    );
    const historyInput =
      candidate.history === undefined ? [] : candidate.history;
    if (!Array.isArray(historyInput) || historyInput.length > 100) {
      throw storeError(
        'store_corrupt',
        'Lifecycle execution history is invalid',
      );
    }
    const history = historyInput.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw storeError(
          'store_corrupt',
          'Lifecycle execution history entry is invalid',
        );
      }
      const historyEnvelope = parsePluginLifecyclePlanEnvelopeV1(
        (item as { envelope?: unknown }).envelope,
      );
      const historyExecution = parsePluginLifecycleExecutionV1(
        (item as { execution?: unknown }).execution,
        historyEnvelope,
      );
      return {
        envelope: historyEnvelope,
        execution: historyExecution,
      };
    });
    return { schemaVersion: 1, envelope, execution, history };
  }

  private async writeStored(
    stored: StoredPluginLifecycleExecutionV1,
  ): Promise<void> {
    parsePluginLifecycleExecutionV1(
      stored.execution,
      stored.envelope,
    );
    await this.atomicWrite(
      resolve(this.root, pluginLifecycleExecutionFileName),
      `${JSON.stringify(stored, null, 2)}\n`,
    );
    await writePluginDeploymentExecutionObservationV1(
      this.root,
      stored.envelope,
      stored.execution,
    );
  }

  private async readJson(
    path: string,
    missingCode: 'execution_not_found' | 'plan_unavailable',
  ): Promise<unknown> {
    let serialized: string;
    try {
      serialized = await readBoundedRegularFileV1(path, 1_048_576);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        throw storeError(
          missingCode,
          missingCode === 'plan_unavailable'
            ? 'Lifecycle plan file does not exist'
            : 'Lifecycle execution file does not exist',
        );
      }
      throw storeError(
        'store_corrupt',
        'Lifecycle store inputs must be regular non-symlink files of at most 1 MiB',
      );
    }
    try {
      return JSON.parse(serialized);
    } catch {
      throw storeError(
        'store_corrupt',
        'Lifecycle store input is not valid JSON',
      );
    }
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const details = await lstat(this.root);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw storeError(
        'store_corrupt',
        'Lifecycle execution store root must be a regular directory',
      );
    }
    await chmod(this.root, 0o700);
  }

  private async atomicWrite(path: string, content: string): Promise<void> {
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, content, {
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

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    await this.ensureRoot();
    const path = resolve(this.root, pluginLifecycleExecutionLockFileName);
    const token = randomUUID();
    let handle;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        handle = await open(path, 'wx', 0o600);
        break;
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
        const details = await lstat(path).catch(() => undefined);
        if (
          attempt === 0 &&
          details?.isFile() &&
          !details.isSymbolicLink() &&
          Date.now() - details.mtimeMs > this.staleLockMs
        ) {
          const stalePath = `${path}.stale-${token}`;
          try {
            await rename(path, stalePath);
            await unlink(stalePath).catch(() => undefined);
          } catch (renameError) {
            if (errorCode(renameError) !== 'ENOENT') {
              throw renameError;
            }
          }
          continue;
        }
        throw storeError(
          'store_locked',
          'Lifecycle execution store is locked by another authority process',
        );
      }
    }
    if (!handle) {
      throw storeError(
        'store_locked',
        'Lifecycle execution store lock could not be acquired',
      );
    }
    try {
      await handle.writeFile(
        `${JSON.stringify({
          token,
          processId: process.pid,
          acquiredAt: new Date().toISOString(),
        })}\n`,
        'utf8',
      );
      return await work();
    } finally {
      await handle.close().catch(() => undefined);
      await unlink(path).catch(() => undefined);
    }
  }
}
