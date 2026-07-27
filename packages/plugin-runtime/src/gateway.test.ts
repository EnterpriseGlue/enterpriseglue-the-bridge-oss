import { createHash, generateKeyPairSync } from 'node:crypto';

import {
  parseEnterpriseGluePluginManifestV1,
  type PluginInvocationClaimsV1,
} from '@enterpriseglue/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  authorizePluginGatewayInvocationV1,
  matchPluginOperationPathV1,
  PluginGatewayAdmissionControllerV1,
  PluginGatewayCircuitBreakerV1,
  signPluginInvocationV1,
  validatePluginBackendCapabilitiesV1,
  verifyPluginInvocationV1,
  type PluginInvocationReplayStoreV1,
} from './gateway.js';
import { compilePluginOperationSchemaV1 } from './jsonSchema.js';

const hash = 'f'.repeat(64);
const pluginId = 'io.enterpriseglue.test-plugin';
const operationId = `${pluginId}.read-status`;

class MemoryReplayStore implements PluginInvocationReplayStoreV1 {
  private readonly seen = new Set<string>();

  async consume(jti: string): Promise<boolean> {
    if (this.seen.has(jti)) return false;
    this.seen.add(jti);
    return true;
  }
}

function claims(): PluginInvocationClaimsV1 {
  return {
    iss: 'enterpriseglue-oss',
    aud: pluginId,
    sub: 'user-1',
    iat: 1_000,
    exp: 1_030,
    jti: 'invocation-1',
    tenantRef: 'tenant-a',
    deploymentRef: 'deployment-1',
    operationId,
    grantedPermissions: ['host.identity.read_safe'],
    correlationId: 'correlation-1',
  };
}

function manifest() {
  return parseEnterpriseGluePluginManifestV1({
    apiVersion: 'plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePlugin',
    metadata: {
      id: pluginId,
      version: '1.0.0',
      displayName: 'Test Plugin',
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
        image: `registry.example/plugin@sha256:${hash}`,
        healthPath: '/_plugin/health',
        readyPath: '/_plugin/ready',
        protocolPath: '/_plugin/capabilities',
        operations: [
          {
            operationId,
            method: 'GET',
            path: 'v1/status',
            requestSchema: {
              path: 'schemas/status.request.json',
              sha256: hash,
            },
            responseSchema: {
              path: 'schemas/status.response.json',
              sha256: hash,
            },
            requiredPermissions: ['host.identity.read_safe'],
            maxRequestBytes: 1_024,
            maxResponseBytes: 8_192,
            timeoutMs: 2_000,
            streaming: 'none',
          },
        ],
      },
    },
    scope: {
      installation: 'deployment',
      enablement: 'tenant',
    },
    permissions: {
      required: ['host.identity.read_safe'],
      optional: [],
    },
    network: {
      egressPolicy: 'none',
    },
  });
}

describe('plugin invocation tokens', () => {
  it('verifies signature, audience, operation, lifetime, and one-time use', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const token = signPluginInvocationV1(claims(), privateKey);
    const replayStore = new MemoryReplayStore();

    await expect(
      verifyPluginInvocationV1({
        token,
        publicKey,
        expectedAudience: pluginId,
        expectedOperationId: operationId,
        replayStore,
        nowEpochSeconds: 1_010,
      }),
    ).resolves.toMatchObject({ aud: pluginId, operationId });

    await expect(
      verifyPluginInvocationV1({
        token,
        publicKey,
        expectedAudience: pluginId,
        expectedOperationId: operationId,
        replayStore,
        nowEpochSeconds: 1_010,
      }),
    ).rejects.toMatchObject({ code: 'token_replayed' });
  });

  it('rejects tampering, wrong audience, expiry, and excessive lifetime', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const token = signPluginInvocationV1(claims(), privateKey);
    const parts = token.split('.');
    parts[1] = Buffer.from(JSON.stringify({ aud: 'io.attacker' })).toString(
      'base64url',
    );

    await expect(
      verifyPluginInvocationV1({
        token: parts.join('.'),
        publicKey,
        expectedAudience: pluginId,
        expectedOperationId: operationId,
        replayStore: new MemoryReplayStore(),
        nowEpochSeconds: 1_010,
      }),
    ).rejects.toMatchObject({ code: 'token_signature_invalid' });

    await expect(
      verifyPluginInvocationV1({
        token,
        publicKey,
        expectedAudience: 'io.enterpriseglue.other',
        expectedOperationId: operationId,
        replayStore: new MemoryReplayStore(),
        nowEpochSeconds: 1_010,
      }),
    ).rejects.toMatchObject({ code: 'token_audience_invalid' });

    await expect(
      verifyPluginInvocationV1({
        token,
        publicKey,
        expectedAudience: pluginId,
        expectedOperationId: operationId,
        replayStore: new MemoryReplayStore(),
        nowEpochSeconds: 1_100,
      }),
    ).rejects.toMatchObject({ code: 'token_expired' });

    await expect(
      verifyPluginInvocationV1({
        token: signPluginInvocationV1(
          { ...claims(), exp: 1_500 },
          privateKey,
        ),
        publicKey,
        expectedAudience: pluginId,
        expectedOperationId: operationId,
        replayStore: new MemoryReplayStore(),
        nowEpochSeconds: 1_010,
      }),
    ).rejects.toMatchObject({ code: 'token_lifetime_exceeded' });
  });
});

