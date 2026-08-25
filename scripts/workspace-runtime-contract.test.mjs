import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const rootUrl = new URL('../', import.meta.url);

const manifests = [
  'package.json',
  'backend/package.json',
  'frontend/package.json',
  'packages/shared/package.json',
  'packages/backend-host/package.json',
  'packages/frontend-host/package.json',
  'packages/enterprise-plugin-api/package.json',
];

async function manifest(path) {
  return JSON.parse(await readFile(new URL(path, rootUrl), 'utf8'));
}

async function sourceFiles(path) {
  const directoryUrl = new URL(`${path}/`, rootUrl);
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue;
    const relativePath = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(relativePath));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

function packageManagerVersion(packageManager) {
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(packageManager ?? '');
  assert.ok(match, 'package.json packageManager must pin an exact pnpm semantic version');
  return match[1];
}

test('pins one supported Node runtime across every published and workspace package', async () => {
  for (const path of manifests) {
    assert.equal((await manifest(path)).engines?.node, '>=24 <25', `${path} must declare the canonical Node runtime`);
  }
});

test('pins the workspace package manager and exact internal runtime dependencies', async () => {
  const root = await manifest('package.json');
  const backendHost = await manifest('packages/backend-host/package.json');
  assert.match(root.packageManager, /^pnpm@\d+\.\d+\.\d+$/);
  assert.equal(backendHost.dependencies?.['@enterpriseglue/shared'], 'workspace:*');
  assert.equal(backendHost.dependencies?.['@enterpriseglue/enterprise-plugin-api'], 'workspace:*');
});

test('uses package.json as the authority for every explicit pnpm toolchain pin', async () => {
  const root = await manifest('package.json');
  const expectedVersion = packageManagerVersion(root.packageManager);
  const paths = (await Promise.all(
    ['.github/workflows', 'backend', 'frontend', 'packages', 'scripts'].map(sourceFiles),
  )).flat();
  const mismatches = [];
  let explicitPinCount = 0;
  let actionSetupCount = 0;
  const actionSetupMarker = ['uses: pnpm', '/action-setup@'].join('');

  for (const path of paths) {
    const content = await readFile(new URL(path, rootUrl), 'utf8');

    for (const match of content.matchAll(/pnpm@(\d+\.\d+\.\d+)/g)) {
      explicitPinCount += 1;
      if (match[1] !== expectedVersion) {
        mismatches.push(`${path}: pnpm@${match[1]}`);
      }
    }

    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].includes(actionSetupMarker)) continue;
      actionSetupCount += 1;
      const setup = lines.slice(index + 1, index + 7).join('\n');
      const version = /\n\s*version:\s*['"]?(\d+\.\d+\.\d+)['"]?/.exec(`\n${setup}`)?.[1];
      if (version !== expectedVersion) {
        mismatches.push(`${path}:${index + 1}: pnpm/action-setup version ${version ?? 'missing'}`);
      }
    }
  }

  assert.ok(explicitPinCount > 0, 'expected at least one explicit pnpm toolchain pin');
  assert.ok(actionSetupCount > 0, 'expected at least one pnpm/action-setup workflow step');
  assert.deepEqual(
    mismatches,
    [],
    `all pnpm toolchain pins must match package.json (${root.packageManager})`,
  );
});

test('pins pnpm in every Dockerfile that installs workspace dependencies', async () => {
  const root = await manifest('package.json');
  const expectedPin = root.packageManager;
  const paths = (await Promise.all(
    ['backend', 'frontend', 'packages'].map(sourceFiles),
  )).flat().filter((path) => path.endsWith('Dockerfile'));
  const unpinned = [];

  for (const path of paths) {
    const content = await readFile(new URL(path, rootUrl), 'utf8');
    if (content.includes('pnpm install') && !content.includes(expectedPin)) {
      unpinned.push(path);
    }
  }

  assert.deepEqual(
    unpinned,
    [],
    `Dockerfiles that install workspace dependencies must explicitly use ${expectedPin}`,
  );
});

