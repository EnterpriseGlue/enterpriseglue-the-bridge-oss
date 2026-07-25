import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  CustomerSidecarBackstopNativeClient,
  EngineBackstopSyncService,
} from '../../../packages/shared/dist/services/platform-admin/EngineBackstopSyncService.js';
import { fetchBpmnEngineEndpoint } from '../../../packages/shared/dist/services/bpmn-engine-client.js';

const execFileAsync = promisify(execFile);
const image = process.env.EG_OPERATON_IMAGE
  || 'operaton/operaton@sha256:0843bc2b4cedf1d01fdc965203f8c213c3d63a810d49c43fc141608a6f9bb813';
const enabled = process.env.EG_RUN_OPERATON_SIDECAR_BACKSTOP_CONTAINER_TESTS === '1';
const sourceHash = 'a'.repeat(64);
const desiredHash = 'b'.repeat(64);

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

async function startOperaton() {
  const name = `eg-operaton-sidecar-backstop-${process.pid}-${Date.now().toString(36)}`;
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

async function startCustomerSidecar(engineBaseUrl, { rejectNativeWrites = false } = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://customer-sidecar.local');
    const allowed = /^\/engine-rest\/authorization(?:\/|$)/.test(url.pathname);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    requests.push({ method: request.method, path: `${url.pathname}${url.search}`, headers: request.headers, body: body.toString('utf8') });
    if (!allowed) {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'native authorization endpoint not allowed by customer sidecar fixture' }));
      return;
    }
    if (rejectNativeWrites && request.method === 'POST') {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'native authorization writes are denied by customer sidecar policy' }));
      return;
    }
    const upstream = await fetch(`${engineBaseUrl}${url.pathname.slice('/engine-rest'.length)}${url.search}`, {
      method: request.method,
      headers: body.length > 0 ? { 'content-type': request.headers['content-type'] || 'application/json' } : undefined,
      body: body.length > 0 ? body : undefined,
    });
    const upstreamBody = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type');
    response.writeHead(upstream.status, contentType ? { 'content-type': contentType } : undefined);
    response.end(upstreamBody);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Customer sidecar fixture did not bind a TCP port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/engine-rest`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function projection(processKey) {
  return {
    classifications: [{
      sourceAssignmentId: 'assignment-sidecar-1',
      principalType: 'group',
      disposition: 'proposed',
      reasonCodes: ['exact_group_read_projected'],
      resourceKind: 'process_definition',
      resourceKey: processKey,
      nativeGroupId: 'egsidecaroperators',
      camundaResourceType: 6,
      permissions: ['READ'],
    }],
    desiredGrants: [{
      nativeGroupId: 'egsidecaroperators',
      resourceKind: 'process_definition',
      resourceKey: processKey,
      camundaResourceType: 6,
      permissions: ['READ'],
      sourceAssignmentIds: ['assignment-sidecar-1'],
    }],
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
      details.set(run.id, { version: 1, projection: input.projection });
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
    async updateRun({ id, detailedSnapshot, ...values }) {
      const run = runs.get(id);
      if (!run) return null;
      Object.assign(run, values, { updatedAt: Date.now() });
      if (values.completed) run.completedAt = Date.now();
      if (detailedSnapshot !== undefined) details.set(id, detailedSnapshot);
      return run;
    },
  };
  const taskService = {
    async enqueue(input) {
      const task = { id: `sidecar-task-${++nextTask}`, ...input };
      tasks.push(task);
      return task;
    },
    async runNext(execute, { runId } = {}) {
      const task = tasks.find((candidate) => candidate.runId === runId);
      if (!task) return null;
      await execute(task);
      return { taskId: task.id, runId: task.runId, operation: task.operation, status: 'completed', attempts: 0, nextAttemptAt: null, lastError: null };
    },
  };
  return { runService, taskService };
}

function customerSidecarTransport(baseUrl) {
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

test('real Operaton lifecycle succeeds through the bounded customer-sidecar backstop adapter', {
  skip: !enabled && 'set EG_RUN_OPERATON_SIDECAR_BACKSTOP_CONTAINER_TESTS=1 to run the disposable Docker contract',
}, async () => {
  const { name, baseUrl: operatonBaseUrl } = await startOperaton();
  let sidecar;
  let rejectingSidecar;
  try {
    const suffix = Date.now().toString(36);
    const groupId = 'egsidecaroperators';
    const processKey = `egsidecarprocess${suffix}`;
    await postJson(operatonBaseUrl, '/group/create', { id: groupId, name: 'EG Sidecar Fixture Operators' });
    sidecar = await startCustomerSidecar(operatonBaseUrl);
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
      customerSidecarNativeClient: new CustomerSidecarBackstopNativeClient(customerSidecarTransport(sidecar.baseUrl)),
      projectionBuilder: async () => ({
        engine: { id: 'operaton-sidecar-engine', type: 'operaton', connectionMode: 'customer_sidecar', lifecycleStatus: 'active' },
        tenantId: 'tenant-sidecar',
        projection: projection(processKey),
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
    assert.equal(sidecar.requests.length, 3);
    assert.deepEqual(sidecar.requests.map((request) => request.method), ['POST', 'GET', 'DELETE']);
    assert.equal(sidecar.requests[0].path, '/engine-rest/authorization/create');
    assert.match(sidecar.requests[1].path, /^\/engine-rest\/authorization\/.+$/);
    assert.match(sidecar.requests[2].path, /^\/engine-rest\/authorization\/.+$/);
    for (const request of sidecar.requests) {
      assert.equal(request.headers.authorization, undefined, 'EnterpriseGlue must not send a downstream engine credential to the sidecar');
      assert.equal(request.headers['x-enterpriseglue-engine-id'], 'operaton-sidecar-engine');
      assert.equal(request.headers['x-enterpriseglue-operation-class'], 'engine.native_authorization.backstop');
    }

    rejectingSidecar = await startCustomerSidecar(operatonBaseUrl, { rejectNativeWrites: true });
    const rejectedDirectCalls = [];
    const rejectedServices = inMemoryRunAndTaskServices();
    const rejectedService = new EngineBackstopSyncService({
      ...rejectedServices,
      directNativeClient: {
        createAuthorization: async () => { rejectedDirectCalls.push('create'); throw new Error('direct adapter must not be used'); },
        deleteAuthorization: async () => { rejectedDirectCalls.push('delete'); throw new Error('direct adapter must not be used'); },
        readAuthorization: async () => { rejectedDirectCalls.push('read'); throw new Error('direct adapter must not be used'); },
      },
      customerSidecarNativeClient: new CustomerSidecarBackstopNativeClient(customerSidecarTransport(rejectingSidecar.baseUrl)),
      projectionBuilder: async () => ({
        engine: { id: 'operaton-sidecar-engine', type: 'operaton', connectionMode: 'customer_sidecar', lifecycleStatus: 'active' },
        tenantId: 'tenant-sidecar', projection: projection(`${processKey}-rejected`), sourceHash, desiredHash,
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
    assert.equal(rejectingSidecar.requests.length, 1);
    assert.equal(rejectingSidecar.requests[0].headers.authorization, undefined);
    assert.equal(rejectingSidecar.requests[0].headers['x-enterpriseglue-operation-class'], 'engine.native_authorization.backstop');
  } finally {
    await rejectingSidecar?.close();
    await sidecar?.close();
    await removeContainer(name);
  }
});
