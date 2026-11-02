import React from 'react';
import { useProjectActionFence } from './useProjectActionFence';
import { parseMissionControlEditorSelection } from '../utils/missionControlEditorSelection';

type State = { check: () => void } | null;
const current = (state: State) => { try { state?.check(); return state !== null; } catch { return false; } };

export function useMissionControlEditorHandoff(options: { fileId?: string; search: string; authority: string }) {
  const selection = parseMissionControlEditorSelection(options.search);
  const fence = useProjectActionFence(JSON.stringify([options.fileId, options.search, options.authority]));
  const check = fence.capture();
  const isCurrent = () => { try { check(); return true; } catch { return false; } };
  const [dismissed, setDismissed] = React.useState<State>(null);
  const [viewing, setViewing] = React.useState<State>(null);
  const [confirmation, setConfirmation] = React.useState<State>(null);
  const canRestore = Boolean(options.fileId && selection.valid && (selection.commitId || selection.fileVersion !== null));
  const canView = Boolean(options.fileId && selection.valid && selection.commitId);
  const dismiss = () => {
    if (!selection.isMissionControl || !isCurrent()) return false;
    setDismissed({ check }); return true;
  };
  const enterView = () => {
    if (!canView || !isCurrent()) return false;
    setDismissed({ check }); setViewing({ check }); return true;
  };
  return { selection, canRestore, canView, isCurrent, dismiss, enterView,
    dismissed: current(dismissed), isViewing: current(viewing), confirmationOpen: current(confirmation),
    leaveView: () => { if (isCurrent()) setViewing(null); },
    requestConfirmation: () => { if (canRestore && isCurrent()) setConfirmation({ check }); },
    cancelConfirmation: () => { if (isCurrent()) setConfirmation(null); } };
}
