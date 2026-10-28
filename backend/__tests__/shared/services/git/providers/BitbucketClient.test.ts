import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BitbucketClient } from '@enterpriseglue/shared/services/git/providers/BitbucketClient.js';

vi.mock('@enterpriseglue/shared/utils/logger.js', () => ({ logger: { warn: vi.fn() } }));
const token = 'controlled-test-token';
const client = () => new BitbucketClient({ token });
const realFetch = globalThis.fetch;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' },
});
const repo = {
  uuid: '{repo-id}', name: 'Project', slug: 'project', full_name: 'team/project',
  is_private: false, mainbranch: { name: 'trunk' },
  links: { clone: [{ name: 'ssh', href: 'ssh-url' }, { name: 'https', href: 'https-url' }], html: { href: 'browser-url' } },
};
function wire(...responses: Response[]) {
  const fetch = vi.fn();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
function call(fetch: ReturnType<typeof vi.fn>, index = 0) {
  const [input, init] = fetch.mock.calls[index];
  const url = new URL(String(input));
  expect(url.origin).toBe('https://api.bitbucket.org');
  expect(init.redirect).toBe('error');
  expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${token}`);
  return { url, init };
}
afterEach(() => vi.unstubAllGlobals());

describe('Bitbucket Cloud HTTP contracts', () => {
  it('authenticates and maps the current user', async () => {
    const fetch = wire(json({ uuid: '{user}', username: 'alice' }), json({}));
    const c = client();
    await expect(c.getCurrentUser()).resolves.toEqual({ id: '{user}', username: 'alice', email: undefined });
    await expect(c.validateCredentials()).resolves.toBe(true);
    expect(call(fetch).url.pathname).toBe('/2.0/user');
    expect(call(fetch, 1).url.pathname).toBe('/2.0/user');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('lists distinct workspaces and retains the user namespace if listing is refused', async () => {
    const user = { username: 'alice', links: { avatar: { href: 'user-avatar' } } };
    const fetch = wire(json(user), json({ values: [{ slug: 'alice' }, { slug: 'team', links: { avatar: { href: 'team-avatar' } } }] }), json(user), json({ error: 'private provider detail' }, 403));
    const c = client();
    await expect(c.getNamespaces()).resolves.toEqual([{ name: 'alice', type: 'user', avatarUrl: 'user-avatar' }, { name: 'team', type: 'organization', avatarUrl: 'team-avatar' }]);
    await expect(c.getNamespaces()).resolves.toEqual([{ name: 'alice', type: 'user', avatarUrl: 'user-avatar' }]);
    expect(call(fetch, 1).url.pathname).toBe('/2.0/workspaces');
  });
  it('creates/lists repositories with private default and explicit query', async () => {
    const fetch = wire(json({ username: 'alice' }), json(repo), json({ values: [repo] }), json(repo));
    const c = client();
    const expected = { id: '{repo-id}', name: 'Project', fullName: 'team/project', cloneUrl: 'https-url', htmlUrl: 'browser-url', defaultBranch: 'trunk', private: false };
    await expect(c.createRepository({ name: 'project', description: 'Description' })).resolves.toEqual(expected);
    const create = call(fetch, 1);
    expect(create.url.pathname).toBe('/2.0/repositories/alice/project');
    expect(create.init.method).toBe('POST');
    expect(JSON.parse(create.init.body)).toEqual({ name: 'project', description: 'Description', is_private: true, scm: 'git' });
    await expect(c.listRepositories({ org: 'team', limit: 25 })).resolves.toEqual([expected]);
    expect(call(fetch, 2).url.pathname).toBe('/2.0/repositories/team');
    expect(Object.fromEntries(call(fetch, 2).url.searchParams)).toEqual({ pagelen: '25', sort: '-updated_on' });
    await c.createRepository({ name: 'project', organization: 'team', private: false });
    expect(JSON.parse(call(fetch, 3).init.body).is_private).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it('gets/deletes repositories and preserves missing/error semantics', async () => {
    const fetch = wire(json(repo), new Response(null, { status: 204 }), json({}, 404), json({}, 429));
    const c = client();
    expect((await c.getRepository('https://bitbucket.org/team/project.git'))?.name).toBe('Project');
    await expect(c.deleteRepository('team/project')).resolves.toBeUndefined();
    await expect(c.getRepository('team/missing')).resolves.toBeNull();
    await expect(c.getRepository('team/project')).rejects.toMatchObject({ status: 429 });
    expect(call(fetch).url.pathname).toBe('/2.0/repositories/team/project');
    expect(call(fetch, 1).init.method).toBe('DELETE');
  });
  it('maps default branches and creates a branch from its source hash', async () => {
    const fetch = wire(json({ values: [{ name: 'trunk', target: { hash: 'aaa' } }, { name: 'topic' }] }), json(repo), json({ target: { hash: 'source-hash' } }), json({ name: 'new/topic', target: { hash: 'new-hash' } }));
    const c = client();
    await expect(c.getBranches('team/project')).resolves.toEqual([{ name: 'trunk', sha: 'aaa', isDefault: true, protected: false }, { name: 'topic', sha: '', isDefault: false, protected: false }]);
    await expect(c.createBranch('team/project', 'new/topic', 'source/topic')).resolves.toEqual({ name: 'new/topic', sha: 'new-hash', isDefault: false, protected: false });
    expect(call(fetch).url.pathname).toBe('/2.0/repositories/team/project/refs/branches');
    expect(call(fetch, 2).url.pathname).toBe('/2.0/repositories/team/project/refs/branches/source%2Ftopic');
    expect(JSON.parse(call(fetch, 3).init.body)).toEqual({ name: 'new/topic', target: { hash: 'source-hash' } });
  });
  it('creates tags, maps commits and preserves the repository access probe', async () => {
    const fetch = wire(json({ name: 'v1', target: { hash: 'tag-hash' } }), json({ values: [{ hash: 'commit', message: 'Message', author: { raw: 'Author' }, date: '2026-10-28T00:00:00Z' }] }), json(repo));
    const c = client();
    await expect(c.createTag('team/project', 'v1', 'commit')).resolves.toEqual({ name: 'v1', sha: 'tag-hash' });
    expect(call(fetch).url.pathname).toBe('/2.0/repositories/team/project/refs/tags');
    expect(JSON.parse(call(fetch).init.body)).toEqual({ name: 'v1', target: { hash: 'commit' } });
    await expect(c.getCommits('team/project', 'main', 7)).resolves.toEqual([{ sha: 'commit', message: 'Message', author: 'Author', date: new Date('2026-10-28T00:00:00Z') }]);
    expect(call(fetch, 1).url.searchParams.get('pagelen')).toBe('7');
    await expect(c.testWriteAccess('team/project')).resolves.toBe(true);
  });
  it('reads text/JSON files, encodes refs/paths and handles missing files', async () => {
    const fetch = wire(new Response('raw file'), json({ setting: true }), json({}, 404));
    const c = client();
    await expect(c.getFile('team/project', 'topic/name', 'dir/a #?.txt')).resolves.toEqual({ path: 'dir/a #?.txt', content: 'raw file', encoding: 'utf-8' });
    expect(call(fetch).url.pathname).toBe('/2.0/repositories/team/project/src/topic%2Fname/dir/a%20%23%3F.txt');
    await expect(c.getFile('team/project', 'main', 'config.json')).resolves.toMatchObject({ content: '{"setting":true}' });
    await expect(c.getFile('team/project', 'main', 'missing.txt')).resolves.toBeNull();
  });
  it('walks nested pulls/trees without following server-supplied next URLs', async () => {
    const root = { values: [{ type: 'commit_directory', path: 'dir' }, { type: 'commit_file', path: 'ignore.md', size: 5 }], next: 'https://foreign.invalid/steal' };
    const directory = { values: [{ type: 'commit_file', path: 'dir/a.txt', size: 4 }] };
    const fetch = wire(json(root), json(directory), new Response('file'), json(root), json(directory));
    const c = client();
    expect((await c.pullFiles({ repo: 'team/project', branch: 'main', patterns: ['dir/*.txt'] })).files).toEqual([{ path: 'dir/a.txt', content: 'file', encoding: 'utf-8' }]);
    await expect(c.getTree('team/project', 'main')).resolves.toEqual([{ path: 'dir', type: 'tree' }, { path: 'dir/a.txt', type: 'blob', size: 4 }, { path: 'ignore.md', type: 'blob', size: 5 }]);
    expect(fetch).toHaveBeenCalledTimes(5);
    for (let i = 0; i < 5; i++) call(fetch, i);
  });
  it('uploads multipart files with the actual token and returns the resulting commit', async () => {
    const fetch = wire(new Response(null, { status: 201 }), json({ values: [{ hash: 'commit', author: { raw: 'Alice' }, date: '2026-10-28T00:00:00Z' }] }));
    await expect(client().pushFiles({ repo: 'team/project', branch: 'topic', message: 'Save', files: [{ path: 'dir/a.txt', content: 'contents', encoding: 'utf-8' }] })).resolves.toEqual({ sha: 'commit', message: 'Save', author: 'Alice', date: new Date('2026-10-28T00:00:00Z') });
    const upload = call(fetch);
    expect(upload.url.pathname).toBe('/2.0/repositories/team/project/src');
    expect(upload.init.method).toBe('POST');
    expect(new Headers(upload.init.headers).has('content-type')).toBe(false);
    expect(upload.init.body.get('branch')).toBe('topic');
    expect(upload.init.body.get('message')).toBe('Save');
    expect(await upload.init.body.get('dir/a.txt').text()).toBe('contents');
    expect(call(fetch, 1).url.searchParams.get('pagelen')).toBe('1');
  });
  it.each([301, 401, 403, 429, 500])('sanitizes HTTP %s failures without retries', async (status) => {
    const fetch = wire(json({ error: `private ${token}` }, status), json({ error: `private ${token}` }, status));
    const c = client();
    await expect(c.getCurrentUser()).rejects.toMatchObject({ message: `Bitbucket request failed (HTTP ${status})`, status });
    await expect(c.validateCredentials()).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('stops after refused uploads without returning provider text or reading commits', async () => {
    const fetch = wire(new Response(`private ${token}`, { status: 403, statusText: 'private-provider-text' }));
    await expect(client().pushFiles({ repo: 'team/project', branch: 'main', message: 'Save', files: [] })).rejects.toMatchObject({ message: 'Bitbucket request failed (HTTP 403)', status: 403 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['../secret', 'dir/../secret', './secret', 'dir//secret'])('rejects traversal/empty segment %s before dispatch', async (path) => {
    const fetch = wire();
    await expect(client().getFile('team/project', 'main', path)).rejects.toThrow('Invalid Bitbucket path segment');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not merge untrusted response properties into request defaults/prototypes', async () => {
    const fetch = wire(new Response('{"username":"alice","__proto__":{"polluted":true}}', { headers: { 'content-type': 'application/json' } }), json(repo));
    const c = client();
    await c.getCurrentUser();
    await c.getRepository('team/project');
    expect(({} as any).polluted).toBeUndefined();
    expect(call(fetch, 1).init.method).toBe('GET');
    expect(call(fetch, 1).init.body).toBeUndefined();
  });
  it('transfers real HTTP bytes over owned loopback and refuses redirects', async () => {
    const seen: Array<{ path?: string; method?: string; authorization?: string; body: string }> = [];
    const server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      seen.push({ path: req.url, method: req.method, authorization: req.headers.authorization, body: Buffer.concat(chunks).toString() });
      if (req.url === '/2.0/repositories/team/redirect') res.writeHead(302, { location: '/credential-leak' }).end();
      else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(
        req.url === '/2.0/user' ? { username: 'alice' }
          : req.url?.startsWith('/2.0/repositories/team/project/commits') ? { values: [{ hash: 'commit', date: '2026-10-28T00:00:00Z' }] }
            : repo,
      ));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loopback port');
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://api.bitbucket.org');
      return realFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
    });
    try {
      const c = client();
      await c.createRepository({ organization: 'team', name: 'project', description: 'Real bytes' });
      expect((await c.pushFiles({ repo: 'team/project', branch: 'topic', message: 'Wire upload', files: [{ path: 'dir/a.txt', content: 'file bytes', encoding: 'utf-8' }] })).sha).toBe('commit');
      await expect(c.getRepository('team/redirect')).rejects.toThrow();
      expect(seen.map((r) => r.path)).toEqual(['/2.0/user', '/2.0/repositories/team/project', '/2.0/repositories/team/project/src', '/2.0/repositories/team/project/commits?pagelen=1', '/2.0/repositories/team/redirect']);
      expect(seen.every((r) => r.authorization === `Bearer ${token}`)).toBe(true);
      expect(JSON.parse(seen[1].body)).toEqual({ name: 'project', description: 'Real bytes', is_private: true, scm: 'git' });
      expect(seen[2].body).toContain('name="branch"\r\n\r\ntopic');
      expect(seen[2].body).toContain('filename="dir/a.txt"');
      expect(seen[2].body).toContain('file bytes');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
