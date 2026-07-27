import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import type {
  EnterpriseGluePluginManifestV1,
  PluginResourceDescriptorV1,
  PluginSecretBrokerPolicyV1,
} from '@enterpriseglue/plugin-sdk';
import {
  signPluginInvocationV1,
  type PluginInvocationReplayStoreV1,
} from '@enterpriseglue/plugin-runtime/gateway';
import { describe, expect, it, vi } from 'vitest';

import {
  SecretBrokerErrorV1,
  executePluginSecretUseV1,
  type PluginSecretBrokerFetchV1,
} from './secretBroker.js';

const pluginId = 'io.enterpriseglue.ion-support' as const;
const operationId = `${pluginId}.ask-question` as const;
const permission = 'host.secret.use_reference' as const;
const secret = 'canary-secret-never-return-38fe1';

class MemoryReplayStore implements PluginInvocationReplayStoreV1 {
  private readonly consumed = new Set<string>();

  async consume(jti: string): Promise<boolean> {
    if (this.consumed.has(jti)) return false;
    this.consumed.add(jti);
    return true;
  }
}

function manifest(): EnterpriseGluePluginManifestV1 {
  return {
    apiVersion: 'plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePlugin',
    metadata: {
      id: pluginId,
      version: '0.1.0',
      displayName: 'ION Support',
      publisher: 'io.enterpriseglue',
    },
    compatibility: {
      host: '^0.4.0',
      sdk: '^0.1.0',
      backendProtocol: 1,
      requiredSlots: [],
    },
    deployment: {
      backend: {
        image: `registry.example/ion-support@sha256:${'a'.repeat(64)}`,
        healthPath: '/_plugin/health',
        readyPath: '/_plugin/ready',
        protocolPath: '/_plugin/capabilities',
        operations: [
          {
            operationId,
            method: 'POST',
            path: 'v1/questions',
            streaming: 'none',
            requestSchema: {
              path: 'schemas/question.json',
              sha256: 'b'.repeat(64),
            },
            responseSchema: {
              path: 'schemas/response.json',
              sha256: 'c'.repeat(64),
            },
            maxRequestBytes: 24_576,
            maxResponseBytes: 65_536,
            timeoutMs: 10_000,
            requiredPermissions: [
              'host.identity.read_safe',
              permission,
            ],
          },
        ],
      },
    },
    scope: {
      installation: 'deployment',
      enablement: 'tenant',
    },
    permissions: {
      required: ['host.identity.read_safe', permission],
      optional: [],
    },
    network: { egressPolicy: 'none' },
    entitlement: { provider: 'plugin', feature: 'ion_support' },
    dependencies: [],
    conflicts: [],
    events: { subscriptions: [] },
    jobs: { fixedSchedules: [] },
    contributions: [],
  };
}

function resources(credentialFile: string): PluginResourceDescriptorV1 {
  return {
    apiVersion: 'resources.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginResources',
    service: {
      containerPort: 8080,
      runAsNonRoot: true,
      readOnlyRootFilesystem: true,
      tmpfsMiB: 64,
      cpuLimit: '500m',
      memoryLimitMiB: 512,
    },
    configuration: [
      {
        name: 'ION_SUPPORT_ACCESS_TOKEN',
        source: 'secret_reference',
        reference: 'ion-support-access-token',
        required: true,
      },
    ],
    storage: [],
    network: { ingress: 'host-gateway-only', egressPolicy: 'none' },
    probes: {
      healthPath: '/_plugin/health',
      readyPath: '/_plugin/ready',
      initialDelaySeconds: 1,
      periodSeconds: 10,
      timeoutSeconds: 2,
      failureThreshold: 3,
    },
  };
}

function policy(credentialFile: string): PluginSecretBrokerPolicyV1 {
  return {
    apiVersion: 'secret-broker-policy.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginSecretBrokerPolicy',
    entries: [
      {
        pluginId,
        reference: 'ion-support-access-token',
        operation: 'http.bearer-json-v1',
        invocationOperations: [operationId],
        baseUrl: 'https://support.example',
        tenantBoundPath: 't/{tenant}/support-agent-api/v1',
        allowedMethods: ['POST'],
        allowedPathPrefixes: ['cases'],
        credentialFile,
        timeoutMs: 10_000,
        maxRequestBytes: 24_576,
        maxResponseBytes: 65_536,
      },
    ],
  };
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'eg-secret-broker-'));
  const secretRoot = resolve(root, 'secrets');
  const credentialFile = resolve(secretRoot, 'ion-support-access-token');
  await mkdir(secretRoot);
  await writeFile(credentialFile, `${secret}\n`, { mode: 0o600 });
  const keys = generateKeyPairSync('ed25519');
  const now = Math.floor(Date.now() / 1_000);
  const token = signPluginInvocationV1(
    {
      iss: 'enterpriseglue-oss',
      aud: pluginId,
      sub: 'user-1',
      iat: now,
      exp: now + 30,
      jti: 'invocation-1',
      tenantRef: 'tenant-1',
      deploymentRef: 'deployment-1',
      operationId,
      grantedPermissions: ['host.identity.read_safe', permission],
      correlationId: 'correlation-1',
    },
    keys.privateKey,
  );
  return {
    credentialFile,
    keys,
    secretRoot,
    token,
    request: {
      apiVersion: 'secret-use.plugin.enterpriseglue.io/v1',
      callId: 'create-case',
      operationId,
      reference: 'ion-support-access-token',
      operation: 'http.bearer-json-v1',
      payload: {
        method: 'POST',
        path: 'cases',
        body: { title: 'Sanitized question' },
        idempotencyKey: 'plugin-invocation-1',
      },
    },
  } as const;
}

