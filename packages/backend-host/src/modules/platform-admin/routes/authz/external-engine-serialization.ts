export function parseExternalEngineJson(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

const sensitiveAuditDetailKey = /(?:password|secret|token|authorization|credential)/i;

/** Audit data can include historical or external registration payloads. Never
 * return credential-shaped values even if an older writer persisted them. */
export function redactExternalEngineAuditDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactExternalEngineAuditDetails);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    sensitiveAuditDetailKey.test(key) ? '[REDACTED]' : redactExternalEngineAuditDetails(child),
  ]));
}

export function parseExternalEngineLabels(value: string | null | undefined): Record<string, string> {
  const parsed = parseExternalEngineJson(value);
  if (!parsed) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}
