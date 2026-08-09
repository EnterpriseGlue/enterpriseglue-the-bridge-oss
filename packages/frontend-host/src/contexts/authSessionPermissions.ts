import type { CurrentUserPermissions, User } from '../shared/types/auth';

/**
 * Browser permission snapshots are UX-only, but must still be bound to the
 * same principal and request-derived tenant as the user response that loaded
 * them. A mismatch is treated as unavailable until the next snapshot arrives.
 */
export function permissionSnapshotMatchesSession(
  user: User | null | undefined,
  snapshot: CurrentUserPermissions | null | undefined,
): boolean {
  if (!user || !snapshot || snapshot.userId !== user.id) return false;
  return snapshot.tenantId === (user.session?.tenant.id ?? null);
}
