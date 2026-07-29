import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { configBundleArchiveService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleArchiveService.js';

export type ConfigBundleFileEnvelope = {
  bundle: unknown;
  files: Record<string, unknown>;
};

export type ConfigBundleFileReadResult = {
  payload: ConfigBundleFileEnvelope;
  sha256: string;
};

/**
 * Startup-only filesystem ingress for mounted configuration bundles.
 * Runtime authorization consumes only the persisted entities produced by the
 * apply service and must never import this adapter.
 */
export async function readConfigBundleFile(
  path: string,
  maxBytes: number,
): Promise<ConfigBundleFileReadResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('EG_CONFIG_MAX_BYTES must be a positive safe integer');
  }

  // Open, inspect, and read the mounted startup input through one file handle.
  // This prevents a path replacement between the validation and read steps.
  const file = await open(path, 'r');
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) throw new Error('EG_CONFIG_BUNDLE_PATH must point to a JSON file or folder-style ZIP archive');
    if (metadata.size > maxBytes) throw new Error(`Configuration bundle exceeds EG_CONFIG_MAX_BYTES (${maxBytes})`);

    const source = await file.readFile();
    if (source.length > maxBytes) throw new Error(`Configuration bundle exceeds EG_CONFIG_MAX_BYTES (${maxBytes})`);
    const sha256 = createHash('sha256').update(source).digest('hex');
    const payload = path.toLowerCase().endsWith('.zip')
      ? configBundleArchiveService.readZip(source, maxBytes)
      : JSON.parse(source.toString('utf8')) as ConfigBundleFileEnvelope;

    return { payload, sha256 };
  } finally {
    await file.close();
  }
}
