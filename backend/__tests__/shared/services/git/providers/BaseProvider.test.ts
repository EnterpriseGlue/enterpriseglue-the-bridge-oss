import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseGitProvider } from '@enterpriseglue/shared/services/git/providers/BaseProvider.js';

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn();
  vi.stubGlobal('fetch', mock);
  return mock;
});

class TestProvider extends BaseGitProvider {
  request(url: string, token: string) { return this.makeRequest<{ ok: boolean }>(url, 'GET', token); }
  createPullRequest(): any { throw new Error('not used'); }
  getPullRequest(): any { throw new Error('not used'); }
  listPullRequests(): any { throw new Error('not used'); }
  mergePullRequest(): any { throw new Error('not used'); }
  createRepository(): any { throw new Error('not used'); }
  getRepository(): any { throw new Error('not used'); }
}

const originalEnv = { ...process.env };

describe('BaseGitProvider outbound boundary', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });
  afterAll(() => vi.unstubAllGlobals());

  it('does not send a bearer token to a prohibited host', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EG_ADMIN_INTEGRATION_ALLOWED_HOSTS = 'git.example.com';
    const provider = new TestProvider('https://git.example.com', 'https://git.example.com/api');
    await expect(provider.request('https://169.254.169.254/repos', 'secret-token'))
      .rejects.toThrow('not permitted by endpoint policy');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns bounded JSON and never follows a redirect', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EG_ADMIN_INTEGRATION_ALLOWED_HOSTS = '93.184.216.34';
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const provider = new TestProvider('https://93.184.216.34', 'https://93.184.216.34/api');
    await expect(provider.request('https://93.184.216.34/repos', 'secret-token')).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
    });
  });
});
