import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { AuthContext } from '../../../contexts/AuthContext';
import { permissionSnapshotAuthorityKey } from '../../../contexts/authSessionPermissions';
import { useTenantNavigate } from '../../../shared/hooks/useTenantNavigate';
import { useProjectActionFence } from '../../starbase/hooks/useProjectActionFence';

export type LinkedDefinition = { id: string; key: string; label: string; version: number; node: string };
type LinkState = { status: 'none' | 'pending' | 'invalid' | 'unavailable' | 'resolved'; error: string | null; selection: LinkedDefinition | null };
const canonical = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value === value.trim();
export function hasRuntimeDefinitionLink(search: string): boolean {
  const params = new URLSearchParams(search);
  return ['process', 'decision', 'version'].some(key => params.has(key));
}

// Selection only. The definitions and every destination request remain server-authorized.
export function resolveRuntimeDefinitionLink(options: { kind: 'process' | 'decision'; search: string; engineId?: string; definitions: unknown; ready: boolean; failed: boolean }): LinkState {
  const result = (status: LinkState['status'], error: string | null = null, selection: LinkedDefinition | null = null): LinkState => ({ status, error, selection });
  if (!hasRuntimeDefinitionLink(options.search)) return result('none');
  const params = new URLSearchParams(options.search), key = params.get(options.kind), rawVersion = params.get('version');
  const other = options.kind === 'process' ? 'decision' : 'process';
  if (['process', 'decision', 'version', 'node', 'engineId'].some(name => params.getAll(name).length > 1)
    || params.has(other) || !canonical(key)
    || (params.has('engineId') && !canonical(params.get('engineId')))
    || (params.has('node') && !canonical(params.get('node')))
    || (params.has('version') && (!rawVersion || !/^[1-9]\d*$/.test(rawVersion) || !Number.isSafeInteger(Number(rawVersion))))) {
    return result('invalid', 'The linked definition selection is invalid or ambiguous. Open the link again or clear the linked selection.');
  }
  if (!options.engineId) return result('pending');
  if (params.has('engineId') && params.get('engineId') !== options.engineId) {
    return result('unavailable', 'The linked engine does not match the selected engine. Choose the intended engine or clear the linked selection.');
  }
  if (options.failed) return result('unavailable', 'The linked definition could not be verified. Clear the link or try again after definitions are available.');
  if (!options.ready) return result('pending');
  const definitions = Array.isArray(options.definitions) ? options.definitions : [];
  const matches = definitions.filter(def => def?.key === key && canonical(def.id) && Number.isSafeInteger(def.version) && def.version > 0);
  const version = rawVersion ? Number(rawVersion) : matches.reduce((max, def) => Math.max(max, def.version), 0);
  const exact = matches.filter(def => def.version === version);
  if (exact.length !== 1) return result('unavailable', 'The linked definition or version is not available unambiguously on this engine. Choose another selection or clear the link.');
  const def = exact[0];
  return result('resolved', null, { id: def.id, key, label: typeof def.name === 'string' && def.name ? def.name : key, version, node: params.get('node') || '' });
}

export function useRuntimeDefinitionLink(options: { kind: 'process' | 'decision'; engineId?: string; definitions: unknown; ready: boolean; failed: boolean;
  apply: (selection: LinkedDefinition) => void; clearSelection: () => void }) {
  const [params, setParams] = useSearchParams(), search = params.toString();
  const auth = React.useContext(AuthContext), { tenantSlug, effectivePathname } = useTenantNavigate();
  const state = resolveRuntimeDefinitionLink({ ...options, search });
  const scope = JSON.stringify([options.kind, options.engineId, search, tenantSlug, effectivePathname,
    auth?.user?.session?.principal.id || auth?.user?.id, auth?.user?.session?.tenant.id,
    auth?.sessionRevision, permissionSnapshotAuthorityKey(auth?.permissions)]);
  const fence = useProjectActionFence(scope), check = fence.capture();
  const applied = React.useRef<{ identity: string; check: () => void } | null>(null);
  const consume = () => {
    const next = new URLSearchParams(search);
    for (const key of ['process', 'decision', 'version', 'node']) next.delete(key);
    if (options.engineId) next.set('engineId', options.engineId);
    setParams(next, { replace: true });
  };
  const identity = JSON.stringify(state.selection);
  React.useEffect(() => {
    if (state.status !== 'resolved' || !state.selection) return;
    if (applied.current?.identity === identity) {
      try { applied.current.check(); return; } catch { /* A replaced context can apply the same link again. */ }
    }
    try { check(); } catch { return; }
    applied.current = { check, identity };
    options.apply(state.selection);
    consume();
  }, [scope, identity, state.status, state.selection, options.apply, check, consume]);
  return { ...state, active: state.status !== 'none', clear: () => {
    try { check(); } catch { return; }
    options.clearSelection(); consume();
  } };
}
