import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { ConfigBundleRequestSchema, type ConfigBundleRequest } from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
import { configBundleArchiveService } from './ConfigBundleArchiveService.js';

const MAX_REMOTE_BUNDLE_BYTES = 1024 * 1024;
const REMOTE_BUNDLE_TIMEOUT_MS = 10_000;

export type ConfigBundleRemoteSourceKind = 'json' | 'zip';

export interface ConfigBundleRemoteImportResult {
  payload: ConfigBundleRequest;
  sourceHost: string;
  sourceKind: ConfigBundleRemoteSourceKind;
}

function invalidUrl(message: string): never {
  throw Errors.validation(`Configuration Git URL ${message}`);
}

function canonicalPathSegments(input: URL): string[] {
  return input.pathname.split('/').filter(Boolean).map((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return invalidUrl('contains invalid path encoding');
    }
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
      return invalidUrl('contains an invalid path segment');
    }
    return encodeURIComponent(decoded);
  });
}

function trustedRemoteUrl(origin: 'https://raw.githubusercontent.com' | 'https://gitlab.com', segments: string[]): URL {
  return new URL(`/${segments.join('/')}`, origin);
}

function normalizeGitRawUrl(value: string): URL {
  let input: URL;
  try {
    input = new URL(value);
  } catch {
    return invalidUrl('must be a valid URL');
  }

  if (input.protocol !== 'https:') return invalidUrl('must use HTTPS');
  if (input.username || input.password) return invalidUrl('must not include credentials');
  if (input.port && input.port !== '443') return invalidUrl('must use the standard HTTPS port');
  if (input.search || input.hash) return invalidUrl('must not include query parameters or fragments');

  const host = input.hostname.toLowerCase();
  const segments = canonicalPathSegments(input);
  if (host === 'raw.githubusercontent.com' && segments.length >= 4) {
    return trustedRemoteUrl('https://raw.githubusercontent.com', segments);
  }

  if (host === 'github.com' && segments.length >= 5 && segments[2] === 'raw') {
    const rawSegments = [...segments.slice(0, 2), ...segments.slice(3)];
    return trustedRemoteUrl('https://raw.githubusercontent.com', rawSegments);
  }

  const gitlabRawMarker = segments.findIndex((segment, index) => segment === '-' && segments[index + 1] === 'raw');
  if (host === 'gitlab.com' && gitlabRawMarker >= 2 && segments.length >= gitlabRawMarker + 4) {
    return trustedRemoteUrl('https://gitlab.com', segments);
  }

  return invalidUrl('must be a GitHub or GitLab raw-file URL');
}

function parseRemotePayload(buffer: Buffer, url: URL): ConfigBundleRemoteImportResult['payload'] {
  const zip = url.pathname.toLowerCase().endsWith('.zip') || buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (zip) return configBundleArchiveService.readZip(buffer, MAX_REMOTE_BUNDLE_BYTES);

  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw Errors.validation('Remote configuration file is not valid JSON');
  }
  const envelope = ConfigBundleRequestSchema.safeParse(parsed);
  if (!envelope.success) throw Errors.validation('Remote configuration file is not a valid bundle envelope');
  return envelope.data;
}

class ConfigBundleRemoteSourceService {
  async import(urlValue: string): Promise<ConfigBundleRemoteImportResult> {
    const url = normalizeGitRawUrl(urlValue);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json, application/zip, application/octet-stream' },
        redirect: 'error',
        signal: AbortSignal.timeout(REMOTE_BUNDLE_TIMEOUT_MS),
      });
    } catch {
      throw Errors.validation('Remote configuration file could not be fetched');
    }
    if (!response.ok) throw Errors.validation(`Remote configuration request failed (${response.status})`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_REMOTE_BUNDLE_BYTES) throw Errors.validation('Remote configuration file exceeds the 1 MB limit');

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_REMOTE_BUNDLE_BYTES) throw Errors.validation('Remote configuration file exceeds the 1 MB limit');
    const sourceKind: ConfigBundleRemoteSourceKind = url.pathname.toLowerCase().endsWith('.zip') || buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ? 'zip' : 'json';
    return { payload: parseRemotePayload(buffer, url), sourceHost: url.hostname, sourceKind };
  }
}

export const configBundleRemoteSourceService = new ConfigBundleRemoteSourceService();
