import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  CustomerSidecarBackstopNativeClient,
  EngineBackstopSyncService,
} from '../../../packages/shared/dist/services/platform-admin/EngineBackstopSyncService.js';
import { fetchBpmnEngineEndpoint } from '../../../packages/shared/dist/services/bpmn-engine-client.js';
import { getDataSource } from '../../../packages/shared/dist/db/data-source.js';
import { Engine } from '../../../packages/shared/dist/infrastructure/persistence/entities/Engine.js';
import { startCustomerSidecarReference } from './customer-sidecar-reference.mjs';

const execFileAsync = promisify(execFile);
const image = process.env.EG_OPERATON_IMAGE
  || 'operaton/operaton@sha256:0843bc2b4cedf1d01fdc965203f8c213c3d63a810d49c43fc141608a6f9bb813';
const enabled = process.env.EG_RUN_OPERATON_SIDECAR_BACKSTOP_CONTAINER_TESTS === '1';
const sourceHash = 'a'.repeat(64);
const desiredHash = 'b'.repeat(64);

if (enabled) {
  // The disposable emulator is intentionally loopback HTTP. Production keeps
  // policy enforcement active, so the test must make that exception explicit
  // and exact rather than disabling the endpoint boundary.
  process.env.EG_ALLOW_INSECURE_ENGINE_HTTP = 'true';
  process.env.EG_ENGINE_ALLOW_PRIVATE_HOSTS = 'true';
  process.env.EG_ENGINE_ALLOWED_HOSTS = '127.0.0.1';
}

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
    // Best-effort cleanup if Docker did not create the fixture container.
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

