import { Buffer } from 'node:buffer';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';

export const MAX_ADMIN_INTEGRATION_REQUEST_BYTES = 1024 * 1024;
export const MAX_ADMIN_INTEGRATION_RESPONSE_BYTES = 1024 * 1024;
export const DEFAULT_ADMIN_INTEGRATION_TIMEOUT_MS = 10_000;

const BUILTIN_ADMIN_INTEGRATION_HOSTS = [
  'api.mailgun.net',
  'api.mailjet.com',
  'api.sendgrid.com',
  'api.bitbucket.org',
  'api.github.com',
  'app.vssps.visualstudio.com',
  'bitbucket.org',
  'dev.azure.com',
  'github.com',
  'gitlab.com',
] as const;

type Address = { address: string; family: number };
type Lookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<Address[]>;

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export function parseAdminIntegrationAllowedHosts(
  raw = process.env.EG_ADMIN_INTEGRATION_ALLOWED_HOSTS || '',
): string[] {
  return [...new Set([
    ...BUILTIN_ADMIN_INTEGRATION_HOSTS,
    ...raw.split(',').map(normalizeHost).filter(Boolean),
  ])];
}

export function isAllowedAdminIntegrationHost(host: string, allowedHosts: string[]): boolean {
  const normalized = normalizeHost(host);
  return allowedHosts.some((entry) => {
    const pattern = normalizeHost(entry);
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      const labels = suffix.split('.');
      const narrowSuffix = labels.length >= 3
        && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
      return narrowSuffix && normalized.endsWith(`.${suffix}`);
    }
    if (pattern.includes('*')) return false;
    return normalized === pattern;
  });
}

export function isAdminIntegrationEndpointPolicyEnforced(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  if (process.env.EG_ENFORCE_ADMIN_INTEGRATION_ENDPOINT_POLICY === 'true') return true;
  if (process.env.EG_ENFORCE_ADMIN_INTEGRATION_ENDPOINT_POLICY === 'false') return false;
  return false;
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const values = parts.map(Number);
  return values.some((value) => value < 0 || value > 255) ? null : values;
}

function ipv4MappedIpv6Octets(host: string): number[] | null {
  const value = normalizeHost(host);
  if (!value.startsWith('::ffff:')) return null;
  const tail = value.slice('::ffff:'.length);
  const dotted = parseIpv4(tail);
  if (dotted) return dotted;
  const groups = tail.split(':');
  if (groups.length !== 2 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  const high = Number.parseInt(groups[0], 16);
  const low = Number.parseInt(groups[1], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isDisallowedIpv4(host: string): boolean {
  const octets = parseIpv4(host);
  if (!octets) return false;
  const [first, second, third] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19 || second === 51))
    || (first === 203 && second === 0 && third === 113)
    || first >= 224;
}

function isDisallowedIpv6(host: string): boolean {
  const value = normalizeHost(host);
  const mapped = ipv4MappedIpv6Octets(value);
  return value === '::'
    || value === '::1'
    || value.startsWith('fe80:')
    || value.startsWith('fc')
    || value.startsWith('fd')
    || value.startsWith('ff')
    || value.startsWith('2001:db8:')
    || value.startsWith('2001:10:')
    || value.startsWith('2001:2:')
    || (mapped !== null && isDisallowedIpv4(mapped.join('.')));
}

function isDisallowedAddressLiteral(host: string): boolean {
  return isDisallowedIpv4(normalizeHost(host)) || isDisallowedIpv6(normalizeHost(host));
}

function isPrivateHostName(host: string): boolean {
  const value = normalizeHost(host);
  return value === 'localhost'
    || value === 'host.docker.internal'
    || value.endsWith('.local')
    || (!value.includes('.') && !value.includes(':'));
}

function isMetadataHost(host: string): boolean {
  const value = normalizeHost(host);
  const mapped = ipv4MappedIpv6Octets(value);
  return value === 'metadata'
    || value === 'metadata.google.internal'
    || value === '169.254.169.254'
    || value === 'fd00:ec2::254'
    || mapped?.join('.') === '169.254.169.254';
}

function exactHostAllowed(host: string, allowedHosts: string[]): boolean {
  const normalized = normalizeHost(host);
  return allowedHosts.some((entry) => !entry.startsWith('*.') && normalizeHost(entry) === normalized);
}

export function validateAdminIntegrationEndpointUrl(raw: string, label: string): URL {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error(`${label} must be a valid URL`); }
  if (parsed.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:')) {
    throw new Error(`${label} must use HTTPS${process.env.NODE_ENV !== 'production' ? ' (HTTP is development-only)' : ''}`);
  }
  if (parsed.username || parsed.password) throw new Error(`${label} must not include embedded credentials`);
  if (!isAdminIntegrationEndpointPolicyEnforced()) return parsed;

  const host = normalizeHost(parsed.hostname);
  const allowedHosts = parseAdminIntegrationAllowedHosts();
  if (isMetadataHost(host)) throw new Error(`${label} host is not permitted by endpoint policy`);
  const privateHost = isPrivateHostName(host) || isDisallowedAddressLiteral(host);
  if (privateHost && process.env.EG_ADMIN_INTEGRATION_ALLOW_PRIVATE_HOSTS !== 'true') {
    throw new Error(`${label} host is private; enable the reviewed private-host policy and add its exact host`);
  }
  if (privateHost && !exactHostAllowed(host, allowedHosts)) {
    throw new Error(`${label} private host must have an exact endpoint-policy allowlist entry`);
  }
  if (!privateHost && !isAllowedAdminIntegrationHost(host, allowedHosts)) {
    throw new Error(`${label} host is not permitted by endpoint policy`);
  }
  return parsed;
}

