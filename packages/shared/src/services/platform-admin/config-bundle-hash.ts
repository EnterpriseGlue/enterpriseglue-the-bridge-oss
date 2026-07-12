import { createHash } from 'node:crypto';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function assertJsonValue(value: unknown, seen: Set<object>): asserts value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON does not support non-finite numbers');
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('Canonical JSON does not support circular references');
    seen.add(value);
    value.forEach((entry) => assertJsonValue(entry, seen));
    seen.delete(value);
    return;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new TypeError('Canonical JSON does not support circular references');
    seen.add(value);
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (!key) throw new TypeError('Canonical JSON does not support empty object keys');
      assertJsonValue(entry, seen);
    }
    seen.delete(value);
    return;
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value}`);
}

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Produces the exact byte representation used by bundle preview and apply.
 * Object keys are ordered recursively; arrays intentionally retain author order.
 */
export function canonicalizeConfigJson(value: unknown): string {
  assertJsonValue(value, new Set<object>());
  return canonicalize(value);
}

export function hashCanonicalConfig(value: unknown): string {
  return createHash('sha256').update(canonicalizeConfigJson(value), 'utf8').digest('hex');
}