describe('plugin gateway policy', () => {
  it('authorizes only the signed manifest operation and permission grant', () => {
    const operation = authorizePluginGatewayInvocationV1({
      manifest: manifest(),
      pluginId,
      operationId,
      method: 'GET',
      relativePath: 'v1/status',
      requestBytes: 100,
      grantedPermissions: ['host.identity.read_safe'],
    });
    expect(operation.timeoutMs).toBe(2_000);

    expect(() =>
      authorizePluginGatewayInvocationV1({
        manifest: manifest(),
        pluginId,
        operationId,
        method: 'POST',
        relativePath: 'v1/status',
        requestBytes: 100,
        grantedPermissions: ['host.identity.read_safe'],
      }),
    ).toThrowError(expect.objectContaining({ code: 'operation_method_invalid' }));

    expect(() =>
      authorizePluginGatewayInvocationV1({
        manifest: manifest(),
        pluginId,
        operationId,
        method: 'GET',
        relativePath: 'v1/status',
        requestBytes: 100,
        grantedPermissions: [],
      }),
    ).toThrowError(expect.objectContaining({ code: 'permission_denied' }));

    const pathBoundManifest = manifest();
    pathBoundManifest.deployment.backend!.operations[0]!.path =
      'v1/engines/:engineRef/status';
    pathBoundManifest.deployment.backend!.operations[0]!.resourceBinding = {
      kind: 'engine',
      source: 'path',
      field: 'engineRef',
    };
    expect(
      authorizePluginGatewayInvocationV1({
        manifest: pathBoundManifest,
        pluginId,
        operationId,
        method: 'GET',
        relativePath: 'v1/engines/engine-1/status',
        requestBytes: 0,
        grantedPermissions: ['host.identity.read_safe'],
      }).resourceBinding,
    ).toEqual({
      kind: 'engine',
      source: 'path',
      field: 'engineRef',
    });
    expect(
      matchPluginOperationPathV1(
        'v1/engines/:engineRef/status',
        'v1/engines/engine-1/status',
      ),
    ).toEqual({ engineRef: 'engine-1' });
    expect(
      matchPluginOperationPathV1(
        'v1/engines/:engineRef/status',
        'v1/projects/engine-1/status',
      ),
    ).toBeNull();
    expect(
      matchPluginOperationPathV1(
        'v1/engines/:engineRef/status',
        'v1/engines/:engineRef/status',
      ),
    ).toBeNull();
  });

  it('validates request and response payloads against digest-bound local schemas', () => {
    const schemaBytes = Buffer.from(
      JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        additionalProperties: false,
        required: ['caseRef'],
        properties: {
          caseRef: {
            $ref: '#/$defs/opaqueRef',
          },
        },
        $defs: {
          opaqueRef: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            pattern: '^[A-Za-z0-9._:-]+$',
          },
        },
      }),
      'utf8',
    );
    const schemaSha256 = createHash('sha256')
      .update(schemaBytes)
      .digest('hex');
    const requestSchema = compilePluginOperationSchemaV1({
      bytes: schemaBytes,
      expectedSha256: schemaSha256,
      direction: 'request',
    });
    const responseSchema = compilePluginOperationSchemaV1({
      bytes: schemaBytes,
      expectedSha256: schemaSha256,
      direction: 'response',
    });

    expect(() => requestSchema.assert({ caseRef: 'case-1' })).not.toThrow();
    expect(() => requestSchema.assert({ caseRef: 'case-1', raw: 'no' }))
      .toThrowError(expect.objectContaining({ code: 'request_schema_invalid' }));
    expect(() => responseSchema.assert({ caseRef: '' })).toThrowError(
      expect.objectContaining({ code: 'response_schema_invalid' }),
    );
    expect(() =>
      compilePluginOperationSchemaV1({
        bytes: schemaBytes,
        expectedSha256: '0'.repeat(64),
        direction: 'request',
      }),
    ).toThrowError(expect.objectContaining({ code: 'schema_digest_invalid' }));

    const remoteSchemaBytes = Buffer.from(
      JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $ref: 'https://attacker.invalid/schema.json',
      }),
      'utf8',
    );
    expect(() =>
      compilePluginOperationSchemaV1({
        bytes: remoteSchemaBytes,
        expectedSha256: createHash('sha256')
          .update(remoteSchemaBytes)
          .digest('hex'),
        direction: 'request',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'schema_document_invalid' }),
    );
  });

  it('bounds per-subject, per-plugin, and concurrent sidecar work', () => {
    const admission = new PluginGatewayAdmissionControllerV1({
      windowMs: 60_000,
      maxRequestsPerSubjectOperation: 2,
      maxRequestsPerPlugin: 3,
      maxConcurrentPerOperation: 1,
    });
    const input = {
      pluginId,
      operationId,
      tenantRef: 'tenant-a',
      subjectRef: 'user-1',
      nowMs: 60_000,
    };
    const first = admission.acquire(input);
    expect(() => admission.acquire(input)).toThrowError(
      expect.objectContaining({ code: 'concurrency_limited' }),
    );
    first.release();
    first.release();
    const second = admission.acquire(input);
    second.release();
    expect(() => admission.acquire(input)).toThrowError(
      expect.objectContaining({ code: 'rate_limited' }),
    );

    const otherSubject = admission.acquire({
      ...input,
      subjectRef: 'user-2',
    });
    otherSubject.release();
    expect(() =>
      admission.acquire({
        ...input,
        subjectRef: 'user-3',
      }),
    ).toThrowError(expect.objectContaining({ code: 'rate_limited' }));

    const nextWindow = admission.acquire({
      ...input,
      nowMs: 120_000,
    });
    nextWindow.release();
  });

  it('opens after failures and permits only one half-open recovery probe', () => {
    const circuit = new PluginGatewayCircuitBreakerV1({
      failureThreshold: 2,
      openMs: 30_000,
    });
    circuit.acquire(pluginId, operationId, 1_000).fail();
    circuit.acquire(pluginId, operationId, 2_000).fail();
    expect(() => circuit.acquire(pluginId, operationId, 3_000)).toThrowError(
      expect.objectContaining({ code: 'circuit_open' }),
    );
    const unrelatedPlugin = circuit.acquire(
      'io.enterpriseglue.unrelated',
      operationId,
      3_000,
    );
    unrelatedPlugin.succeed();

    const probe = circuit.acquire(pluginId, operationId, 32_000);
    expect(() => circuit.acquire(pluginId, operationId, 32_000)).toThrowError(
      expect.objectContaining({ code: 'circuit_open' }),
    );
    probe.fail();
    expect(() => circuit.acquire(pluginId, operationId, 40_000)).toThrowError(
      expect.objectContaining({ code: 'circuit_open' }),
    );

    const recovery = circuit.acquire(pluginId, operationId, 62_000);
    recovery.succeed();
    recovery.fail();
    const closed = circuit.acquire(pluginId, operationId, 62_001);
    closed.succeed();
  });

  it('starts an implicit-time cooldown when the failure completes', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      const circuit = new PluginGatewayCircuitBreakerV1({
        failureThreshold: 1,
        openMs: 2_000,
      });
      const slowRequest = circuit.acquire(pluginId, operationId);
      now.mockReturnValue(5_000);
      slowRequest.fail();

      now.mockReturnValue(5_001);
      expect(() => circuit.acquire(pluginId, operationId)).toThrowError(
        expect.objectContaining({ code: 'circuit_open' }),
      );
      now.mockReturnValue(7_000);
      const probe = circuit.acquire(pluginId, operationId);
      probe.succeed();
    } finally {
      now.mockRestore();
    }
  });

  it('cross-checks capability identity and schema hashes', () => {
    const valid = {
      protocol: 'backend.plugin.enterpriseglue.io/v1',
      pluginId,
      pluginVersion: '1.0.0',
      apiRevision: '1',
      schemaRevision: 0,
      operations: [
        {
          operationId,
          requestSchemaSha256: hash,
          responseSchemaSha256: hash,
        },
      ],
      optionalFeatures: [],
      entitlement: {
        feature: 'example_feature',
        status: 'wind_down',
        reasonCode: 'contracted_wind_down_active',
        validUntil: '2026-08-31T23:59:59.000Z',
      },
    };
    expect(
      validatePluginBackendCapabilitiesV1(manifest(), valid).pluginId,
    ).toBe(pluginId);

    expect(() =>
      validatePluginBackendCapabilitiesV1(manifest(), {
        ...valid,
        pluginVersion: '2.0.0',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'capabilities_identity_invalid' }),
    );
    expect(() =>
      validatePluginBackendCapabilitiesV1(manifest(), {
        ...valid,
        operations: [
          {
            ...valid.operations[0],
            responseSchemaSha256: 'a'.repeat(64),
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'capabilities_operation_mismatch' }),
    );
  });
});
