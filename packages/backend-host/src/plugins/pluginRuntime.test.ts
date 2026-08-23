import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  pluginPermissionValues,
  pluginSlotIdValues,
  type EnterpriseGluePluginManifestV1,
  type PluginResourceDescriptorV1,
} from '@enterpriseglue/plugin-sdk';
import { DEFAULT_TENANT_ID } from '@enterpriseglue/shared/middleware/tenant.js';
import {
  PluginGatewayCircuitBreakerV1,
  PluginGatewayError,
  signPluginInvocationV1,
} from '@enterpriseglue/plugin-runtime/gateway';
import express from 'express';
import type { RequestHandler } from 'express';
import {
  Agent,
  getGlobalDispatcher,
  MockAgent,
  setGlobalDispatcher,
} from 'undici';
import { describe, expect, it, vi } from 'vitest';

import {
  MemoryPluginControlStoreV1,
  PluginControlPlaneV1,
} from './pluginControlPlane.js';
import {
  defaultPluginHostCapabilitiesV1,
  defaultPluginPlatformCapabilityCatalogV1,
  PluginHostRuntimeV1,
  registerPluginPlatformRoutes,
  type PluginHostRuntimeOptions,
} from './pluginRuntime.js';
import { MemoryPluginContributionAvailabilityStoreV1 } from './pluginContributionAvailabilityStore.js';

const pluginId = 'io.enterpriseglue.reference';
const version = '1.0.0';
const imageDigest = 'b'.repeat(64);
const operationId = `${pluginId}.create-case`;

function sha256(input: Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

function hostCapabilities(
  hostVersion = '0.4.6',
): NonNullable<PluginHostRuntimeOptions['hostCapabilities']> {
  return {
    hostVersion,
    sdkVersion: '0.1.0',
    supportedSdkVersions: new Set(['0.1.0']),
    frontendProtocol: 1,
    backendProtocol: 1,
    sharedFrontend: {
      react: '19.2.6',
      reactDom: '19.2.6',
      router: '7.18.1',
      carbonReact: '1.107.0',
      pluginSdk: '0.1.0',
    },
    slots: new Set(pluginSlotIdValues),
    permissions: new Set(pluginPermissionValues),
    egressPolicies: new Set(),
    trustedPublishers: new Set(['io.enterpriseglue']),
  };
}

function resources(): PluginResourceDescriptorV1 {
  return {
    apiVersion: 'resources.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginResources',
    service: {
      containerPort: 8080,
      runAsNonRoot: true,
      readOnlyRootFilesystem: true,
      tmpfsMiB: 32,
      cpuLimit: '250m',
      memoryLimitMiB: 256,
    },
    configuration: [],
    storage: [],
    network: {
      ingress: 'host-gateway-only',
      egressPolicy: 'none',
    },
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

function manifest(
  entryBytes: Uint8Array,
  requestSchemaBytes: Uint8Array,
  responseSchemaBytes: Uint8Array,
): EnterpriseGluePluginManifestV1 {
  return {
    apiVersion: 'plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePlugin',
    metadata: {
      id: pluginId,
      version,
      displayName: 'Reference plugin',
      publisher: 'io.enterpriseglue',
    },
    compatibility: {
      host: '>=0.4.0 <0.5.0',
      sdk: '^0.1.0',
      frontendProtocol: 1,
      backendProtocol: 1,
      requiredSlots: ['mission-control.incident.actions.v1'],
    },
    deployment: {
      frontend: {
        entry: 'frontend/index.js',
        sha256: sha256(entryBytes),
        shared: {
          react: '19.2.6',
          reactDom: '19.2.6',
          router: '7.18.1',
          carbonReact: '1.107.0',
          pluginSdk: '0.1.0',
        },
      },
      backend: {
        image: `registry.example/reference@sha256:${imageDigest}`,
        healthPath: '/_plugin/health',
        readyPath: '/_plugin/ready',
        protocolPath: '/_plugin/capabilities',
        operations: [
          {
            operationId,
            method: 'POST',
            path: 'v1/cases',
            requestSchema: {
              path: 'schemas/create-case.request.json',
              sha256: sha256(requestSchemaBytes),
            },
            responseSchema: {
              path: 'schemas/create-case.response.json',
              sha256: sha256(responseSchemaBytes),
            },
            requiredPermissions: ['host.identity.read_safe'],
            maxRequestBytes: 8_192,
            maxResponseBytes: 8_192,
            timeoutMs: 2_000,
            streaming: 'none',
          },
        ],
      },
    },
    scope: {
      installation: 'deployment',
      enablement: 'deployment',
    },
    permissions: {
      required: ['host.identity.read_safe'],
      optional: [],
    },
    network: {
      egressPolicy: 'none',
    },
    entitlement: {
      provider: 'none',
    },
    dependencies: [],
    conflicts: [],
    events: {
      subscriptions: [],
    },
    jobs: { fixedSchedules: [] },
    contributions: [],
  };
}

async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), 'eg-plugin-runtime-'));
  const assetRoot = resolve(directory, 'assets');
  const pluginRoot = resolve(assetRoot, pluginId);
  const frontendRoot = resolve(pluginRoot, 'frontend');
  const schemaRoot = resolve(pluginRoot, 'schemas');
  await Promise.all([
    mkdir(frontendRoot, { recursive: true }),
    mkdir(schemaRoot, { recursive: true }),
  ]);
  const entryBytes = Buffer.from(
    'export default { apiVersion: "frontend.plugin.enterpriseglue.io/v1" };',
  );
  const requestSchemaBytes = Buffer.from(
    JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['question'],
      properties: {
        question: { type: 'string', minLength: 1, maxLength: 1_000 },
      },
    }),
    'utf8',
  );
  const responseSchemaBytes = Buffer.from(
    JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['caseRef'],
      properties: {
        caseRef: { type: 'string', minLength: 1, maxLength: 128 },
      },
    }),
    'utf8',
  );
  const entry = resolve(frontendRoot, 'index.js');
  const requestSchema = resolve(schemaRoot, 'create-case.request.json');
  const responseSchema = resolve(schemaRoot, 'create-case.response.json');
  await Promise.all([
    writeFile(entry, entryBytes),
    writeFile(requestSchema, requestSchemaBytes),
    writeFile(responseSchema, responseSchemaBytes),
  ]);
  const pluginManifest = manifest(
    entryBytes,
    requestSchemaBytes,
    responseSchemaBytes,
  );
  const stateFile = resolve(directory, 'plugin-installer-state.json');
  await writeFile(
    stateFile,
    JSON.stringify({
      schemaVersion: 1,
      revision: 7,
      plugins: {
        [pluginId]: {
          pluginId,
          version,
          bundle: `registry.example/reference-bundle@sha256:${'c'.repeat(64)}`,
          manifestSha256: 'd'.repeat(64),
          manifest: pluginManifest,
          resources: resources(),
          grantedPermissions: ['host.identity.read_safe'],
          enabled: true,
        },
      },
    }),
  );
  return {
    assetRoot,
    entry,
    entryBytes,
    requestSchema,
    responseSchema,
    pluginManifest,
    stateFile,
  };
}

