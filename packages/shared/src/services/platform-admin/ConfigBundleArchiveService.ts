import AdmZip from 'adm-zip';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import type { ConfigBundlePreviewInput } from './ConfigBundlePreviewService.js';

const DEFAULT_MAX_ARCHIVE_BYTES = 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 64;
const MANIFEST_PATH = 'bundle.json';
const ALLOWED_ARCHIVE_PATHS = new Set([
  MANIFEST_PATH,
  'engines.json',
  'engine-tenant-mappings.json',
  'engine-sets.json',
  'runtime-resource-sets.json',
  'roles.json',
  'groups.json',
  'assignments.json',
  'identity-providers.json',
  'identity-mappings.json',
  'project-engine-targets.json',
]);

function archivePath(entryName: string): string {
  const normalized = entryName.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw Errors.validation(`Invalid configuration archive path: ${entryName}`);
  }
  if (!normalized.endsWith('.json')) throw Errors.validation(`Configuration archive entries must be JSON files: ${entryName}`);
  return normalized;
}

function assertNoDuplicateJsonObjectKeys(path: string, source: string): void {
  let index = 0;
  const invalid = (): never => { throw Errors.validation(`Configuration archive entry is not valid JSON: ${path}`); };
  const whitespace = (): void => { while (/\s/.test(source[index] || '')) index += 1; };
  const expect = (value: string): void => { if (source[index] !== value) invalid(); index += 1; };
  const string = (): string => {
    const start = index;
    expect('"');
    while (index < source.length) {
      const character = source[index++];
      if (character === '"') {
        try { return JSON.parse(source.slice(start, index)) as string; } catch { invalid(); }
      }
      if (character === '\\') {
        if (index >= source.length) invalid();
        index += 1;
      } else if (character.charCodeAt(0) < 0x20) {
        invalid();
      }
    }
    return invalid();
  };
  const scalar = (): void => {
    const start = index;
    while (index < source.length && !/[\s,}\]]/.test(source[index])) index += 1;
    if (index === start) invalid();
  };
  const value = (): void => {
    whitespace();
    if (source[index] === '{') {
      index += 1;
      whitespace();
      const keys = new Set<string>();
      if (source[index] === '}') { index += 1; return; }
      while (true) {
        whitespace();
        if (source[index] !== '"') invalid();
        const key = string();
        if (keys.has(key)) throw Errors.validation(`Configuration archive entry contains duplicate JSON key "${key}": ${path}`);
        keys.add(key);
        whitespace(); expect(':'); value(); whitespace();
        if (source[index] === '}') { index += 1; return; }
        expect(',');
      }
    }
    if (source[index] === '[') {
      index += 1;
      whitespace();
      if (source[index] === ']') { index += 1; return; }
      while (true) {
        value(); whitespace();
        if (source[index] === ']') { index += 1; return; }
        expect(',');
      }
    }
    if (source[index] === '"') { string(); return; }
    scalar();
  };

  whitespace();
  value();
  whitespace();
  if (index !== source.length) invalid();
}

function parseJson(path: string, value: Buffer): unknown {
  const source = value.toString('utf8');
  assertNoDuplicateJsonObjectKeys(path, source);
  try {
    return JSON.parse(source);
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
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw Errors.validation('Configuration ZIP archive maximum size must be a positive safe integer');
    }
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
      if (!ALLOWED_ARCHIVE_PATHS.has(path)) {
        throw Errors.validation(`Configuration archive entry is not declared by the production bundle contract: ${path}`);
      }
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
