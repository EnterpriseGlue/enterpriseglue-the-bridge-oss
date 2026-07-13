#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const [command, argument] = process.argv.slice(2);
const apiUrl = (process.env.ENTERPRISEGLUE_API_URL || '').replace(/\/$/, '');
const token = process.env.ENTERPRISEGLUE_API_TOKEN;
const needsFile = command === 'validate' || command === 'preview' || command === 'apply';
const needsBundleKey = command === 'export';

if (!['validate', 'preview', 'apply', 'export'].includes(command) || !argument || !apiUrl || !token) {
  console.error('Usage: ENTERPRISEGLUE_API_URL=https://host ENTERPRISEGLUE_API_TOKEN=token node scripts/config-bundle.mjs <validate|preview|apply> <bundle.json>');
  console.error('   or: ENTERPRISEGLUE_API_URL=https://host ENTERPRISEGLUE_API_TOKEN=token node scripts/config-bundle.mjs export <bundle-key>');
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
      console.log(JSON.stringify(result, null, 2));
    } else if (needsFile) {
      const payload = JSON.parse(await readFile(argument, 'utf8'));
      const previewRequest = await request('/api/authz/config-bundles/preview', { method: 'POST', body: JSON.stringify(payload) });
      console.log(JSON.stringify(previewRequest.result, null, 2));
      if (!previewRequest.response.ok || !previewRequest.result.valid || !previewRequest.result.canonicalHash) {
        process.exitCode = 2;
      } else if (command === 'apply') {
        const applyRequest = await request('/api/authz/config-bundles/apply', { method: 'POST', body: JSON.stringify({ ...payload, expectedPreviewHash: previewRequest.result.canonicalHash }) });
        if (!applyRequest.response.ok) throw new Error(applyRequest.result.message || applyRequest.result.error || `Apply failed: ${applyRequest.response.status}`);
        console.log(JSON.stringify(applyRequest.result, null, 2));
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
