import { cp, mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const packageDirectories = {
  '@enterpriseglue/shared': 'packages/shared',
  '@enterpriseglue/enterprise-plugin-api': 'packages/enterprise-plugin-api',
  '@enterpriseglue/backend-host': 'packages/backend-host',
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'enterpriseglue-package-smoke-'));

try {
  const packedPackages = new Map();

  for (const [packageName, directory] of Object.entries(packageDirectories)) {
    const packDirectory = path.join(temporaryRoot, packageName.replaceAll('/', '-'));
    await mkdir(packDirectory, { recursive: true });
    run('pnpm', ['--dir', directory, 'pack', '--pack-destination', packDirectory]);
    const tarball = (await readdir(packDirectory)).find((entry) => entry.endsWith('.tgz'));
    if (!tarball) throw new Error(`pnpm pack did not create a tarball for ${packageName}`);

    const extractionDirectory = path.join(packDirectory, 'extracted');
    await mkdir(extractionDirectory, { recursive: true });
    run('tar', ['-xzf', path.join(packDirectory, tarball), '-C', extractionDirectory]);
    const packageDirectory = path.join(extractionDirectory, 'package');
    const manifest = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
    const dependencyEntries = {
      ...manifest.dependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    };
    const workspaceDependencies = Object.entries(dependencyEntries)
      .filter(([, value]) => typeof value === 'string' && value.startsWith('workspace:'));
    if (workspaceDependencies.length > 0) {
      throw new Error(
        `Packed ${packageName} contains workspace dependencies: ${workspaceDependencies.map(([name]) => name).join(', ')}`,
      );
    }
    packedPackages.set(packageName, { manifest, packageDirectory });
  }

  const backend = packedPackages.get('@enterpriseglue/backend-host');
  if (!backend) throw new Error('Packed backend host was not found');

  for (const [dependencyName, dependency] of packedPackages) {
    const packedRange = backend.manifest.dependencies?.[dependencyName];
    if (dependencyName === '@enterpriseglue/backend-host') continue;
    if (packedRange !== dependency.manifest.version) {
      throw new Error(
        `Packed backend host must depend on ${dependencyName}@${dependency.manifest.version}; found ${String(packedRange)}`,
      );
    }
  }

  const smokeRoot = path.join(temporaryRoot, 'runtime');
  for (const [packageName, entry] of packedPackages) {
    await cp(entry.packageDirectory, path.join(smokeRoot, 'node_modules', ...packageName.split('/')), {
      recursive: true,
    });
  }

  run(process.execPath, [
    '--input-type=module',
    '--eval',
    "await import('@enterpriseglue/backend-host/services/loginExperienceMetrics.js'); console.log('Published backend-host runtime import passed.');",
  ], { cwd: smokeRoot });

  console.log('Published host package dependency and runtime checks passed.');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
