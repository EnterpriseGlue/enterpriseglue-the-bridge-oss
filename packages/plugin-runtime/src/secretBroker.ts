import type { KeyObject } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import {
  pluginSecretBrokerPolicyV1Schema,
  pluginSecretUseRequestV1Schema,
  pluginSecretUseResponseV1Schema,
  type EnterpriseGluePluginManifestV1,
  type PluginId,
  type PluginPermissionV1,
  type PluginResourceDescriptorV1,
  type PluginSecretBrokerPolicyV1,
  type PluginSecretUseResponseV1,
} from '@enterpriseglue/plugin-sdk';
import {
  verifyPluginInvocationV1,
  type PluginInvocationReplayStoreV1,
} from './gateway.js';
const SECRET_USE_PERMISSION = 'host.secret.use_reference' as const;
const DEFAULT_SECRET_ROOT =
  '/run/enterpriseglue/plugin-broker/secrets';
const POLICY_MAX_BYTES = 2 * 1024 * 1024;
const CREDENTIAL_MAX_BYTES = 16 * 1024;

export type SecretBrokerErrorCodeV1 =
  | 'request_invalid'
  | 'plugin_unavailable'
  | 'permission_denied'
  | 'reference_denied'
  | 'policy_unavailable'
  | 'policy_denied'
  | 'invocation_invalid'
  | 'invocation_replayed'
  | 'tenant_required'
  | 'deployment_mismatch'
  | 'request_too_large'
  | 'credential_unavailable'
  | 'upstream_unavailable'
  | 'upstream_response_invalid'
  | 'upstream_secret_reflection';

export class SecretBrokerErrorV1 extends Error {
  constructor(
    readonly status: number,
    readonly code: SecretBrokerErrorCodeV1,
  ) {
    super(code);
    this.name = 'SecretBrokerErrorV1';
  }
}

export interface SecretBrokerPluginRecordV1 {
  pluginId: PluginId;
  manifest: EnterpriseGluePluginManifestV1;
  resources: PluginResourceDescriptorV1;
  grantedPermissions: readonly PluginPermissionV1[];
}

export type PluginSecretBrokerFetchV1 = (
  input: URL,
  init?: Parameters<typeof fetch>[1],
) => ReturnType<typeof fetch>;

export interface ExecuteSecretUseInputV1 {
  record: SecretBrokerPluginRecordV1;
  request: unknown;
  invocationToken: string;
  invocationPublicKey: KeyObject | string | Buffer;
  expectedDeploymentRef: string;
  policy: PluginSecretBrokerPolicyV1;
  replayStore: PluginInvocationReplayStoreV1;
  secretRoot?: string;
  fetchImplementation?: PluginSecretBrokerFetchV1;
  allowInsecureLoopback?: boolean;
}

function containsPath(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

function prefixAllowed(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

async function readBoundedRegularFile(
  path: string,
  maximumBytes: number,
): Promise<string> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size > maximumBytes) {
      throw new Error('bounded_file_invalid');
    }
    return await handle.readFile({ encoding: 'utf8' });
  } finally {
    await handle.close();
  }
}

function endpointFromPolicy(
  baseUrlInput: string,
  tenantBoundPath: string,
  tenantRef: string,
  relativePath: string,
  allowInsecureLoopback: boolean,
): URL {
  const endpoint = new URL(baseUrlInput);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !['https:', 'http:'].includes(endpoint.protocol)
  ) {
    throw new SecretBrokerErrorV1(503, 'policy_unavailable');
  }
  if (
    endpoint.protocol === 'http:' &&
    !(
      allowInsecureLoopback &&
      ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname)
    )
  ) {
    throw new SecretBrokerErrorV1(503, 'policy_unavailable');
  }
  const boundPath = tenantBoundPath
    .split('/')
    .map((segment) =>
      segment === '{tenant}' ? encodeURIComponent(tenantRef) : segment,
    )
    .join('/');
  endpoint.pathname = [
    endpoint.pathname.replace(/\/+$/, ''),
    boundPath,
    relativePath,
  ]
    .filter(Boolean)
    .join('/');
  return endpoint;
}

