import React from 'react';

/**
 * Gives the non-destructive action initial focus after Carbon finishes opening a
 * danger modal. Carbon's focus selector can race with the modal transition, so
 * the explicit post-render focus keeps keyboard users on the safer choice.
 */
export function useSafeDestructiveModalFocus(
  open: boolean,
  modalHeading: string,
  safeActionText: string,
): void {
  React.useEffect(() => {
    if (!open) return undefined;

    let secondAnimationFrame = 0;
    const firstAnimationFrame = window.requestAnimationFrame(() => {
      secondAnimationFrame = window.requestAnimationFrame(() => {
        const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
          .find((candidate) => candidate.textContent?.includes(modalHeading));
        const safeAction = Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button') || [])
          .find((button) => button.textContent?.trim() === safeActionText);
        safeAction?.focus();
      });
    });

    return () => {
      window.cancelAnimationFrame(firstAnimationFrame);
      if (secondAnimationFrame) window.cancelAnimationFrame(secondAnimationFrame);
    };
  }, [modalHeading, open, safeActionText]);
}

export default useSafeDestructiveModalFocus;