describe('PluginHostRuntimeV1', () => {
  it('advertises and enforces the current and previous SDK package lines', () => {
    const catalog = defaultPluginPlatformCapabilityCatalogV1();
    const capabilities = defaultPluginHostCapabilitiesV1();

    expect(catalog.compatibility).toMatchObject({
      hostVersion: '0.14.0',
      sdkVersion: '0.2.0',
      sharedFrontend: {
        router: '7.18.2',
        pluginSdk: '0.2.0',
      },
      supportWindow: {
        sdkMinorLines: ['0.1', '0.2'],
        sdkVersions: ['0.1.0', '0.2.0'],
      },
    });
    expect(capabilities.sdkVersion).toBe('0.2.0');
    expect([...capabilities.supportedSdkVersions].sort()).toEqual([
      '0.1.0',
      '0.2.0',
    ]);
  });

  it('projects the exact resolver inputs through the safe host capability catalog', () => {
    const runtime = new PluginHostRuntimeV1({
      hostCapabilities: {
        ...hostCapabilities(),
        permissions: new Set(['host.identity.read_safe']),
        slots: new Set(['settings.deployment.pages.v1']),
        egressPolicies: new Set(['approved-cloud']),
        trustedPublishers: new Set(['io.enterpriseglue']),
      },
    });

    expect(runtime.platformCapabilities()).toMatchObject({
      apiVersion: 'platform-capabilities.plugin.enterpriseglue.io/v1',
      compatibility: {
        hostVersion: '0.4.6',
        sdkVersion: '0.1.0',
      },
      permissions: [{ id: 'host.identity.read_safe' }],
      slots: [{ id: 'settings.deployment.pages.v1' }],
      events: [],
      egressPolicies: [{ id: 'none' }, { id: 'approved-cloud' }],
      trustedPublishers: [
        {
          id: 'io.enterpriseglue',
          source: 'deployment',
          keyMaterialExposed: false,
        },
      ],
    });
  });

  it('is an empty no-op when no installer state is configured', async () => {
    const runtime = new PluginHostRuntimeV1({
      stateFile: '',
      hostCapabilities: hostCapabilities(),
    });
    await expect(runtime.frontendBootstrap()).resolves.toEqual({
      apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1',
      revision: 0,
      plugins: [],
      issues: [],
    });
  });

  it('publishes only compatible digest-verified local assets', async () => {
    const files = await fixture();
    const runtime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });

    const bootstrap = await runtime.frontendBootstrap();
    expect(bootstrap.revision).toBe(7);
    expect(bootstrap.issues).toEqual([]);
    expect(bootstrap.plugins).toHaveLength(1);
    expect(bootstrap.plugins[0]?.entryUrl).toBe(
      '/_enterpriseglue/plugins/io.enterpriseglue.reference/1.0.0/frontend/index.js',
    );
    await expect(
      runtime.readAsset(pluginId, version, 'frontend/index.js'),
    ).resolves.toMatchObject({
      bytes: files.entryBytes,
      contentType: 'text/javascript; charset=utf-8',
    });
    await expect(
      runtime.readAsset(pluginId, version, '../state.json'),
    ).resolves.toBeNull();
    await writeFile(
      join(files.assetRoot, pluginId, 'frontend', 'unsigned.js'),
      'export default "unsigned";',
    );
    await expect(
      runtime.readAsset(pluginId, version, 'frontend/unsigned.js'),
    ).resolves.toBeNull();
    await expect(runtime.controlSnapshot()).resolves.toMatchObject({
      revision: 7,
      records: [
        {
          pluginId,
          compatible: true,
          healthy: true,
          installerEnabled: true,
          enablementScope: 'deployment',
          entitled: 'not_required',
          reasonCode: 'none',
        },
      ],
    });
  });

  it('projects only current safe lifecycle observations and fails closed on stale or unsafe input', async () => {
    const files = await fixture();
    const state = JSON.parse(
      await readFile(files.stateFile, 'utf8'),
    ) as Record<string, unknown>;
    state.lifecyclePlan = {
      apiVersion: 'lifecycle-plan.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginLifecyclePlan',
      operation: 'install',
      pluginId,
      fromDataSchema: 0,
      toDataSchema: 0,
      rollbackSupported: true,
      phases: ['stage', 'commit'],
    };
    await writeFile(files.stateFile, JSON.stringify(state));
    const observationFile = resolve(
      files.stateFile,
      '..',
      'plugin-lifecycle-observation.json',
    );
    const observation = {
      apiVersion:
        'deployment-execution-observation.plugin.enterpriseglue.io/v1',
      observedFrom: 'local_execution_mirror',
      workloadReconciliation: 'not_checked',
      observationState: 'current',
      observationReason: 'none',
      desiredRevision: 7,
      planSha256: 'e'.repeat(64),
      execution: {
        executionId: 'execution-runtime-0001',
        executionRevision: 1,
        desiredRevision: 7,
        planSha256: 'e'.repeat(64),
        pluginId,
        operation: 'install',
        status: 'queued',
        completedPhases: [],
        nextPhase: 'stage',
        reasonCode: 'none',
        updatedAt: '2026-07-25T01:00:00.000Z',
        leaseExpiresAt: null,
      },
    };
    await writeFile(observationFile, JSON.stringify(observation));
    const runtime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      executionObservationFile: observationFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });

    await expect(runtime.controlSnapshot()).resolves.toMatchObject({
      deploymentExecution: {
        observationState: 'current',
        execution: {
          pluginId,
          status: 'queued',
        },
      },
    });

    await writeFile(
      observationFile,
      JSON.stringify({
        ...observation,
        desiredRevision: 6,
        execution: {
          ...observation.execution,
          desiredRevision: 6,
        },
      }),
    );
    await expect(runtime.controlSnapshot()).resolves.toMatchObject({
      deploymentExecution: {
        observationState: 'stale',
        observationReason: 'desired_revision_mismatch',
        desiredRevision: 7,
        execution: null,
      },
    });

    await writeFile(
      observationFile,
      JSON.stringify({
        ...observation,
        execution: {
          ...observation.execution,
          leaseOwner: 'worker-identity-must-not-pass',
        },
      }),
    );
    await expect(runtime.controlSnapshot()).resolves.toMatchObject({
      deploymentExecution: {
        observationState: 'invalid',
        observationReason: 'observation_invalid',
        execution: null,
      },
    });
  });

  it('fails closed after entry tampering or host incompatibility', async () => {
    const files = await fixture();
    const tamperedRuntime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });
    await writeFile(files.entry, 'export default "tampered";');
    const tampered = await tamperedRuntime.frontendBootstrap();
    expect(tampered.plugins).toEqual([]);
    expect(tampered.issues).toEqual([
      { pluginId, code: 'asset_digest_invalid' },
    ]);

    const incompatibleRuntime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities('1.0.0'),
    });
    const incompatible = await incompatibleRuntime.frontendBootstrap();
    expect(incompatible.plugins).toEqual([]);
    expect(incompatible.issues[0]).toEqual({
      pluginId,
      code: 'incompatible_host',
    });
  });

  it('fails closed on a digest-matching frontend entry that violates source policy', async () => {
    const files = await fixture();
    const unsafeEntry = Buffer.from(
      'export default { activate: () => fetch("/raw-host-api") };',
      'utf8',
    );
    await writeFile(files.entry, unsafeEntry);
    const state = JSON.parse(
      await readFile(files.stateFile, 'utf8'),
    ) as {
      plugins: Record<
        string,
        { manifest: EnterpriseGluePluginManifestV1 }
      >;
    };
    state.plugins[pluginId]!.manifest.deployment.frontend!.sha256 =
      sha256(unsafeEntry);
    await writeFile(files.stateFile, JSON.stringify(state));

    const runtime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });
    await expect(runtime.frontendBootstrap()).resolves.toMatchObject({
      plugins: [],
      issues: [{ pluginId, code: 'asset_policy_invalid' }],
    });
    await expect(
      runtime.readAsset(pluginId, version, 'frontend/index.js'),
    ).resolves.toBeNull();
  });

  it('loads, digest-checks, caches, and enforces signed operation schemas', async () => {
    const files = await fixture();
    const runtime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });

    await expect(
      runtime.assertOperationPayload(pluginId, operationId, 'request', {
        question: 'Why did this job fail?',
      }),
    ).resolves.toBeUndefined();
    await expect(
      runtime.assertOperationPayload(pluginId, operationId, 'request', {
        question: '',
        undeclared: true,
      }),
    ).rejects.toMatchObject({ code: 'request_schema_invalid' });
    await expect(
      runtime.assertOperationPayload(pluginId, operationId, 'response', {
        caseRef: 'case-1',
      }),
    ).resolves.toBeUndefined();

    const freshRuntime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });
    await writeFile(
      files.responseSchema,
      JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'null',
      }),
    );
    await expect(
      freshRuntime.assertOperationPayload(
        pluginId,
        operationId,
        'response',
        { caseRef: 'case-1' },
      ),
    ).rejects.toMatchObject({ code: 'schema_digest_invalid' });
  });

  it('returns a fixed 403 before sidecar work when an operation grant is missing', async () => {
    const files = await fixture();
    const state = JSON.parse(await readFile(files.stateFile, 'utf8')) as {
      plugins: Record<
        string,
        {
          manifest: EnterpriseGluePluginManifestV1;
          grantedPermissions: string[];
        }
      >;
    };
    const installed = state.plugins[pluginId]!;
    installed.manifest.permissions.optional = [
      'host.plugin_storage.deployment',
    ];
    installed.manifest.deployment.backend!.operations[0]!.requiredPermissions =
      ['host.plugin_storage.deployment'];
    await writeFile(files.stateFile, JSON.stringify(state));

    const runtime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });
    const control = new PluginControlPlaneV1(
      runtime,
      new MemoryPluginControlStoreV1(),
      { defaultTenantRef: 'default-tenant-id' },
    );
    const app = express();
    app.use(express.json());
    registerPluginPlatformRoutes(app, runtime, control, {
      operationMiddleware: [authenticatedPluginRequest()],
      operationAuthorizer: async () => true,
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/plugins/v1/${pluginId}/operations/${operationId}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: { question: 'This must not reach the sidecar' },
          }),
        },
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: 'Plugin permission denied',
      });
    });
  });

  it('derives a path-bound resource from the declared source and authorizes it before sidecar work', async () => {
    const files = await fixture();
    files.pluginManifest.deployment.backend!.operations[0]!.path =
      'v1/engines/:engineRef/cases';
    files.pluginManifest.deployment.backend!.operations[0]!.resourceBinding = {
      kind: 'engine',
      source: 'path',
      field: 'engineRef',
    };
    const state = JSON.parse(await readFile(files.stateFile, 'utf8')) as {
      plugins: Record<
        string,
        { manifest: EnterpriseGluePluginManifestV1 }
      >;
    };
    state.plugins[pluginId]!.manifest = files.pluginManifest;
    await writeFile(files.stateFile, JSON.stringify(state));

    const runtime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });
    const control = new PluginControlPlaneV1(
      runtime,
      new MemoryPluginControlStoreV1(),
      { defaultTenantRef: 'default-tenant-id' },
    );
    const keys = generateKeyPairSync('ed25519');
    const privateKeyFile = resolve(
      files.assetRoot,
      'resource-invocation-private.pem',
    );
    await writeFile(
      privateKeyFile,
      keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    );
    const previousKeyFile =
      process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE;
    process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE =
      privateKeyFile;

    const previousDispatcher = getGlobalDispatcher();
    const agent = new MockAgent();
    agent.disableNetConnect();
    agent.enableNetConnect(/127\.0\.0\.1/);
    setGlobalDispatcher(agent);
    const sidecar = agent.get(
      'http://eg-plugin-io-enterpriseglue-reference:8080',
    );
    sidecar
      .intercept({ path: '/_plugin/capabilities', method: 'GET' })
      .reply(200, capabilities(files.pluginManifest), {
        headers: { 'content-type': 'application/json' },
      });
    sidecar
      .intercept({
        path: '/v1/engines/engine-allowed/cases',
        method: 'POST',
      })
      .reply(201, { caseRef: 'case-bound-engine' }, {
        headers: { 'content-type': 'application/json' },
      });

    const authorizationInputs: unknown[] = [];
    const app = express();
    app.use(express.json());
    registerPluginPlatformRoutes(app, runtime, control, {
      operationMiddleware: [authenticatedPluginRequest()],
      operationAuthorizer: async (input) =>
        input.actionId === 'engine.instances.read' &&
        input.resourceRef === 'engine-allowed',
      resourceAuthorizer: async (input) => {
        authorizationInputs.push(input);
        return input.resourceRef === 'engine-allowed';
      },
    });
    try {
      await withServer(app, async (baseUrl) => {
        const url = `${baseUrl}/api/plugins/v1/${pluginId}/operations/${operationId}`;
        const missingPath = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: { question: 'engine-allowed' },
          }),
        });
        expect(missingPath.status).toBe(404);
        await expect(missingPath.json()).resolves.toEqual({
          error: 'Plugin operation not available',
        });

        const denied = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            path: 'v1/engines/engine-denied/cases',
            body: { question: 'engine-allowed' },
          }),
        });
        expect(denied.status).toBe(403);
        await expect(denied.json()).resolves.toEqual({
          error: 'Plugin operation is not authorized',
        });

        const accepted = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            path: 'v1/engines/engine-allowed/cases',
            body: { question: 'engine-denied' },
          }),
        });
        expect(accepted.status).toBe(201);
        await expect(accepted.json()).resolves.toEqual({
          caseRef: 'case-bound-engine',
        });
      });
      expect(authorizationInputs).toEqual([
        {
          pluginId,
          operationId,
          subjectRef: 'user-1',
          tenantRef: 'default-tenant-id',
          resourceKind: 'engine',
          resourceRef: 'engine-allowed',
        },
      ]);
      agent.assertNoPendingInterceptors();
    } finally {
      setGlobalDispatcher(previousDispatcher);
      await agent.close();
      if (previousKeyFile === undefined) {
        delete process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE;
      } else {
        process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE =
          previousKeyFile;
      }
    }
  });

  it('validates requests and rechecks live sidecar capabilities on every accepted call', async () => {
    const files = await fixture();
    const runtime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });
    const control = new PluginControlPlaneV1(
      runtime,
      new MemoryPluginControlStoreV1(),
      { defaultTenantRef: 'default-tenant-id' },
    );
    const keys = generateKeyPairSync('ed25519');
    const privateKeyFile = resolve(files.assetRoot, 'invocation-private.pem');
    await writeFile(
      privateKeyFile,
      keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    );
    const previousKeyFile =
      process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE;
    process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE =
      privateKeyFile;

    const previousDispatcher = getGlobalDispatcher();
    const agent = new MockAgent();
    agent.disableNetConnect();
    agent.enableNetConnect(/127\.0\.0\.1/);
    setGlobalDispatcher(agent);
    const sidecar = agent.get(
      'http://eg-plugin-io-enterpriseglue-reference:8080',
    );
    sidecar
      .intercept({ path: '/_plugin/capabilities', method: 'GET' })
      .reply(200, capabilities(files.pluginManifest), {
        headers: { 'content-type': 'application/json' },
      });
    const driftedCapabilities = capabilities(files.pluginManifest);
    driftedCapabilities.operations[0]!.responseSchemaSha256 =
      'e'.repeat(64);
    sidecar
      .intercept({ path: '/_plugin/capabilities', method: 'GET' })
      .reply(200, driftedCapabilities, {
        headers: { 'content-type': 'application/json' },
      });
    sidecar
      .intercept({ path: '/v1/cases', method: 'POST' })
      .reply(201, { caseRef: 'case-1' }, {
        headers: { 'content-type': 'application/json' },
      });

    const app = express();
    app.use(express.json());
    registerPluginPlatformRoutes(app, runtime, control, {
      operationMiddleware: [authenticatedPluginRequest()],
      operationAuthorizer: async () => true,
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      await withServer(app, async (baseUrl) => {
        const url = `${baseUrl}/api/plugins/v1/${pluginId}/operations/${operationId}`;
        const invalid = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: { question: '', undeclared: true },
          }),
        });
        expect(invalid.status).toBe(400);

        const valid = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: { question: 'Why did this job fail?' },
          }),
        });
        expect(valid.status).toBe(201);
        await expect(valid.json()).resolves.toEqual({ caseRef: 'case-1' });

        const changedCapability = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: { question: 'Does the sidecar still match?' },
          }),
        });
        expect(changedCapability.status).toBe(502);
        await expect(changedCapability.json()).resolves.toEqual({
          error: 'Plugin gateway unavailable',
        });
      });
      agent.assertNoPendingInterceptors();
    } finally {
      consoleError.mockRestore();
      setGlobalDispatcher(previousDispatcher);
      await agent.close();
      if (previousKeyFile === undefined) {
        delete process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE;
      } else {
        process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE =
          previousKeyFile;
      }
    }
  });

  it('opens the wired gateway circuit after an invalid sidecar response', async () => {
    const files = await fixture();
    const runtime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });
    const control = new PluginControlPlaneV1(
      runtime,
      new MemoryPluginControlStoreV1(),
      { defaultTenantRef: 'default-tenant-id' },
    );
    const keys = generateKeyPairSync('ed25519');
    const privateKeyFile = resolve(files.assetRoot, 'circuit-private.pem');
    await writeFile(
      privateKeyFile,
      keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    );
    const previousKeyFile =
      process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE;
    process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE =
      privateKeyFile;

    const previousDispatcher = getGlobalDispatcher();
    const agent = new MockAgent();
    agent.disableNetConnect();
    agent.enableNetConnect(/127\.0\.0\.1/);
    setGlobalDispatcher(agent);
    const sidecar = agent.get(
      'http://eg-plugin-io-enterpriseglue-reference:8080',
    );
    sidecar
      .intercept({ path: '/_plugin/capabilities', method: 'GET' })
      .reply(200, capabilities(files.pluginManifest), {
        headers: { 'content-type': 'application/json' },
      });
    sidecar
      .intercept({ path: '/v1/cases', method: 'POST' })
      .reply(201, { undeclared: true }, {
        headers: { 'content-type': 'application/json' },
      });

    const app = express();
    app.use(express.json());
    registerPluginPlatformRoutes(app, runtime, control, {
      operationMiddleware: [authenticatedPluginRequest()],
      operationAuthorizer: async () => true,
      gatewayCircuitBreaker: new PluginGatewayCircuitBreakerV1({
        failureThreshold: 1,
        openMs: 60_000,
      }),
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      await withServer(app, async (baseUrl) => {
        const url = `${baseUrl}/api/plugins/v1/${pluginId}/operations/${operationId}`;
        const request = () =>
          fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ body: { question: 'Why?' } }),
          });
        expect((await request()).status).toBe(502);
        expect((await request()).status).toBe(503);
      });
      agent.assertNoPendingInterceptors();
    } finally {
      consoleError.mockRestore();
      setGlobalDispatcher(previousDispatcher);
      await agent.close();
      if (previousKeyFile === undefined) {
        delete process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE;
      } else {
        process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE =
          previousKeyFile;
      }
    }
  });

  it('fails closed before contacting a sidecar when durable admission is unavailable', async () => {
    const files = await fixture();
    const runtime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });
    const control = new PluginControlPlaneV1(
      runtime,
      new MemoryPluginControlStoreV1(),
      { defaultTenantRef: 'default-tenant-id' },
    );
    let acquireCalls = 0;
    const app = express();
    app.use(express.json());
    registerPluginPlatformRoutes(app, runtime, control, {
      operationMiddleware: [authenticatedPluginRequest()],
      operationAuthorizer: async () => true,
      gatewayAdmission: {
        acquire: async () => {
          acquireCalls += 1;
          throw new PluginGatewayError(
            'admission_unavailable',
            'synthetic durable store outage',
          );
        },
      },
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/plugins/v1/${pluginId}/operations/${operationId}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: { question: 'Why did this job fail?' },
          }),
        },
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: 'Plugin operation unavailable',
      });
    });
    expect(acquireCalls).toBe(1);
  });

  it('contains sidecar crash and timeout failures behind the same operation circuit', async () => {
    const files = await fixture();
    files.pluginManifest.deployment.backend!.operations[0]!.timeoutMs = 100;
    await writeFile(
      files.stateFile,
      JSON.stringify({
        schemaVersion: 1,
        revision: 8,
        plugins: {
          [pluginId]: {
            pluginId,
            version,
            bundle: `registry.example/reference-bundle@sha256:${'c'.repeat(64)}`,
            manifestSha256: 'd'.repeat(64),
            manifest: files.pluginManifest,
            resources: resources(),
            grantedPermissions: ['host.identity.read_safe'],
            enabled: true,
          },
        },
      }),
    );
    const runtime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });
    const control = new PluginControlPlaneV1(
      runtime,
      new MemoryPluginControlStoreV1(),
      { defaultTenantRef: 'default-tenant-id' },
    );
    const keys = generateKeyPairSync('ed25519');
    const privateKeyFile = resolve(files.assetRoot, 'fault-private.pem');
    await writeFile(
      privateKeyFile,
      keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    );
    const previousKeyFile =
      process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE;
    process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE =
      privateKeyFile;

    const previousDispatcher = getGlobalDispatcher();
    const agent = new MockAgent();
    agent.disableNetConnect();
    agent.enableNetConnect(/127\.0\.0\.1/);
    setGlobalDispatcher(agent);
    const sidecar = agent.get(
      'http://eg-plugin-io-enterpriseglue-reference:8080',
    );
    for (let index = 0; index < 2; index += 1) {
      sidecar
        .intercept({ path: '/_plugin/capabilities', method: 'GET' })
        .reply(200, capabilities(files.pluginManifest), {
          headers: { 'content-type': 'application/json' },
        });
    }
    sidecar
      .intercept({ path: '/v1/cases', method: 'POST' })
      .replyWithError(new Error('synthetic sidecar crash'));
    sidecar
      .intercept({ path: '/v1/cases', method: 'POST' })
      .reply(201, { caseRef: 'too-late' }, {
        headers: { 'content-type': 'application/json' },
      })
      .delay(250);

    const app = express();
    app.use(express.json());
    registerPluginPlatformRoutes(app, runtime, control, {
      operationMiddleware: [authenticatedPluginRequest()],
      operationAuthorizer: async () => true,
      gatewayCircuitBreaker: new PluginGatewayCircuitBreakerV1({
        failureThreshold: 2,
        openMs: 60_000,
      }),
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      await withServer(app, async (baseUrl) => {
        const request = () =>
          fetch(
            `${baseUrl}/api/plugins/v1/${pluginId}/operations/${operationId}`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ body: { question: 'Why?' } }),
            },
          );
        expect((await request()).status).toBe(502);
        expect((await request()).status).toBe(502);
        expect((await request()).status).toBe(503);
      });
      agent.assertNoPendingInterceptors();
    } finally {
      consoleError.mockRestore();
      setGlobalDispatcher(previousDispatcher);
      await agent.close();
      if (previousKeyFile === undefined) {
        delete process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE;
      } else {
        process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE =
          previousKeyFile;
      }
    }
  });

  it('keeps ordinary OSS routes available after real socket crash and timeout failures', async () => {
    const files = await fixture();
    files.pluginManifest.deployment.backend!.operations[0]!.timeoutMs = 100;
    let operationCalls = 0;
    const sidecar = express();
    sidecar.use(express.json());
    sidecar.get('/_plugin/capabilities', (_request, response) => {
      response.json(capabilities(files.pluginManifest));
    });
    sidecar.post('/v1/cases', (request, response) => {
      operationCalls += 1;
      if (operationCalls === 1) {
        request.socket.destroy();
        return;
      }
      setTimeout(() => {
        if (!response.writableEnded) {
          response.status(201).json({ caseRef: 'too-late' });
        }
      }, 250);
    });

    await withServer(sidecar, async (sidecarUrl) => {
      const sidecarPort = Number(new URL(sidecarUrl).port);
      const resourceDocument = resources();
      resourceDocument.service.containerPort = sidecarPort;
      await writeFile(
        files.stateFile,
        JSON.stringify({
          schemaVersion: 1,
          revision: 9,
          plugins: {
            [pluginId]: {
              pluginId,
              version,
              bundle: `registry.example/reference-bundle@sha256:${'c'.repeat(64)}`,
              manifestSha256: 'd'.repeat(64),
              manifest: files.pluginManifest,
              resources: resourceDocument,
              grantedPermissions: ['host.identity.read_safe'],
              enabled: true,
            },
          },
        }),
      );
      const runtime = new PluginHostRuntimeV1({
        stateFile: files.stateFile,
        assetRoot: files.assetRoot,
        hostCapabilities: hostCapabilities(),
      });
      const control = new PluginControlPlaneV1(
        runtime,
        new MemoryPluginControlStoreV1(),
        { defaultTenantRef: 'default-tenant-id' },
      );
      const keys = generateKeyPairSync('ed25519');
      const privateKeyFile = resolve(files.assetRoot, 'socket-fault-private.pem');
      await writeFile(
        privateKeyFile,
        keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      );
      const previousKeyFile =
        process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE;
      process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE =
        privateKeyFile;
      const previousDispatcher = getGlobalDispatcher();
      const realNetwork = new Agent({
        connect: {
          lookup: (_hostname, options, callback) => {
            if (options.all) {
              callback(null, [{ address: '127.0.0.1', family: 4 }]);
              return;
            }
            callback(null, '127.0.0.1', 4);
          },
        },
      });
      setGlobalDispatcher(realNetwork);
      const host = express();
      host.use(express.json());
      registerPluginPlatformRoutes(host, runtime, control, {
        operationMiddleware: [authenticatedPluginRequest()],
        operationAuthorizer: async () => true,
        gatewayCircuitBreaker: new PluginGatewayCircuitBreakerV1({
          failureThreshold: 2,
          openMs: 60_000,
        }),
      });
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      try {
        await withServer(host, async (baseUrl) => {
          const invoke = () =>
            fetch(
              `${baseUrl}/api/plugins/v1/${pluginId}/operations/${operationId}`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ body: { question: 'Why?' } }),
              },
            );
          expect((await invoke()).status).toBe(502);
          expect((await invoke()).status).toBe(502);
          expect((await invoke()).status).toBe(503);
          const ordinaryHostRoute = await fetch(
            `${baseUrl}/api/plugins/v1/frontend`,
          );
          expect(ordinaryHostRoute.status).toBe(200);
          await expect(ordinaryHostRoute.json()).resolves.toMatchObject({
            revision: 9,
          });
        });
        expect(operationCalls).toBe(2);
      } finally {
        consoleError.mockRestore();
        setGlobalDispatcher(previousDispatcher);
        await realNetwork.close();
        if (previousKeyFile === undefined) {
          delete process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE;
        } else {
          process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE =
            previousKeyFile;
        }
      }
    });
  });

  it('relays a declared SSE operation only after per-event response validation', async () => {
    const files = await fixture();
    files.pluginManifest.deployment.backend!.operations[0]!.streaming = 'sse';
    await writeFile(
      files.stateFile,
      JSON.stringify({
        schemaVersion: 1,
        revision: 8,
        plugins: {
          [pluginId]: {
            pluginId,
            version,
            bundle: `registry.example/reference-bundle@sha256:${'c'.repeat(64)}`,
            manifestSha256: 'd'.repeat(64),
            manifest: files.pluginManifest,
            resources: resources(),
            grantedPermissions: ['host.identity.read_safe'],
            enabled: true,
          },
        },
      }),
    );
    const runtime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });
    const control = new PluginControlPlaneV1(
      runtime,
      new MemoryPluginControlStoreV1(),
      { defaultTenantRef: 'default-tenant-id' },
    );
    const keys = generateKeyPairSync('ed25519');
    const privateKeyFile = resolve(files.assetRoot, 'sse-private.pem');
    await writeFile(
      privateKeyFile,
      keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    );
    const previousKeyFile =
      process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE;
    process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE =
      privateKeyFile;

    const previousDispatcher = getGlobalDispatcher();
    const agent = new MockAgent();
    agent.disableNetConnect();
    agent.enableNetConnect(/127\.0\.0\.1/);
    setGlobalDispatcher(agent);
    const sidecar = agent.get(
      'http://eg-plugin-io-enterpriseglue-reference:8080',
    );
    sidecar
      .intercept({ path: '/_plugin/capabilities', method: 'GET' })
      .reply(200, capabilities(files.pluginManifest), {
        headers: { 'content-type': 'application/json' },
      });
    sidecar
      .intercept({ path: '/v1/cases', method: 'POST' })
      .reply(200, 'event: progress\ndata: {"caseRef":"case-1"}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });

    const app = express();
    app.use(express.json());
    registerPluginPlatformRoutes(app, runtime, control, {
      operationMiddleware: [authenticatedPluginRequest()],
      operationAuthorizer: async () => true,
    });
    try {
      await withServer(app, async (baseUrl) => {
        const result = await fetch(
          `${baseUrl}/api/plugins/v1/${pluginId}/operations/${operationId}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              body: { question: 'Stream this case' },
            }),
          },
        );
        expect(result.status).toBe(200);
        expect(result.headers.get('content-type')).toContain(
          'text/event-stream',
        );
        await expect(result.text()).resolves.toBe(
          'event: progress\ndata: {"caseRef":"case-1"}\n\n',
        );
      });
      agent.assertNoPendingInterceptors();
    } finally {
      setGlobalDispatcher(previousDispatcher);
      await agent.close();
      if (previousKeyFile === undefined) {
        delete process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE;
      } else {
        process.env.ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE =
          previousKeyFile;
      }
    }
  });

  it('removes a runtime-disabled plugin from frontend bootstrap without changing installer state', async () => {
    const files = await fixture();
    const runtime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });
    const control = new PluginControlPlaneV1(
      runtime,
      new MemoryPluginControlStoreV1(),
      { defaultTenantRef: 'default-tenant-id' },
    );
    const app = express();
    app.use(express.json());
    registerPluginPlatformRoutes(app, runtime, control);
    await withServer(app, async (baseUrl) => {
      const before = (await (
        await fetch(`${baseUrl}/api/plugins/v1/frontend`)
      ).json()) as { plugins: unknown[] };
      expect(before.plugins).toHaveLength(1);
      await control.setDeploymentEnabled({
        pluginId,
        enabled: false,
        expectedRevision: 0,
        idempotencyKey: 'runtime-disable-request-0001',
        actorRef: 'admin-1',
        correlationId: 'correlation-1',
      });
      const after = (await (
        await fetch(`${baseUrl}/api/plugins/v1/frontend`)
      ).json()) as { plugins: unknown[] };
      expect(after.plugins).toEqual([]);
    });
  });

  it('delivers only a current tenant projection in frontend bootstrap', async () => {
    const files = await fixture();
    const refreshOperationId = `${pluginId}.refresh-availability`;
    files.pluginManifest.deployment.backend!.operations.push({
      operationId: refreshOperationId,
      method: 'POST',
      path: 'v1/contribution-availability',
      requestSchema:
        files.pluginManifest.deployment.backend!.operations[0]!.requestSchema,
      responseSchema:
        files.pluginManifest.deployment.backend!.operations[0]!.responseSchema,
      requiredPermissions: ['host.identity.read_safe'],
      maxRequestBytes: 8_192,
      maxResponseBytes: 8_192,
      timeoutMs: 2_000,
      streaming: 'none',
    });
    files.pluginManifest.contributions = [
      {
        id: `${pluginId}.action`,
        kind: 'slot',
        slot: 'mission-control.incident.actions.v1',
      },
    ];
    files.pluginManifest.contributionAvailability = {
      refreshOperationId,
      refreshIntervalSeconds: 300,
      maximumStalenessSeconds: 900,
      gatedContributionIds: [`${pluginId}.action`],
    };
    const state = JSON.parse(await readFile(files.stateFile, 'utf8')) as {
      plugins: Record<string, { manifest: EnterpriseGluePluginManifestV1 }>;
    };
    state.plugins[pluginId]!.manifest = files.pluginManifest;
    await writeFile(files.stateFile, JSON.stringify(state));

    const runtime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });
    const control = new PluginControlPlaneV1(
      runtime,
      new MemoryPluginControlStoreV1(),
      { defaultTenantRef: 'default-tenant-id' },
    );
    const availabilityStore =
      new MemoryPluginContributionAvailabilityStoreV1();
    const now = Date.now();
    const target = {
      deploymentRef: 'oss-deployment',
      tenantRef: DEFAULT_TENANT_ID,
      pluginId,
      pluginVersion: version,
      installerRevision: 7,
      refreshIntervalSeconds: 300,
      maximumStalenessSeconds: 900,
    };
    await availabilityStore.reconcileTargets([target], now);
    const [claim] = await availabilityStore.claimDue({
      workerRef: 'bootstrap-test-worker',
      now,
      leaseMs: 60_000,
      limit: 1,
    });
    const projection = {
      apiVersion:
        'contribution-availability.plugin.enterpriseglue.io/v1' as const,
      evaluatedAt: new Date(now).toISOString(),
      validUntil: new Date(now + 900_000).toISOString(),
      contributions: [
        {
          contributionId: `${pluginId}.action`,
          available: false,
          reasonCode: 'dependency_incompatible' as const,
        },
      ],
    };
    await availabilityStore.completeSuccess(
      claim!,
      projection,
      now + 300_000,
      now,
    );

    const app = express();
    app.use(express.json());
    registerPluginPlatformRoutes(app, runtime, control, {
      availabilityStore,
      startAvailabilityWorker: false,
    });
    await withServer(app, async (baseUrl) => {
      const bootstrap = (await (
        await fetch(`${baseUrl}/api/plugins/v1/frontend`)
      ).json()) as {
        plugins: Array<{ contributionAvailability?: unknown }>;
      };
      expect(bootstrap.plugins).toHaveLength(1);
      expect(
        bootstrap.plugins[0]?.contributionAvailability,
      ).toEqual(projection);
    });
  });

  it('serves safe identity and collector health through the signed internal broker', async () => {
    const files = await fixture();
    const runtime = new PluginHostRuntimeV1({
      stateFile: files.stateFile,
      assetRoot: files.assetRoot,
      hostCapabilities: hostCapabilities(),
    });
    const control = new PluginControlPlaneV1(
      runtime,
      new MemoryPluginControlStoreV1(),
      { defaultTenantRef: 'default-tenant-id' },
    );
    const keys = generateKeyPairSync('ed25519');
    const consumed = new Set<string>();
    const app = express();
    app.use(express.json());
    registerPluginPlatformRoutes(app, runtime, control, {
      hostBroker: {
        invocationPublicKey: async () =>
          keys.publicKey.export({ type: 'spki', format: 'pem' }),
        expectedDeploymentRef: 'test-deployment',
        replayStoreFactory: () => ({
          consume: async (jti) => {
            if (consumed.has(jti)) return false;
            consumed.add(jti);
            return true;
          },
        }),
        storageStore: {
          execute: async () => {
            throw new Error('Identity must not access plugin storage');
          },
        },
      },
    });
    const now = Math.floor(Date.now() / 1_000);
    const invocation = signPluginInvocationV1(
      {
        iss: 'enterpriseglue-oss',
        aud: pluginId,
        sub: 'user-1',
        iat: now,
        exp: now + 30,
        jti: 'identity-http-invocation-1',
        tenantRef: 'default-tenant-id',
        deploymentRef: 'test-deployment',
        operationId,
        grantedPermissions: ['host.identity.read_safe'],
        correlationId: 'identity-http-correlation-1',
      },
      keys.privateKey,
    );
    await withServer(app, async (baseUrl) => {
      const invoke = () =>
        fetch(
          `${baseUrl}/_enterpriseglue/plugin-broker/v1/${pluginId}/identity`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-enterpriseglue-plugin-invocation': invocation,
            },
            body: JSON.stringify({
              apiVersion: 'identity-request.plugin.enterpriseglue.io/v1',
              callId: 'identity-http-call-1',
              operationId,
            }),
          },
        );
      const first = await invoke();
      expect(first.status).toBe(200);
      await expect(first.json()).resolves.toEqual({
        apiVersion: 'identity.plugin.enterpriseglue.io/v1',
        subjectRef: 'user-1',
        tenantRef: 'default-tenant-id',
        deploymentRef: 'test-deployment',
        grantedPermissions: ['host.identity.read_safe'],
      });
      const replay = await invoke();
      expect(replay.status).toBe(401);
      await expect(replay.json()).resolves.toEqual({
        code: 'invocation_replayed',
      });
      const statusInvocation = signPluginInvocationV1(
        {
          iss: 'enterpriseglue-oss',
          aud: pluginId,
          sub: 'user-1',
          iat: now,
          exp: now + 30,
          jti: 'diagnostic-status-http-invocation-1',
          tenantRef: 'default-tenant-id',
          deploymentRef: 'test-deployment',
          operationId,
          grantedPermissions: ['host.identity.read_safe'],
          correlationId: 'diagnostic-status-http-correlation-1',
        },
        keys.privateKey,
      );
      const statusResponse = await fetch(
        `${baseUrl}/_enterpriseglue/plugin-broker/v1/${pluginId}/diagnostics/status`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-enterpriseglue-plugin-invocation': statusInvocation,
          },
          body: JSON.stringify({
            apiVersion:
              'diagnostic-collector-status-request.plugin.enterpriseglue.io/v1',
            callId: 'diagnostic-status-http-call-1',
            operationId,
          }),
        },
      );
      expect(statusResponse.status).toBe(200);
      await expect(statusResponse.json()).resolves.toMatchObject({
        apiVersion:
          'diagnostic-collector-status.plugin.enterpriseglue.io/v1',
        state: 'disabled',
        reasonCode: 'collector_not_configured',
        collectionPermission: 'not_granted',
        sourceClass: 'none',
        filteringBoundary: 'enterpriseglue_backend',
        rawUploadPermitted: false,
        browserEditable: false,
      });
    });
  });
});

function capabilities(pluginManifest: EnterpriseGluePluginManifestV1) {
  return {
    protocol: 'backend.plugin.enterpriseglue.io/v1',
    pluginId,
    pluginVersion: version,
    apiRevision: '1',
    schemaRevision: 0,
    operations:
      pluginManifest.deployment.backend?.operations.map((operation) => ({
        operationId: operation.operationId,
        requestSchemaSha256: operation.requestSchema.sha256,
        responseSchemaSha256: operation.responseSchema.sha256,
      })) ?? [],
    optionalFeatures: [],
  };
}

function authenticatedPluginRequest(): RequestHandler {
  return (request, _response, next) => {
    Object.assign(request, {
      user: { userId: 'user-1' },
      tenant: {
        tenantId: 'default-tenant-id',
        tenantSlug: 'default',
      },
    });
    next();
  };
}

async function withServer(
  app: express.Express,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolvePromise, reject) => {
    server.once('listening', resolvePromise);
    server.once('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) =>
        error ? reject(error) : resolvePromise(),
      );
    });
  }
}
