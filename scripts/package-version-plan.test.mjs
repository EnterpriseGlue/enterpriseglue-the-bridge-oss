import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  applyRepositoryPackageVersions,
  incrementSemanticVersion,
  loadPackageVersionAuthority,
  planRepositoryPackageVersions,
  publicationOrder,
  semanticVersionImpact,
  validatePackageVersionAuthority,
} from './lib/package-version-authority.mjs';
import { parsePackageVersionPlanArguments } from './package-version-plan.mjs';

const repository = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'eg-package-version-authority-'));
  for (const directory of [
    'scripts',
    'packages/a/src',
    'packages/b/src',
    'charts/b',
    '.release-notes',
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeJson(join(root, 'scripts/package-version-authority.json'), {
    schemaVersion: 1,
    dependencyPolicy: {
      workspaceFields: ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'],
      propagatedConsumerImpact: 'patch',
    },
    sourceChangeExcludes: [
      '^Dockerfile(?:\\..*)?$',
      '^(?:README(?:\\.md)?|CHANGELOG\\.md)$',
      '(?:^|/)(?:__tests__|test|tests)(?:/|$)',
      '\\.(?:test|spec)\\.[cm]?[jt]sx?$',
    ],
    publicationSets: [{
      id: 'packages',
      workflow: '.github/workflows/release.yml',
      atomic: true,
      packages: ['@eg/a', '@eg/b'],
    }],
    packages: [
      {
        name: '@eg/a',
        manifest: 'packages/a/package.json',
        sourceRoot: 'packages/a',
        publicationSet: 'packages',
        versionPolicy: 'independent',
      },
      {
        name: '@eg/b',
        manifest: 'packages/b/package.json',
        sourceRoot: 'packages/b',
        publicationSet: 'packages',
        versionPolicy: 'independent',
      },
    ],
    versionBindings: [{
      id: 'b-chart',
      source: { type: 'package', name: '@eg/b' },
      targets: [{
        path: 'charts/b/Chart.yaml',
        format: 'yaml',
        fields: ['version', 'appVersion'],
      }],
    }],
    independentArtifacts: [],
  });
  writeJson(join(root, 'packages/a/package.json'), {
    name: '@eg/a',
    version: '1.0.0',
  });
  writeJson(join(root, 'packages/b/package.json'), {
    name: '@eg/b',
    version: '2.0.0',
    dependencies: { '@eg/a': 'workspace:*' },
  });
  writeFileSync(join(root, 'packages/a/src/index.js'), 'export const value = 1;\n');
  writeFileSync(join(root, 'packages/b/src/index.js'), 'export const consumer = true;\n');
  writeFileSync(join(root, 'charts/b/Chart.yaml'), 'apiVersion: v2\nname: b\nversion: 2.0.0\nappVersion: "2.0.0"\n');
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'EnterpriseGlue Test');
  git(root, 'config', 'user.email', 'test@enterpriseglue.invalid');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return root;
}

