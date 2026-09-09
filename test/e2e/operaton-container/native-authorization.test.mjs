import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  EngineBackstopSyncService,
} from '../../../packages/shared/dist/services/platform-admin/EngineBackstopSyncService.js';
import { getDataSource } from '../../../packages/shared/dist/db/data-source.js';
import { Engine } from '../../../packages/shared/dist/infrastructure/persistence/entities/Engine.js';
import { fetchBpmnEngineEndpoint } from '../../../packages/shared/dist/services/bpmn-engine-client.js';

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

async function startOperaton({ authorizationEnforced = false } = {}) {
  const name = `eg-operaton-native-auth-${process.pid}-${Date.now().toString(36)}`;
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

async function persistDirectEngine(baseUrl) {
  const repository = (await getDataSource()).getRepository(Engine);
  const id = 'operaton-direct-engine';
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
    name: 'Synthetic Operaton direct engine',
    baseUrl,
    type: 'operaton',
    connectionMode: 'direct',
    authType: 'basic',
    username: 'demo',
    passwordEnc: 'demo',
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
        id: `direct-run-${++nextRun}`,
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
    async getSummary(id) { return runs.get(id) || null; },
    async getDetailedSnapshot(id) { return details.get(id) || null; },
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
      const task = { id: `direct-task-${++nextTask}`, leaseId: `direct-lease-${nextTask}`, ...input };
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

function projection(groupId, processKey, decisionKey) {
  return {
    classifications: [
      {
        sourceAssignmentId: 'assignment-direct-process-1', principalType: 'group', disposition: 'proposed',
        reasonCodes: ['exact_group_read_projected'], resourceKind: 'process_definition', resourceKey: processKey,
        nativeGroupId: groupId, camundaResourceType: 6, permissions: ['READ'],
      },
      {
        sourceAssignmentId: 'assignment-direct-decision-1', principalType: 'group', disposition: 'proposed',
        reasonCodes: ['exact_group_read_projected'], resourceKind: 'decision_definition', resourceKey: decisionKey,
        nativeGroupId: groupId, camundaResourceType: 10, permissions: ['READ'],
      },
    ],
    desiredGrants: [
      { nativeGroupId: groupId, resourceKind: 'process_definition', resourceKey: processKey, camundaResourceType: 6, permissions: ['READ'], sourceAssignmentIds: ['assignment-direct-process-1'] },
      { nativeGroupId: groupId, resourceKind: 'decision_definition', resourceKey: decisionKey, camundaResourceType: 10, permissions: ['READ'], sourceAssignmentIds: ['assignment-direct-decision-1'] },
    ],
  };
}

test('managed engine policy permits real Operaton health, process, BPMN and variable requests', {
  skip: !enabled && 'set EG_RUN_OPERATON_CONTAINER_TESTS=1 to run the disposable Docker contract',
  timeout: 180_000,
}, async () => {
  const { Agent } = createRequire(new URL('../../../packages/shared/package.json', import.meta.url))('undici');
  const fixture = await startOperaton();
  const fixtureUrl = new URL(fixture.baseUrl);
  const hostname = `egme-${'a'.repeat(40)}.managed.svc.cluster.local`;
  const managedBaseUrl = `http://${hostname}:8081/engine-rest`;
  const settings = {
    EG_ENFORCE_ENGINE_ENDPOINT_POLICY: 'true', EG_ENGINE_ALLOW_PRIVATE_HOSTS: 'true',
    EG_ALLOW_INSECURE_ENGINE_HTTP: 'true', EG_MANAGED_ENGINE_INTERNAL_DNS_SUFFIX: 'managed.svc.cluster.local',
    EG_ENGINE_ALLOWED_HOSTS: '*.managed.svc.cluster.local',
  };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  let requests = 0;
  const dispatcher = new Agent({ connect(options, callback) {
    if (options.hostname !== hostname || Number(options.port) !== 8081) { callback(Error('unexpected fixture target'), null); return; }
    const socket = connect({ host: '127.0.0.1', port: Number(fixtureUrl.port) });
    socket.once('connect', () => callback(null, socket));
    socket.once('error', (error) => callback(error, null));
  } });
  async function request(path, method = 'GET', body) {
    const { response } = await fetchBpmnEngineEndpoint({ id: 'managed-fixture', baseUrl: managedBaseUrl, authType: 'none' },
      { path, method }, { dispatcher, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    requests++;
    assert.equal(response.ok, true, `managed ${method} ${path} must reach Operaton`);
    return response.status === 204 ? null : response.json();
  }
  try {
    Object.assign(process.env, settings);
    const version = await request('/version');
    assert.match(version.version, /^2\.1\./);
    await deployFixture(fixture.baseUrl, 'authorization-process.bpmn', 'eg-managed-rest-policy-fixture');
    const definitions = await request('/process-definition?key=egprocess');
    assert.equal(definitions.length, 1);
    const xml = await request(`/process-definition/${encodeURIComponent(definitions[0].id)}/xml`);
    assert.match(xml.bpmn20Xml, /bpmndi:BPMNDiagram/);
    const instance = await request('/process-definition/key/egprocess/start', 'POST', { variables: { amount: { value: 84, type: 'Integer' }, approved: { value: true, type: 'Boolean' } } });
    const instances = await request(`/history/process-instance?processInstanceId=${encodeURIComponent(instance.id)}`);
    assert.equal(instances[0].state, 'COMPLETED');
    const variables = await request(`/history/variable-instance?processInstanceId=${encodeURIComponent(instance.id)}`);
    assert.ok(variables.some((variable) => variable.name === 'amount' && variable.type === 'Integer' && variable.value === 84));
    assert.ok(variables.some((variable) => variable.name === 'approved' && variable.type === 'Boolean' && variable.value === true));
    await assert.rejects(request('/../admin'));
    assert.equal(requests, 6, 'the denied traversal must not reach outbound transport');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await dispatcher.close();
    await removeContainer(fixture.name);
  }
});

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

test('direct EnterpriseGlue backstop grants enforce exact Operaton process and decision access', {
  skip: !enabled && 'set EG_RUN_OPERATON_CONTAINER_TESTS=1 to run the disposable Docker contract',
}, async () => {
  const { name, baseUrl } = await startOperaton({ authorizationEnforced: true });
  let restoreEngine;
  try {
    const groupId = `egdirectoperators${Date.now().toString(36)}`;
    const allowedAuthorization = basicAuthorization('egdirectallowed', 'fixturepassword');
    const deniedAuthorization = basicAuthorization('egdirectdenied', 'fixturepassword');
    await adminRequest(baseUrl, '/user/create', {
      method: 'POST',
      body: {
        profile: { id: 'egdirectallowed', firstName: 'Allowed', lastName: 'Fixture', email: 'direct-allowed@example.test' },
        credentials: { password: 'fixturepassword' },
      },
    });
    await adminRequest(baseUrl, '/user/create', {
      method: 'POST',
      body: {
        profile: { id: 'egdirectdenied', firstName: 'Denied', lastName: 'Fixture', email: 'direct-denied@example.test' },
        credentials: { password: 'fixturepassword' },
      },
    });
    await adminRequest(baseUrl, '/group/create', {
      method: 'POST', body: { id: groupId, name: 'EG Direct Fixture Operators', type: 'WORKFLOW' },
    });
    await adminRequest(baseUrl, `/group/${groupId}/members/egdirectallowed`, { method: 'PUT' });
    await deployFixture(baseUrl, 'authorization-process.bpmn', 'eg-direct-authorization-process-fixture');
    await deployFixture(baseUrl, 'authorization-decision.dmn', 'eg-direct-authorization-decision-fixture');
    await adminRequest(baseUrl, '/authorization/create', {
      method: 'POST',
      body: {
        type: 1,
        permissions: ['READ'],
        userId: 'demo',
        resourceType: 4,
        resourceId: '*',
      },
    });
    restoreEngine = await persistDirectEngine(baseUrl);

    const { runService, taskService } = inMemoryRunAndTaskServices();
    const sourceHash = 'c'.repeat(64);
    const desiredHash = 'd'.repeat(64);
    const service = new EngineBackstopSyncService({
      runService,
      taskService,
      projectionBuilder: async () => ({
        engine: {
          id: 'operaton-direct-engine', type: 'operaton', baseUrl, connectionMode: 'direct', authType: 'basic',
          username: 'demo', passwordEnc: 'demo', oauthTokenUrl: null, oauthScopes: null, oauthAudience: null,
        },
        tenantId: 'tenant-direct',
        projection: projection(groupId, 'egprocess', 'egdecision'),
        sourceHash,
        desiredHash,
        capability: { nativeAuthorizationWrite: true },
      }),
    });

    const preview = await service.preview({ engineId: 'operaton-direct-engine', tenantId: 'tenant-direct' });
    assert.equal(preview.capability.customerSidecarTransport, false);
    assert.equal(preview.capability.directTrustedEndpoint, true);
    const applied = await service.apply({
      engineId: 'operaton-direct-engine', tenantId: 'tenant-direct', runId: preview.id,
      request: { desiredHash, acknowledgeDirectIdentityBoundary: true },
    });
    assert.equal(applied.run.status, 'succeeded');

    const [allowedProcess, allowedDecision, deniedProcess, deniedDecision, allowedProcessList, allowedDecisionList, deniedProcessList, deniedDecisionList, allowedDecisionEvaluation, allowedProcessStart] = await Promise.all([
      authenticatedRequest(baseUrl, '/process-definition/key/egprocess', allowedAuthorization),
      authenticatedRequest(baseUrl, '/decision-definition/key/egdecision', allowedAuthorization),
      authenticatedRequest(baseUrl, '/process-definition/key/egprocess', deniedAuthorization),
      authenticatedRequest(baseUrl, '/decision-definition/key/egdecision', deniedAuthorization),
      authenticatedRequest(baseUrl, '/process-definition?key=egprocess', allowedAuthorization),
      authenticatedRequest(baseUrl, '/decision-definition?key=egdecision', allowedAuthorization),
      authenticatedRequest(baseUrl, '/process-definition?key=egprocess', deniedAuthorization),
      authenticatedRequest(baseUrl, '/decision-definition?key=egdecision', deniedAuthorization),
      authenticatedRequest(baseUrl, '/decision-definition/key/egdecision/evaluate', allowedAuthorization, {
        method: 'POST', body: { variables: { input: { value: 'allowed', type: 'String' } } },
      }),
      authenticatedRequest(baseUrl, '/process-definition/key/egprocess/start', allowedAuthorization, { method: 'POST', body: {} }),
    ]);
    assert.equal(allowedProcess.response.status, 200);
    assert.equal(allowedDecision.response.status, 200);
    assert.equal(allowedProcess.value.key, 'egprocess');
    assert.equal(allowedDecision.value.key, 'egdecision');
    assert.equal(deniedProcess.response.status, 404);
    assert.equal(deniedDecision.response.status, 404);
    assert.deepEqual(allowedProcessList.value.map((item) => item.key), ['egprocess']);
    assert.deepEqual(allowedDecisionList.value.map((item) => item.key), ['egdecision']);
    assert.deepEqual(deniedProcessList.value, []);
    assert.deepEqual(deniedDecisionList.value, []);
    assert.notEqual(allowedDecisionEvaluation.response.status, 200, 'READ must not permit decision evaluation');
    assert.notEqual(allowedProcessStart.response.status, 200, 'READ must not permit process-instance creation');

    const rolledBack = await service.rollback({
      engineId: 'operaton-direct-engine', tenantId: 'tenant-direct', runId: applied.run.id,
      request: { acknowledgeOwnedGrantDeletion: true },
    });
    assert.equal(rolledBack.run.status, 'rolled_back');
    const [afterProcessRollback, afterDecisionRollback] = await Promise.all([
      authenticatedRequest(baseUrl, '/process-definition/key/egprocess', allowedAuthorization),
      authenticatedRequest(baseUrl, '/decision-definition/key/egdecision', allowedAuthorization),
    ]);
    assert.equal(afterProcessRollback.response.status, 404);
    assert.equal(afterDecisionRollback.response.status, 404);
  } finally {
    await restoreEngine?.();
    await removeContainer(name);
  }
});
