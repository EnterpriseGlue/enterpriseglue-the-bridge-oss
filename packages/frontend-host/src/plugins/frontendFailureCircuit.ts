import type { PluginId } from '@enterpriseglue/plugin-sdk';

export type PluginFrontendFailureCodeV1 =
  | 'entry_url_invalid'
  | 'module_invalid'
  | 'activation_failed';

export interface PluginFrontendFailureTargetV1 {
  pluginId: PluginId;
  version: string;
  bootstrapRevision: number;
}

export interface PluginFrontendFailureStorageV1 {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface FailureEntryV1 extends PluginFrontendFailureTargetV1 {
  failureCode: PluginFrontendFailureCodeV1;
  count: number;
  firstFailureAt: number;
  lastFailureAt: number;
  quarantinedUntil: number | null;
}

interface FailureStateV1 {
  schemaVersion: 1;
  entries: FailureEntryV1[];
}

export interface PluginFrontendFailureCircuitOptionsV1 {
  storage?: PluginFrontendFailureStorageV1 | null;
  now?: () => number;
  threshold?: number;
  failureWindowMs?: number;
  quarantineMs?: number;
  maximumEntries?: number;
}

const STORAGE_KEY =
  'enterpriseglue.plugin.frontend-activation-failure-circuit.v1';
const DEFAULT_THRESHOLD = 3;
const DEFAULT_FAILURE_WINDOW_MS = 5 * 60 * 1_000;
const DEFAULT_QUARANTINE_MS = 15 * 60 * 1_000;
const DEFAULT_MAXIMUM_ENTRIES = 32;
const MAXIMUM_STATE_BYTES = 16 * 1_024;
const MAXIMUM_ENTRY_AGE_MS = 24 * 60 * 60 * 1_000;
const PLUGIN_ID_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Browser-local containment for repeatedly failing native frontend modules.
 *
 * This deliberately cannot disable a plugin deployment or backend operation:
 * a browser report is not trusted platform-health evidence. The exact
 * plugin/version/bootstrap revision is quarantined only on this browser and a
 * new installer revision automatically gets a fresh attempt.
 */
export class PluginFrontendFailureCircuitV1 {
  private readonly storage: PluginFrontendFailureStorageV1 | null;
  private readonly now: () => number;
  private readonly threshold: number;
  private readonly failureWindowMs: number;
  private readonly quarantineMs: number;
  private readonly maximumEntries: number;
  private memoryState: FailureStateV1 = { schemaVersion: 1, entries: [] };

  constructor(options: PluginFrontendFailureCircuitOptionsV1 = {}) {
    this.storage =
      options.storage === undefined ? browserLocalStorage() : options.storage;
    this.now = options.now ?? Date.now;
    this.threshold = boundedInteger(
      options.threshold,
      DEFAULT_THRESHOLD,
      2,
      10,
    );
    this.failureWindowMs = boundedInteger(
      options.failureWindowMs,
      DEFAULT_FAILURE_WINDOW_MS,
      10_000,
      60 * 60 * 1_000,
    );
    this.quarantineMs = boundedInteger(
      options.quarantineMs,
      DEFAULT_QUARANTINE_MS,
      10_000,
      24 * 60 * 60 * 1_000,
    );
    this.maximumEntries = boundedInteger(
      options.maximumEntries,
      DEFAULT_MAXIMUM_ENTRIES,
      1,
      100,
    );
  }

  isQuarantined(target: PluginFrontendFailureTargetV1): boolean {
    const now = this.now();
    const state = this.read(now);
    const entry = state.entries.find((candidate) =>
      sameTarget(candidate, target),
    );
    return entry?.quarantinedUntil !== null &&
      entry?.quarantinedUntil !== undefined &&
      entry.quarantinedUntil > now;
  }

  recordFailure(
    target: PluginFrontendFailureTargetV1,
    failureCode: PluginFrontendFailureCodeV1,
  ): { count: number; quarantined: boolean } {
    const now = this.now();
    const state = this.read(now);
    const existing = state.entries.find((candidate) =>
      sameTarget(candidate, target),
    );
    const insideWindow =
      existing !== undefined &&
      now >= existing.firstFailureAt &&
      now - existing.firstFailureAt <= this.failureWindowMs;
    const count = insideWindow ? Math.min(existing.count + 1, 10) : 1;
    const entry: FailureEntryV1 = {
      ...target,
      failureCode,
      count,
      firstFailureAt: insideWindow ? existing.firstFailureAt : now,
      lastFailureAt: now,
      quarantinedUntil:
        count >= this.threshold ? now + this.quarantineMs : null,
    };
    state.entries = [
      entry,
      ...state.entries.filter((candidate) => !sameTarget(candidate, target)),
    ]
      .sort((left, right) => right.lastFailureAt - left.lastFailureAt)
      .slice(0, this.maximumEntries);
    this.write(state);
    return {
      count,
      quarantined:
        entry.quarantinedUntil !== null && entry.quarantinedUntil > now,
    };
  }

