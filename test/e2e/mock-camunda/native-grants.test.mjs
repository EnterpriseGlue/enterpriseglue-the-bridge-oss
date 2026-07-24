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
