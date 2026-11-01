import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../shared/hooks/useAuth';
import { permissionSnapshotAuthorityKey } from '../../contexts/authSessionPermissions';

/** View identity only; server action decisions remain authoritative. */
export function useUserDirectoryViewScope(): string {
  const { user, permissions, sessionRevision } = useAuth();
  const location = useLocation();
  return JSON.stringify([location.pathname, user?.id, user?.session?.tenant?.id,
    sessionRevision, permissionSnapshotAuthorityKey(permissions)]);
}

/** Discard late UI work without claiming to cancel an already-issued write. */
export function useUserDirectoryLifetime() {
  const active = useRef(true);
  const revision = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; revision.current += 1; };
  }, []);
  return useCallback(() => {
    const requestRevision = revision.current;
    return () => active.current && revision.current === requestRevision;
  }, []);
}
