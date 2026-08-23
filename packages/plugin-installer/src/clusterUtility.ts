#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const pluginIdPattern = /^[a-z0-9]+([.-][a-z0-9-]+)+$/;
const storageNamePattern = /^[a-z][a-z0-9-]{0,62}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const MAX_STORAGE_ENTRIES = 1_000_000;
const MAX_STORAGE_DEPTH = 64;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function boundedInteger(name: string): number {
  const value = Number(requiredEnvironment(name));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
}

async function runTar(
  source: string,
  target: string,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      '/bin/tar',
      ['-C', source, '-czf', target, '.'],
      {
        shell: false,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderrBytes = 0;
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 64 * 1024) child.kill('SIGKILL');
    });
    child.on('error', () => {
      reject(new Error('Archive utility could not start'));
    });
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error('Archive utility failed'));
    });
  });
}

async function digestFile(path: string): Promise<{
  sizeBytes: number;
  sha256: string;
}> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += bytes.byteLength;
    hash.update(bytes);
  }
  return { sizeBytes, sha256: hash.digest('hex') };
}

async function regularDirectory(path: string): Promise<void> {
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error('Lifecycle utility mount must be a regular directory');
  }
}

async function validateStorageTree(root: string): Promise<void> {
  const pending: Array<{ path: string; depth: number }> = [
    { path: root, depth: 0 },
  ];
  let entries = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > MAX_STORAGE_DEPTH) {
      throw new Error('Plugin storage exceeds the supported directory depth');
    }
    for (const entry of await readdir(current.path, {
      withFileTypes: true,
    })) {
      entries += 1;
      if (entries > MAX_STORAGE_ENTRIES) {
        throw new Error('Plugin storage exceeds the supported entry count');
      }
      const path = resolve(current.path, entry.name);
      const details = await lstat(path);
      if (details.isSymbolicLink()) {
        throw new Error(
          'Lifecycle utility refuses symbolic links in plugin storage',
        );
      }
      if (details.isDirectory()) {
        pending.push({ path, depth: current.depth + 1 });
      } else if (!details.isFile()) {
        throw new Error(
          'Lifecycle utility only accepts regular files and directories',
        );
      }
    }
  }
}

async function copyDirectoryContents(
  source: string,
  target: string,
): Promise<void> {
  await regularDirectory(source);
  await regularDirectory(target);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new Error('Lifecycle utility refuses symbolic links in plugin storage');
    }
    await cp(resolve(source, entry.name), resolve(target, entry.name), {
      recursive: true,
      force: true,
      errorOnExist: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
  }
}

export async function runClusterLifecycleUtilityV1(): Promise<void> {
  const kind = requiredEnvironment('ENTERPRISEGLUE_PLUGIN_ARTIFACT_KIND');
  if (kind !== 'checkpoint' && kind !== 'export') {
    throw new Error('Artifact kind must be checkpoint or export');
  }
  const executionId = requiredEnvironment(
    'ENTERPRISEGLUE_PLUGIN_EXECUTION_ID',
  );
  const pluginId = requiredEnvironment('ENTERPRISEGLUE_PLUGIN_ID');
  const planSha256 = requiredEnvironment(
    'ENTERPRISEGLUE_PLUGIN_PLAN_SHA256',
  );
  if (!pluginIdPattern.test(pluginId) || !sha256Pattern.test(planSha256)) {
    throw new Error('Lifecycle utility identity is invalid');
  }
  if (executionId.length > 256) {
    throw new Error('Lifecycle utility execution identity is invalid');
  }
  const desiredRevision = boundedInteger(
    'ENTERPRISEGLUE_PLUGIN_DESIRED_REVISION',
  );
  const fromDataSchema = boundedInteger(
    'ENTERPRISEGLUE_PLUGIN_FROM_SCHEMA',
  );
  const toDataSchema = boundedInteger(
    'ENTERPRISEGLUE_PLUGIN_TO_SCHEMA',
  );
  const storageNames = requiredEnvironment(
    'ENTERPRISEGLUE_PLUGIN_STORAGE_NAMES',
  ).split(',');
  if (
    storageNames.length < 1 ||
    storageNames.length > 16 ||
    new Set(storageNames).size !== storageNames.length ||
    storageNames.some((name) => !storageNamePattern.test(name))
  ) {
    throw new Error('Lifecycle utility storage names are invalid');
  }
  const copyTarget =
    process.env.ENTERPRISEGLUE_PLUGIN_COPY_TARGET === 'true';
  if (
    process.env.ENTERPRISEGLUE_PLUGIN_COPY_TARGET !== 'true' &&
    process.env.ENTERPRISEGLUE_PLUGIN_COPY_TARGET !== 'false'
  ) {
    throw new Error('Lifecycle utility copy-target flag is invalid');
  }

  const artifactVolume = '/artifacts';
  await regularDirectory(artifactVolume);
  const token = createHash('sha256')
    .update(`${executionId}:${pluginId}:${kind}`)
    .digest('hex');
  const artifactRoot = resolve(artifactVolume, token);
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  await regularDirectory(artifactRoot);

  const artifacts: Array<{
    storageName: string;
    filename: string;
    sizeBytes: number;
    sha256: string;
  }> = [];
  for (const storageName of storageNames.sort()) {
    const source = resolve('/source', storageName);
    await regularDirectory(source);
    await validateStorageTree(source);
    const filename = `${storageName}.tgz`;
    const archive = resolve(artifactRoot, filename);
    const temporaryArchive = `${archive}.tmp-${randomUUID()}`;
    await runTar(source, temporaryArchive);
    await rename(temporaryArchive, archive);
    artifacts.push({
      storageName,
      filename,
      ...(await digestFile(archive)),
    });
    if (copyTarget) {
      await copyDirectoryContents(
        source,
        resolve('/target', storageName),
      );
    }
  }

  const manifestPath = resolve(artifactRoot, `${kind}-manifest.json`);
  const temporaryManifest = `${manifestPath}.tmp-${randomUUID()}`;
  await writeFile(
    temporaryManifest,
    `${JSON.stringify(
      {
        apiVersion:
          'kubernetes-data-artifact.plugin.enterpriseglue.io/v1',
        kind:
          kind === 'checkpoint'
            ? 'EnterpriseGluePluginDataCheckpoint'
            : 'EnterpriseGluePluginDataExport',
        executionId,
        desiredRevision,
        planSha256,
        pluginId,
        fromDataSchema,
        toDataSchema,
        artifacts,
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  try {
    await rename(temporaryManifest, manifestPath);
  } finally {
    await unlink(temporaryManifest).catch(() => undefined);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runClusterLifecycleUtilityV1().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Cluster lifecycle utility failed',
    );
    process.exitCode = 1;
  });
}
