#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';

function usage() {
  return `Usage:
  node scripts/provisioning-credential.mjs generate <secret-file>
  node scripts/provisioning-credential.mjs create <directory-key> <secret-file>
  node scripts/provisioning-credential.mjs rotate <directory-key> <credential-id> <secret-file>

API commands require ENTERPRISEGLUE_API_URL and ENTERPRISEGLUE_API_TOKEN.
API commands also require a stable ENTERPRISEGLUE_PROVISIONING_IDEMPOTENCY_KEY.`;
}

async function writeSecret(output, token) {
  const target = path.resolve(output);
  const handle = await open(target, 'wx', 0o600);
  try {
    await handle.writeFile(`${token}\n`, { encoding: 'utf8' });
    await handle.sync();
  } finally {
    await handle.close();
  }
  return target;
}

function generatedToken() {
  const id = randomUUID();
  return { id, token: `egscim_${id}.${randomBytes(32).toString('base64url')}` };
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function issueFromApi(command, directoryKey, credentialId) {
  const apiUrl = requiredEnvironment('ENTERPRISEGLUE_API_URL').replace(/\/+$/, '');
  const apiToken = requiredEnvironment('ENTERPRISEGLUE_API_TOKEN');
  const idempotencyKey = requiredEnvironment('ENTERPRISEGLUE_PROVISIONING_IDEMPOTENCY_KEY');
  const name = process.env.ENTERPRISEGLUE_PROVISIONING_CREDENTIAL_NAME?.trim() || 'Headless provisioning automation';
  const overlapSeconds = Number(process.env.ENTERPRISEGLUE_PROVISIONING_OVERLAP_SECONDS || '3600');
  if (!Number.isInteger(overlapSeconds) || overlapSeconds < 0 || overlapSeconds > 86_400) {
    throw new Error('ENTERPRISEGLUE_PROVISIONING_OVERLAP_SECONDS must be an integer from 0 through 86400');
  }
  const basePath = `/api/identity/provisioning-directories/${encodeURIComponent(directoryKey)}/credentials`;
  const requestPath = command === 'rotate'
    ? `${basePath}/${encodeURIComponent(credentialId)}/rotate`
    : basePath;
  const body = command === 'rotate' ? { name, overlapSeconds } : { name };
  const response = await fetch(`${apiUrl}${requestPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Credential API returned HTTP ${response.status}`);
  const result = await response.json();
  if (typeof result.token !== 'string' || !result.token.startsWith('egscim_')) {
    throw new Error('Credential API response did not contain a provisioning token');
  }
  return { ...result, idempotencyKey };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'generate' && args.length === 1) {
    const issued = generatedToken();
    const output = await writeSecret(args[0], issued.token);
    console.log(JSON.stringify({ operation: 'generate', credentialId: issued.id, output, mode: '0600' }));
    return;
  }
  if (command === 'create' && args.length === 2) {
    const issued = await issueFromApi(command, args[0]);
    const output = await writeSecret(args[1], issued.token);
    console.log(JSON.stringify({ operation: command, credentialId: issued.clientId, fingerprint: issued.credential?.fingerprint, tokenEndpointPath: issued.tokenEndpointPath, idempotencyKey: issued.idempotencyKey, output, mode: '0600' }));
    return;
  }
  if (command === 'rotate' && args.length === 3) {
    const issued = await issueFromApi(command, args[0], args[1]);
    const output = await writeSecret(args[2], issued.token);
    console.log(JSON.stringify({ operation: command, credentialId: issued.clientId, fingerprint: issued.credential?.fingerprint, tokenEndpointPath: issued.tokenEndpointPath, idempotencyKey: issued.idempotencyKey, output, mode: '0600' }));
    return;
  }
  throw new Error(usage());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Provisioning credential command failed');
  process.exitCode = 1;
});