test('derives published plugin host identity from the immutable release tag', async () => {
  const [
    platform,
    developmentDockerfile,
    productionDockerfile,
    workflow,
    managerExampleSource,
    managerPackageSource,
    referenceBundleSource,
  ] = await Promise.all([
    readFile(new URL('packages/plugin-sdk/src/platform.ts', rootUrl), 'utf8'),
    readFile(new URL('backend/Dockerfile', rootUrl), 'utf8'),
    readFile(new URL('backend/Dockerfile.prod', rootUrl), 'utf8'),
    readFile(new URL('.github/workflows/docker-images-reusable.yml', rootUrl), 'utf8'),
    readFile(new URL('infra/docker/compose/plugin-manager.example.json', rootUrl), 'utf8'),
    readFile(new URL('packages/plugin-manager/package.json', rootUrl), 'utf8'),
    readFile(new URL('packages/plugin-reference/scripts/build-bundle.mjs', rootUrl), 'utf8'),
  ]);
  const hostVersion = /hostVersion:\s*'(\d+\.\d+\.\d+)'/.exec(platform)?.[1];
  const sdkVersion = /sdkVersion:\s*'(\d+\.\d+\.\d+)'/.exec(platform)?.[1];
  assert.ok(hostVersion, 'plugin platform release identity must contain an exact host version');
  assert.ok(sdkVersion, 'plugin platform release identity must contain an exact SDK version');
  const managerExample = JSON.parse(managerExampleSource);
  const managerPackage = JSON.parse(managerPackageSource);
  assert.equal(managerExample.host.version, hostVersion);
  assert.equal(managerExample.host.sdkVersion, sdkVersion);
  assert.equal(managerExample.capability.managerVersion, managerPackage.version);
  assert.match(
    referenceBundleSource,
    /sdk: pluginMinorCompatibilityRangeV1\(\s*pluginPlatformReleaseIdentityV1\.sdkVersion,?\s*\)/,
    'the reference plugin SDK range must derive from the canonical release identity',
  );
  assert.match(
    referenceBundleSource,
    /pluginPlatformReleaseIdentityV1\.sharedFrontend\.pluginSdk/,
    'the reference plugin shared SDK runtime must derive from the canonical release identity',
  );

  for (const [path, dockerfile] of [
    ['backend/Dockerfile', developmentDockerfile],
    ['backend/Dockerfile.prod', productionDockerfile],
  ]) {
    assert.match(
      dockerfile,
      new RegExp(`ARG ENTERPRISEGLUE_HOST_VERSION=${hostVersion.replaceAll('.', '\\.')}\\b`),
      `${path} must use the checked-in host identity for non-release builds`,
    );
    assert.match(dockerfile, /ENV ENTERPRISEGLUE_HOST_VERSION=\$\{ENTERPRISEGLUE_HOST_VERSION\}/);
  }

  assert.match(workflow, /host_version="\$\{image_tag#v\}"/);
  assert.equal(
    [...workflow.matchAll(/ENTERPRISEGLUE_HOST_VERSION=\$\{\{ steps\.meta\.outputs\.host_version \}\}/g)].length,
    2,
    'both protected backend image build attempts must inject the release host version',
  );
  assert.match(
    workflow,
    /process\.env\.ENTERPRISEGLUE_HOST_VERSION !== '\$\{\{ steps\.meta\.outputs\.host_version \}\}'/,
  );
});

test('keeps the real source backend image build in both CI implementations', async () => {
  for (const path of ['.github/workflows/ci.yml', '.github/workflows/ci-core-reusable.yml']) {
    const workflow = await readFile(new URL(path, rootUrl), 'utf8');
    assert.match(workflow, /name: Verify source backend image dependency contract/);
    assert.match(workflow, /-f backend\/Dockerfile \\\n\s+-t eg-source-backend-contract:pr/);
  }
});