async function startOperaton({ authorizationEnforced = false } = {}) {
  const name = `eg-operaton-sidecar-backstop-${process.pid}-${Date.now().toString(36)}`;
  await removeContainer(name);
  const args = ['run', '--detach', '--rm', '--name', name, '--publish', '127.0.0.1::8080'];
  if (authorizationEnforced) {
    args.push(
      '--env', 'OPERATON_BPM_AUTHORIZATION_ENABLED=true',
      '--env', 'OPERATON_BPM_RUN_AUTH_ENABLED=true',
      '--env', 'OPERATON_BPM_RUN_EXAMPLE_ENABLED=false',
    );
  }
  args.push(image);
  await docker(args);
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

function basicAuthorization(userId, password) {
  return `Basic ${Buffer.from(`${userId}:${password}`).toString('base64')}`;
}

async function authenticatedRequest(baseUrl, path, authorization, { method = 'GET', body, form } = {}) {
  const headers = { authorization };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: form || (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  return { response, text, value: text ? JSON.parse(text) : null };
}

async function adminRequest(baseUrl, path, options = {}) {
  const result = await authenticatedRequest(baseUrl, path, basicAuthorization('demo', 'demo'), options);
  if (!result.response.ok) throw new Error(`Operaton admin request ${options.method || 'GET'} ${path} failed with ${result.response.status}: ${result.text.slice(0, 500)}`);
  return result.value;
}

async function deployFixture(baseUrl, filename, deploymentName) {
  const source = await readFile(new URL(`./fixtures/${filename}`, import.meta.url));
  const form = new FormData();
  form.set('deployment-name', deploymentName);
  form.set(filename, new Blob([source], { type: 'application/xml' }), filename);
  return adminRequest(baseUrl, '/deployment/create', { method: 'POST', form });
}

function projection(processKey, decisionKey) {
  return {
    classifications: [
      {
        sourceAssignmentId: 'assignment-sidecar-process-1',
        principalType: 'group',
        disposition: 'proposed',
        reasonCodes: ['exact_group_read_projected'],
        resourceKind: 'process_definition',
        resourceKey: processKey,
        nativeGroupId: 'egsidecaroperators',
        camundaResourceType: 6,
        permissions: ['READ'],
      },
      {
        sourceAssignmentId: 'assignment-sidecar-decision-1',
        principalType: 'group',
        disposition: 'proposed',
        reasonCodes: ['exact_group_read_projected'],
        resourceKind: 'decision_definition',
        resourceKey: decisionKey,
        nativeGroupId: 'egsidecaroperators',
        camundaResourceType: 10,
        permissions: ['READ'],
      },
    ],
    desiredGrants: [
      {
        nativeGroupId: 'egsidecaroperators',
        resourceKind: 'process_definition',
        resourceKey: processKey,
        camundaResourceType: 6,
        permissions: ['READ'],
        sourceAssignmentIds: ['assignment-sidecar-process-1'],
      },
      {
        nativeGroupId: 'egsidecaroperators',
        resourceKind: 'decision_definition',
        resourceKey: decisionKey,
        camundaResourceType: 10,
        permissions: ['READ'],
        sourceAssignmentIds: ['assignment-sidecar-decision-1'],
      },
    ],
  };
}

function sidecarEngine(baseUrl) {
  return {
    id: 'operaton-sidecar-engine',
    type: 'operaton',
    baseUrl,
    connectionMode: 'customer_sidecar',
    authType: 'none',
    username: null,
    passwordEnc: null,
    oauthTokenUrl: null,
    oauthScopes: null,
    oauthAudience: null,
    lifecycleStatus: 'active',
  };
}

async function persistSidecarEngine(baseUrl) {
  const repository = (await getDataSource()).getRepository(Engine);
  const id = 'operaton-sidecar-engine';
  const previous = await repository.createQueryBuilder('engine')
    .select([
      'engine.id',
      'engine.name',
      'engine.baseUrl',
      'engine.type',
      'engine.connectionMode',
      'engine.authType',
      'engine.username',
      'engine.passwordEnc',
      'engine.oauthTokenUrl',
      'engine.oauthScopes',
      'engine.oauthAudience',
      'engine.lifecycleStatus',
      'engine.createdAt',
      'engine.updatedAt',
    ])
    .where('engine.id = :id', { id })
    .getOne();
  const now = Date.now();
  const connection = {
    id,
    name: 'Synthetic Operaton customer-sidecar engine',
    baseUrl,
    type: 'operaton',
    connectionMode: 'customer_sidecar',
    authType: 'none',
    username: null,
    passwordEnc: null,
    oauthTokenUrl: null,
    oauthScopes: null,
    oauthAudience: null,
    lifecycleStatus: 'active',
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  if (previous) await repository.update({ id }, connection);
  else await repository.insert(connection);

  return async () => {
    if (previous) await repository.update({ id }, previous);
    else await repository.delete({ id });
  };
}

function inMemoryRunAndTaskServices() {
  const runs = new Map();
  const details = new Map();
  const tasks = [];
  let nextRun = 0;
  let nextTask = 0;
  const runService = {
    async createPreview(input) {
      const now = Date.now();
      const run = {
        id: `sidecar-run-${++nextRun}`,
        engineId: input.engineId,
        tenantId: input.tenantId || null,
        status: 'previewed',
        sourceHash: input.sourceHash,
        desiredHash: input.desiredHash,
        resultHash: null,
        catalogVersion: 'camunda7-operaton-mirrored-backstop-v1',
        capability: input.capability || {},
        counts: {},
        classifications: [],
        rollbackOfRunId: null,
        observedOfRunId: null,
        detailedSnapshotAvailable: true,
        detailedSnapshotExpiresAt: now + 60_000,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      runs.set(run.id, run);
      details.set(run.id, {
        version: 1,
        projection: input.projection,
        connectionCommitment: input.connectionCommitment,
      });
      return run;
    },
    async getSummary(id) {
      return runs.get(id) || null;
    },
    async getDetailedSnapshot(id) {
      return details.get(id) || null;
    },
    async listForEngine(input) {
      return [...runs.values()].filter((run) => run.engineId === input.engineId && run.tenantId === (input.tenantId || null));
    },
    async getLatestSuccessfulApply(input) {
      return [...runs.values()]
        .filter((run) => run.engineId === input.engineId
          && run.tenantId === (input.tenantId || null)
          && run.status === 'succeeded'
          && !run.rollbackOfRunId
          && !run.observedOfRunId
          && run.id !== input.excludeRunId)
        .sort((left, right) => (right.completedAt || right.updatedAt) - (left.completedAt || left.updatedAt))[0] || null;
    },
    async updateRun({ id, detailedSnapshot, ...values }) {
      const run = runs.get(id);
      if (!run) return null;
      Object.assign(run, values, { updatedAt: Date.now() });
      if (values.completed) run.completedAt = Date.now();
      if (detailedSnapshot !== undefined) details.set(id, detailedSnapshot);
      return run;
    },
    async updateRunWithTaskLease(input) {
      return this.updateRun(input);
    },
  };
  const taskService = {
    async enqueue(input) {
      const task = { id: `sidecar-task-${++nextTask}`, leaseId: `sidecar-lease-${nextTask}`, ...input };
      tasks.push(task);
      return task;
    },
    async runNext(execute, { runId } = {}) {
      const task = tasks.find((candidate) => candidate.runId === runId);
      if (!task) return null;
      await execute({ ...task, assertLease: async () => undefined });
      return { taskId: task.id, runId: task.runId, operation: task.operation, status: 'completed', attempts: 0, nextAttemptAt: null, lastError: null };
    },
  };
  return { runService, taskService };
}

function customerSidecarTransport(baseUrl, { timeoutMs } = {}) {
  async function request(method, path, body) {
    const { response } = await fetchBpmnEngineEndpoint({
      id: 'operaton-sidecar-engine',
      baseUrl,
      connectionMode: 'customer_sidecar',
      authType: 'none',
    }, {
      engineId: 'operaton-sidecar-engine',
      method,
      path,
      ...(body === undefined ? {} : { contentType: 'application/json' }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }, {
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Customer sidecar rejected ${method} ${path}: ${response.status} ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
  }
  return {
    post: (_engineId, path, body) => request('POST', path, body),
    get: (_engineId, path) => request('GET', path),
    delete: async (_engineId, path) => { await request('DELETE', path); },
  };
}

function boundedCustomerSidecarClient(baseUrl, options) {
  const client = new CustomerSidecarBackstopNativeClient(customerSidecarTransport(baseUrl, options));
  // Exercise the injectable bounded adapter used by this self-contained E2E
  // fixture. Omitting the connection-aware methods keeps the test's explicit
  // timeout and request capture in the transport while production uses the
  // same shared endpoint boundary with the persisted connection.
  return {
    createAuthorization: client.createAuthorization.bind(client),
    deleteAuthorization: client.deleteAuthorization.bind(client),
    readAuthorization: client.readAuthorization.bind(client),
    listExactAuthorizationIds: client.listExactAuthorizationIds.bind(client),
  };
}

async function startUpstreamCapture() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ method: request.method, path: request.url, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
    response.writeHead(200, { 'content-type': 'application/json' });
    if (request.method === 'GET' && request.url?.startsWith('/engine-rest/authorization?')) {
      const url = new URL(request.url, 'http://upstream.local');
      response.end(JSON.stringify([{
        id: 'native-auth-reference', type: 1,
        groupId: url.searchParams.get('groupId'),
        resourceType: Number(url.searchParams.get('resourceType')),
        resourceId: url.searchParams.get('resourceId'),
      }]));
    } else {
      response.end(JSON.stringify({ id: 'native-auth-reference' }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Upstream capture did not bind a TCP port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/engine-rest`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function startAdversarialUpstream(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Adversarial upstream did not bind a TCP port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/engine-rest`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

const validCreateBody = JSON.stringify({
  type: 1,
  permissions: ['READ'],
  groupId: 'operators',
  resourceType: 6,
  resourceId: 'payments',
});

test('customer-sidecar reference permits only the bounded native ownership contract', async () => {
  const upstream = await startUpstreamCapture();
  const sidecar = await startCustomerSidecarReference(upstream.baseUrl, { upstreamAuthorization: 'Basic customer-sidecar-upstream' });
  try {
    const rejected = await fetch(`${sidecar.baseUrl}/process-definition/key/payments`, {
      headers: { authorization: 'Bearer caller-must-not-reach-engine' },
    });
    assert.equal(rejected.status, 403);
    assert.equal(upstream.requests.length, 0);

    const accepted = await fetch(`${sidecar.baseUrl}/authorization/create`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer caller-must-not-reach-engine',
        'content-type': 'application/json',
        'x-enterpriseglue-operation-class': 'engine.native_authorization.backstop',
        'x-untrusted-header': 'must-not-reach-engine',
      },
      body: JSON.stringify({ type: 1, permissions: ['READ'], groupId: 'operators', resourceType: 6, resourceId: 'payments' }),
    });
    assert.equal(accepted.status, 200);
    assert.equal(upstream.requests.length, 1);
    assert.equal(upstream.requests[0].headers.authorization, 'Basic customer-sidecar-upstream');
    assert.equal(upstream.requests[0].headers['x-untrusted-header'], undefined);
    assert.equal(upstream.requests[0].headers['x-enterpriseglue-operation-class'], undefined);

    const exactInventory = await fetch(`${sidecar.baseUrl}/authorization?type=1&groupId=operators&resourceType=6&resourceId=payments`);
    assert.equal(exactInventory.status, 200);
    assert.deepEqual(await exactInventory.json(), [{
      id: 'native-auth-reference', type: 1, groupId: 'operators', resourceType: 6, resourceId: 'payments',
    }]);
    assert.equal(upstream.requests.length, 2);

    for (const rejectedPath of [
      '/authorization',
      '/authorization?type=1&groupId=operators&resourceType=6&resourceId=*',
      '/authorization?type=1&groupId=operators&resourceType=6&resourceId=payments&extra=true',
      '/authorization?type=1&type=1&groupId=operators&resourceType=6&resourceId=payments',
    ]) {
      const rejectedInventory = await fetch(`${sidecar.baseUrl}${rejectedPath}`);
      assert.equal(rejectedInventory.status, 403);
    }
    assert.equal(upstream.requests.length, 2);
  } finally {
    await sidecar.close();
    await upstream.close();
  }
});

test('customer-sidecar reference rejects redirects, timeouts, oversized bodies, and raw upstream errors', async () => {
  const cases = [
    {
      name: 'redirect',
      handler: (_request, response) => {
        response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        response.end();
      },
    },
    {
      name: 'oversized response',
      handler: (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(1024 * 1024 + 1) });
        response.end(JSON.stringify({ id: 'must-not-be-reflected', token: 'Bearer upstream-secret' }));
      },
    },
    {
      name: 'timeout',
      timeoutMs: 20,
      handler: async (_request, response) => {
        await sleep(75);
        if (!response.destroyed) {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ id: 'late-native-id' }));
        }
      },
    },
    {
      name: 'raw upstream error',
      handler: (_request, response) => {
        response.writeHead(500, { 'content-type': 'text/plain' });
        response.end('Bearer upstream-secret at https://private-engine.example/internal');
      },
    },
  ];

  for (const fixture of cases) {
    const upstream = await startAdversarialUpstream(fixture.handler);
    const sidecar = await startCustomerSidecarReference(upstream.baseUrl, {
      upstreamTimeoutMs: fixture.timeoutMs,
    });
    try {
      const response = await fetch(`${sidecar.baseUrl}/authorization/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: validCreateBody,
      });
      assert.equal(response.status, 502, fixture.name);
      const body = await response.text();
      assert.doesNotMatch(body, /Bearer|upstream-secret|private-engine|169\.254|late-native-id|must-not-be-reflected/i, fixture.name);
    } finally {
      await sidecar.close();
      await upstream.close();
    }
  }

  const upstream = await startUpstreamCapture();
  const sidecar = await startCustomerSidecarReference(upstream.baseUrl);
  try {
    const response = await fetch(`${sidecar.baseUrl}/authorization/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `${validCreateBody}${' '.repeat(20 * 1024)}`,
    });
    assert.equal(response.status, 413);
    assert.equal(upstream.requests.length, 0);
  } finally {
    await sidecar.close();
    await upstream.close();
  }
});

test('real Operaton lifecycle applies both supported resource types through the bounded customer-sidecar backstop adapter', {
  skip: !enabled && 'set EG_RUN_OPERATON_SIDECAR_BACKSTOP_CONTAINER_TESTS=1 to run the disposable Docker contract',
}, async () => {
  const { name, baseUrl: operatonBaseUrl } = await startOperaton();
  let sidecar;
  let rejectingSidecar;
  let malformedSidecar;
  let timedOutSidecar;
  let restoreEngine;
  try {
    const suffix = Date.now().toString(36);
    const groupId = 'egsidecaroperators';
    const processKey = `egsidecarprocess${suffix}`;
    const decisionKey = `egsidedecision${suffix}`;
    await postJson(operatonBaseUrl, '/group/create', { id: groupId, name: 'EG Sidecar Fixture Operators' });
    sidecar = await startCustomerSidecarReference(operatonBaseUrl);
    restoreEngine = await persistSidecarEngine(sidecar.baseUrl);
    const { runService, taskService } = inMemoryRunAndTaskServices();
    const directCalls = [];
    const service = new EngineBackstopSyncService({
      runService,
      taskService,
      directNativeClient: {
        createAuthorization: async () => { directCalls.push('create'); throw new Error('direct adapter must not be used'); },
        deleteAuthorization: async () => { directCalls.push('delete'); throw new Error('direct adapter must not be used'); },
        readAuthorization: async () => { directCalls.push('read'); throw new Error('direct adapter must not be used'); },
      },
      customerSidecarNativeClient: boundedCustomerSidecarClient(sidecar.baseUrl),
      projectionBuilder: async () => ({
        engine: sidecarEngine(sidecar.baseUrl),
        tenantId: 'tenant-sidecar',
        projection: projection(processKey, decisionKey),
        sourceHash,
        desiredHash,
        capability: { nativeAuthorizationWrite: true },
      }),
    });

    const preview = await service.preview({ engineId: 'operaton-sidecar-engine', tenantId: 'tenant-sidecar' });
    assert.equal(preview.capability.customerSidecarTransport, true);
    assert.equal(preview.capability.directTrustedEndpoint, false);

    const applied = await service.apply({
      engineId: 'operaton-sidecar-engine', tenantId: 'tenant-sidecar', runId: preview.id,
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    });
    assert.equal(applied.run.status, 'succeeded');

    const drift = await service.driftCheck({ engineId: 'operaton-sidecar-engine', tenantId: 'tenant-sidecar', runId: applied.run.id });
    assert.equal(drift.run.status, 'succeeded');

    const rolledBack = await service.rollback({
      engineId: 'operaton-sidecar-engine', tenantId: 'tenant-sidecar', runId: applied.run.id,
      request: { acknowledgeOwnedGrantDeletion: true },
    });
    assert.equal(rolledBack.run.status, 'rolled_back');
    assert.deepEqual(directCalls, []);
    assert.equal(sidecar.requests.length, 12);
    const createRequests = sidecar.requests.filter((request) => request.method === 'POST');
    const exactRecoveryReads = sidecar.requests.filter((request) => request.method === 'GET' && request.path.includes('?'));
    const trackedReads = sidecar.requests.filter((request) => request.method === 'GET' && !request.path.includes('?'));
    const deleteRequests = sidecar.requests.filter((request) => request.method === 'DELETE');
    assert.equal(exactRecoveryReads.length, 4);
    assert.equal(trackedReads.length, 4);
    assert.equal(deleteRequests.length, 2);
    assert.deepEqual(createRequests.map((request) => ({
      path: request.path,
      body: JSON.parse(request.body),
    })), [
      {
        path: '/engine-rest/authorization/create',
        body: { type: 1, permissions: ['READ'], groupId, resourceType: 6, resourceId: processKey },
      },
      {
        path: '/engine-rest/authorization/create',
        body: { type: 1, permissions: ['READ'], groupId, resourceType: 10, resourceId: decisionKey },
      },
    ]);
    for (const request of exactRecoveryReads) assert.match(request.path, /^\/engine-rest\/authorization\?type=1&groupId=.+$/);
    for (const request of [...trackedReads, ...deleteRequests]) assert.match(request.path, /^\/engine-rest\/authorization\/.+$/);
    for (const request of sidecar.requests) {
      assert.equal(request.headers.authorization, undefined, 'EnterpriseGlue must not send a downstream engine credential to the sidecar');
      assert.equal(request.headers['x-enterpriseglue-engine-id'], 'operaton-sidecar-engine');
      assert.equal(
        request.headers['x-enterpriseglue-operation-class'],
        request.method === 'GET' && request.path.includes('?')
          ? 'engine.read'
          : 'engine.native_authorization.backstop',
      );
    }

    rejectingSidecar = await startCustomerSidecarReference(operatonBaseUrl, { rejectNativeWrites: true });
    const rejectedDirectCalls = [];
    const rejectedServices = inMemoryRunAndTaskServices();
    const rejectedService = new EngineBackstopSyncService({
      ...rejectedServices,
      directNativeClient: {
        createAuthorization: async () => { rejectedDirectCalls.push('create'); throw new Error('direct adapter must not be used'); },
        deleteAuthorization: async () => { rejectedDirectCalls.push('delete'); throw new Error('direct adapter must not be used'); },
        readAuthorization: async () => { rejectedDirectCalls.push('read'); throw new Error('direct adapter must not be used'); },
      },
      customerSidecarNativeClient: boundedCustomerSidecarClient(rejectingSidecar.baseUrl),
      projectionBuilder: async () => ({
        engine: sidecarEngine(rejectingSidecar.baseUrl),
        tenantId: 'tenant-sidecar', projection: projection(`${processKey}-rejected`, `${decisionKey}-rejected`), sourceHash, desiredHash,
        capability: { nativeAuthorizationWrite: true },
      }),
    });
    const rejectedPreview = await rejectedService.preview({ engineId: 'operaton-sidecar-engine', tenantId: 'tenant-sidecar' });
    await assert.rejects(
      rejectedService.apply({
        engineId: 'operaton-sidecar-engine', tenantId: 'tenant-sidecar', runId: rejectedPreview.id,
        request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
      }),
      /Customer sidecar rejected POST \/authorization\/create: 403/,
    );
    assert.deepEqual(rejectedDirectCalls, []);
    assert.equal(rejectingSidecar.requests.length, 2);
    for (const request of rejectingSidecar.requests) {
      assert.equal(request.headers.authorization, undefined);
      assert.equal(
        request.headers['x-enterpriseglue-operation-class'],
        request.method === 'GET' && request.path.includes('?')
          ? 'engine.read'
          : 'engine.native_authorization.backstop',
      );
    }

    malformedSidecar = await startCustomerSidecarReference(operatonBaseUrl, { malformedAuthorizationCreateResponse: true });
    const malformedDirectCalls = [];
    const malformedServices = inMemoryRunAndTaskServices();
    const malformedService = new EngineBackstopSyncService({
      ...malformedServices,
      directNativeClient: {
        createAuthorization: async () => { malformedDirectCalls.push('create'); throw new Error('direct adapter must not be used'); },
        deleteAuthorization: async () => { malformedDirectCalls.push('delete'); throw new Error('direct adapter must not be used'); },
        readAuthorization: async () => { malformedDirectCalls.push('read'); throw new Error('direct adapter must not be used'); },
      },
      customerSidecarNativeClient: boundedCustomerSidecarClient(malformedSidecar.baseUrl),
      projectionBuilder: async () => ({
        engine: sidecarEngine(malformedSidecar.baseUrl),
        tenantId: 'tenant-sidecar', projection: projection(`${processKey}-malformed`, `${decisionKey}-malformed`), sourceHash, desiredHash,
        capability: { nativeAuthorizationWrite: true },
      }),
    });
    const malformedPreview = await malformedService.preview({ engineId: 'operaton-sidecar-engine', tenantId: 'tenant-sidecar' });
    await assert.rejects(
      malformedService.apply({
        engineId: 'operaton-sidecar-engine', tenantId: 'tenant-sidecar', runId: malformedPreview.id,
        request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
      }),
      /authorization create response did not include an authorization id/,
    );
    assert.deepEqual(malformedDirectCalls, [], 'malformed sidecar success responses must fail closed without a direct retry');
    assert.equal(malformedSidecar.requests.length, 2);
    for (const request of malformedSidecar.requests) assert.equal(request.headers.authorization, undefined);

    timedOutSidecar = await startCustomerSidecarReference(operatonBaseUrl, { responseDelayMs: 250 });
    const timeoutDirectCalls = [];
    const timeoutServices = inMemoryRunAndTaskServices();
    const timeoutService = new EngineBackstopSyncService({
      ...timeoutServices,
      directNativeClient: {
        createAuthorization: async () => { timeoutDirectCalls.push('create'); throw new Error('direct adapter must not be used'); },
        deleteAuthorization: async () => { timeoutDirectCalls.push('delete'); throw new Error('direct adapter must not be used'); },
        readAuthorization: async () => { timeoutDirectCalls.push('read'); throw new Error('direct adapter must not be used'); },
      },
      customerSidecarNativeClient: boundedCustomerSidecarClient(timedOutSidecar.baseUrl, { timeoutMs: 100 }),
      projectionBuilder: async () => ({
        engine: sidecarEngine(timedOutSidecar.baseUrl),
        tenantId: 'tenant-sidecar', projection: projection(`${processKey}-timeout`, `${decisionKey}-timeout`), sourceHash, desiredHash,
        capability: { nativeAuthorizationWrite: true },
      }),
    });
    const timeoutPreview = await timeoutService.preview({ engineId: 'operaton-sidecar-engine', tenantId: 'tenant-sidecar' });
    let timeoutError;
    try {
      await timeoutService.apply({
        engineId: 'operaton-sidecar-engine', tenantId: 'tenant-sidecar', runId: timeoutPreview.id,
        request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
      });
    } catch (error) {
      timeoutError = error;
    }
    assert.equal(timeoutError?.code, 'ENGINE_TRANSPORT_UNAVAILABLE');
    assert.equal(timeoutError?.details?.connectionMode, 'customer_sidecar');
    assert.deepEqual(timeoutDirectCalls, [], 'an unavailable sidecar must never fall back to the direct adapter');
    assert.doesNotMatch(JSON.stringify(timeoutError?.toJSON?.() || timeoutError), /engine-rest|127\.0\.0\.1/);
  } finally {
    await restoreEngine?.();
    await timedOutSidecar?.close();
    await malformedSidecar?.close();
    await rejectingSidecar?.close();
    await sidecar?.close();
    await removeContainer(name);
  }
});

test('real Operaton enforces sidecar-created grants for group members and denies non-members', {
  skip: !enabled && 'set EG_RUN_OPERATON_SIDECAR_BACKSTOP_CONTAINER_TESTS=1 to run the disposable Docker contract',
}, async () => {
  const { name, baseUrl: operatonBaseUrl } = await startOperaton({ authorizationEnforced: true });
  let sidecar;
  let badCredentialsSidecar;
  let restoreEngine;
  try {
    const groupId = 'egsidecaroperators';
    const allowedAuthorization = basicAuthorization('egallowed', 'fixturepassword');
    const deniedAuthorization = basicAuthorization('egdenied', 'fixturepassword');

    await adminRequest(operatonBaseUrl, '/user/create', {
      method: 'POST',
      body: {
        profile: { id: 'egallowed', firstName: 'Allowed', lastName: 'Fixture', email: 'allowed@example.test' },
        credentials: { password: 'fixturepassword' },
      },
    });
    await adminRequest(operatonBaseUrl, '/user/create', {
      method: 'POST',
      body: {
        profile: { id: 'egdenied', firstName: 'Denied', lastName: 'Fixture', email: 'denied@example.test' },
        credentials: { password: 'fixturepassword' },
      },
    });
    await adminRequest(operatonBaseUrl, '/group/create', {
      method: 'POST', body: { id: groupId, name: 'EG Sidecar Fixture Operators', type: 'WORKFLOW' },
    });
    await adminRequest(operatonBaseUrl, `/group/${groupId}/members/egallowed`, { method: 'PUT' });
    await deployFixture(operatonBaseUrl, 'authorization-process.bpmn', 'eg-authorization-process-fixture');
    await deployFixture(operatonBaseUrl, 'authorization-decision.dmn', 'eg-authorization-decision-fixture');

    // The customer-owned sidecar can fail independently when its peer token is
    // invalid or expired. A bearer token avoids fixture-user lockout from bad
    // basic-password attempts while still producing an engine-side 401.
    badCredentialsSidecar = await startCustomerSidecarReference(operatonBaseUrl, {
      upstreamAuthorization: 'Bearer invalid-sidecar-peer-token',
    });
    const rejectedDirectCalls = [];
    const rejectedServices = inMemoryRunAndTaskServices();
    const rejectedService = new EngineBackstopSyncService({
      ...rejectedServices,
      directNativeClient: {
        createAuthorization: async () => { rejectedDirectCalls.push('create'); throw new Error('direct adapter must not be used'); },
        deleteAuthorization: async () => { rejectedDirectCalls.push('delete'); throw new Error('direct adapter must not be used'); },
        readAuthorization: async () => { rejectedDirectCalls.push('read'); throw new Error('direct adapter must not be used'); },
      },
      customerSidecarNativeClient: boundedCustomerSidecarClient(badCredentialsSidecar.baseUrl),
      projectionBuilder: async () => ({
        engine: sidecarEngine(badCredentialsSidecar.baseUrl),
        tenantId: 'tenant-sidecar', projection: projection('egprocess', 'egdecision'), sourceHash, desiredHash,
        capability: { nativeAuthorizationWrite: true },
      }),
    });
    const rejectedPreview = await rejectedService.preview({ engineId: 'operaton-sidecar-engine', tenantId: 'tenant-sidecar' });
    await assert.rejects(
      rejectedService.apply({
        engineId: 'operaton-sidecar-engine', tenantId: 'tenant-sidecar', runId: rejectedPreview.id,
        request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
      }),
      /Customer sidecar rejected GET \/authorization\?.*: 502/,
    );
    assert.deepEqual(rejectedDirectCalls, []);
    assert.equal(badCredentialsSidecar.requests[0].headers.authorization, undefined);

    sidecar = await startCustomerSidecarReference(operatonBaseUrl, { upstreamAuthorization: basicAuthorization('demo', 'demo') });
    restoreEngine = await persistSidecarEngine(sidecar.baseUrl);
    const { runService, taskService } = inMemoryRunAndTaskServices();
    const directCalls = [];
    const service = new EngineBackstopSyncService({
      runService,
      taskService,
      directNativeClient: {
        createAuthorization: async () => { directCalls.push('create'); throw new Error('direct adapter must not be used'); },
        deleteAuthorization: async () => { directCalls.push('delete'); throw new Error('direct adapter must not be used'); },
        readAuthorization: async () => { directCalls.push('read'); throw new Error('direct adapter must not be used'); },
      },
      customerSidecarNativeClient: boundedCustomerSidecarClient(sidecar.baseUrl),
      projectionBuilder: async () => ({
        engine: sidecarEngine(sidecar.baseUrl),
        tenantId: 'tenant-sidecar',
        projection: projection('egprocess', 'egdecision'),
        sourceHash,
        desiredHash,
        capability: { nativeAuthorizationWrite: true },
      }),
    });
    const preview = await service.preview({ engineId: 'operaton-sidecar-engine', tenantId: 'tenant-sidecar' });
    const applied = await service.apply({
      engineId: 'operaton-sidecar-engine', tenantId: 'tenant-sidecar', runId: preview.id,
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    });
    assert.equal(applied.run.status, 'succeeded');

    const [allowedProcess, allowedDecision, deniedProcess, deniedDecision, allowedProcessList, allowedDecisionList, deniedProcessList, deniedDecisionList, allowedDecisionEvaluation, deniedDecisionEvaluation, allowedProcessStart] = await Promise.all([
      authenticatedRequest(operatonBaseUrl, '/process-definition/key/egprocess', allowedAuthorization),
      authenticatedRequest(operatonBaseUrl, '/decision-definition/key/egdecision', allowedAuthorization),
      authenticatedRequest(operatonBaseUrl, '/process-definition/key/egprocess', deniedAuthorization),
      authenticatedRequest(operatonBaseUrl, '/decision-definition/key/egdecision', deniedAuthorization),
      authenticatedRequest(operatonBaseUrl, '/process-definition?key=egprocess', allowedAuthorization),
      authenticatedRequest(operatonBaseUrl, '/decision-definition?key=egdecision', allowedAuthorization),
      authenticatedRequest(operatonBaseUrl, '/process-definition?key=egprocess', deniedAuthorization),
      authenticatedRequest(operatonBaseUrl, '/decision-definition?key=egdecision', deniedAuthorization),
      authenticatedRequest(operatonBaseUrl, '/decision-definition/key/egdecision/evaluate', allowedAuthorization, {
        method: 'POST', body: { variables: { input: { value: 'allowed', type: 'String' } } },
      }),
      authenticatedRequest(operatonBaseUrl, '/decision-definition/key/egdecision/evaluate', deniedAuthorization, {
        method: 'POST', body: { variables: { input: { value: 'allowed', type: 'String' } } },
      }),
      authenticatedRequest(operatonBaseUrl, '/process-definition/key/egprocess/start', allowedAuthorization, { method: 'POST', body: {} }),
    ]);
    assert.equal(allowedProcess.response.status, 200);
    assert.equal(allowedDecision.response.status, 200);
    assert.equal(deniedProcess.response.status, 404);
    assert.equal(deniedDecision.response.status, 404);
    assert.equal(allowedProcess.value.key, 'egprocess');
    assert.equal(allowedDecision.value.key, 'egdecision');
    assert.equal(allowedProcessList.response.status, 200);
    assert.equal(allowedDecisionList.response.status, 200);
    assert.equal(deniedProcessList.response.status, 200);
    assert.equal(deniedDecisionList.response.status, 200);
    assert.deepEqual(allowedProcessList.value.map((item) => item.key), ['egprocess']);
    assert.deepEqual(allowedDecisionList.value.map((item) => item.key), ['egdecision']);
    assert.deepEqual(deniedProcessList.value, []);
    assert.deepEqual(deniedDecisionList.value, []);
    assert.notEqual(allowedDecisionEvaluation.response.status, 200, 'READ must not permit decision evaluation');
    assert.notEqual(deniedDecisionEvaluation.response.status, 200);
    assert.notEqual(allowedProcessStart.response.status, 200, 'READ must not permit process-instance creation');
    assert.deepEqual(sidecar.requests.map((request) => request.method), [
      'GET', 'POST', 'GET', 'GET',
      'GET', 'POST', 'GET', 'GET',
    ]);
    for (const request of sidecar.requests) {
      assert.equal(request.headers.authorization, undefined, 'EnterpriseGlue must not send a downstream engine credential to the sidecar');
      assert.equal(
        request.headers['x-enterpriseglue-operation-class'],
        request.method === 'GET' && request.path.includes('?')
          ? 'engine.read'
          : 'engine.native_authorization.backstop',
      );
    }

    const rolledBack = await service.rollback({
      engineId: 'operaton-sidecar-engine', tenantId: 'tenant-sidecar', runId: applied.run.id,
      request: { acknowledgeOwnedGrantDeletion: true },
    });
    assert.equal(rolledBack.run.status, 'rolled_back');
    const [afterProcessRollback, afterDecisionRollback] = await Promise.all([
      authenticatedRequest(operatonBaseUrl, '/process-definition/key/egprocess', allowedAuthorization),
      authenticatedRequest(operatonBaseUrl, '/decision-definition/key/egdecision', allowedAuthorization),
    ]);
    assert.equal(afterProcessRollback.response.status, 404);
    assert.equal(afterDecisionRollback.response.status, 404);
    assert.deepEqual(directCalls, []);
    assert.deepEqual(sidecar.requests.map((request) => request.method), [
      'GET', 'POST', 'GET', 'GET',
      'GET', 'POST', 'GET', 'GET',
      'DELETE', 'DELETE',
    ]);
  } finally {
    await restoreEngine?.();
    await badCredentialsSidecar?.close();
    await sidecar?.close();
    await removeContainer(name);
  }
});
