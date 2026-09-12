import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = join(dirname(fileURLToPath(import.meta.url)), '..');

function git(directory, ...args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('published-package guard detects working-tree changes before the first commit', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'eg-package-discipline-'));
  try {
    mkdirSync(join(fixture, 'scripts'), { recursive: true });
    mkdirSync(join(fixture, 'packages/shared/src'), { recursive: true });
    copyFileSync(join(repository, 'scripts/check-published-package-version-discipline.sh'), join(fixture, 'scripts/check-published-package-version-discipline.sh'));
    copyFileSync(join(repository, 'scripts/check-workspace-dependency-version-drift.mjs'), join(fixture, 'scripts/check-workspace-dependency-version-drift.mjs'));
    writeFileSync(join(fixture, 'packages/shared/package.json'), JSON.stringify({ name: '@enterpriseglue/shared', version: '1.0.0' }, null, 2));
    writeFileSync(join(fixture, 'packages/shared/src/index.ts'), 'export const value = 1;\n');
    git(fixture, 'init', '-q');
    git(fixture, 'config', 'user.name', 'EnterpriseGlue Test');
    git(fixture, 'config', 'user.email', 'test@enterpriseglue.invalid');
    git(fixture, 'add', '.');
    git(fixture, 'commit', '-qm', 'fixture');
    git(fixture, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

    writeFileSync(join(fixture, 'packages/shared/src/index.ts'), 'export const value = 2;\n');
    const missing = spawnSync('bash', ['scripts/check-published-package-version-discipline.sh', 'origin/main'], { cwd: fixture, encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(`${missing.stdout}${missing.stderr}`, /changed without a version bump/);

    const manifest = JSON.parse(readFileSync(join(fixture, 'packages/shared/package.json'), 'utf8'));
    manifest.version = '1.0.1';
    writeFileSync(join(fixture, 'packages/shared/package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const corrected = spawnSync('bash', ['scripts/check-published-package-version-discipline.sh', 'origin/main'], { cwd: fixture, encoding: 'utf8' });
    assert.equal(corrected.status, 0, `${corrected.stdout}${corrected.stderr}`);
    assert.match(corrected.stdout, /1\.0\.0 -> 1\.0\.1/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