async function resolvePinnedAddress(parsed: URL, label: string, lookup: Lookup): Promise<Address | null> {
  if (!isAdminIntegrationEndpointPolicyEnforced()) return null;
  const hostname = normalizeHost(parsed.hostname);
  const privateHostAllowed = process.env.EG_ADMIN_INTEGRATION_ALLOW_PRIVATE_HOSTS === 'true'
    && exactHostAllowed(hostname, parseAdminIntegrationAllowedHosts());
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0) throw new Error(`${label} host could not be resolved safely`);
  for (const address of addresses) {
    if (isMetadataHost(address.address)) throw new Error(`${label} host resolved to a prohibited metadata address`);
    if (isDisallowedAddressLiteral(address.address) && !privateHostAllowed) {
      throw new Error(`${label} host resolved to a private or reserved address`);
    }
  }
  return addresses[0];
}

function bodySize(body: RequestInit['body']): number | null {
  if (body === null || body === undefined) return 0;
  if (typeof body === 'string') return Buffer.byteLength(body);
  if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString());
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  return null;
}

async function boundedResponse(
  response: Response,
  label: string,
  maxBytes: number,
): Promise<Response> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isSafeInteger(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${label} response exceeds the maximum allowed size`);
  }
  if (!response.body) return new Response(null, { status: response.status, headers: response.headers });
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${label} response exceeds the maximum allowed size`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(Buffer.concat(chunks), {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
  });
}

export async function fetchAdminIntegrationEndpoint(
  raw: string,
  init: RequestInit,
  options: {
    label: string;
    timeoutMs?: number;
    maxRequestBytes?: number;
    maxResponseBytes?: number;
    lookup?: Lookup;
    fetchImpl?: typeof globalThis.fetch;
  },
): Promise<Response> {
  const parsed = validateAdminIntegrationEndpointUrl(raw, options.label);
  const maxRequestBytes = options.maxRequestBytes ?? MAX_ADMIN_INTEGRATION_REQUEST_BYTES;
  const size = bodySize(init.body);
  if (size === null || size > maxRequestBytes) {
    throw new Error(`${options.label} request exceeds the maximum allowed size`);
  }
  const pinned = await resolvePinnedAddress(parsed, options.label, options.lookup || dnsLookup);
  const dispatcher = pinned
    ? new Agent({ connect: { lookup: (_hostname: string, _options: unknown, callback: (error: Error | null, address?: string, family?: number) => void) => callback(null, pinned.address, pinned.family) } as never })
    : null;
  try {
    const requestInit: RequestInit & { dispatcher?: Agent } = {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(Math.min(60_000, Math.max(100, options.timeoutMs || DEFAULT_ADMIN_INTEGRATION_TIMEOUT_MS))),
      ...(dispatcher ? { dispatcher } : {}),
    };
    const response = await (options.fetchImpl || globalThis.fetch)(parsed, requestInit as RequestInit);
    return await boundedResponse(
      response,
      options.label,
      options.maxResponseBytes ?? MAX_ADMIN_INTEGRATION_RESPONSE_BYTES,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${options.label} `)) throw error;
    throw new Error(`${options.label} request failed`);
  } finally {
    await dispatcher?.close().catch(() => undefined);
  }
}

export async function fetchAdminIntegrationJson(
  raw: string,
  init: RequestInit,
  options: Parameters<typeof fetchAdminIntegrationEndpoint>[2],
): Promise<Record<string, unknown>> {
  const response = await fetchAdminIntegrationEndpoint(raw, init, options);
  if (!response.ok) throw new Error(`${options.label} returned HTTP ${response.status}`);
  const parsed = await readAdminIntegrationJsonResponse<unknown>(response, options.label);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${options.label} returned invalid JSON`);
  }
  return parsed as Record<string, unknown>;
}

export async function readAdminIntegrationJsonResponse<T>(response: Response, label: string): Promise<T> {
  try {
    return JSON.parse(await response.text()) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}