  clear(target: PluginFrontendFailureTargetV1): void {
    const state = this.read(this.now());
    const entries = state.entries.filter(
      (candidate) => !sameTarget(candidate, target),
    );
    if (entries.length === state.entries.length) return;
    state.entries = entries;
    this.write(state);
  }

  clearAll(): void {
    this.memoryState = { schemaVersion: 1, entries: [] };
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // Storage policy or quota failures must not prevent OSS startup.
    }
  }

  private read(now: number): FailureStateV1 {
    let state = this.memoryState;
    if (this.storage) {
      try {
        const serialized = this.storage.getItem(STORAGE_KEY);
        if (
          serialized !== null &&
          new TextEncoder().encode(serialized).byteLength <= MAXIMUM_STATE_BYTES
        ) {
          state = parseState(serialized) ?? {
            schemaVersion: 1,
            entries: [],
          };
        }
      } catch {
        state = this.memoryState;
      }
    }
    state = {
      schemaVersion: 1,
      entries: state.entries
        .filter(
          (entry) =>
            now >= entry.lastFailureAt &&
            now - entry.lastFailureAt <= MAXIMUM_ENTRY_AGE_MS,
        )
        .sort((left, right) => right.lastFailureAt - left.lastFailureAt)
        .slice(0, this.maximumEntries),
    };
    this.memoryState = structuredClone(state);
    return state;
  }

  private write(state: FailureStateV1): void {
    this.memoryState = structuredClone(state);
    if (!this.storage) return;
    try {
      const serialized = JSON.stringify(state);
      if (new TextEncoder().encode(serialized).byteLength > MAXIMUM_STATE_BYTES) {
        this.storage.removeItem(STORAGE_KEY);
        return;
      }
      this.storage.setItem(STORAGE_KEY, serialized);
    } catch {
      // The in-memory circuit remains active for this page.
    }
  }
}

function browserLocalStorage(): PluginFrontendFailureStorageV1 | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function parseState(serialized: string): FailureStateV1 | null {
  try {
    const value = JSON.parse(serialized) as unknown;
    if (!isRecord(value) || value.schemaVersion !== 1) return null;
    if (!Array.isArray(value.entries) || value.entries.length > 100) return null;
    const entries = value.entries.filter(isFailureEntry);
    return entries.length === value.entries.length
      ? { schemaVersion: 1, entries }
      : null;
  } catch {
    return null;
  }
}

function isFailureEntry(value: unknown): value is FailureEntryV1 {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      'pluginId',
      'version',
      'bootstrapRevision',
      'failureCode',
      'count',
      'firstFailureAt',
      'lastFailureAt',
      'quarantinedUntil',
    ]) &&
    typeof value.pluginId === 'string' &&
    PLUGIN_ID_PATTERN.test(value.pluginId) &&
    typeof value.version === 'string' &&
    VERSION_PATTERN.test(value.version) &&
    integerInRange(value.bootstrapRevision, 0, Number.MAX_SAFE_INTEGER) &&
    ['entry_url_invalid', 'module_invalid', 'activation_failed'].includes(
      String(value.failureCode),
    ) &&
    integerInRange(value.count, 1, 10) &&
    integerInRange(value.firstFailureAt, 0, Number.MAX_SAFE_INTEGER) &&
    integerInRange(value.lastFailureAt, 0, Number.MAX_SAFE_INTEGER) &&
    (value.quarantinedUntil === null ||
      integerInRange(value.quarantinedUntil, 0, Number.MAX_SAFE_INTEGER))
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameTarget(
  left: PluginFrontendFailureTargetV1,
  right: PluginFrontendFailureTargetV1,
): boolean {
  return (
    left.pluginId === right.pluginId &&
    left.version === right.version &&
    left.bootstrapRevision === right.bootstrapRevision
  );
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return integerInRange(value, minimum, maximum) ? value : fallback;
}

export const __pluginFrontendFailureCircuitTestUtils = {
  storageKey: STORAGE_KEY,
};
