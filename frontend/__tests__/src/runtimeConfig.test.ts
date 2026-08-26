import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '@src/config';
import { initRuntimeConfig, RuntimeConfigError } from '@src/runtimeConfig';

/** Build a JSON Response for the mocked fetch. */
function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

const BUILD_TIME_BASE = 'https://build-time.example';

describe('initRuntimeConfig', () => {
  beforeEach(() => {
    // Reset the mutated singleton to a known build-time baseline before each test.
    config.apiBaseUrl = BUILD_TIME_BASE;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does nothing and issues no fetch when no config URL is set', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await initRuntimeConfig();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(config.apiBaseUrl).toBe(BUILD_TIME_BASE); // build-time value untouched
  });

  it('fetches the config (no-store) and applies apiBaseUrl on success', async () => {
    vi.stubEnv('VITE_RUNTIME_CONFIG_URL', '/config.json');
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ apiBaseUrl: 'https://runtime.example' }));
    vi.stubGlobal('fetch', fetchSpy);

    await initRuntimeConfig();

    expect(config.apiBaseUrl).toBe('https://runtime.example');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/config.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('tolerates and ignores unrecognised keys in the config document', async () => {
    vi.stubEnv('VITE_RUNTIME_CONFIG_URL', '/config.json');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ apiBaseUrl: 'https://runtime.example', featureX: true, nested: { a: 1 } }),
      ),
    );

    await initRuntimeConfig();

    expect(config.apiBaseUrl).toBe('https://runtime.example');
  });

  it('falls back to build-time config when the document is a malformed shape', async () => {
    vi.stubEnv('VITE_RUNTIME_CONFIG_URL', '/config.json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('not-an-object')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(initRuntimeConfig()).resolves.toBeUndefined();

    expect(config.apiBaseUrl).toBe(BUILD_TIME_BASE);
    expect(warn).toHaveBeenCalled();
  });

  it('falls back to build-time config on a non-OK HTTP response', async () => {
    vi.stubEnv('VITE_RUNTIME_CONFIG_URL', '/config.json');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({}, { status: 404 })),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await initRuntimeConfig();

    expect(config.apiBaseUrl).toBe(BUILD_TIME_BASE);
  });

  it('falls back to build-time config on a network error', async () => {
    vi.stubEnv('VITE_RUNTIME_CONFIG_URL', '/config.json');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await initRuntimeConfig();

    expect(config.apiBaseUrl).toBe(BUILD_TIME_BASE);
  });

  it('throws when required and the fetch fails', async () => {
    vi.stubEnv('VITE_RUNTIME_CONFIG_URL', '/config.json');
    vi.stubEnv('VITE_RUNTIME_CONFIG_REQUIRED', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({}, { status: 500 })),
    );

    await expect(initRuntimeConfig()).rejects.toBeInstanceOf(RuntimeConfigError);
  });

  it('throws when required and the loaded document has no usable apiBaseUrl', async () => {
    vi.stubEnv('VITE_RUNTIME_CONFIG_URL', '/config.json');
    vi.stubEnv('VITE_RUNTIME_CONFIG_REQUIRED', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ somethingElse: 'x' })),
    );

    await expect(initRuntimeConfig()).rejects.toBeInstanceOf(RuntimeConfigError);
  });

  it('rejects a non-string apiBaseUrl as malformed (throws when required)', async () => {
    vi.stubEnv('VITE_RUNTIME_CONFIG_URL', '/config.json');
    vi.stubEnv('VITE_RUNTIME_CONFIG_REQUIRED', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ apiBaseUrl: 123 })),
    );

    await expect(initRuntimeConfig()).rejects.toBeInstanceOf(RuntimeConfigError);
  });

  it('treats a present-but-empty apiBaseUrl as no override', async () => {
    vi.stubEnv('VITE_RUNTIME_CONFIG_URL', '/config.json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ apiBaseUrl: '' })));

    await initRuntimeConfig();

    expect(config.apiBaseUrl).toBe(BUILD_TIME_BASE); // unchanged, no error
  });
});
