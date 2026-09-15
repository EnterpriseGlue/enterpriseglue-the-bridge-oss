import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = join(dirname(fileURLToPath(import.meta.url)), '..');

function git(directory, ...args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('published-package guard plans and applies working-tree changes before the first commit', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'eg-package-discipline-'));
  try {
    mkdirSync(join(fixture, 'scripts/lib'), { recursive: true });
    mkdirSync(join(fixture, 'packages/shared/src'), { recursive: true });
    mkdirSync(join(fixture, '.release-notes'), { recursive: true });
    copyFileSync(
      join(repository, 'scripts/check-published-package-version-discipline.sh'),
      join(fixture, 'scripts/check-published-package-version-discipline.sh'),
    );
    copyFileSync(
      join(repository, 'scripts/package-version-plan.mjs'),
      join(fixture, 'scripts/package-version-plan.mjs'),
    );
    copyFileSync(
      join(repository, 'scripts/lib/package-version-authority.mjs'),
      join(fixture, 'scripts/lib/package-version-authority.mjs'),
    );
    writeFileSync(join(fixture, 'scripts/package-version-authority.json'), `${JSON.stringify({
      schemaVersion: 1,
      dependencyPolicy: {
        workspaceFields: ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'],
        propagatedConsumerImpact: 'patch',
      },
      sourceChangeExcludes: ['^Dockerfile(?:\\..*)?$'],
      publicationSets: [{
        id: 'host-packages',
        workflow: '.github/workflows/host-package-release.yml',
        atomic: true,
        packages: ['@enterpriseglue/shared'],
      }],
      packages: [{
        name: '@enterpriseglue/shared',
        manifest: 'packages/shared/package.json',
        sourceRoot: 'packages/shared',
        publicationSet: 'host-packages',
        versionPolicy: 'independent',
      }],
      versionBindings: [],
      independentArtifacts: [],
    }, null, 2)}\n`);
    writeFileSync(
      join(fixture, 'packages/shared/package.json'),
      `${JSON.stringify({ name: '@enterpriseglue/shared', version: '1.0.0' }, null, 2)}\n`,
    );
    writeFileSync(join(fixture, 'packages/shared/src/index.ts'), 'export const value = 1;\n');
    git(fixture, 'init', '-q');
    git(fixture, 'config', 'user.name', 'EnterpriseGlue Test');
    git(fixture, 'config', 'user.email', 'test@enterpriseglue.invalid');
    git(fixture, 'add', '.');
    git(fixture, 'commit', '-qm', 'fixture');
    git(fixture, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

    writeFileSync(join(fixture, 'packages/shared/src/index.ts'), 'export const value = 2;\n');
    const missing = spawnSync(
      'bash',
      ['scripts/check-published-package-version-discipline.sh', 'origin/main'],
      { cwd: fixture, encoding: 'utf8' },
    );
    assert.equal(missing.status, 1);
    assert.match(`${missing.stdout}${missing.stderr}`, /publishable source changes/);

    const fragmentPath = '.release-notes/version-test.json';
    writeFileSync(join(fixture, fragmentPath), `${JSON.stringify({ packages: [] }, null, 2)}\n`);
    const applied = spawnSync(
      process.execPath,
      [
        'scripts/package-version-plan.mjs',
        'apply',
        '--base-ref',
        'origin/main',
        '--fragment',
        fragmentPath,
        '--bump',
        '@enterpriseglue/shared=patch',
      ],
      { cwd: fixture, encoding: 'utf8' },
    );
    assert.equal(applied.status, 0, `${applied.stdout}${applied.stderr}`);

    const corrected = spawnSync(
      'bash',
      ['scripts/check-published-package-version-discipline.sh', 'origin/main'],
      { cwd: fixture, encoding: 'utf8' },
    );
    assert.equal(corrected.status, 0, `${corrected.stdout}${corrected.stderr}`);
    assert.match(corrected.stderr, /1\.0\.0 -> 1\.0\.1/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
