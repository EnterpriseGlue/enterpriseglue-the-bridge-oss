import { AsyncLocalStorage } from 'node:async_hooks';

/** Internal server capabilities, never populated from a request or a JWT. */
export type PlatformDatabaseCapability =
  | { kind: 'migration-execution'; schema: string; ownerRole: string }
  | { kind: 'provider-discovery' }
  | { kind: 'provider-lookup'; providerId: string }
  | { kind: 'provider-proof'; providerId: string; subjectId: string }
  | { kind: 'provider-login'; providerId: string; subjectId: string; runId: string }
  | { kind: 'provider-account'; providerId: string; subjectId: string; userId: string }
  | { kind: 'account-baseline'; userId: string }
  | { kind: 'session-account'; providerId: string; userId: string }
  | { kind: 'authenticated-account'; userId: string }
  | { kind: 'authenticated-baseline-revoke'; userId: string }
  | { kind: 'manual-administrator-grant' | 'manual-administrator-revoke'; userId: string }
  | { kind: 'administrator-recovery-claim'; userId: string; membershipId: string; source: string; sourceRef: string|null; expiresAt: string|null; createdById: string|null; createdAt: string; updatedAt: string }
  | { kind: 'config-bootstrap'; bundleKey: string; providerKeys: readonly string[] }
  | { kind: 'system-group-seed'; groupIds: readonly string[] }
  | { kind: 'system-membership'; groupId: string; userId: string; sourceRef: string }
  | { kind: 'audit-append'; rowId: string };

interface CapabilityLease {
  readonly capability: Readonly<PlatformDatabaseCapability>;
  active: boolean;
}

const storage = new AsyncLocalStorage<CapabilityLease>();

function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || value.includes('\0')) {
    throw new Error('Invalid server database capability binding');
  }
}

/** Returns no authority after the owning operation settles, including in timers it spawned. */
export function getPlatformDatabaseCapability(): Readonly<PlatformDatabaseCapability> | undefined {
  const lease = storage.getStore();
  return lease?.active ? lease.capability : undefined;
}

/**
 * Call only after the owning service has verified the identity, configured
 * bootstrap envelope or immutable system row. An exported internal function is
 * not an HTTP capability: no route accepts its kind or bindings from callers.
 */
export async function runWithPlatformDatabaseCapability<T>(
  input: PlatformDatabaseCapability,
  work: () => Promise<T>,
): Promise<T> {
  const bindings: Record<PlatformDatabaseCapability['kind'], readonly string[]> = {
    'migration-execution': ['schema','ownerRole'], 'provider-discovery': [], 'provider-lookup': ['providerId'],
    'provider-proof': ['providerId','subjectId'], 'provider-account': ['providerId','subjectId','userId'],
    'provider-login': ['providerId','subjectId','runId'],
    'account-baseline': ['userId'], 'config-bootstrap': ['bundleKey','providerKeys'],
    'session-account': ['providerId','userId'], 'authenticated-account': ['userId'],
    'authenticated-baseline-revoke': ['userId'],
    'manual-administrator-grant': ['userId'], 'manual-administrator-revoke': ['userId'],
    'administrator-recovery-claim': ['userId','membershipId','source','sourceRef','expiresAt','createdById','createdAt','updatedAt'],
    'system-group-seed': ['groupIds'], 'system-membership': ['groupId','userId','sourceRef'], 'audit-append': ['rowId'],
  };
  if (!input || !Object.prototype.hasOwnProperty.call(bindings, input.kind)) throw new Error('Unknown server database capability');
  const expected = ['kind', ...bindings[input.kind]].sort();
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(expected)) throw new Error('Invalid server database capability bindings');
  for (const [key, value] of Object.entries(input)) {
    if (key === 'kind') continue;
    if (input.kind === 'administrator-recovery-claim' && ['sourceRef','expiresAt','createdById'].includes(key) && value === null) continue;
    if (key === 'providerKeys' || key === 'groupIds') {
      if (!Array.isArray(value)) throw new Error('Invalid server database capability array binding');
      if (!value.length || value.length > 100) throw new Error('Invalid server database capability binding');
      value.forEach(identifier);
    } else { if (Array.isArray(value)) throw new Error('Invalid server database capability scalar binding'); identifier(value); }
    if (input.kind === 'administrator-recovery-claim' && ['expiresAt','createdAt','updatedAt'].includes(key) && !/^\d+$/.test(String(value))) throw new Error('Invalid recovery membership timestamp');
  }
  const capability = Object.freeze({ ...input,
    ...('providerKeys' in input ? { providerKeys: Object.freeze([...input.providerKeys]) } : {}),
    ...('groupIds' in input ? { groupIds: Object.freeze([...input.groupIds]) } : {}),
  }) as Readonly<PlatformDatabaseCapability>;
  const lease: CapabilityLease = { capability, active: true };
  try {
    return await storage.run(lease, work);
  } finally {
    // AsyncLocalStorage propagation alone is insufficient: deferred work keeps
    // the store even after run() returns. Revoke this exact lease as well.
    lease.active = false;
  }
}
