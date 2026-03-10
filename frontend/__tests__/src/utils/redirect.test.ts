import { describe, it, expect, beforeEach, vi } from 'vitest';
import { redirectTo, replaceAndReloadToInternalPath } from '../../../../packages/frontend-host/src/utils/redirect';

describe('redirect utils', () => {
  const assign = vi.fn();
  const reload = vi.fn();
  const replaceState = vi.fn();

  beforeEach(() => {
    assign.mockReset();
    reload.mockReset();
    replaceState.mockReset();

    Object.defineProperty(window, 'location', {
      value: {
        origin: 'http://localhost:3000',
        assign,
        reload,
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(window, 'history', {
      value: {
        state: { from: 'test' },
        replaceState,
      },
      configurable: true,
      writable: true,
    });
  });

  it('allows same-origin internal redirects', () => {
    redirectTo('/api/auth/google?tenantSlug=acme');

    expect(assign).toHaveBeenCalledWith('/api/auth/google?tenantSlug=acme');
  });

  it('falls back for external redirect targets', () => {
    redirectTo('https://evil.example/path');

    expect(assign).toHaveBeenCalledWith('/');
  });

  it('replaces history and reloads for safe internal paths', () => {
    replaceAndReloadToInternalPath('/t/acme/starbase/editor/file-123', '/starbase');

    expect(replaceState).toHaveBeenCalledWith({ from: 'test' }, '', '/t/acme/starbase/editor/file-123');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('falls back before replacing history for external paths', () => {
    replaceAndReloadToInternalPath('https://evil.example/path', '/starbase');

    expect(replaceState).toHaveBeenCalledWith({ from: 'test' }, '', '/starbase');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
