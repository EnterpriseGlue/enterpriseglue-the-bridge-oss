function isHostnameAllowed(hostname: string, allowedHosts: string[], allowSubdomains: boolean): boolean {
  const h = hostname.toLowerCase();
  return allowedHosts.some((allowed) => {
    const a = String(allowed || '').toLowerCase().trim();
    if (!a) return false;
    if (h === a) return true;
    if (!allowSubdomains) return false;
    return h.endsWith(`.${a}`);
  });
}

export function toSafeInternalPath(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const raw = value.trim();
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//')) return fallback;

  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export type ExternalUrlOptions = {
  allowedProtocols?: string[];
  allowedHosts?: string[];
  allowSubdomains?: boolean;
};

export function toSafePathSegment(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(v)) return null;
  return v;
}

export function toSafeExternalUrl(value: unknown, opts: ExternalUrlOptions = {}): string | null {
  if (typeof value !== 'string') return null;

  const {
    allowedProtocols = ['https:', 'http:'],
    allowedHosts,
    allowSubdomains = true,
  } = opts;

  try {
    const url = new URL(value);
    if (!allowedProtocols.includes(url.protocol)) return null;
    if (Array.isArray(allowedHosts) && allowedHosts.length > 0) {
      if (!isHostnameAllowed(url.hostname, allowedHosts, allowSubdomains)) return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
