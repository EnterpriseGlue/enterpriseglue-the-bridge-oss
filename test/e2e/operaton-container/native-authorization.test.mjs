import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
// Pin the fixture image so the Operaton compatibility claim is reproducible.
// Override only to qualify a supported customer Operaton release deliberately.
const image = process.env.EG_OPERATON_IMAGE
  || 'operaton/operaton@sha256:0843bc2b4cedf1d01fdc965203f8c213c3d63a810d49c43fc141608a6f9bb813';
const enabled = process.env.EG_RUN_OPERATON_CONTAINER_TESTS === '1';

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function docker(args, options = {}) {
  return execFileAsync('docker', args, { encoding: 'utf8', maxBuffer: 1024 * 1024, ...options });
}

async function removeContainer(name) {
  try {
    await docker(['rm', '-f', '-v', name]);
  } catch {
    // Best-effort cleanup: creation can fail before Docker accepts the name.
  }
}

async function waitForOperaton(baseUrl) {
  let lastError = null;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/engine`);
      if (response.ok) return;
      lastError = new Error(`Operaton readiness returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1_000);
  }
  throw new Error(`Operaton did not become ready: ${lastError?.message || 'timeout'}`);
}

async function startOperaton() {
  const name = `eg-operaton-native-auth-${process.pid}-${Date.now().toString(36)}`;
  await removeContainer(name);
  await docker(['run', '--detach', '--rm', '--name', name, '--publish', '127.0.0.1::8080', image]);
  try {
    const { stdout } = await docker(['port', name, '8080/tcp']);
    const endpoint = stdout.trim().split('\n')[0];
    const port = endpoint.slice(endpoint.lastIndexOf(':') + 1);
    if (!/^\d+$/.test(port)) throw new Error('Operaton container did not publish port 8080');
    const baseUrl = `http://127.0.0.1:${port}/engine-rest`;
    await waitForOperaton(baseUrl);
    return { name, baseUrl };
  } catch (error) {
    await removeContainer(name);
    throw error;
  }
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Operaton write ${path} failed with ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  if (!response.ok) throw new Error(`Operaton read ${path} failed with ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function deleteAuthorization(baseUrl, authorizationId) {
  const response = await fetch(`${baseUrl}/authorization/${encodeURIComponent(authorizationId)}`, { method: 'DELETE' });
  const text = await response.text();
  if (!response.ok) throw new Error(`Operaton delete failed with ${response.status}: ${text.slice(0, 500)}`);
}

test('real Operaton container supports the owned group READ authorization lifecycle', {
  skip: !enabled && 'set EG_RUN_OPERATON_CONTAINER_TESTS=1 to run the disposable Docker contract',
}, async () => {
  const { name, baseUrl } = await startOperaton();
  try {
    const suffix = Date.now().toString(36);
    const groupId = `egoperatonoperators${suffix}`;
    const processKey = `egoperatonprocess${suffix}`;
    const decisionKey = `egoperatondecision${suffix}`;
    await postJson(baseUrl, '/group/create', { id: groupId, name: 'EG Operaton Fixture Operators' });
    const grants = await Promise.all([
      postJson(baseUrl, '/authorization/create', { type: 1, permissions: ['READ'], groupId, resourceType: 6, resourceId: processKey }),
      postJson(baseUrl, '/authorization/create', { type: 1, permissions: ['READ'], groupId, resourceType: 10, resourceId: decisionKey }),
    ]);
    assert.ok(grants.every((grant) => typeof grant?.id === 'string' && grant.id.length > 0));

    const byId = await Promise.all(grants.map((grant) => getJson(baseUrl, `/authorization/${encodeURIComponent(grant.id)}`)));
    assert.deepEqual(byId.map(({ type, groupId: observedGroupId, resourceType, resourceId, permissions }) => ({ type, groupId: observedGroupId, resourceType, resourceId, permissions }))
      .sort((left, right) => left.resourceType - right.resourceType), [
      { type: 1, groupId, resourceType: 6, resourceId: processKey, permissions: ['READ'] },
      { type: 1, groupId, resourceType: 10, resourceId: decisionKey, permissions: ['READ'] },
    ]);

    const page = await getJson(baseUrl, `/authorization?groupIdIn=${encodeURIComponent(groupId)}&firstResult=0&maxResults=1`);
    assert.ok(Array.isArray(page), 'Operaton authorization inventory must remain a paged collection endpoint');
    assert.ok(page.some((authorization) => authorization.id === grants[0].id || authorization.id === grants[1].id));

    await Promise.all(grants.map((grant) => deleteAuthorization(baseUrl, grant.id)));
    for (const grant of grants) {
      const response = await fetch(`${baseUrl}/authorization/${encodeURIComponent(grant.id)}`);
      assert.equal(response.status, 404, 'ownership-only rollback must be able to prove a deleted ID is absent');
    }
  } finally {
    await removeContainer(name);
  }
});
