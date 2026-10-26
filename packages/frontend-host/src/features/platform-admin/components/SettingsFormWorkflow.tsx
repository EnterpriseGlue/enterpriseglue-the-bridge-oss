import React, { useEffect, useId, useRef } from 'react';
import { Button, InlineNotification, Modal } from '@carbon/react';
import { useUnsavedChangesGuard } from '../../../shared/hooks/useUnsavedChangesGuard';

/** One guard per administration surface, including its local section controls. */
export function useSettingsWorkflowExit(dirty: boolean, onExit: () => void) {
  const exitAction = useRef(onExit);
  const guard = useUnsavedChangesGuard(dirty, () => exitAction.current());
  return {
    ...guard,
    requestExit: (afterExit?: () => void) => {
      exitAction.current = () => { onExit(); afterExit?.(); };
      guard.requestExit();
    },
  };
}

export function WorkflowDiscardDialog({ guard, busy = false }: {
  guard: ReturnType<typeof useSettingsWorkflowExit>;
  busy?: boolean;
}) {
  if (!guard.confirmationOpen) return null;
  return <Modal open={guard.confirmationOpen} danger modalHeading="Leave without saving?"
    primaryButtonText="Leave" secondaryButtonText="Keep editing"
    primaryButtonDisabled={busy} selectorPrimaryFocus=".cds--btn--secondary"
    onRequestClose={guard.keepEditing} onRequestSubmit={() => !busy && guard.leaveWithoutSaving()}>
    <p>Your changes have not been saved. Leaving this form will discard them.</p>
  </Modal>;
}

/** A bounded form inside the page's existing navigation, never a desktop overlay. */
export function SettingsFormWorkflow({ open = true, title, description, backLabel, primaryButtonText,
  primaryButtonDisabled, busy = false, error, onCancel, onSubmit, children }: {
  open?: boolean;
  title: string;
  description: string;
  backLabel: string;
  primaryButtonText: string;
  primaryButtonDisabled?: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement;
    heading.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [open]);
  if (!open) return null;
  return <section className="eg-settings-workflow eg-admin-form-workflow" role="region" aria-labelledby={titleId}
    aria-busy={busy} onKeyDown={event => {
      // Escape belongs to a dropdown/accordion while that control is open.
      if (event.key === 'Escape' && !busy && !event.defaultPrevented && !(event.target instanceof Element
        && event.target.closest('[aria-expanded="true"], [role="listbox"], [role="option"]'))) {
        event.preventDefault(); onCancel();
      }
    }}>
    <div className="eg-settings-workflow__header">
      <div><h2 id={titleId} ref={heading} tabIndex={-1}>{title}</h2><p>{description}</p></div>
      <Button kind="ghost" size="sm" disabled={busy} onClick={onCancel}>{backLabel}</Button>
    </div>
    <div className="eg-settings-workflow__body" role="region" aria-label={`${title} form fields`} tabIndex={0}>
      {error && <InlineNotification kind="error" title="Changes not saved" subtitle={error} hideCloseButton lowContrast />}
      <fieldset className="eg-settings-workflow__fieldset" disabled={busy}>{children}</fieldset>
    </div>
    <div className="eg-settings-workflow__actions">
      <Button kind="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      <Button kind="primary" disabled={busy || primaryButtonDisabled} onClick={onSubmit}>
        {busy ? 'Saving…' : primaryButtonText}
      </Button>
    </div>
  </section>;
}
