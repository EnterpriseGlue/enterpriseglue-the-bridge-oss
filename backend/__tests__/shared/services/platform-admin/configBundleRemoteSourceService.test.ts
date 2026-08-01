import { afterEach, describe, expect, it, vi } from 'vitest';
import { configBundleRemoteSourceService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleRemoteSourceService.js';

const payload = {
  bundle: {
    apiVersion: 'enterpriseglue.ai/v1alpha1',
    kind: 'EnterpriseGlueConfigBundle',
    metadata: { key: 'acme.authz', owner: 'platform' },
    tenantKey: 'acme',
    mode: 'preview_only',
    settings: {},
    imports: ['./groups.json'],
  },
  files: { './groups.json': { groups: [] } },
};

describe('configBundleRemoteSourceService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('imports a GitHub repository raw URL through the canonical raw host', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await configBundleRemoteSourceService.import('https://github.com/acme/config/raw/main/bundle.json');

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://raw.githubusercontent.com/acme/config/main/bundle.json'),
      expect.objectContaining({ redirect: 'error' }),
    );
    expect(result).toMatchObject({ sourceHost: 'raw.githubusercontent.com', sourceKind: 'json', payload });
  });

  it('allows GitLab raw-file URLs and rejects arbitrary or credential-bearing hosts before fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(configBundleRemoteSourceService.import('https://gitlab.com/acme/config/-/raw/main/bundle.json')).resolves.toMatchObject({ sourceHost: 'gitlab.com' });
    await expect(configBundleRemoteSourceService.import('https://example.test/config.json')).rejects.toThrow('GitHub or GitLab raw-file URL');
    await expect(configBundleRemoteSourceService.import('https://token@example.test/config.json')).rejects.toThrow('must not include credentials');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reconstructs every accepted URL from a fixed trusted origin', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await configBundleRemoteSourceService.import('https://raw.githubusercontent.com/acme/config/main/folder%20name/bundle.json');
    await configBundleRemoteSourceService.import('https://gitlab.com/acme/config/-/raw/main/folder%20name/bundle.json');

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://raw.githubusercontent.com/acme/config/main/folder%20name/bundle.json',
      'https://gitlab.com/acme/config/-/raw/main/folder%20name/bundle.json',
    ]);
  });

  it.each([
    'http://raw.githubusercontent.com/acme/config/main/bundle.json',
    'https://raw.githubusercontent.com:444/acme/config/main/bundle.json',
    'https://raw.githubusercontent.com/acme/config/main/bundle.json?redirect=https://evil.test',
    'https://raw.githubusercontent.com/acme/config/main/%2f%2fevil.test/bundle.json',
    'https://gitlab.com/acme/config/-/blob/main/bundle.json',
  ])('rejects an unsafe remote bundle URL before fetch: %s', async (url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(configBundleRemoteSourceService.import(url)).rejects.toThrow('Configuration Git URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects redirects, oversized responses, and invalid bundle envelopes', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://evil.test/config.json' } }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'content-length': String(1024 * 1024 + 1) } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ unexpected: true }), { status: 200 })));

    await expect(configBundleRemoteSourceService.import('https://raw.githubusercontent.com/acme/config/main/bundle.json')).rejects.toThrow('request failed (302)');
    await expect(configBundleRemoteSourceService.import('https://raw.githubusercontent.com/acme/config/main/bundle.json')).rejects.toThrow('exceeds the 1 MB limit');
    await expect(configBundleRemoteSourceService.import('https://raw.githubusercontent.com/acme/config/main/bundle.json')).rejects.toThrow('not a valid bundle envelope');
  });
});
