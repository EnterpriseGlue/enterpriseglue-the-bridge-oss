const SENSITIVE_KEY = /(secret|password|token|credential|certificate|private[_-]?key|bind[_-]?dn|peer[_-]?token|authorization|metadata[_-]?xml[_-]?ref|tls[_-]?trust[_-]?ref)/i;
const SENSITIVE_VALUE = /((secret|password|token|credential|certificate|private[_-]?key|bind[_-]?dn|peer[_-]?token)\s*[=:]\s*)([^\s,;]+)/gi;
const REDACTED = '[REDACTED]';

function redactText(value, knownSecrets) {
  let result = value.replace(/(authorization\s*[=:]\s*bearer\s+)[^\s,;]+/gi, `$1${REDACTED}`);
  result = result.replace(SENSITIVE_VALUE, `$1${REDACTED}`);
  for (const secret of knownSecrets) {
    if (secret) result = result.replaceAll(secret, REDACTED);
  }
  return result;
}

/**
 * Sanitizes machine-readable CLI output before it is written to logs or CI
 * artifacts. It intentionally redacts opaque references too: artifacts need
 * configuration outcomes, not credential identifiers.
 */
export function sanitizeConfigBundleOutput(value, knownSecrets = []) {
  if (typeof value === 'string') return redactText(value, knownSecrets);
  if (Array.isArray(value)) return value.map((entry) => sanitizeConfigBundleOutput(entry, knownSecrets));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    SENSITIVE_KEY.test(key) ? REDACTED : sanitizeConfigBundleOutput(entry, knownSecrets),
  ]));
}

export function toSanitizedJson(value, knownSecrets = []) {
  return JSON.stringify(sanitizeConfigBundleOutput(value, knownSecrets), null, 2);
}

export function sanitizeConfigBundleError(value, knownSecrets = []) {
  return redactText(value instanceof Error ? value.message : String(value), knownSecrets);
}
