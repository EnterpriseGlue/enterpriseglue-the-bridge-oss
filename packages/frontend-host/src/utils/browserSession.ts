/** Client continuation fence only; cookies and server authorization remain authoritative. */
let revision = 0;

export function getBrowserSessionRevision(): number {
  return revision;
}

/** Invalidate older continuations even for A -> B -> A or same-user sign-in. */
export function advanceBrowserSessionRevision(): void {
  revision += 1;
}

export class BrowserSessionChangedError extends Error {
  readonly code = 'BROWSER_SESSION_CHANGED';
  constructor() {
    super('Browser session changed; review the current session before submitting again');
    this.name = 'BrowserSessionChangedError';
  }
}
