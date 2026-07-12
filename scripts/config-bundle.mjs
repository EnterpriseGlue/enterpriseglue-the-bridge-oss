#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const [command, file] = process.argv.slice(2);
const apiUrl = (process.env.ENTERPRISEGLUE_API_URL || '').replace(/\/$/, '');
const token = process.env.ENTERPRISEGLUE_API_TOKEN;
if (!['preview', 'apply'].includes(command) || !file || !apiUrl || !token) {
  throw new Error('Usage: ENTERPRISEGLUE_API_URL=https://host ENTERPRISEGLUE_API_TOKEN=token node scripts/config-bundle.mjs <preview|apply> <bundle.json>');
}
const payload = JSON.parse(await readFile(file, 'utf8'));
const request = async (path, body) => {
  const response = await fetch(`${apiUrl}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || result.error || `Request failed: ${response.status}`);
  return result;
};
const preview = await request('/api/authz/config-bundles/preview', payload);
console.log(JSON.stringify(preview, null, 2));
if (command === 'apply') {
  if (!preview.valid || !preview.canonicalHash) throw new Error('Bundle preview is invalid; apply was not attempted');
  console.log(JSON.stringify(await request('/api/authz/config-bundles/apply', { ...payload, expectedPreviewHash: preview.canonicalHash }), null, 2));
}
