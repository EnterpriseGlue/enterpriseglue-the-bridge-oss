import React from 'react';
import { useLocation } from 'react-router-dom';
import { ProcessInstanceStartRequestSchema, type ProcessInstanceStartByDefinitionResponse } from '@enterpriseglue/shared/schemas/mission-control/process.js';
import { AuthContext } from '../../../../contexts/AuthContext';
import { permissionSnapshotAuthorityKey } from '../../../../contexts/authSessionPermissions';
import { useProjectActionFence } from '../../../starbase/hooks/useProjectActionFence';
import { startProcessDefinition } from '../api/startProcess';

type StartTarget = { id: string; key: string; version: number };
export function useStartProcess(options: { engineId?: string; target: StartTarget | null; allowed: boolean;
  onStarted: (receipt: ProcessInstanceStartByDefinitionResponse, check: () => void) => Promise<void> }) {
  const auth = React.useContext(AuthContext), location = useLocation();
  const available = auth?.isAuthenticated === true && !auth.isLoading && !!options.engineId && !!options.target?.id && !!options.target.key
    && Number.isSafeInteger(options.target.version) && options.target.version > 0 && options.allowed;
  const scope = JSON.stringify([options.engineId, options.target, available, location.pathname, location.search,
    auth?.user?.session?.principal.id || auth?.user?.id || auth?.permissions?.userId, auth?.user?.session?.tenant.id,
    auth?.sessionRevision, permissionSnapshotAuthorityKey(auth?.permissions)]);
  const fence = useProjectActionFence(scope), check = fence.capture();
  const dialog = React.useRef<object | null>(null), inFlight = React.useRef<object | null>(null), owner = dialog.current;
  const [isOpen, setOpen] = React.useState(false), [businessKey, setBusinessKey] = React.useState('');
  const [variablesJson, setVariablesJson] = React.useState(''), [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { dialog.current = null; inFlight.current = null; setOpen(false); setBusinessKey(''); setVariablesJson(''); setError(null); }, [scope]);
  const current = () => { check(); if (!owner || dialog.current !== owner) throw new Error('Process start dialog changed'); };
  const open = () => {
    try { check(); } catch { return; }
    if (!available || inFlight.current || fence.blocked || dialog.current) return;
    dialog.current = {}; setBusinessKey(''); setVariablesJson(''); setError(null); setOpen(true);
  };
  const close = () => {
    try { current(); } catch { return; }
    if (inFlight.current) return;
    dialog.current = null; setOpen(false); setBusinessKey(''); setVariablesJson(''); setError(null);
  };
  const submit = async () => {
    try { current(); } catch { return; }
    let variables: unknown;
    try { if (variablesJson.trim()) variables = JSON.parse(variablesJson); }
    catch { setError('Variables must be valid JSON'); return; }
    const request = ProcessInstanceStartRequestSchema.safeParse({ engineId: options.engineId,
      ...(businessKey.trim() ? { businessKey: businessKey.trim() } : {}), ...(variables === undefined ? {} : { variables }) });
    if (!request.success) { setError('Variables must be a JSON object keyed by supported variable names.'); return; }
    const operation = fence.begin(available && isOpen);
    if (!operation || !options.target) return;
    inFlight.current = owner;
    const assertCurrent = () => { operation.check(); current(); };
    let verified = false;
    try {
      assertCurrent(); setError(null);
      const receipt = await startProcessDefinition(options.target.id, request.data);
      assertCurrent(); verified = true;
      await options.onStarted(receipt, assertCurrent);
      assertCurrent(); dialog.current = null; setOpen(false); setBusinessKey(''); setVariablesJson('');
    } catch {
      try {
        assertCurrent();
        operation.markUncertain();
        setError(verified ? 'The process started, but its instance list could not be refreshed.' : 'Process start was not verified. Check instances before trying again.');
      } catch { /* Replaced views do not adopt old acknowledgements or errors. */ }
    } finally { if (inFlight.current === owner) inFlight.current = null; operation.finish(); }
  };
  return { available, isOpen, businessKey, setBusinessKey, variablesJson, setVariablesJson, error, open, close, submit,
    pending: fence.pending, blocked: fence.blocked };
}
