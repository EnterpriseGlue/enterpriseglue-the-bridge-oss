import { expect, type ConsoleMessage, type Page, type Request, type Response } from '@playwright/test';

export type BrowserDiagnosticKind = 'console' | 'pageerror' | 'requestfailed' | 'http';

export interface BrowserDiagnostic {
  kind: BrowserDiagnosticKind;
  message: string;
  url?: string;
}

export interface BrowserDiagnosticAllowance {
  kind: BrowserDiagnosticKind;
  pattern: RegExp;
  owner: string;
  reason: string;
  expires: string;
  issue: string;
}

function validateAllowances(allowances: BrowserDiagnosticAllowance[]) {
  const today = new Date().toISOString().slice(0, 10);
  for (const allowance of allowances) {
    expect(allowance.owner, 'browser diagnostic allowance owner').not.toBe('');
    expect(allowance.reason, 'browser diagnostic allowance reason').not.toBe('');
    expect(allowance.issue, 'browser diagnostic allowance issue').toMatch(/^https:\/\//);
    expect(allowance.expires, 'browser diagnostic allowance expiry').toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(allowance.expires >= today, `expired browser diagnostic allowance: ${allowance.issue}`).toBe(true);
    expect(allowance.pattern.source, 'wildcard browser diagnostic allowances are prohibited').not.toBe('.*');
  }
}

export function monitorBrowserDiagnostics(
  page: Page,
  allowances: BrowserDiagnosticAllowance[] = [],
) {
  validateAllowances(allowances);
  const diagnostics: BrowserDiagnostic[] = [];

  const allowed = (diagnostic: BrowserDiagnostic) => allowances.some((allowance) => {
    allowance.pattern.lastIndex = 0;
    return allowance.kind === diagnostic.kind && allowance.pattern.test(
      `${diagnostic.message}\n${diagnostic.url || ''}`,
    );
  });
  const record = (diagnostic: BrowserDiagnostic) => {
    if (!allowed(diagnostic)) diagnostics.push(diagnostic);
  };
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    record({
      kind: 'console',
      message: `${message.type()}: ${message.text()}`,
      url: message.location().url,
    });
  };
  const onPageError = (error: Error) => record({
    kind: 'pageerror',
    message: error.stack || error.message || String(error),
  });
  const onRequestFailed = (request: Request) => record({
    kind: 'requestfailed',
    message: `${request.method()} ${request.failure()?.errorText || 'request failed'}`,
    url: request.url(),
  });
  const onResponse = (response: Response) => {
    if (response.status() < 400) return;
    record({
      kind: 'http',
      message: `${response.request().method()} HTTP ${response.status()} ${response.statusText()}`,
      url: response.url(),
    });
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  return {
    current: () => [...diagnostics],
    clear: () => diagnostics.splice(0, diagnostics.length),
    async expectClean(label: string) {
      await page.waitForTimeout(500);
      expect(
        diagnostics,
        `${label} produced unexpected browser diagnostics:\n${diagnostics
          .map((entry) => `[${entry.kind}] ${entry.message}${entry.url ? ` ${entry.url}` : ''}`)
          .join('\n')}`,
      ).toEqual([]);
      await expect(page.locator('body')).not.toContainText(/Unexpected Application Error/i);
    },
    dispose() {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
    },
  };
}
