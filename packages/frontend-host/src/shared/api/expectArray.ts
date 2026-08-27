/**
 * Runtime guard for API responses that are expected to be arrays.
 *
 * Many screens consume list endpoints with the defensive `(query.data || [])`
 * pattern. That guards against `null`/`undefined`, but a truthy non-array
 * payload — an error envelope such as `{ error: 'Unauthorized' }`, an object
 * like `{ items: [] }`, or a bare string — still slips through and then throws
 * an opaque `TypeError: <fn> is not a function` the moment `.filter`/`.map`/
 * `.reduce` runs, with no clue as to which request produced it.
 *
 * `expectArray` moves that failure to the API boundary and turns it into an
 * actionable diagnostic: it logs the request context and the shape of the
 * offending payload, then throws a typed contract error. Query consumers can
 * render their existing error state instead of crashing or presenting invalid
 * data as a legitimate empty list.
 */

const PAYLOAD_PREVIEW_MAX_LENGTH = 500;
const MAX_LOGGED_KEYS = 12;

/** A successful HTTP response did not satisfy the expected list contract. */
export class ListResponseContractError extends Error {
  constructor(
    public readonly context: string,
    message: string,
  ) {
    super(message);
    this.name = 'ListResponseContractError';
  }
}

function isDevEnvironment(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

/**
 * Describe a value's runtime shape without dumping its (potentially large or
 * sensitive) contents — safe to log in any environment.
 */
function describeShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(length ${value.length})`;
  const type = typeof value;
  if (type !== 'object') return type;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) return 'object (no keys)';
  const shown = keys.slice(0, MAX_LOGGED_KEYS);
  const suffix = keys.length > shown.length ? `, …+${keys.length - shown.length} more` : '';
  return `object { ${shown.join(', ')}${suffix} }`;
}

/**
 * Pull a human-readable message out of a common API error envelope so the log
 * hints at the underlying cause (auth failure, missing endpoint, etc.).
 */
function extractEnvelopeMessage(value: object): string | undefined {
  const record = value as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) return record.error.trim();
  if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
  const nestedError = record.error;
  if (nestedError && typeof nestedError === 'object') {
    const message = (nestedError as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return undefined;
}

function previewPayload(value: unknown): string | undefined {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return undefined;
    return json.length > PAYLOAD_PREVIEW_MAX_LENGTH
      ? `${json.slice(0, PAYLOAD_PREVIEW_MAX_LENGTH)}…`
      : json;
  } catch {
    return undefined;
  }
}

/**
 * Ensure a value is an array before collection operations run against it.
 *
 * - Arrays pass through unchanged.
 * - `null`/`undefined` (the ordinary "no data" case, already handled safely by
 *   the `|| []` idiom) return `[]` silently.
 * - Any other value is a contract violation: it is logged with `context` and a
 *   description of the payload, then a typed error is thrown so query error
 *   handling remains active.
 *
 * @param value   The parsed response payload.
 * @param context A label for the request, e.g. `GET /mission-control-api/batches`.
 */
export function expectArray<T>(value: unknown, context: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value == null) return [];

  const parts = [
    `[enterpriseglue] Expected an array from ${context}, but received ${describeShape(value)}.`,
    'The response was rejected instead of being presented as an empty list.',
    'This usually means an API contract mismatch, a missing endpoint, or an',
    'authentication/configuration problem.',
  ];
  if (typeof value === 'object') {
    const envelopeMessage = extractEnvelopeMessage(value);
    if (envelopeMessage) parts.push(`Payload message: "${envelopeMessage}".`);
  }

  // The full payload is helpful locally but may carry sensitive data, so only
  // include it in development builds.
  const preview = isDevEnvironment() ? previewPayload(value) : undefined;
  // The message is derived from the (externally-controlled) payload, so it is
  // passed as a %s argument rather than as the format string itself, which
  // would otherwise interpret any `%` sequences it happens to contain.
  const message = parts.join(' ');
  if (preview !== undefined) {
    console.error('%s Payload: %s', message, preview);
  } else {
    console.error('%s', message);
  }

  throw new ListResponseContractError(context, message);
}
