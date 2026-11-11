import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const bundlePath = '/opt/compose/bundle.json';
const policyPath = '/opt/compose/policy.json';
const configApi = '/api/authz/config-bundles';
const cookies = new Map();

class RequestError extends Error {
  constructor(path, status) {
    super(`${path} returned HTTP ${status}`);
    this.status = status;
  }
}

async function request(path, { body, csrf } = {}) {
  const headers = new Headers({ origin: process.env.FRONTEND_URL });
  if (cookies.size) headers.set('cookie', [...cookies.values()].join('; '));
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (csrf) headers.set('x-xsrf-token', csrf);
  let response;
  try {
    response = await fetch(`http://backend:8787${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`Could not reach EnterpriseGlue at ${path}`);
  }
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0];
    cookies.set(pair.split('=', 1)[0], pair);
  }
  if (!response.ok) throw new RequestError(path, response.status);
  return response.json().catch(() => {
    throw new Error(`Invalid response from EnterpriseGlue at ${path}`);
  });
}

async function post(path, body) {
  const { csrfToken } = await request('/api/csrf-token');
  return request(path, { body, csrf: csrfToken });
}

async function readBundle(path, description) {
  try {
    const bytes = await readFile(path);
    if (bytes.length > 1024 * 1024) throw new Error('too large');
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`Check the ${description} mount. Expected a readable JSON file of at most 1 MiB.`);
  }
}

function addBootstrapAssignment(payload, engine, userId) {
  const assignmentsPath = './assignments.json';
  const key = 'assignment.compose-bootstrap-operator';
  const assignments = payload.files[assignmentsPath]?.assignments ?? [];
  if (!Array.isArray(assignments) || assignments.some((assignment) => assignment.key === key)) {
    throw new Error('Check the assignments file. The setup service owns assignment.compose-bootstrap-operator.');
  }
  if (!payload.bundle.imports.includes(assignmentsPath)) payload.bundle.imports.push(assignmentsPath);
  payload.files[assignmentsPath] = {
    assignments: [
      ...assignments,
      {
        key,
        principal: { type: 'user', id: userId },
        roleKey: 'system.engine.operator',
        scope: { type: 'engine', engineKey: engine.key },
      },
    ],
  };
}

async function waitForTasks(runId, queue) {
  const path = `${configApi}/runs/${encodeURIComponent(runId)}/${queue}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const tasks = await request(path);
    if (tasks.some(({ status }) => status === 'failed')) break;
    if (tasks.length && tasks.every(({ status }) => status === 'completed')) return;
    await delay(1500);
  }
  throw new Error(`Configuration ${queue} did not complete. Review the apply run in EnterpriseGlue.`);
}

async function applyBundle(payload) {
  const preflight = await post(`${configApi}/validate-secret-refs`, payload);
  if (!preflight.valid || !preflight.available || !preflight.availabilityHash) {
    throw new Error('Configuration secret preflight failed. Check the secret filenames, permissions, and references.');
  }
  const diff = await post(`${configApi}/diff`, payload);
  if (!diff.valid || !diff.canonicalHash || diff.canonicalHash !== preflight.canonicalHash) {
    throw new Error('Configuration validation failed. Review the supplied bundle.');
  }
  if (diff.changes.some(({ operation }) => ['conflict', 'archive', 'remove'].includes(operation)) || diff.requiredAcknowledgements?.length) {
    throw new Error('Configuration requires a reviewed change. Use configuration preview and apply for conflicts or removals.');
  }
  if (diff.changes.every(({ operation }) => operation === 'noop' || operation === 'skip')) return;

  const { applyRunId, reconciliation } = await post(`${configApi}/apply`, {
    ...payload,
    expectedPreviewHash: diff.canonicalHash,
    expectedSecretPreflightHash: preflight.availabilityHash,
    expectedTenantScope: 'tenant-default',
  });
  if (!applyRunId || reconciliation.identitySnapshot?.status === 'failed' || reconciliation.runtimeReconciliation?.status === 'failed') {
    throw new Error('Configuration apply or reconciliation failed. Review the apply run in EnterpriseGlue.');
  }
  if (reconciliation.identitySnapshot?.status === 'truncated') await waitForTasks(applyRunId, 'identity-replay-tasks');
  if (reconciliation.runtimeReconciliation?.status === 'queued') await waitForTasks(applyRunId, 'runtime-reconciliation-tasks');
}

async function checkOperaton(engine) {
  const engines = await request('/engines-api/engines');
  const registered = engines.find(({ externalId }) => externalId === engine.externalId);
  if (!registered || registered.type !== 'operaton' || registered.connectionMode !== engine.connectionMode) {
    throw new Error('The configured Operaton engine is missing from the administrator’s engine list.');
  }
  const path = `/mission-control-api/process-definitions?engineId=${encodeURIComponent(registered.id)}&maxResults=1`;
  const deadline = Date.now() + 90_000;
  while (true) {
    try {
      if (!Array.isArray(await request(path))) throw new Error('Invalid Operaton process-definition response.');
      return;
    } catch (error) {
      if (!(error instanceof RequestError) || error.status < 500 || Date.now() >= deadline) {
        throw new Error('EnterpriseGlue could not read Operaton. Check the engine or sidecar endpoint, TLS, credential, and REST permissions.');
      }
      await delay(2000);
    }
  }
}

async function main() {
  const payload = await readBundle(bundlePath, 'EnterpriseGlue configuration bundle');
  const policy = await readBundle(policyPath, 'peer-auth policy bundle');
  const engines = payload?.files?.['./engines.json']?.engines;
  const engine = engines?.[0];
  if (!Array.isArray(engines) || engines.length !== 1 || engine?.type !== 'operaton' || !engine.key || !engine.externalId ||
      !['direct', 'customer_sidecar'].includes(engine.connectionMode) ||
      !Array.isArray(payload.bundle?.imports) || !payload.bundle.imports.includes('./engines.json') ||
      payload.bundle.tenantKey !== 'default') {
    throw new Error('The configuration must declare one Operaton engine with a stable key and external ID in the default tenant.');
  }
  if (policy !== null && (engine.connectionMode !== 'customer_sidecar' || engine.auth?.type !== 'none')) {
    throw new Error('A separate peer-auth policy is only used with a peer-authenticated customer sidecar.');
  }

  await request('/api/auth/recovery/login', {
    body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  });
  try {
    const user = await request('/api/auth/me');
    if (user.platformRole !== 'admin' || user.email.toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase()) {
      throw new Error('The configured local recovery account must be an active platform administrator.');
    }

    if (policy !== null) await applyBundle(policy);
    addBootstrapAssignment(payload, engine, user.id);
    await applyBundle(payload);
    await checkOperaton(engine);
    console.log('EnterpriseGlue configuration applied and Operaton is reachable.');
  } finally {
    try {
      await post('/api/auth/logout', {});
    } catch {
      console.error('The setup session could not be closed explicitly.');
    }
  }
}

main().catch((error) => {
  console.error(`Operaton setup failed. ${error.message}`);
  process.exitCode = 1;
});
