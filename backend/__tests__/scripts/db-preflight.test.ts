import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const preflightScript = join(repoRoot, 'scripts', 'db-preflight.sh');
const temporaryDirectories: string[] = [];

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'enterpriseglue-db-preflight-'));
  temporaryDirectories.push(directory);

  const envFile = join(directory, 'docker.env');
  writeFileSync(envFile, [
    'DATABASE_TYPE=postgres',
    'POSTGRES_HOST=db',
    'POSTGRES_USER=postgres',
    'POSTGRES_PASSWORD=postgres',
    'POSTGRES_DATABASE=postgres',
    'POSTGRES_SCHEMA=main',
    '',
  ].join('\n'));

  const binDirectory = join(directory, 'bin');
  const npmMarker = join(directory, 'npm-invoked');
  mkdirSync(binDirectory);
  writeFileSync(join(binDirectory, 'node'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  writeFileSync(
    join(binDirectory, 'npm'),
    `#!/bin/sh\nprintf invoked > "${npmMarker}"\nexit 0\n`,
    { mode: 0o755 },
  );

  return {
    envFile,
    npmMarker,
    path: `${binDirectory}:${process.env.PATH}`,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('database preflight dependency ownership', () => {
  it('does not inspect or install host dependencies in Docker mode', () => {
    const fixture = createFixture();
    const result = spawnSync('bash', [
      preflightScript,
      '--env-file', fixture.envFile,
      '--mode', 'docker',
      '--install-drivers', 'true',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, PATH: fixture.path },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Database drivers are managed inside the Docker backend container');
    expect(existsSync(fixture.npmMarker)).toBe(false);
  });

  it('retains host dependency installation for localhost mode', () => {
    const fixture = createFixture();
    const result = spawnSync('bash', [
      preflightScript,
      '--env-file', fixture.envFile,
      '--mode', 'localhost',
      '--install-drivers', 'true',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, PATH: fixture.path },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(fixture.npmMarker)).toBe(true);
  });
});
