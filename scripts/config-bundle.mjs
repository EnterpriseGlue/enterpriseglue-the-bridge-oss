#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { sanitizeConfigBundleError, toSanitizedJson } from './lib/config-bundle-output.mjs';

const [command, argument] = process.argv.slice(2);
const apiUrl = (process.env.ENTERPRISEGLUE_API_URL || '').replace(/\/$/, '');
const token = process.env.ENTERPRISEGLUE_API_TOKEN;
const idempotencyKey = process.env.ENTERPRISEGLUE_CONFIG_IDEMPOTENCY_KEY;
const expectedTenantScope = process.env.ENTERPRISEGLUE_CONFIG_EXPECTED_TENANT_SCOPE;
const identityReconciliationMode = process.env.ENTERPRISEGLUE_CONFIG_IDENTITY_RECONCILIATION_MODE;
const knownSecrets = [token];
const needsFile = command === 'validate' || command === 'preview' || command === 'apply';
const needsBundleKey = command === 'export';

if (!['validate', 'preview', 'apply', 'export'].includes(command) || !argument || !apiUrl || !token || (command === 'apply' && !expectedTenantScope) || (identityReconciliationMode && !['none', 'preview', 'apply'].includes(identityReconciliationMode))) {
  console.error('Usage: ENTERPRISEGLUE_API_URL=https://host ENTERPRISEGLUE_API_TOKEN=token node scripts/config-bundle.mjs <validate|preview|apply> <bundle.json>');
  console.error('   or: ENTERPRISEGLUE_API_URL=https://host ENTERPRISEGLUE_API_TOKEN=token node scripts/config-bundle.mjs export <bundle-key>');
  console.error('   apply also requires ENTERPRISEGLUE_CONFIG_EXPECTED_TENANT_SCOPE.');
  console.error('   ENTERPRISEGLUE_CONFIG_IDENTITY_RECONCILIATION_MODE may be none, preview, or apply.');
  process.exitCode = 64;
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
    if (needsBundleKey) {
      const { response, result } = await request(`/api/authz/config-bundles/export?bundleKey=${encodeURIComponent(argument)}`);
      if (!response.ok) throw new Error(result.message || result.error || `Export failed: ${response.status}`);
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
          if (!response.ok) throw new Error(result.message || result.error || `ZIP import failed: ${response.status}`);
          return result;
        })()
        : JSON.parse(await readFile(argument, 'utf8'));
      const previewRequest = await request('/api/authz/config-bundles/preview', { method: 'POST', body: JSON.stringify(payload) });
      console.log(toSanitizedJson(previewRequest.result, knownSecrets));
      if (!previewRequest.response.ok || !previewRequest.result.valid || !previewRequest.result.canonicalHash) {
        process.exitCode = 2;
      } else if (command === 'apply') {
        const applyRequest = await request('/api/authz/config-bundles/apply', { method: 'POST', body: JSON.stringify({
          ...payload,
          expectedPreviewHash: previewRequest.result.canonicalHash,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          expectedTenantScope,
          ...(identityReconciliationMode ? { identityReconciliationMode } : {}),
        }) });
        if (!applyRequest.response.ok) throw new Error(applyRequest.result.message || applyRequest.result.error || `Apply failed: ${applyRequest.response.status}`);
        console.log(toSanitizedJson(applyRequest.result, knownSecrets));
      }
    }
  } catch (error) {
    console.error(sanitizeConfigBundleError(error, knownSecrets));
    process.exitCode = 1;
  }
}
