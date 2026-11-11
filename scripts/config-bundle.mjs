#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { sanitizeConfigBundleError, toSanitizedJson } from './lib/config-bundle-output.mjs';
import { ConfigBundleExitCode, classifyConfigBundleHttpFailure, reconciliationExitCode, reconciliationWaitState } from './lib/config-bundle-exit.mjs';

const [command, argument, summaryFlag] = process.argv.slice(2);
const helpRequested = command === '--help' || command === '-h';
const apiUrl = (process.env.ENTERPRISEGLUE_API_URL || '').replace(/\/$/, '');
const token = process.env.ENTERPRISEGLUE_API_TOKEN;
const idempotencyKey = process.env.ENTERPRISEGLUE_CONFIG_IDEMPOTENCY_KEY;
const expectedTenantScope = process.env.ENTERPRISEGLUE_CONFIG_EXPECTED_TENANT_SCOPE;
const identityReconciliationMode = process.env.ENTERPRISEGLUE_CONFIG_IDENTITY_RECONCILIATION_MODE;
const ciProvenance = (() => {
  const repository = process.env.ENTERPRISEGLUE_CONFIG_SOURCE_REPOSITORY;
  const revision = process.env.ENTERPRISEGLUE_CONFIG_SOURCE_REVISION;
  const workflowRunId = process.env.ENTERPRISEGLUE_CONFIG_SOURCE_WORKFLOW_RUN_ID;
  const workflow = process.env.ENTERPRISEGLUE_CONFIG_SOURCE_WORKFLOW;
  if (!repository && !revision && !workflowRunId && !workflow) return undefined;
  return { repository, revision, workflowRunId, ...(workflow ? { workflow } : {}) };
})();
const reconciliationTimeoutMs = Number(process.env.ENTERPRISEGLUE_CONFIG_RECONCILIATION_TIMEOUT_MS || 300_000);
const reconciliationPollMs = Number(process.env.ENTERPRISEGLUE_CONFIG_RECONCILIATION_POLL_MS || 1_000);
const maxBundleBytes = 1024 * 1024;
const knownSecrets = [token];
const needsFile = command === 'validate' || command === 'preview' || command === 'apply';
const needsBundleKey = command === 'export';
const usage = [
  'Usage: ENTERPRISEGLUE_API_URL=https://host ENTERPRISEGLUE_API_TOKEN=token node scripts/config-bundle.mjs <validate|preview|apply> <bundle.json|bundle.zip|directory> [--summary]',
  '   or: ENTERPRISEGLUE_API_URL=https://host ENTERPRISEGLUE_API_TOKEN=token node scripts/config-bundle.mjs export <bundle-key>',
  '   or: ENTERPRISEGLUE_API_URL=https://host ENTERPRISEGLUE_API_TOKEN=token node scripts/config-bundle.mjs wait <apply-run-id>',
  '   apply also requires ENTERPRISEGLUE_CONFIG_EXPECTED_TENANT_SCOPE.',
  '   Directories process top-level JSON bundles in filename order and report every result.',
  '   --summary produces the same report and waits for reconciliation for a single file.',
  '   ENTERPRISEGLUE_CONFIG_IDENTITY_RECONCILIATION_MODE may be none, preview, or apply.',
  'New bundles and exports use enterpriseglue.ai/v1beta1.',
  'enterpriseglue.ai/v1alpha1 remains accepted with explicit normalization and deprecation warnings.',
  'v1beta1 uses bundle.governance; v1alpha1 bundle.settings aliases are compatibility-only.',
  'Engine tenancy: bundle files may include ./engines.json and ./engine-tenant-mappings.json.',
  'Use explicit dedicated/shared tenancy; shared engines require resource_aware access and deny unmapped resources.',
  'Examples: docs/how-to/configure-engine-tenancy.md',
];

async function readBundleFile(filePath, encoding, directory) {
  if (directory) {
    filePath = await realpath(filePath);
    const target = relative(directory, filePath);
    if (!target || target === '..' || target.startsWith(`..${sep}`) || isAbsolute(target)) {
      throw new Error('Configuration bundle entry resolves outside its directory');
    }
  }
  const handle = directory ? await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK) : await open(filePath, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('Configuration bundle path must identify a regular file');
    if (metadata.size > maxBundleBytes) throw new Error(`Configuration bundle exceeds ${maxBundleBytes} bytes`);
    const contents = await handle.readFile();
    if (contents.byteLength > maxBundleBytes) throw new Error(`Configuration bundle exceeds ${maxBundleBytes} bytes`);
    return encoding ? contents.toString(encoding) : contents;
  } finally {
    await handle.close();
  }
}