test('semantic version helpers compute exact requested changes', () => {
  assert.equal(incrementSemanticVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(incrementSemanticVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(incrementSemanticVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(semanticVersionImpact('1.2.3', '1.2.4'), 'patch');
  assert.equal(semanticVersionImpact('1.2.3', '1.3.0'), 'minor');
  assert.equal(semanticVersionImpact('1.2.3', '2.0.0'), 'major');
});

test('repository manifest is the publication-order authority', () => {
  const authority = loadPackageVersionAuthority(repository);
  assert.deepEqual(publicationOrder(authority, 'plugin-platform-packages'), [
    '@enterpriseglue/enterprise-plugin-api',
    '@enterpriseglue/plugin-sdk',
    '@enterpriseglue/plugin-runtime',
    '@enterpriseglue/plugin-installer',
    '@enterpriseglue/plugin-manager',
  ]);
  assert.deepEqual(publicationOrder(authority, 'host-packages'), [
    '@enterpriseglue/shared',
    '@enterpriseglue/backend-host',
    '@enterpriseglue/frontend-host',
  ]);
});

test('the authority rejects two owners for the same bound version field', () => {
  const authority = structuredClone(loadPackageVersionAuthority(repository));
  authority.versionBindings[1].targets[0] = structuredClone(authority.versionBindings[0].targets[0]);
  assert.throws(
    () => validatePackageVersionAuthority(authority),
    /version target must have one authority/,
  );
});

test('unrelated repository tooling changes produce an empty passing package plan', () => {
  const plan = planRepositoryPackageVersions({ root: repository, baseRef: 'origin/main' });
  assert.equal(plan.status, 'passed', plan.violations.join('\n'));
  assert.deepEqual(plan.directPackages, []);
  assert.deepEqual(plan.packages, []);
  assert.ok(plan.bindings.length >= 6);
});

test('plan reports every transitive packed-workspace bump before CI', () => {
  const root = createFixture();
  try {
    writeFileSync(join(root, 'packages/a/src/index.js'), 'export const value = 2;\n');
    writeJson(join(root, '.release-notes/example.json'), { packages: [] });
    const plan = planRepositoryPackageVersions({ root, baseRef: 'origin/main' });
    assert.equal(plan.status, 'blocked');
    assert.deepEqual(plan.directPackages, ['@eg/a']);
    assert.deepEqual(plan.packages.map(({ name, expectedVersion }) => [name, expectedVersion]), [
      ['@eg/a', '1.0.1'],
      ['@eg/b', '2.0.1'],
    ]);
    assert.match(plan.violations.join('\n'), /@eg\/a has publishable source changes/);
    assert.match(plan.violations.join('\n'), /@eg\/b requires a release-note package entry/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release-range plans accept a continuous chain of package bumps since the stable tag', () => {
  const root = createFixture();
  try {
    writeFileSync(join(root, 'packages/a/src/index.js'), 'export const value = 3;\n');
    writeJson(join(root, 'packages/a/package.json'), { name: '@eg/a', version: '1.1.0' });
    writeJson(join(root, 'packages/b/package.json'), {
      name: '@eg/b',
      version: '2.0.2',
      dependencies: { '@eg/a': 'workspace:*' },
    });
    writeFileSync(join(root, 'charts/b/Chart.yaml'), 'apiVersion: v2\nname: b\nversion: 2.0.2\nappVersion: "2.0.2"\n');
    writeJson(join(root, '.release-notes/first.json'), {
      packages: [
        { name: '@eg/a', previousVersion: '1.0.0', newVersion: '1.0.1', impact: 'patch' },
        { name: '@eg/b', previousVersion: '2.0.0', newVersion: '2.0.1', impact: 'patch' },
      ],
    });
    writeJson(join(root, '.release-notes/second.json'), {
      packages: [
        { name: '@eg/a', previousVersion: '1.0.1', newVersion: '1.1.0', impact: 'minor' },
        { name: '@eg/b', previousVersion: '2.0.1', newVersion: '2.0.2', impact: 'patch' },
      ],
    });

    const plan = planRepositoryPackageVersions({ root, baseRef: 'origin/main' });
    assert.equal(plan.status, 'passed', plan.violations.join('\n'));
    assert.deepEqual(plan.packages.map(({ name, expectedVersion, impact }) => [name, expectedVersion, impact]), [
      ['@eg/a', '1.1.0', 'minor'],
      ['@eg/b', '2.0.2', 'patch'],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release-range plans reject disconnected package histories', () => {
  const root = createFixture();
  try {
    writeFileSync(join(root, 'packages/a/src/index.js'), 'export const value = 2;\n');
    writeJson(join(root, 'packages/a/package.json'), { name: '@eg/a', version: '1.0.1' });
    writeJson(join(root, '.release-notes/example.json'), {
      packages: [
        { name: '@eg/a', previousVersion: '0.9.0', newVersion: '1.0.1', impact: 'minor' },
      ],
    });
    const plan = planRepositoryPackageVersions({ root, baseRef: 'origin/main' });
    assert.equal(plan.status, 'blocked');
    assert.match(plan.violations.join('\n'), /continuous chain from 1\.0\.0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('apply writes selected and propagated versions, release notes, and chart bindings once', () => {
  const root = createFixture();
  try {
    writeFileSync(join(root, 'packages/a/src/index.js'), 'export const value = 2;\n');
    writeJson(join(root, '.release-notes/example.json'), { packages: [] });
    const plan = applyRepositoryPackageVersions({
      root,
      baseRef: 'origin/main',
      fragmentPath: '.release-notes/example.json',
      requestedImpacts: new Map([['@eg/a', 'minor']]),
    });
    assert.equal(plan.status, 'passed', plan.violations.join('\n'));
    assert.equal(JSON.parse(readFileSync(join(root, 'packages/a/package.json'))).version, '1.1.0');
    assert.equal(JSON.parse(readFileSync(join(root, 'packages/b/package.json'))).version, '2.0.1');
    assert.deepEqual(JSON.parse(readFileSync(join(root, '.release-notes/example.json'))).packages, [
      { name: '@eg/a', previousVersion: '1.0.0', newVersion: '1.1.0', impact: 'minor' },
      { name: '@eg/b', previousVersion: '2.0.0', newVersion: '2.0.1', impact: 'patch' },
    ]);
    const chart = readFileSync(join(root, 'charts/b/Chart.yaml'), 'utf8');
    assert.match(chart, /^version: 2\.0\.1$/m);
    assert.match(chart, /^appVersion: "2\.0\.1"$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('apply refuses to guess semantic impact for directly changed packages', () => {
  const root = createFixture();
  try {
    writeFileSync(join(root, 'packages/a/src/index.js'), 'export const value = 2;\n');
    writeJson(join(root, '.release-notes/example.json'), { packages: [] });
    assert.throws(
      () => applyRepositoryPackageVersions({
        root,
        baseRef: 'origin/main',
        fragmentPath: '.release-notes/example.json',
      }),
      /select --bump.*@eg\/a/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI requires explicit, non-duplicated package impacts', () => {
  assert.deepEqual(
    parsePackageVersionPlanArguments(['check', '--base-ref', 'v1.0.0']).baseRef,
    'v1.0.0',
  );
  const parsed = parsePackageVersionPlanArguments([
    'apply',
    '--fragment',
    '.release-notes/example.json',
    '--bump',
    '@eg/a=minor',
  ]);
  assert.equal(parsed.requestedImpacts.get('@eg/a'), 'minor');
  assert.throws(
    () => parsePackageVersionPlanArguments(['apply', '--fragment', '.release-notes/example.json']),
    /at least one --bump/,
  );
  assert.throws(
    () => parsePackageVersionPlanArguments(['apply', '--fragment', '.release-notes/example.json', '--bump', '@eg/a=patch', '--bump', '@eg/a=minor']),
    /duplicate --bump/,
  );
});
