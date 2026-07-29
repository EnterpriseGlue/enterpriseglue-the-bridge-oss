#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { sanitizeConfigBundleError, toSanitizedJson } from './lib/config-bundle-output.mjs';
import { ConfigBundleExitCode, classifyConfigBundleHttpFailure, reconciliationExitCode, reconciliationWaitState } from './lib/config-bundle-exit.mjs';

const [command, argument] = process.argv.slice(2);
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
const knownSecrets = [token];
const needsFile = command === 'validate' || command === 'preview' || command === 'apply';
const needsBundleKey = command === 'export';
const usage = [
  'Usage: ENTERPRISEGLUE_API_URL=https://host ENTERPRISEGLUE_API_TOKEN=token node scripts/config-bundle.mjs <validate|preview|apply> <bundle.json>',
  '   or: ENTERPRISEGLUE_API_URL=https://host ENTERPRISEGLUE_API_TOKEN=token node scripts/config-bundle.mjs export <bundle-key>',
  '   or: ENTERPRISEGLUE_API_URL=https://host ENTERPRISEGLUE_API_TOKEN=token node scripts/config-bundle.mjs wait <apply-run-id>',
  '   apply also requires ENTERPRISEGLUE_CONFIG_EXPECTED_TENANT_SCOPE.',
  '   ENTERPRISEGLUE_CONFIG_IDENTITY_RECONCILIATION_MODE may be none, preview, or apply.',
  'New bundles and exports use enterpriseglue.ai/v1beta1.',
  'enterpriseglue.ai/v1alpha1 remains accepted with explicit normalization and deprecation warnings.',
  'v1beta1 uses bundle.governance; v1alpha1 bundle.settings aliases are compatibility-only.',
  'Engine tenancy: bundle files may include ./engines.json and ./engine-tenant-mappings.json.',
  'Use explicit dedicated/shared tenancy; shared engines require resource_aware access and deny unmapped resources.',
  'Examples: docs/how-to/configure-engine-tenancy.md',
];

if (helpRequested) {
  console.log(usage.join('\n'));
} else if (!['validate', 'preview', 'apply', 'export', 'wait'].includes(command) || !argument || !apiUrl || !token || (command === 'apply' && !expectedTenantScope) || (identityReconciliationMode && !['none', 'preview', 'apply'].includes(identityReconciliationMode)) || !Number.isFinite(reconciliationTimeoutMs) || reconciliationTimeoutMs < 1 || !Number.isFinite(reconciliationPollMs) || reconciliationPollMs < 1) {
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

  try {
    if (command === 'wait') {
      const deadline = Date.now() + reconciliationTimeoutMs;
      while (true) {
        const { response, result } = await request(`/api/authz/config-bundles/runs/${encodeURIComponent(argument)}/identity-replay-tasks`);
        if (!response.ok) { const error = new Error(result.message || result.error || `Reconciliation status failed: ${response.status}`); error.exitCode = classifyConfigBundleHttpFailure(response.status, 'reconciliation'); throw error; }
        const state = reconciliationWaitState(result);
        if (state === 'completed') { console.log(toSanitizedJson({ runId: argument, status: 'completed', tasks: result }, knownSecrets)); break; }
        if (state === 'failed' || Date.now() >= deadline) { const error = new Error(state === 'failed' ? 'Reconciliation continuation was cancelled' : 'Timed out waiting for reconciliation continuation'); error.exitCode = ConfigBundleExitCode.RECONCILIATION; throw error; }
        await new Promise((resolve) => setTimeout(resolve, reconciliationPollMs));
      }
    } else if (needsBundleKey) {
      const { response, result } = await request(`/api/authz/config-bundles/export?bundleKey=${encodeURIComponent(argument)}`);
      if (!response.ok) { const error = new Error(result.message || result.error || `Export failed: ${response.status}`); error.exitCode = classifyConfigBundleHttpFailure(response.status); throw error; }
      console.log(toSanitizedJson(result, knownSecrets));
    } else if (needsFile) {
      const isZip = argument.toLowerCase().endsWith('.zip');
      const payload = isZip
        ? await (async () => {
          const response = await fetch(`${apiUrl}/api/authz/config-bundles/import-zip`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/zip' },
            body: await readFile(argument),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) { const error = new Error(result.message || result.error || `ZIP import failed: ${response.status}`, { cause: { exitCode: classifyConfigBundleHttpFailure(response.status, 'zip_import') } }); error.exitCode = classifyConfigBundleHttpFailure(response.status, 'zip_import'); throw error; }
          return result;
        })()
        : JSON.parse(await readFile(argument, 'utf8'));
      const previewRequest = await request('/api/authz/config-bundles/preview', { method: 'POST', body: JSON.stringify(payload) });
      console.log(toSanitizedJson(previewRequest.result, knownSecrets));
      if (!previewRequest.response.ok || !previewRequest.result.valid || !previewRequest.result.canonicalHash) {
        process.exitCode = previewRequest.response.ok ? ConfigBundleExitCode.VALIDATION : classifyConfigBundleHttpFailure(previewRequest.response.status, 'preview');
      } else if (command === 'apply') {
        const applyRequest = await request('/api/authz/config-bundles/apply', { method: 'POST', body: JSON.stringify({
          ...payload,
          expectedPreviewHash: previewRequest.result.canonicalHash,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          expectedTenantScope,
          ...(identityReconciliationMode ? { identityReconciliationMode } : {}),
          ...(ciProvenance ? { ciProvenance } : {}),
        }) });
        if (!applyRequest.response.ok) { const error = new Error(applyRequest.result.message || applyRequest.result.error || `Apply failed: ${applyRequest.response.status}`); error.exitCode = classifyConfigBundleHttpFailure(applyRequest.response.status, 'apply'); throw error; }
        console.log(toSanitizedJson(applyRequest.result, knownSecrets));
        process.exitCode = reconciliationExitCode(applyRequest.result) || 0;
      }
    }
  } catch (error) {
    console.error(sanitizeConfigBundleError(error, knownSecrets));
    process.exitCode = error?.exitCode || ConfigBundleExitCode.TRANSPORT;
  }
}
