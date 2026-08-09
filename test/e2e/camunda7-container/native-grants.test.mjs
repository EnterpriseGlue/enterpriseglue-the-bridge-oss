import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  CamundaNativeGrantInventoryService,
  classifyCamundaNativeGrant,
} from '../../../packages/shared/dist/services/platform-admin/CamundaNativeGrantInventoryService.js';

const execFileAsync = promisify(execFile);
// Pin the fixture image so the REST compatibility claim is reproducible. A
// caller may override it to qualify a supported customer Camunda 7 release.
const image = process.env.EG_CAMUNDA7_IMAGE
  || 'camunda/camunda-bpm-platform@sha256:bcc5bb0542df5895f4f9bbd1eed31d0c4273ab25c6c5c144693b494e81411d1c';
const enabled = process.env.EG_RUN_CAMUNDA7_CONTAINER_TESTS === '1';

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function docker(args, options = {}) {
  return execFileAsync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    ...options,
  });
}

async function removeContainer(name) {
  try {
    await docker(['rm', '-f', '-v', name]);
  } catch {
    // Cleanup is deliberately best effort: a container may have failed before
    // Docker accepted its name, or may already have been removed by --rm.
  }
}

async function waitForCamunda(baseUrl) {
  let lastError = null;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/engine`);
      if (response.ok) return;
      lastError = new Error(`Camunda readiness returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1_000);
  }
  throw new Error(`Camunda 7 did not become ready: ${lastError?.message || 'timeout'}`);
}

async function startCamunda() {
  const name = `eg-camunda7-native-grants-${process.pid}-${Date.now().toString(36)}`;
  await removeContainer(name);
  await docker([
    'run', '--detach', '--rm', '--name', name,
    '--publish', '127.0.0.1::8080',
    image,
  ]);
  try {
    const { stdout } = await docker(['port', name, '8080/tcp']);
    const endpoint = stdout.trim().split('\n')[0];
    const port = endpoint.slice(endpoint.lastIndexOf(':') + 1);
    if (!/^\d+$/.test(port)) throw new Error('Camunda container did not publish port 8080');
    const baseUrl = `http://127.0.0.1:${port}/engine-rest`;
    await waitForCamunda(baseUrl);
    return { name, baseUrl };
  } catch (error) {
    await removeContainer(name);
    throw error;
  }
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Camunda fixture write ${path} failed with ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Camunda fixture read ${path} failed with ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

test('real Camunda 7 container returns exact process/decision READ grants to the read-only inventory', {
  skip: !enabled && 'set EG_RUN_CAMUNDA7_CONTAINER_TESTS=1 to run the disposable Docker contract',
}, async () => {
  const { name, baseUrl } = await startCamunda();
  try {
    // Camunda's in-memory identity provider validates resource identifiers more
    // narrowly than EnterpriseGlue keys. Keep these synthetic native values
    // alphanumeric; the target EnterpriseGlue group key remains independently
    // configurable in the migration draft.
    const suffix = Date.now().toString(36);
    const groupId = `egfixtureoperators${suffix}`;
    const processKey = `egfixtureprocess${suffix}`;
    const decisionKey = `egfixturedecision${suffix}`;
    await postJson(baseUrl, '/group/create', { id: groupId, name: 'EG Fixture Operators' });
    const processAuthorization = await postJson(baseUrl, '/authorization/create', {
      type: 1, permissions: ['READ'], groupId, resourceType: 6, resourceId: processKey,
    });
    const decisionAuthorization = await postJson(baseUrl, '/authorization/create', {
      type: 1, permissions: ['READ'], groupId, resourceType: 10, resourceId: decisionKey,
    });
    assert.match(processAuthorization?.id || '', /^.+$/);
    assert.match(decisionAuthorization?.id || '', /^.+$/);
    const processById = await getJson(baseUrl, `/authorization/${encodeURIComponent(processAuthorization.id)}`);
    const decisionById = await getJson(baseUrl, `/authorization/${encodeURIComponent(decisionAuthorization.id)}`);
    assert.deepEqual(
      [processById, decisionById].map(({ type, groupId: observedGroupId, resourceType, resourceId, permissions }) => ({ type, groupId: observedGroupId, resourceType, resourceId, permissions })),
      [
        { type: 1, groupId, resourceType: 6, resourceId: processKey, permissions: ['READ'] },
        { type: 1, groupId, resourceType: 10, resourceId: decisionKey, permissions: ['READ'] },
      ],
    );

    const observedRequests = [];
    const inventory = await new CamundaNativeGrantInventoryService(async (_engineId, page) => {
      const url = new URL(`${baseUrl}/authorization`);
      url.searchParams.set('firstResult', String(page.firstResult));
      url.searchParams.set('maxResults', String(page.maxResults));
      observedRequests.push({ method: 'GET', path: url.pathname });
      const response = await fetch(url);
      assert.equal(response.status, 200);
      return response.json();
    }).listLive('real-camunda-container', { pageSize: 13, maxRecords: 250 });

    assert.equal(inventory.truncated, false);
    assert.ok(observedRequests.length > 1, 'the container inventory must exercise pagination');
    assert.deepEqual(observedRequests, observedRequests.map(() => ({ method: 'GET', path: '/engine-rest/authorization' })));

    const seeded = inventory.authorizations
      .filter((authorization) => authorization.groupId === groupId
        && [processKey, decisionKey].includes(authorization.resourceId || ''))
      .sort((left, right) => Number(left.resourceType) - Number(right.resourceType));
    assert.equal(seeded.length, 2);
    assert.deepEqual(seeded.map(({ resourceType, permissions }) => ({ resourceType, permissions })), [
      { resourceType: 6, permissions: ['READ'] },
      { resourceType: 10, permissions: ['READ'] },
    ]);

    const runtimeResources = [
      { resourceKind: 'process_definition', resourceKey: processKey, runtimeTenantId: '', isActive: true, tenantResolutionStatus: 'resolved' },
      { resourceKind: 'decision_definition', resourceKey: decisionKey, runtimeTenantId: '', isActive: true, tenantResolutionStatus: 'resolved' },
    ];
    assert.deepEqual(seeded.map((authorization) => {
      const classified = classifyCamundaNativeGrant(authorization, { runtimeResources });
      return {
        disposition: classified.disposition,
        resourceKind: classified.resourceKind,
        mappedActionIds: classified.mappedActionIds,
      };
    }), [
      {
        disposition: 'proposed', resourceKind: 'process_definition',
        mappedActionIds: ['engine.runtime.process-definitions.read'],
      },
      {
        disposition: 'proposed', resourceKind: 'decision_definition',
        mappedActionIds: ['engine.runtime.decisions.read'],
      },
    ]);
  } finally {
    await removeContainer(name);
  }
});
