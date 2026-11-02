import type { CurrentUserPermissions, User } from '../shared/types/auth';

/** Client cache/view identity, excluding the observation timestamp. Not server authority. */
export function permissionSnapshotAuthorityKey(snapshot: CurrentUserPermissions | null | undefined): string | null {
  if (!snapshot) return null;
  return JSON.stringify([snapshot.userId, snapshot.tenantId, snapshot.authorizationVersion,
    snapshot.platform, snapshot.platformActionAvailability, snapshot.tenant, snapshot.projects, snapshot.engines]);
}

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