if (helpRequested) {
  console.log(usage.join('\n'));
} else if (!['validate', 'preview', 'apply', 'export', 'wait'].includes(command) || !argument || !apiUrl || !token || (command === 'apply' && !expectedTenantScope) || (summaryFlag && (!needsFile || summaryFlag !== '--summary')) || (identityReconciliationMode && !['none', 'preview', 'apply'].includes(identityReconciliationMode)) || !Number.isFinite(reconciliationTimeoutMs) || reconciliationTimeoutMs < 1 || !Number.isFinite(reconciliationPollMs) || reconciliationPollMs < 1) {
  console.error(usage.join('\n'));
  process.exitCode = ConfigBundleExitCode.USAGE;
} else {
  const request = async (path, options = {}) => {
    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const result = await response.json().catch(() => ({}));
    return { response, result };
  };

  const print = (result) => console.log(toSanitizedJson(result, knownSecrets));
  const failure = (message, exitCode) => Object.assign(new Error(message), { exitCode });

  async function waitForReconciliation(runId, queues, requireTasks = false) {
    const deadline = Date.now() + reconciliationTimeoutMs;
    const completed = {};
    while (Date.now() < deadline) {
      for (const queue of queues) {
        if (Object.hasOwn(completed, queue)) continue;
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const { response, result } = await request(
          `/api/authz/config-bundles/runs/${encodeURIComponent(runId)}/${queue}`,
          { signal: AbortSignal.timeout(Math.min(Math.ceil(remaining), 2_147_483_647)) },
        );
        if (!response.ok) {
          throw failure(result.message || result.error || `Reconciliation status failed: ${response.status}`,
            classifyConfigBundleHttpFailure(response.status, 'reconciliation'));
        }
        if (!Array.isArray(result) || (requireTasks && !result.length)) {
          throw failure('Required reconciliation tasks are missing', ConfigBundleExitCode.RECONCILIATION);
        }
        const state = reconciliationWaitState(result);
        if (state === 'failed') {
          throw failure('Configuration reconciliation failed', ConfigBundleExitCode.RECONCILIATION);
        }
        if (state === 'completed') completed[queue] = result;
      }
      if (queues.every(queue => Object.hasOwn(completed, queue))) return completed;
      const delay = Math.min(reconciliationPollMs, deadline - Date.now());
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw failure('Timed out waiting for reconciliation continuation', ConfigBundleExitCode.RECONCILIATION);
  }

  async function processBundle(filePath, { directory, summary, key } = {}) {
    const filename = basename(filePath);
    const report = { filename, bundleKey: null, status: 'failed', issueCode: null };
    let issueCode = 'bundle_read_failed';
    try {
      const payload = filePath.toLowerCase().endsWith('.zip')
        ? await (async () => {
          const response = await fetch(`${apiUrl}/api/authz/config-bundles/import-zip`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/zip' },
            body: await readBundleFile(filePath),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw failure(result.message || result.error || `ZIP import failed: ${response.status}`,
              classifyConfigBundleHttpFailure(response.status, 'zip_import'));
          }
          return result;
        })()
        : JSON.parse(await readBundleFile(filePath, 'utf8', directory));
      const bundleKey = payload?.bundle?.metadata?.key;
      if (typeof bundleKey === 'string' && bundleKey.length >= 3 && bundleKey.length <= 160
        && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(bundleKey)) report.bundleKey = bundleKey;

      issueCode = 'validation_failed';
      const previewRequest = await request('/api/authz/config-bundles/preview', { method: 'POST', body: JSON.stringify(payload) });
      if (!summary) print(previewRequest.result);
      if (summary && command !== 'apply') report.preview = previewRequest.result;
      if (!previewRequest.response.ok || !previewRequest.result.valid || !previewRequest.result.canonicalHash) {
        return {
          report: { ...report, issueCode },
          exitCode: previewRequest.response.ok ? ConfigBundleExitCode.VALIDATION : classifyConfigBundleHttpFailure(previewRequest.response.status, 'preview'),
        };
      }
      if (command !== 'apply') return { report: { ...report, status: 'validated' }, exitCode: 0 };

      issueCode = 'apply_failed';
      const applyRequest = await request('/api/authz/config-bundles/apply', { method: 'POST', body: JSON.stringify({
        ...payload,
        expectedPreviewHash: previewRequest.result.canonicalHash,
        ...(key ? { idempotencyKey: key } : {}),
        expectedTenantScope,
        ...(identityReconciliationMode ? { identityReconciliationMode } : {}),
        ...(ciProvenance ? { ciProvenance } : {}),
      }) });
      if (!applyRequest.response.ok) {
        throw failure(applyRequest.result.message || applyRequest.result.error || `Apply failed: ${applyRequest.response.status}`,
          classifyConfigBundleHttpFailure(applyRequest.response.status, 'apply'));
      }
      if (!summary) {
        print(applyRequest.result);
        return { exitCode: reconciliationExitCode(applyRequest.result) || 0 };
      }

      const { applyRunId, reconciliation } = applyRequest.result;
      if (!applyRunId) throw failure('Configuration apply receipt is unavailable', ConfigBundleExitCode.RUNTIME);
      report.applyRunId = applyRunId;
      issueCode = 'reconciliation_failed';
      if (reconciliationExitCode(applyRequest.result) || reconciliation?.runtimeReconciliation?.status === 'failed') {
        throw failure('Configuration reconciliation failed', ConfigBundleExitCode.RECONCILIATION);
      }
      const queues = [];
      if (reconciliation?.identitySnapshot?.status === 'truncated' && reconciliation.identitySnapshot.mode !== 'preview') {
        queues.push('identity-replay-tasks');
      }
      if (reconciliation?.runtimeReconciliation?.status === 'queued') queues.push('runtime-reconciliation-tasks');
      if (queues.length) await waitForReconciliation(applyRunId, queues, true);
      return { report: { ...report, status: 'applied' }, exitCode: 0 };
    } catch (error) {
      if (!summary) throw error;
      const exitCode = error?.exitCode || (issueCode === 'reconciliation_failed' ? ConfigBundleExitCode.RECONCILIATION
        : issueCode === 'bundle_read_failed' ? ConfigBundleExitCode.VALIDATION : ConfigBundleExitCode.TRANSPORT);
      return { report: { ...report, issueCode }, exitCode };
    }
  }

  try {
    if (command === 'wait') {
      const result = await waitForReconciliation(argument, ['identity-replay-tasks']);
      print({ runId: argument, status: 'completed', tasks: result['identity-replay-tasks'] });
    } else if (needsBundleKey) {
      const { response, result } = await request(`/api/authz/config-bundles/export?bundleKey=${encodeURIComponent(argument)}`);
      if (!response.ok) { const error = new Error(result.message || result.error || `Export failed: ${response.status}`); error.exitCode = classifyConfigBundleHttpFailure(response.status); throw error; }
      print(result);
    } else if (needsFile) {
      const directory = (await stat(argument).then(metadata => metadata.isDirectory(), () => false))
        ? await realpath(argument) : undefined;
      const summary = Boolean(directory || summaryFlag);
      const files = directory
        ? (await readdir(directory, { withFileTypes: true }))
          .filter(entry => entry.name.endsWith('.json') && (entry.isFile() || entry.isSymbolicLink()))
          .map(entry => entry.name).sort().map(name => join(directory, name))
        : [argument];
      const bundles = [];
      let exitCode = files.length ? 0 : ConfigBundleExitCode.VALIDATION;
      for (const file of files) {
        const key = directory && idempotencyKey
          ? `directory:${createHash('sha256').update(JSON.stringify([idempotencyKey, basename(file)])).digest('hex')}`
          : idempotencyKey;
        const result = await processBundle(file, { directory, summary, key });
        if (summary) bundles.push(result.report);
        exitCode ||= result.exitCode;
      }
      if (summary) print({
        status: exitCode ? 'failed' : command === 'apply' ? 'applied' : 'validated',
        ...(files.length ? {} : { issueCode: 'bundle_directory_empty' }),
        bundles,
      });
      process.exitCode = exitCode;
    }
  } catch (error) {
    console.error(sanitizeConfigBundleError(error, knownSecrets));
    process.exitCode = error?.exitCode || ConfigBundleExitCode.TRANSPORT;
  }
}
