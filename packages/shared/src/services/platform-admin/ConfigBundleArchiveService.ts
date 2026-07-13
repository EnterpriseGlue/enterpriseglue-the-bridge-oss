import AdmZip from 'adm-zip';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import type { ConfigBundlePreviewInput } from './ConfigBundlePreviewService.js';

const DEFAULT_MAX_ARCHIVE_BYTES = 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 64;
const MANIFEST_PATH = 'bundle.json';

function archivePath(entryName: string): string {
  const normalized = entryName.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw Errors.validation(`Invalid configuration archive path: ${entryName}`);
  }
  if (!normalized.endsWith('.json')) throw Errors.validation(`Configuration archive entries must be JSON files: ${entryName}`);
  return normalized;
}

function parseJson(path: string, value: Buffer): unknown {
  try {
    return JSON.parse(value.toString('utf8'));
  } catch {
    throw Errors.validation(`Configuration archive entry is not valid JSON: ${path}`);
  }
}

/**
 * Converts a folder-style ZIP archive into the existing JSON bundle envelope.
 * This does not validate or mutate authorization state; callers must use the
 * normal preview/diff/apply services afterwards.
 */
class ConfigBundleArchiveService {
  readZip(buffer: Buffer, maxBytes = DEFAULT_MAX_ARCHIVE_BYTES): ConfigBundlePreviewInput {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw Errors.validation('Configuration ZIP archive is required');
    if (buffer.length > maxBytes) throw Errors.validation(`Configuration ZIP archive exceeds ${maxBytes} bytes`);

    let archive: any;
    try {
      archive = new AdmZip(buffer);
    } catch {
      throw Errors.validation('Configuration ZIP archive is invalid');
    }
    const entries = archive.getEntries().filter((entry: any) => !entry.isDirectory);
    if (entries.length === 0) throw Errors.validation('Configuration ZIP archive contains no files');
    if (entries.length > MAX_ARCHIVE_ENTRIES) throw Errors.validation(`Configuration ZIP archive exceeds ${MAX_ARCHIVE_ENTRIES} files`);

    let totalBytes = 0;
    let bundle: unknown;
    const files: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const entry of entries) {
      const path = archivePath(String(entry.entryName));
      if (seen.has(path)) throw Errors.validation(`Configuration ZIP archive contains duplicate path: ${path}`);
      seen.add(path);
      const declaredSize = Number(entry.header?.size || 0);
      if (declaredSize > maxBytes || totalBytes + declaredSize > maxBytes) throw Errors.validation(`Configuration ZIP archive exceeds ${maxBytes} uncompressed bytes`);
      const contents = entry.getData() as Buffer;
      totalBytes += contents.length;
      if (totalBytes > maxBytes) throw Errors.validation(`Configuration ZIP archive exceeds ${maxBytes} uncompressed bytes`);
      const parsed = parseJson(path, contents);
      if (path === MANIFEST_PATH) bundle = parsed;
      else files[`./${path}`] = parsed;
    }
    if (!bundle) throw Errors.validation(`Configuration ZIP archive must contain ${MANIFEST_PATH}`);
    return { bundle, files };
  }
}

export const configBundleArchiveService = new ConfigBundleArchiveService();
