import { Buffer } from 'node:buffer';
import { config } from '../../config/index.js';

export const MAX_IDENTITY_PROVIDER_RESPONSE_BYTES = 1024 * 1024;

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export function parseIdentityProviderAllowedHosts(raw = process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS || ''): string[] {
  return raw.split(',').map(normalizeHost).filter(Boolean);
}

export function isAllowedIdentityProviderHost(host: string, allowedHosts: string[]): boolean {
  const normalized = normalizeHost(host);
  return allowedHosts.some((entry) => {
    const pattern = normalizeHost(entry);
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      const labels = suffix.split('.');
      // A wildcard must be below an organizational boundary. Requiring at
      // least three validated labels rejects *, *.com, *.co.uk, and similarly
      // broad patterns without pretending to implement DNS/PSL pinning.
      const narrowSuffix = labels.length >= 3
        && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
      return narrowSuffix && normalized.endsWith(`.${suffix}`);
    }
    if (pattern.includes('*')) return false;
    return normalized === pattern;
  });
}

export function isIdentityProviderEndpointPolicyEnforced(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  if (process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY === 'true') return true;
  if (process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY === 'false') return false;
  return false;
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const values = parts.map(Number);
  return values.some((value) => value < 0 || value > 255) ? null : values;
}

function isPrivateIpv4Literal(host: string): boolean {
  const octets = parseIpv4(host);
  if (!octets) return false;
  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
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

function isPrivateIpv6Literal(host: string): boolean {
  const value = normalizeHost(host);
  const mappedIpv4 = ipv4MappedIpv6Octets(value);
  return value === '::'
    || value === '::1'
    || value.startsWith('fe80:')
    || value.startsWith('fc')
    || value.startsWith('fd')
    || value.startsWith('ff')
    || (mappedIpv4 !== null && isPrivateIpv4Literal(mappedIpv4.join('.')));
}

function isPrivateHost(host: string): boolean {
  const value = normalizeHost(host);
  return value === 'localhost'
    || value === 'host.docker.internal'
    || value.endsWith('.local')
    || (!value.includes('.') && !value.includes(':'))
    || isPrivateIpv4Literal(value)
    || isPrivateIpv6Literal(value);
}

function isMetadataHost(host: string): boolean {
  const value = normalizeHost(host);
  const mappedIpv4 = ipv4MappedIpv6Octets(value);
  return value === 'metadata'
    || value === 'metadata.google.internal'
    || value === '169.254.169.254'
    || value === 'fd00:ec2::254'
    || mappedIpv4?.join('.') === '169.254.169.254';
}

export function validateIdentityProviderEndpointUrl(
  raw: string,
  label: string,
  protocols: readonly string[],
): URL {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error(`${label} must be a valid URL`); }
  if (!protocols.includes(parsed.protocol)) throw new Error(`${label} must use ${protocols.map((protocol) => protocol.replace(':', '').toUpperCase()).join(' or ')}`);
  if (parsed.username || parsed.password) throw new Error(`${label} must not include embedded credentials`);
  if (!isIdentityProviderEndpointPolicyEnforced()) return parsed;

  if (isMetadataHost(parsed.hostname)) throw new Error(`${label} host is not permitted by endpoint policy`);
  const privateHost = isPrivateHost(parsed.hostname);
  const allowedHosts = parseIdentityProviderAllowedHosts();
  if (privateHost && process.env.EG_IDENTITY_PROVIDER_ALLOW_PRIVATE_HOSTS !== 'true') {
    throw new Error(`${label} host is private; set EG_IDENTITY_PROVIDER_ALLOW_PRIVATE_HOSTS=true and add the exact host to the allowlist only for a reviewed private identity service`);
  }
  if (privateHost && !allowedHosts.some((entry) => !entry.startsWith('*.') && normalizeHost(entry) === normalizeHost(parsed.hostname))) {
    throw new Error(`${label} private host must have an exact endpoint-policy allowlist entry`);
  }
  if (!privateHost && !isAllowedIdentityProviderHost(parsed.hostname, allowedHosts)) {
    throw new Error(`${label} host is not permitted by endpoint policy`);
  }
  return parsed;
}

export function validateIdentityProviderCallbackUrl(raw: string, protocol: 'oidc' | 'saml'): URL {
  const label = `${protocol.toUpperCase()} callbackUrl`;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error(`${label} must be a valid URL`); }
  const frontend = new URL(config.frontendUrl);
  const expectedPath = protocol === 'oidc' ? '/api/auth/identity/callback' : '/api/auth/providers/saml/callback';
  const tenantCallbackPattern = protocol === 'oidc'
    ? /^\/api\/t\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\/auth\/identity\/callback$/
    : /^\/api\/t\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\/auth\/providers\/saml\/callback$/;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must not include credentials, query parameters, or a fragment`);
  }
  if (parsed.origin !== frontend.origin || (parsed.pathname !== expectedPath && !tenantCallbackPattern.test(parsed.pathname))) {
    throw new Error(`${label} must be the canonical global or tenant-scoped callback endpoint on ${frontend.origin}`);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS in production`);
  }
  if (parsed.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && frontend.protocol === 'http:' && parsed.protocol === 'http:')) {
    throw new Error(`${label} protocol must match the configured EnterpriseGlue frontend`);
  }
  return parsed;
}

/** OIDC post-logout navigation is constrained to the canonical local login page. */
export function validateIdentityProviderLogoutRedirectUrl(raw: string): URL {
  const label = 'OIDC postLogoutRedirectUrl';
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error(`${label} must be a valid URL`); }
  const frontend = new URL(config.frontendUrl);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must not include credentials, query parameters, or a fragment`);
  }
  if (parsed.origin !== frontend.origin || parsed.pathname !== '/login') {
    throw new Error(`${label} must be the canonical ${frontend.origin}/login endpoint`);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS in production`);
  }
  return parsed;
}

/** SAML SLO callbacks stay on the provider-addressed local authentication route. */
export function validateIdentityProviderSamlLogoutCallbackUrl(raw: string): URL {
  const label = 'SAML logoutCallbackUrl';
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error(`${label} must be a valid URL`); }
  const frontend = new URL(config.frontendUrl);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must not include credentials, query parameters, or a fragment`);
  }
  if (parsed.origin !== frontend.origin || !/^\/api\/auth\/identity\/[A-Za-z0-9._-]{1,160}\/saml\/logout$/.test(parsed.pathname)) {
    throw new Error(`${label} must use the canonical ${frontend.origin}/api/auth/identity/{providerKey}/saml/logout endpoint`);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS in production`);
  }
  if (parsed.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && frontend.protocol === 'http:' && parsed.protocol === 'http:')) {
    throw new Error(`${label} protocol must match the configured EnterpriseGlue frontend`);
  }
  return parsed;
}

export async function readBoundedIdentityProviderResponse(
  response: Response,
  label: string,
  maxBytes = MAX_IDENTITY_PROVIDER_RESPONSE_BYTES,
): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isSafeInteger(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${label} exceeds the maximum allowed size`);
  }
  if (!response.body) return Buffer.alloc(0);
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
        throw new Error(`${label} exceeds the maximum allowed size`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function readBoundedIdentityProviderJson(response: Response, label: string): Promise<Record<string, unknown>> {
  const body = await readBoundedIdentityProviderResponse(response, label);
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}
