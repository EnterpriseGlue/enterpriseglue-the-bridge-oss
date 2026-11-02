import React from 'react';
import { useLocation } from 'react-router-dom';
import { AuthContext } from '../../../contexts/AuthContext';
import { permissionSnapshotAuthorityKey } from '../../../contexts/authSessionPermissions';
import { evaluateStarbaseMissionControlBridge, type BridgeDecisionResponse } from '../../../shared/api/bridgeAuthz';
import { getUiErrorMessage } from '../../../shared/api/apiErrorUtils';
import { useTenantNavigate } from '../../../shared/hooks/useTenantNavigate';
import { selectLatestFileMissionControlTarget, type RuntimeLinkFile } from '../../git/utils/missionControlTarget';
import { useProjectActionFence } from './useProjectActionFence';

type Options = {
  file: RuntimeLinkFile | null | undefined;
  engineId?: string | null;
  rows: unknown;
  isFetching: boolean;
  canReadDeployments: boolean;
  viewKey: string;
  refetch: () => Promise<{ data?: unknown; isError?: boolean }>;
};

// A read-only navigation handoff. The composite and destination APIs own authorization.
export function useEditorMissionControlBridge(options: Options) {
  const auth = React.useContext(AuthContext), location = useLocation();
  const { tenantNavigate, tenantSlug, effectivePathname } = useTenantNavigate();
  const file = options.file ? { id: options.file.id, projectId: options.file.projectId, type: options.file.type } : null;
  const engineId = options.engineId;
  const target = selectLatestFileMissionControlTarget(file, options.rows, engineId);
  const retainedIdentity = target?.identity;
  const unavailableReason = !auth?.isAuthenticated || auth.isLoading ? 'Sign in before opening Mission Control.'
    : !options.canReadDeployments ? 'Deployment history access is required.'
    : !engineId ? 'Select an engine before opening Mission Control.'
    : options.isFetching ? 'Refreshing deployment metadata.'
    : !target ? 'No unambiguous deployment was found for this file and selected engine.' : null;
  // Own refetch changes isFetching; it must not revoke its own unchanged selection.
  const scope = JSON.stringify([file, engineId, retainedIdentity, options.canReadDeployments, options.viewKey,
    auth?.isAuthenticated, auth?.isLoading, auth?.user?.session?.principal.id || auth?.user?.id,
    auth?.user?.session?.tenant.id, auth?.sessionRevision, permissionSnapshotAuthorityKey(auth?.permissions),
    tenantSlug, effectivePathname, location.search]);
  const fence = useProjectActionFence(scope);
  const [decision, setDecision] = React.useState<BridgeDecisionResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { setDecision(null); setError(null); }, [scope]);
  const open = async () => {
    const operation = fence.begin(unavailableReason === null);
    if (!operation || !file) return;
    try {
      operation.check(); setDecision(null); setError(null);
      let refreshed: Awaited<ReturnType<Options['refetch']>>;
      try { refreshed = await options.refetch(); } catch { throw new Error('Current deployment metadata could not be verified. Refresh before opening Mission Control.'); }
      operation.check();
      if (refreshed.isError) throw new Error('Current deployment metadata could not be verified. Refresh before opening Mission Control.');
      const fresh = selectLatestFileMissionControlTarget(file, refreshed.data, engineId);
      if (!fresh || fresh.identity !== retainedIdentity) throw new Error('The deployed selection changed. Select it again before opening Mission Control.');
      const response = await evaluateStarbaseMissionControlBridge({ projectId: file.projectId, fileId: file.id,
        engineId: fresh.engineId, kind: fresh.keyParam, definitionId: fresh.definitionId, definitionKey: fresh.key,
        ...(fresh.keyParam === 'decision' ? { decisionDefinitionId: fresh.definitionId, decisionDefinitionKey: fresh.key } : {}) });
      operation.check();
      if (!response.allowed) { setDecision(response); return; }
      const params = new URLSearchParams({ engineId: fresh.engineId, [fresh.keyParam]: fresh.key, version: String(fresh.version) });
      tenantNavigate(`${fresh.path}?${params.toString()}`);
    } catch (failure) {
      try { operation.check(); setError(getUiErrorMessage(failure, 'Unable to verify Mission Control access')); } catch {}
    } finally { operation.finish(); }
  };
  return { open, target, available: unavailableReason === null, unavailableReason, isPending: fence.pending, decision, error };
}
