import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');

describe('plugin frontend host security configuration', () => {
  it('serves the SPA and same-origin plugin modules with a restrictive CSP', async () => {
    const nginx = await readFile(
      resolve(repositoryRoot, 'frontend/nginx.conf'),
      'utf8',
    );
    const policy = nginx.match(
      /add_header Content-Security-Policy "([^"]+)" always;/,
    )?.[1];

    expect(policy).toBeDefined();
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("worker-src 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain('script-src *');
    expect(policy).not.toContain('connect-src *');
    expect(nginx).toContain(
      'add_header X-Content-Type-Options "nosniff" always;',
    );
    expect(nginx).toContain('add_header X-Frame-Options "DENY" always;');
  });

  it('loads the verified same-origin module without eval-like Function construction', async () => {
    const runtime = await readFile(
      resolve(
        repositoryRoot,
        'packages/frontend-host/src/plugins/nativePluginRuntime.tsx',
      ),
      'utf8',
    );

    expect(runtime).toContain('import(/* @vite-ignore */ url)');
    expect(runtime).not.toContain('new Function(');
    expect(runtime).not.toContain('eval(');
  });
});
