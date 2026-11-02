import React from 'react';
import { useLocation } from 'react-router-dom';
import { ProcessEditTargetSchema, DecisionEditTargetSchema } from '@enterpriseglue/shared/schemas/mission-control/edit-target.js';
import { AuthContext } from '../../../contexts/AuthContext';
import { permissionSnapshotAuthorityKey } from '../../../contexts/authSessionPermissions';
import { evaluateMissionControlStarbaseBridge, type BridgeDecisionResponse } from '../../../shared/api/bridgeAuthz';
import { getUiErrorMessage } from '../../../shared/api/apiErrorUtils';
import { useTenantNavigate } from '../../../shared/hooks/useTenantNavigate';
import { useProjectActionFence } from '../../starbase/hooks/useProjectActionFence';

export type StarbaseEditSelection = {
  engineId?: string | null;
  kind: 'process' | 'decision';
  definitionKey?: string | null;
  definitionId?: string | null;
  version?: number | null;
  editTarget: unknown;
  isFetching?: boolean;
  viewKey?: string;
};
const canonical = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value === value.trim();

// One read-only handoff. Metadata/response validation never grants server authority.
export function useStarbaseEditBridge(selection: StarbaseEditSelection) {
  const auth = React.useContext(AuthContext);
  const { tenantNavigate, tenantSlug, effectivePathname } = useTenantNavigate();
  const location = useLocation();
  const parsed = (selection.kind === 'process' ? ProcessEditTargetSchema : DecisionEditTargetSchema).safeParse(selection.editTarget);
  const target = parsed.success ? parsed.data : null;
  const targetKey = target && ('processKey' in target ? target.processKey : target.decisionKey);
  const targetVersion = target && ('processVersion' in target ? target.processVersion : target.decisionVersion);
  const verified = target && canonical(selection.engineId) && target.engineId === selection.engineId
    && canonical(selection.definitionKey) && targetKey === selection.definitionKey && targetVersion === selection.version
    && Number.isSafeInteger(selection.version) && Number(selection.version) > 0
    && canonical(target.projectId) && canonical(target.fileId)
    && (target.commitId == null || target.commitId === '' || canonical(target.commitId))
    && (target.fileVersionNumber == null || (Number.isSafeInteger(target.fileVersionNumber) && target.fileVersionNumber > 0));
  const unavailableReason = !auth?.isAuthenticated ? 'Sign in before opening Starbase.'
    : selection.isFetching ? 'The deployed edit target is being refreshed.'
    : !verified ? 'The selected edit target could not be verified.'
    : !target.canShowEditButton || !target.canEdit ? 'You do not have edit access for this project.' : null;
  const available = unavailableReason === null;
  const intent = { engineId: selection.engineId, kind: selection.kind, definitionKey: selection.definitionKey,
    definitionId: selection.definitionId || undefined, version: selection.version, target };
  const scope = JSON.stringify([intent, selection.isFetching, selection.viewKey, available,
    auth?.user?.session?.principal.id || auth?.user?.id || auth?.permissions?.userId,
    auth?.user?.session?.tenant.id, auth?.sessionRevision, permissionSnapshotAuthorityKey(auth?.permissions),
    tenantSlug, effectivePathname, location.search]);
  const fence = useProjectActionFence(scope);
  const [decision, setDecision] = React.useState<BridgeDecisionResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { setDecision(null); setError(null); }, [scope]);
  const open = async () => {
    const operation = fence.begin(available);
    if (!operation || !target) return;
    try {
      operation.check(); setDecision(null); setError(null);
      const response = await evaluateMissionControlStarbaseBridge({ engineId: target.engineId, projectId: target.projectId,
        fileId: target.fileId, definitionId: intent.definitionId, definitionKey: intent.definitionKey || undefined,
        ...(intent.kind === 'decision' ? { decisionDefinitionId: intent.definitionId, decisionDefinitionKey: intent.definitionKey || undefined } : {}), kind: intent.kind });
      operation.check();
      if (!response.allowed) { setDecision(response); return; }
      const params = new URLSearchParams({ source: 'mission-control', engineId: target.engineId,
        [intent.kind === 'decision' ? 'decision' : 'process']: String(intent.definitionKey), version: String(intent.version),
        deploymentId: target.engineDeploymentId || '', mappingSource: target.mappingSource || '' });
      if (target.commitId) params.set('commitId', target.commitId);
      if (target.fileVersionNumber != null) params.set('fileVersion', String(target.fileVersionNumber));
      tenantNavigate(`/starbase/editor/${encodeURIComponent(target.fileId)}?${params.toString()}`);
    } catch (failure) {
      try { operation.check(); setError(getUiErrorMessage(failure, 'Unable to evaluate Starbase edit access')); } catch {}
    } finally { operation.finish(); }
  };
  return { open, decision, error, available, unavailableReason, isPending: fence.pending };
}
