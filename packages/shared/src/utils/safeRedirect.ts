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

export function getSafeRedirectUrl(
  value: unknown,
  opts: { allowedHosts: string[]; allowedProtocols?: string[]; allowSubdomains?: boolean }
): string | null {
  if (typeof value !== 'string') return null;

  const {
    allowedHosts,
    allowedProtocols = ['https:'],
    allowSubdomains = true,
  } = opts;

  try {
    const url = new URL(value);
    if (!allowedProtocols.includes(url.protocol)) return null;
    if (!isHostnameAllowed(url.hostname, allowedHosts, allowSubdomains)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
