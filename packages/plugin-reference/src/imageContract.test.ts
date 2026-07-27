import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '..');

describe('reference plugin image contract', () => {
  it('uses a bounded lightweight exact health probe', async () => {
    const [dockerfile, healthcheck] = await Promise.all([
      readFile(resolve(packageRoot, 'Dockerfile'), 'utf8'),
      readFile(
        resolve(
          packageRoot,
          'scripts/plugin-healthcheck.sh',
        ),
        'utf8',
      ),
    ]);

    expect(dockerfile).toContain(
      'scripts/plugin-healthcheck.sh',
    );
    expect(dockerfile).not.toContain(
      'scripts/plugin-healthcheck.mjs',
    );
    expect(healthcheck).toContain('#!/bin/sh');
    expect(healthcheck).toContain('wget -q -T 1 -O -');
    expect(healthcheck).toContain(
      `[ "$body" = '{"status":"alive"}' ]`,
    );
    expect(healthcheck).not.toContain('node');
    expect(healthcheck).not.toContain('fetch(');
  });
});