describe('plugin secret-reference broker', () => {
  it('uses the secret without returning it and binds the signed tenant', async () => {
    const files = await fixture();
    const request = vi.fn(async (
      url: URL,
      init?: Parameters<PluginSecretBrokerFetchV1>[1],
    ) => {
      expect(String(url)).toBe(
        'https://support.example/t/tenant-1/support-agent-api/v1/cases',
      );
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Bearer ${secret}`,
      );
      return new Response(
        JSON.stringify({ id: 'case-1', tenantId: 'tenant-1' }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    const result = await executePluginSecretUseV1({
      record: {
        pluginId,
        manifest: manifest(),
        resources: resources(files.credentialFile),
        grantedPermissions: ['host.identity.read_safe', permission],
      },
      request: files.request,
      invocationToken: files.token,
      invocationPublicKey: files.keys.publicKey,
      expectedDeploymentRef: 'deployment-1',
      policy: policy(files.credentialFile),
      replayStore: new MemoryReplayStore(),
      secretRoot: files.secretRoot,
      fetchImplementation: request,
    });

    expect(result).toMatchObject({
      status: 201,
      body: { id: 'case-1', tenantId: 'tenant-1' },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('fails closed on missing grants, undeclared references, and deployment drift', async () => {
    const files = await fixture();
    const base = {
      record: {
        pluginId,
        manifest: manifest(),
        resources: resources(files.credentialFile),
        grantedPermissions: ['host.identity.read_safe', permission],
      },
      request: files.request,
      invocationToken: files.token,
      invocationPublicKey: files.keys.publicKey,
      expectedDeploymentRef: 'deployment-1',
      policy: policy(files.credentialFile),
      replayStore: new MemoryReplayStore(),
      secretRoot: files.secretRoot,
    } as const;

    await expect(
      executePluginSecretUseV1({
        ...base,
        record: { ...base.record, grantedPermissions: [] },
      }),
    ).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(
      executePluginSecretUseV1({
        ...base,
        request: { ...files.request, reference: 'other-secret' },
      }),
    ).rejects.toMatchObject({ code: 'reference_denied' });
    await expect(
      executePluginSecretUseV1({
        ...base,
        expectedDeploymentRef: 'other-deployment',
      }),
    ).rejects.toMatchObject({ code: 'deployment_mismatch' });
  });

  it('rejects replayed broker calls and reflected credential canaries', async () => {
    const files = await fixture();
    const replayStore = new MemoryReplayStore();
    const base = {
      record: {
        pluginId,
        manifest: manifest(),
        resources: resources(files.credentialFile),
        grantedPermissions: ['host.identity.read_safe', permission],
      },
      request: files.request,
      invocationToken: files.token,
      invocationPublicKey: files.keys.publicKey,
      expectedDeploymentRef: 'deployment-1',
      policy: policy(files.credentialFile),
      replayStore,
      secretRoot: files.secretRoot,
      fetchImplementation: (async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as PluginSecretBrokerFetchV1,
    } as const;
    await expect(executePluginSecretUseV1(base)).resolves.toMatchObject({
      status: 200,
    });
    await expect(executePluginSecretUseV1(base)).rejects.toMatchObject({
      code: 'invocation_replayed',
    });

    const reflected = await fixture();
    await expect(
      executePluginSecretUseV1({
        ...base,
        invocationToken: reflected.token,
        invocationPublicKey: reflected.keys.publicKey,
        replayStore: new MemoryReplayStore(),
        fetchImplementation: (async () =>
          new Response(JSON.stringify({ accidentallyEchoed: secret }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })) as PluginSecretBrokerFetchV1,
      }),
    ).rejects.toBeInstanceOf(SecretBrokerErrorV1);
    await expect(
      executePluginSecretUseV1({
        ...base,
        invocationToken: signPluginInvocationV1(
          {
            iss: 'enterpriseglue-oss',
            aud: pluginId,
            sub: 'user-1',
            iat: Math.floor(Date.now() / 1_000),
            exp: Math.floor(Date.now() / 1_000) + 30,
            jti: 'reflection-2',
            tenantRef: 'tenant-1',
            deploymentRef: 'deployment-1',
            operationId,
            grantedPermissions: ['host.identity.read_safe', permission],
            correlationId: 'correlation-2',
          },
          files.keys.privateKey,
        ),
        replayStore: new MemoryReplayStore(),
        fetchImplementation: (async () =>
          new Response(JSON.stringify({ accidentallyEchoed: secret }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })) as PluginSecretBrokerFetchV1,
      }),
    ).rejects.toMatchObject({ code: 'upstream_secret_reflection' });
  });

  it('does not expose upstream error detail to the plugin', async () => {
    const files = await fixture();
    const result = await executePluginSecretUseV1({
      record: {
        pluginId,
        manifest: manifest(),
        resources: resources(files.credentialFile),
        grantedPermissions: ['host.identity.read_safe', permission],
      },
      request: files.request,
      invocationToken: files.token,
      invocationPublicKey: files.keys.publicKey,
      expectedDeploymentRef: 'deployment-1',
      policy: policy(files.credentialFile),
      replayStore: new MemoryReplayStore(),
      secretRoot: files.secretRoot,
      fetchImplementation: (async () =>
        new Response(
          JSON.stringify({
            code: 'provider_internal',
            infrastructure: 'private-cluster-name',
          }),
          {
            status: 503,
            headers: { 'content-type': 'application/json' },
          },
        )) as PluginSecretBrokerFetchV1,
    });
    expect(result).toEqual({
      apiVersion: 'secret-use-result.plugin.enterpriseglue.io/v1',
      status: 503,
      body: { code: 'upstream_rejected' },
    });
    expect(JSON.stringify(result)).not.toContain('private-cluster-name');
  });
});
