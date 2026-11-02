import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMissionControlEditorHandoff } from '@src/features/starbase/hooks/useMissionControlEditorHandoff';
import { advanceBrowserSessionRevision } from '@src/utils/browserSession';

const initial = () => ({ fileId: 'file-A', search: '?source=mission-control&engineId=engine-A&process=invoice&version=3&commitId=commit-A&fileVersion=2', authority: 'tenant-A/actor-A/session1/permission1/route-A' });
describe('Mission Control editor handoff lifetime', () => {
  it('separates read-only preview from the guarded version-only hotfix capability', () => {
    const input = initial(); input.search = input.search.replace('&commitId=commit-A', '');
    const f = renderHook(useMissionControlEditorHandoff, { initialProps: input });
    expect(f.result.current.canView).toBe(false); expect(f.result.current.canRestore).toBe(true);
    act(() => expect(f.result.current.enterView()).toBe(false)); expect(f.result.current.isViewing).toBe(false);
    act(() => f.result.current.requestConfirmation()); expect(f.result.current.confirmationOpen).toBe(true);
  });
  it('opens the exact commit view and explicitly returns to the draft', () => {
    const f = renderHook(useMissionControlEditorHandoff, { initialProps: initial() });
    act(() => expect(f.result.current.enterView()).toBe(true)); expect(f.result.current.isViewing).toBe(true); expect(f.result.current.dismissed).toBe(true);
    act(() => f.result.current.leaveView()); expect(f.result.current.isViewing).toBe(false);
  });
  it.each(['file', 'selection', 'actor', 'permission', 'tenant', 'route', 'aba', 'browser', 'unmount'])('revokes view, dismissal, confirmation and retained actions after %s changes', change => {
    const input = initial(), f = renderHook(useMissionControlEditorHandoff, { initialProps: input });
    act(() => { f.result.current.enterView(); f.result.current.requestConfirmation(); });
    expect(f.result.current.isViewing).toBe(true); expect(f.result.current.confirmationOpen).toBe(true);
    const old = f.result.current;
    if (change === 'unmount') f.unmount();
    else if (change === 'browser') { advanceBrowserSessionRevision(); f.rerender(input); }
    else {
      const replacement = { ...input };
      if (change === 'file') replacement.fileId = 'file-B';
      else if (change === 'selection' || change === 'aba') replacement.search = input.search.replace('version=3', 'version=4');
      else replacement.authority = change + '/replacement';
      f.rerender(replacement); if (change === 'aba') f.rerender(input);
    }
    expect(old.isCurrent()).toBe(false);
    act(() => { expect(old.enterView()).toBe(false); expect(old.dismiss()).toBe(false); old.requestConfirmation(); });
    if (change !== 'unmount') {
      expect(f.result.current.isViewing).toBe(false); expect(f.result.current.dismissed).toBe(false); expect(f.result.current.confirmationOpen).toBe(false);
    }
  });
  it.each(['', '?commitId=commit-A', '?source=mission-control&engineId=e&process=p&version=1.9&commitId=c', '?source=mission-control&engineId=e&process=p&decision=d&version=1&commitId=c'])('refuses view, restore and confirmation for an invalid handoff %s', search => {
    const f = renderHook(useMissionControlEditorHandoff, { initialProps: { ...initial(), search } });
    expect(f.result.current.canRestore).toBe(false); expect(f.result.current.canView).toBe(false);
    act(() => { expect(f.result.current.enterView()).toBe(false); f.result.current.requestConfirmation(); });
    expect(f.result.current.confirmationOpen).toBe(false);
  });
});
