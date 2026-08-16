import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router-dom';

export interface UnsavedChangesGuard {
  confirmationOpen: boolean;
  requestExit: () => void;
  keepEditing: () => void;
  leaveWithoutSaving: () => void;
}

/**
 * Protects in-page create/edit workflows from browser and SPA navigation.
 * Explicit workflow Cancel actions may still call their close handler directly;
 * use requestExit for back links and other task-abandoning controls.
 */
export function useUnsavedChangesGuard(
  dirty: boolean,
  onLocalExit: () => void,
): UnsavedChangesGuard {
  const navigate = useNavigate();
  const allowNavigationRef = useRef(false);
  const blocker = useBlocker(() => dirty && !allowNavigationRef.current);
  const [localExitRequested, setLocalExitRequested] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return undefined;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty]);

  useLayoutEffect(() => {
    if (!dirty) return undefined;
    const interceptNavigationLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
      const destination = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      if (destination.href === current.href || (destination.pathname === current.pathname && destination.search === current.search && destination.hash)) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(destination.href);
    };
    document.addEventListener('click', interceptNavigationLink, true);
    return () => document.removeEventListener('click', interceptNavigationLink, true);
  }, [dirty]);

  const requestExit = useCallback(() => {
    if (dirty) {
      setLocalExitRequested(true);
      return;
    }
    onLocalExit();
  }, [dirty, onLocalExit]);

  const keepEditing = useCallback(() => {
    setLocalExitRequested(false);
    setPendingHref(null);
    if (blocker.state === 'blocked') blocker.reset();
  }, [blocker]);

  const leaveWithoutSaving = useCallback(() => {
    if (localExitRequested) {
      setLocalExitRequested(false);
      onLocalExit();
      return;
    }
    if (pendingHref) {
      const destination = new URL(pendingHref, window.location.href);
      setPendingHref(null);
      allowNavigationRef.current = true;
      if (destination.origin === window.location.origin) {
        navigate(`${destination.pathname}${destination.search}${destination.hash}`);
        window.setTimeout(() => { allowNavigationRef.current = false; }, 0);
      } else {
        window.location.assign(destination.href);
      }
      return;
    }
    if (blocker.state === 'blocked') blocker.proceed();
  }, [blocker, localExitRequested, navigate, onLocalExit, pendingHref]);

  return {
    confirmationOpen: localExitRequested || Boolean(pendingHref) || blocker.state === 'blocked',
    requestExit,
    keepEditing,
    leaveWithoutSaving,
  };
}