async function credentialFromPolicy(
  credentialFile: string,
  secretRootInput: string,
): Promise<string> {
  try {
    const root = await realpath(secretRootInput);
    const target = await realpath(resolve(credentialFile));
    if (!containsPath(root, target)) {
      throw new SecretBrokerErrorV1(503, 'credential_unavailable');
    }
    const credential = (
      await readBoundedRegularFile(target, CREDENTIAL_MAX_BYTES)
    ).trim();
    if (!credential || /[\r\n]/.test(credential)) {
      throw new SecretBrokerErrorV1(503, 'credential_unavailable');
    }
    return credential;
  } catch (error) {
    if (error instanceof SecretBrokerErrorV1) throw error;
    throw new SecretBrokerErrorV1(503, 'credential_unavailable');
  }
}

async function boundedResponseBody(
  response: Awaited<ReturnType<typeof fetch>>,
  maximumBytes: number,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maximumBytes
  ) {
    throw new SecretBrokerErrorV1(502, 'upstream_response_invalid');
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maximumBytes) {
      await response.body.cancel();
      throw new SecretBrokerErrorV1(502, 'upstream_response_invalid');
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

export async function executePluginSecretUseV1(
  input: ExecuteSecretUseInputV1,
): Promise<PluginSecretUseResponseV1> {
  const parsed = pluginSecretUseRequestV1Schema.safeParse(input.request);
  if (!parsed.success) {
    throw new SecretBrokerErrorV1(400, 'request_invalid');
  }
  const request = parsed.data;
  const policyDocument = pluginSecretBrokerPolicyV1Schema.safeParse(
    input.policy,
  );
  if (!policyDocument.success) {
    throw new SecretBrokerErrorV1(503, 'policy_unavailable');
  }
  const operation = input.record.manifest.deployment.backend?.operations.find(
    (candidate) => candidate.operationId === request.operationId,
  );
  const declaredPermissions = new Set([
    ...input.record.manifest.permissions.required,
    ...input.record.manifest.permissions.optional,
  ]);
  const grantedPermissions = new Set(input.record.grantedPermissions);
  if (
    !operation ||
    !declaredPermissions.has(SECRET_USE_PERMISSION) ||
    !grantedPermissions.has(SECRET_USE_PERMISSION) ||
    !operation.requiredPermissions.includes(SECRET_USE_PERMISSION)
  ) {
    throw new SecretBrokerErrorV1(403, 'permission_denied');
  }
  const declaredReference = input.record.resources.configuration.some(
    (entry) =>
      entry.source === 'secret_reference' &&
      entry.reference === request.reference,
  );
  if (!declaredReference) {
    throw new SecretBrokerErrorV1(403, 'reference_denied');
  }
  const policy = policyDocument.data.entries.find(
    (entry) =>
      entry.pluginId === input.record.pluginId &&
      entry.reference === request.reference &&
      entry.operation === request.operation,
  );
  if (!policy) {
    throw new SecretBrokerErrorV1(403, 'policy_denied');
  }
  if (
    !policy.invocationOperations.includes(request.operationId) ||
    !policy.allowedMethods.includes(request.payload.method) ||
    !prefixAllowed(request.payload.path, policy.allowedPathPrefixes)
  ) {
    throw new SecretBrokerErrorV1(403, 'policy_denied');
  }

  let claims;
  try {
    claims = await verifyPluginInvocationV1({
      token: input.invocationToken,
      publicKey: input.invocationPublicKey,
      expectedAudience: input.record.pluginId,
      expectedOperationId: request.operationId,
      replayStore: input.replayStore,
      maximumLifetimeSeconds: 60,
    });
  } catch (error) {
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'token_replayed'
        ? 'invocation_replayed'
        : 'invocation_invalid';
    throw new SecretBrokerErrorV1(401, code);
  }
  if (!claims.grantedPermissions.includes(SECRET_USE_PERMISSION)) {
    throw new SecretBrokerErrorV1(403, 'permission_denied');
  }
  if (!claims.tenantRef) {
    throw new SecretBrokerErrorV1(403, 'tenant_required');
  }
  if (claims.deploymentRef !== input.expectedDeploymentRef) {
    throw new SecretBrokerErrorV1(403, 'deployment_mismatch');
  }

  const serializedBody =
    request.payload.body === undefined
      ? undefined
      : JSON.stringify(request.payload.body);
  if (
    serializedBody !== undefined &&
    Buffer.byteLength(serializedBody, 'utf8') > policy.maxRequestBytes
  ) {
    throw new SecretBrokerErrorV1(413, 'request_too_large');
  }

  const credential = await credentialFromPolicy(
    policy.credentialFile,
    input.secretRoot ?? DEFAULT_SECRET_ROOT,
  );
  const endpoint = endpointFromPolicy(
    policy.baseUrl,
    policy.tenantBoundPath,
    claims.tenantRef,
    request.payload.path,
    input.allowInsecureLoopback ?? false,
  );
  let upstream;
  try {
    upstream = await (input.fetchImplementation ?? fetch)(endpoint, {
      method: request.payload.method,
      redirect: 'error',
      signal: AbortSignal.timeout(policy.timeoutMs),
      // lgtm[js/file-access-to-http] Reviewed broker sink: signed tenant-bound policy restricts method and path, production requires HTTPS, redirects are rejected, requests time out, responses are bounded, and reflected credentials are rejected.
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credential}`,
        ...(serializedBody === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
        'X-Correlation-ID': claims.correlationId,
        ...(request.payload.idempotencyKey
          ? { 'Idempotency-Key': request.payload.idempotencyKey }
          : {}),
      },
      body: serializedBody,
    });
  } catch {
    throw new SecretBrokerErrorV1(502, 'upstream_unavailable');
  }

  const contentType = upstream.headers.get('content-type');
  if (
    contentType &&
    !contentType.toLowerCase().startsWith('application/json')
  ) {
    throw new SecretBrokerErrorV1(502, 'upstream_response_invalid');
  }
  const bytes = await boundedResponseBody(upstream, policy.maxResponseBytes);
  if (
    bytes.byteLength > 0 &&
    !contentType?.toLowerCase().startsWith('application/json')
  ) {
    throw new SecretBrokerErrorV1(502, 'upstream_response_invalid');
  }
  if (bytes.includes(Buffer.from(credential, 'utf8'))) {
    throw new SecretBrokerErrorV1(502, 'upstream_secret_reflection');
  }
  if (upstream.status < 200 || upstream.status >= 300) {
    return pluginSecretUseResponseV1Schema.parse({
      apiVersion: 'secret-use-result.plugin.enterpriseglue.io/v1',
      status: upstream.status,
      body: { code: 'upstream_rejected' },
    });
  }
  let body: unknown = {};
  if (bytes.byteLength > 0) {
    try {
      body = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new SecretBrokerErrorV1(502, 'upstream_response_invalid');
    }
  }
  return pluginSecretUseResponseV1Schema.parse({
    apiVersion: 'secret-use-result.plugin.enterpriseglue.io/v1',
    status: upstream.status,
    body,
  });
}

export async function loadPluginSecretBrokerPolicyV1(
  path: string,
): Promise<PluginSecretBrokerPolicyV1> {
  try {
    return pluginSecretBrokerPolicyV1Schema.parse(
      JSON.parse(await readBoundedRegularFile(path, POLICY_MAX_BYTES)),
    );
  } catch {
    throw new SecretBrokerErrorV1(503, 'policy_unavailable');
  }
}
