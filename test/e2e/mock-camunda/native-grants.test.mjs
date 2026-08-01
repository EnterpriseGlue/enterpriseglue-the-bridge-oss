import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createMockCamundaHandler } from './server-handler.mjs';

async function withServer(run) {
  const server = http.createServer(createMockCamundaHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('synthetic Camunda authorization fixture paginates every supported and fail-closed migration disposition through GET only', async () => {
  await withServer(async (baseUrl) => {
    const first = await fetch(`${baseUrl}/engine-rest/authorization?firstResult=0&maxResults=5`);
    const second = await fetch(`${baseUrl}/engine-rest/authorization?firstResult=5&maxResults=10`);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const authorizations = [...await first.json(), ...await second.json()];
    assert.deepEqual(authorizations.map((item) => item.id), [
      'synthetic-grant-process-read', 'synthetic-grant-decision-read', 'synthetic-grant-process-broad', 'synthetic-grant-decision-broad',
      'synthetic-user-grant', 'synthetic-global-grant', 'synthetic-group-revoke', 'synthetic-task-grant',
      'synthetic-process-create', 'synthetic-missing-group', 'synthetic-missing-resource-id', 'synthetic-missing-runtime-resource',
    ]);
    assert.equal(authorizations.filter((item) => item.type === 2).length, 1);
    assert.equal(authorizations.filter((item) => item.resourceType === 7).length, 1);
    assert.equal(authorizations.filter((item) => item.resourceType === 10 && item.resourceId === '*').length, 1);
    assert.equal(authorizations.filter((item) => item.permissions.includes('CREATE')).length, 1);
    assert.equal(authorizations.filter((item) => !item.groupId && !item.userId).length, 2);
  });
});

test('synthetic Camunda deployment fixture derives stable deployment metadata from runtime definitions', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/engine-rest/deployment`);
    assert.equal(response.status, 200);
    const deployments = await response.json();
    assert.deepEqual(deployments.map((item) => item.id), [
      'mock-deployment-primary',
      'mock-deployment-sequential',
      'mock-deployment-parallel',
      'mock-deployment-loop',
    ]);
    assert.ok(deployments.every((item) => item.source === 'enterpriseglue-e2e'));
    assert.ok(deployments.every((item) => item.deploymentTime === '2026-03-01T00:00:00.000Z'));
  });
});

test('synthetic runtime fixture exposes Operaton-compatible connection metadata', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/engine-rest/version`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { version: '2.1.0', productName: 'Operaton' });
  });
});

test('synthetic Camunda process variables support an isolated modification round trip', async () => {
  await withServer(async (baseUrl) => {
    const instanceId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const before = await fetch(`${baseUrl}/engine-rest/process-instance/${instanceId}/variables`);
    assert.equal(before.status, 200);
    assert.equal((await before.json()).customerId.value, 'ACME-42');

    const update = await fetch(`${baseUrl}/engine-rest/process-instance/${instanceId}/variables`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modifications: { browserEvidence: { type: 'String', value: 'persisted-in-mock' } } }),
    });
    assert.equal(update.status, 204);

    const after = await fetch(`${baseUrl}/engine-rest/process-instance/${instanceId}/variables`);
    assert.equal(after.status, 200);
    assert.deepEqual((await after.json()).browserEvidence, { type: 'String', value: 'persisted-in-mock' });
  });
});
