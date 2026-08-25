import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const script = new URL('./enterpriseglue-distribution-lock.mjs', import.meta.url);
const digest = (character) => `sha256:${character.repeat(64)}`;
const subject = (name, character) => `registry.example/enterpriseglue/${name}@${digest(character)}`;

test('creates, verifies, and rejects tampering of a complete distribution lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eg-distribution-lock-'));
  try {
    const revision = 'a'.repeat(40);
    const toolchain = join(root, 'toolchain.json');
    const frontend = join(root, 'enterpriseglue-frontend-v0.16.0.tar.gz');
    const kit = join(root, 'enterpriseglue-deployment-kit-v0.16.0.tar.gz');
    const lock = join(root, 'enterpriseglue-distribution-lock-v0.16.0.json');
    await writeFile(frontend, 'static frontend');
    await writeFile(kit, 'deployment kit');
    await writeFile(toolchain, JSON.stringify({
      schemaVersion: 'enterpriseglue-plugin-toolchain-release/v1',
      version: '0.2.2',
      managerVersion: '0.1.2',
      sourceRevision: revision,
      installer: subject('plugin-installer', '1'),
      manager: subject('plugin-manager', '2'),
      runtimeChart: { subject: subject('runtime-chart', '3'), archiveSha256: '3'.repeat(64) },
      installerRbacChart: { subject: subject('rbac-chart', '4'), archiveSha256: '4'.repeat(64) },
      managerChart: { subject: subject('manager-chart', '5'), archiveSha256: '5'.repeat(64) },
      customerCiRequired: false,
      customerBuildRequired: false,
    }));
    execFileSync(process.execPath, [script.pathname, 'create',
      '--version', 'v0.16.0', '--source-revision', revision,
      '--toolchain-release', toolchain,
      '--backend', subject('backend', '6'), '--frontend', subject('frontend', '7'),
      '--frontend-static', frontend, '--deployment-kit', kit, '--output', lock,
    ]);
    execFileSync(process.execPath, [script.pathname, 'verify', '--lock', lock, '--root', root]);
    const value = JSON.parse(await readFile(lock, 'utf8'));
    assert.equal(value.schemaVersion, 'enterpriseglue-distribution-lock/v1');
    assert.deepEqual(value.supportedTopologies, ['compose-backend-cdn-frontend']);
    await rm(frontend);
    await symlink(kit, frontend);
    const linked = spawnSync(
      process.execPath,
      [script.pathname, 'verify', '--lock', lock, '--root', root],
      { encoding: 'utf8' },
    );
    assert.notEqual(linked.status, 0);
    assert.match(linked.stderr, /must not be a symbolic link/);
    await rm(frontend);
    await writeFile(frontend, 'tampered');
    const result = spawnSync(process.execPath, [script.pathname, 'verify', '--lock', lock, '--root', root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /differs from the signed distribution lock/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
