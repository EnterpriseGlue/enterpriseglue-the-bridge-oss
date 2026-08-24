import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  FilePluginLifecycleExecutionStoreV1,
  pluginLifecyclePlanFileName,
  runPluginLifecycleExecutionV1,
  type PluginLifecyclePhaseAdapterV1,
} from '@enterpriseglue/plugin-installer';

import type { PluginManagerLifecyclePortV1 } from './manager.js';

export interface FileInstallerLifecycleOptionsV1 {
  root: string;
  adapter: PluginLifecyclePhaseAdapterV1;
  leaseDurationMs?: number;
  now?: () => Date;
}

function installationRoot(root: string, installationId: string): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(installationId)) {
    throw new Error('installation_id_invalid');
  }
  return resolve(root, installationId);
}

async function atomicWritePlan(
  root: string,
  envelope: Parameters<PluginManagerLifecyclePortV1['execute']>[0]['envelope'],
): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const details = await lstat(root);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error('manager_execution_root_invalid');
  }
  await chmod(root, 0o700);
  const target = resolve(root, pluginLifecyclePlanFileName);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export class FileInstallerLifecycleV1 implements PluginManagerLifecyclePortV1 {
  private readonly leaseDurationMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: FileInstallerLifecycleOptionsV1) {
    this.leaseDurationMs = options.leaseDurationMs ?? 30_000;
    this.now = options.now ?? (() => new Date());
  }

  async execute(
    input: Parameters<PluginManagerLifecyclePortV1['execute']>[0],
  ): ReturnType<PluginManagerLifecyclePortV1['execute']> {
    const root = installationRoot(
      this.options.root,
      input.intent.installationId,
    );
    await atomicWritePlan(root, input.envelope);
    const store = new FilePluginLifecycleExecutionStoreV1(root);
    const occurredAt = this.now().toISOString();
    await store.initialize({
      executionId: `${input.intent.installationId}:${input.envelope.planSha256}`,
      occurredAt,
    });
    const execution = await runPluginLifecycleExecutionV1({
      store,
      adapter: this.options.adapter,
      owner: input.managerId,
      leaseDurationMs: this.leaseDurationMs,
      now: this.now,
    });
    if (execution.status === 'queued' || execution.status === 'running') {
      throw new Error('manager_lifecycle_execution_not_terminal');
    }
    return {
      status: execution.status,
      reasonCode:
        execution.status === 'succeeded'
          ? 'none'
          : execution.status === 'manual_intervention'
            ? 'rollback_unavailable'
            : 'staging_failed',
      occurredAt: execution.updatedAt,
    };
  }
}
