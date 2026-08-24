import { createHash } from 'node:crypto';

import {
  ociDigestReferenceSchema,
  pluginDeploymentModeSchema,
  pluginIdSchema,
  semVerSchema,
} from '@enterpriseglue/plugin-sdk';
import { z } from 'zod';

const desiredPluginSchema = z
  .object({
    pluginId: pluginIdSchema,
    targetVersion: semVerSchema,
    release: ociDigestReferenceSchema,
    source: z.enum(['connected_registry', 'offline_delivery', 'static_catalog']),
    deploymentMode: pluginDeploymentModeSchema,
  })
  .strict();

export const pluginDesiredStateV1Schema = z
  .object({
    apiVersion: z.literal('desired-state.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginDesiredState'),
    plugins: z.array(desiredPluginSchema).max(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const [index, plugin] of value.plugins.entries()) {
      if (ids.has(plugin.pluginId)) {
        context.addIssue({
          code: 'custom',
          path: ['plugins', index, 'pluginId'],
          message: 'Desired plugin IDs must be unique',
        });
      }
      ids.add(plugin.pluginId);
    }
  });

export type PluginDesiredStateV1 = z.infer<typeof pluginDesiredStateV1Schema>;

interface SafeInstalledPluginV1 {
  pluginId: string;
  version: string;
  enabled: boolean;
}

interface SafePluginListV1 {
  revision: number;
  plugins: SafeInstalledPluginV1[];
}

export interface ReconcilePluginDesiredStateOptionsV1 {
  baseUrl: string;
  accessToken: string;
  desired: unknown;
  fetch?: typeof fetch;
}

export type PluginDesiredStateReconcileResultV1 =
  | { status: 'current'; changed: false }
  | {
      status: 'requested';
      changed: true;
      pluginId: string;
      operation: 'install' | 'upgrade';
      installationId: string;
    }
  | { status: 'operation_in_progress'; changed: false };

function baseUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('plugin_gitops_base_url_invalid');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function accessToken(value: string): string {
  const token = value.trim();
  if (!/^[A-Za-z0-9._~-]{16,8192}$/.test(token)) {
    throw new Error('plugin_gitops_access_token_invalid');
  }
  return token;
}

async function jsonRequest(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const response = await fetchImpl(url, {
    ...init,
    redirect: 'error',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  });
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > 1024 ** 2) throw new Error('plugin_gitops_response_too_large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 1024 ** 2) {
    throw new Error('plugin_gitops_response_too_large');
  }
  let body: unknown = {};
  if (bytes.byteLength > 0) body = JSON.parse(bytes.toString('utf8'));
  return { status: response.status, body };
}

function safeList(input: unknown): SafePluginListV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('plugin_gitops_plugin_list_invalid');
  }
  const value = input as { revision?: unknown; plugins?: unknown };
  if (
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !Array.isArray(value.plugins)
  ) {
    throw new Error('plugin_gitops_plugin_list_invalid');
  }
  const plugins = value.plugins.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('plugin_gitops_plugin_list_invalid');
    }
    const record = entry as Record<string, unknown>;
    return {
      pluginId: pluginIdSchema.parse(record.pluginId),
      version: semVerSchema.parse(record.version),
      enabled: z.boolean().parse(record.enabled),
    };
  });
  return { revision: Number(value.revision), plugins };
}

function deterministicIdempotencyKey(value: unknown, revision: number): string {
  return `gitops-${createHash('sha256')
    .update(JSON.stringify({ value, revision }))
    .digest('hex')}`;
}

export async function reconcilePluginDesiredStateV1(
  options: ReconcilePluginDesiredStateOptionsV1,
): Promise<PluginDesiredStateReconcileResultV1> {
  const desired = pluginDesiredStateV1Schema.parse(options.desired);
  const host = baseUrl(options.baseUrl);
  const token = accessToken(options.accessToken);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const listResponse = await jsonRequest(
    fetchImpl,
    `${host}/api/plugin-platform/v1/plugins`,
    token,
    { method: 'GET' },
  );
  if (listResponse.status !== 200) {
    throw new Error(`plugin_gitops_host_http_${listResponse.status}`);
  }
  const installed = safeList(listResponse.body);
  for (const target of desired.plugins) {
    const current = installed.plugins.find(
      (plugin) => plugin.pluginId === target.pluginId,
    );
    if (current?.version === target.targetVersion) continue;
    const operation = current ? 'upgrade' : 'install';
    const body = {
      pluginId: target.pluginId,
      release: target.release,
      operation,
      ...(current
        ? { fromVersion: current.version, currentEnabled: current.enabled }
        : {}),
      source: target.source,
      deploymentMode: target.deploymentMode,
      expectedPlatformRevision: installed.revision,
      idempotencyKey: deterministicIdempotencyKey(target, installed.revision),
    };
    const result = await jsonRequest(
      fetchImpl,
      `${host}/api/plugin-platform/v1/installations`,
      token,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (
      result.status === 409 &&
      result.body &&
      typeof result.body === 'object' &&
      (result.body as { code?: unknown }).code === 'operation_in_progress'
    ) {
      return { status: 'operation_in_progress', changed: false };
    }
    if (result.status !== 201) {
      throw new Error(`plugin_gitops_host_http_${result.status}`);
    }
    const installationId =
      result.body &&
      typeof result.body === 'object' &&
      typeof (result.body as { installationId?: unknown }).installationId ===
        'string'
        ? (result.body as { installationId: string }).installationId
        : undefined;
    if (!installationId) throw new Error('plugin_gitops_intent_response_invalid');
    return {
      status: 'requested',
      changed: true,
      pluginId: target.pluginId,
      operation,
      installationId,
    };
  }
  return { status: 'current', changed: false };
}
