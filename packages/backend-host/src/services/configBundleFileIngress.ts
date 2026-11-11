import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { configBundleArchiveService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleArchiveService.js';

export type ConfigBundleFileEnvelope = {
  bundle: unknown;
  files: Record<string, unknown>;
  /** Reviewed ownership/removal acknowledgements used only by startup apply. */
  acknowledgements?: string[];
};

export type ConfigBundleFileReadResult = {
  payload: ConfigBundleFileEnvelope;
  sha256: string;
};

export async function isConfigBundleDirectory(path: string): Promise<boolean> {
  return (await stat(path)).isDirectory();
}

export async function listConfigBundleDirectory(path: string): Promise<{ root: string; filenames: string[] }> {
  const root = await realpath(path);
  const entries = await readdir(root, { withFileTypes: true });
  const filenames = entries
    .filter(entry => entry.name.endsWith('.json') && (entry.isFile() || entry.isSymbolicLink()))
    .map(entry => entry.name)
    .sort();
  if (filenames.length === 0) throw new Error('Configuration bundle directory contains no JSON bundles');
  return { root, filenames };
}

export async function readConfigBundleDirectoryEntry(root: string, filename: string, maxBytes: number): Promise<Buffer> {
  // ConfigMap projections use symlinks. Only follow entries whose resolved
  // target stays inside the configured directory.
  const path = await realpath(join(root, filename));
  const target = relative(root, path);
  if (!target || target === '..' || target.startsWith(`..${sep}`) || isAbsolute(target)) {
    throw new Error('Configuration bundle entry resolves outside its directory');
  }
  return readConfigBundleBytes(path, maxBytes, constants.O_RDONLY | constants.O_NONBLOCK);
}

export function configBundleSha256(source: Buffer | string): string {
  return createHash('sha256').update(source).digest('hex');
}

/**
 * Startup-only filesystem ingress for mounted configuration bundles.
 * Runtime authorization consumes only the persisted entities produced by the
 * apply service and must never import this adapter.
 */
export async function readConfigBundleFile(
  path: string,
  maxBytes: number,
): Promise<ConfigBundleFileReadResult> {
  return parseConfigBundleFile(path, await readConfigBundleBytes(path, maxBytes), maxBytes);
}

async function readConfigBundleBytes(path: string, maxBytes: number, flags: string | number = 'r'): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('EG_CONFIG_MAX_BYTES must be a positive safe integer');
  }

  // Open, inspect, and read the mounted startup input through one file handle.
  // This prevents a path replacement between the validation and read steps.
  const file = await open(path, flags);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) throw new Error('EG_CONFIG_BUNDLE_PATH must point to a JSON file or folder-style ZIP archive');
    if (metadata.size > maxBytes) throw new Error(`Configuration bundle exceeds EG_CONFIG_MAX_BYTES (${maxBytes})`);

    const source = await file.readFile();
    if (source.length > maxBytes) throw new Error(`Configuration bundle exceeds EG_CONFIG_MAX_BYTES (${maxBytes})`);
    return source;
  } finally {
    await file.close();
  }
}

export function parseConfigBundleFile(
  path: string,
  source: Buffer,
  maxBytes: number,
  sha256 = configBundleSha256(source),
): ConfigBundleFileReadResult {
  const payload: ConfigBundleFileEnvelope = path.toLowerCase().endsWith('.zip')
    ? configBundleArchiveService.readZip(source, maxBytes)
    : JSON.parse(source.toString('utf8')) as ConfigBundleFileEnvelope;

  if (payload.acknowledgements !== undefined && (
    !Array.isArray(payload.acknowledgements) || payload.acknowledgements.length > 100
    || payload.acknowledgements.some((value) => typeof value !== 'string' || value.length < 1 || value.length > 500)
  )) {
    throw new Error('Configuration bootstrap acknowledgements are invalid');
  }

  return { payload, sha256 };
}
