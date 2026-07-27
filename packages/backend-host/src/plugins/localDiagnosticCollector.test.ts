import {
  createHash,
  generateKeyPairSync,
  verify,
} from 'node:crypto';
import {
  chmod,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  pluginDiagnosticBundleSignaturePayloadV1,
  pluginSanitizedDiagnosticBundleV1Schema,
  type PluginInvocationClaimsV1,
  type PluginSanitizedDiagnosticBundleV1,
} from '@enterpriseglue/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  LocalSanitizedDiagnosticCollectorV1,
  parseLocalDiagnosticCollectorPolicyV1,
} from './localDiagnosticCollector.js';
import { PluginDiagnosticMetricsRegistryV1 } from './pluginDiagnosticMetrics.js';

const pluginId = 'io.enterpriseglue.ion-support';

describe('LocalSanitizedDiagnosticCollectorV1', () => {
  it('keeps the shipped multi-format policy example schema-valid and disabled', async () => {
    const path = fileURLToPath(
      new URL(
        '../../examples/diagnostic-collector/policy.example.json',
        import.meta.url,
      ),
    );
    const policy = parseLocalDiagnosticCollectorPolicyV1(
      JSON.parse(await readFile(path, 'utf8')),
    );
    expect(policy.plugins).toHaveLength(1);
    expect(policy.plugins[0]?.enabled).toBe(false);
    expect(policy.plugins[0]?.sources.map((source) => source.kind)).toEqual([
      'file_tail',
      'docker_json_file_tail',
      'kubernetes_cri_file_tail',
    ]);
  });

  it('reads only a policy-owned source, filters locally, signs, and hands off', async () => {
    const directory = await mkdtemp(
      resolve(tmpdir(), 'eg-local-collector-'),
    );
    const logPath = resolve(directory, 'engine.log');
    const keyPath = resolve(directory, 'collector-key.pem');
    const tokenPath = resolve(directory, 'handoff-token');
    const policyPath = resolve(directory, 'collector-policy.json');
    const keys = generateKeyPairSync('ed25519');
    const rawValues = [
      'synthetic-customer-secret',
      'operator@example.test',
      '10.20.30.40',
      '1d4f6f90-bc40-4ef8-a1f3-099eac321234',
    ];
    await writeFile(
      logPath,
      [
        'org.operaton.bpm.engine.ProcessEngineException: failed',
        `password=${rawValues[0]}`,
        `owner=${rawValues[1]} remote=${rawValues[2]}`,
        `processInstance=${rawValues[3]}`,
      ].join('\n'),
    );
    await writeFile(
      keyPath,
      keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    );
    await writeFile(tokenPath, 'local-handoff-token');
    await Promise.all([chmod(keyPath, 0o600), chmod(tokenPath, 0o600)]);
    await writeFile(
      policyPath,
      JSON.stringify({
        apiVersion:
          'diagnostic-collector-policy.plugin.enterpriseglue.io/v1',
        plugins: [
          {
            pluginId,
            enabled: true,
            policyRevision: 'policy-1',
            signingKeyId: 'collector-key-1',
            signingPrivateKeyFile: keyPath,
            bearerTokenFile: tokenPath,
            handoffEndpoint:
              'http://127.0.0.1:8788/v1/diagnostic-bundles',
            timeoutMs: 1_000,
            bundleTtlSeconds: 300,
            sources: [
              {
                sourceId: 'io.enterpriseglue.source.engine-log',
                kind: 'file_tail',
                path: logPath,
                engineRefs: ['engine-1'],
                profiles: ['incident_minimal'],
                maxBytes: 64 * 1024,
                maxLines: 1_000,
              },
            ],
          },
        ],
      }),
    );
    let received: PluginSanitizedDiagnosticBundleV1 | undefined;
    const fetchMock = vi.fn(
      async (_url: string, init?: { body?: unknown; headers?: unknown }) => {
        received = pluginSanitizedDiagnosticBundleV1Schema.parse(
          JSON.parse(String(init?.body)),
        );
        expect(init?.headers).toEqual(
          expect.objectContaining({
            Authorization: 'Bearer local-handoff-token',
          }),
        );
        return new Response(
          JSON.stringify({
            apiVersion:
              'sanitized-diagnostic-bundle-receipt.plugin.enterpriseglue.io/v1',
            bundleRef: received.bundleRef,
            status: 'accepted',
            consumerContextRef: received.consumerContextRef,
            artifactRef: 'artifact-1',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    );
    const metrics = new PluginDiagnosticMetricsRegistryV1(
      () => new Date('2026-07-25T00:00:00.000Z'),
    );
    const collector = new LocalSanitizedDiagnosticCollectorV1(policyPath, {
      fetch: fetchMock as never,
      allowLoopbackHttp: true,
      now: () => new Date('2026-07-25T00:00:00.000Z'),
      metrics,
    });

    const result = await collector.collect({
      pluginId,
      claims: claims(),
      request: request(),
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: 'sanitized_bundle_ready',
      filteringBoundary: 'enterpriseglue_backend',
      reasonCode: 'locally_filtered_and_handed_off',
      consumerContextRef: 'case-1',
      artifactRef: 'artifact-1',
    });
    const status = await collector.status({
      pluginId,
      claims: claims(),
    });
    expect(status).toEqual({
      state: 'ready',
      reasonCode: 'collector_ready',
      sourceClass: 'single',
      filteringBoundary: 'enterpriseglue_backend',
      checkedAt: '2026-07-25T00:00:00.000Z',
    });
    expect(JSON.stringify(status)).not.toContain(logPath);
    expect(JSON.stringify(status)).not.toContain(tokenPath);
    expect(JSON.stringify(status)).not.toContain('collector-key-1');
    expect(metrics.snapshot()).toMatchObject({
      collections: [
        {
          pluginId,
          status: 'sanitized_bundle_ready',
          reasonCode: 'locally_filtered_and_handed_off',
          sanitizedByteClass: 'up_to_4_kib',
          count: 1,
        },
      ],
      statusChecks: [
        {
          pluginId,
          state: 'ready',
          reasonCode: 'collector_ready',
          sourceClass: 'single',
          count: 1,
        },
      ],
    });

    expect(received).toBeDefined();
    const bundle = received!;
    const serialized = JSON.stringify(bundle);
    for (const raw of rawValues) expect(serialized).not.toContain(raw);
    expect(serialized).not.toContain(logPath);
    expect(serialized).not.toContain('local-handoff-token');
    expect(bundle.sanitizedContent).toContain('<SECRET>');
    expect(bundle.sanitizedContent).toContain('<EMAIL>');
    expect(bundle.sanitizedContent).toContain('<IP>');
    expect(bundle.sanitizedContent).toContain('<IDENTIFIER>');
    expect(bundle.consumerContextRef).toBe('case-1');
    expect(bundle.contentSha256).toBe(
      createHash('sha256')
        .update(bundle.sanitizedContent, 'utf8')
        .digest('hex'),
    );
    const { signature, ...unsigned } = bundle;
    expect(
      verify(
        null,
        Buffer.from(pluginDiagnosticBundleSignaturePayloadV1(unsigned)),
        keys.publicKey,
        Buffer.from(signature, 'base64'),
      ),
    ).toBe(true);
  });

  it('fails closed for an engine or profile absent from deployment policy', async () => {
    const directory = await mkdtemp(
      resolve(tmpdir(), 'eg-local-collector-denied-'),
    );
    const policyPath = resolve(directory, 'collector-policy.json');
    await writeFile(
      policyPath,
      JSON.stringify({
        apiVersion:
          'diagnostic-collector-policy.plugin.enterpriseglue.io/v1',
        plugins: [
          {
            pluginId,
            enabled: true,
            policyRevision: 'policy-1',
            signingKeyId: 'collector-key-1',
            signingPrivateKeyFile: '/deployment-owned/key.pem',
            bearerTokenFile: '/deployment-owned/token',
            handoffEndpoint: 'https://support.example.test/v1/bundles',
            sources: [
              {
                sourceId: 'io.enterpriseglue.source.engine-log',
                kind: 'file_tail',
                path: '/deployment-owned/engine.log',
                engineRefs: ['another-engine'],
                profiles: ['incident_minimal'],
                maxBytes: 1_024,
                maxLines: 100,
              },
            ],
          },
        ],
      }),
    );
    const collector = new LocalSanitizedDiagnosticCollectorV1(policyPath, {
      fetch: vi.fn() as never,
    });

    await expect(
      collector.collect({
        pluginId,
        claims: claims(),
        request: request(),
      }),
    ).resolves.toMatchObject({
      status: 'rejected',
      reasonCode: 'collector_source_not_approved',
    });
    await expect(
      collector.status({ pluginId, claims: claims() }),
    ).resolves.toMatchObject({
      state: 'degraded',
      reasonCode: 'collector_signing_key_invalid',
      sourceClass: 'single',
    });
  });

  it.each([
    {
      kind: 'docker_json_file_tail' as const,
      raw: `${JSON.stringify({
        log: 'ProcessEngineException: docker failure password=container-secret\n',
        stream: 'stderr',
        time: '2026-07-25T00:00:00.123456789Z',
        attrs: { pod: 'deployment-detail-not-for-support' },
      })}\n`,
      expected: '2026-07-25T00:00:00.123456789Z stderr ProcessEngineException',
      excluded: 'deployment-detail-not-for-support',
    },
    {
      kind: 'kubernetes_cri_file_tail' as const,
      raw:
        '2026-07-25T00:00:00.123456789Z stdout F ' +
        'ProcessEngineException: pod failure password=container-secret\n',
      expected:
        '2026-07-25T00:00:00.123456789Z stdout F ProcessEngineException',
      excluded: 'container-secret',
    },
  ])(
    'normalizes and locally filters a deployment-owned $kind source',
    async ({ kind, raw, expected, excluded }) => {
      let received: PluginSanitizedDiagnosticBundleV1 | undefined;
      const fetchMock = vi.fn(
        async (_url: string, init?: { body?: unknown }) => {
          received = pluginSanitizedDiagnosticBundleV1Schema.parse(
            JSON.parse(String(init?.body)),
          );
          return new Response(
            JSON.stringify({
              apiVersion:
                'sanitized-diagnostic-bundle-receipt.plugin.enterpriseglue.io/v1',
              bundleRef: received.bundleRef,
              status: 'accepted',
              consumerContextRef: received.consumerContextRef,
              artifactRef: 'artifact-structured',
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        },
      );
      const collector = await collectorForSource(kind, raw, fetchMock);

      await expect(
        collector.collect({
          pluginId,
          claims: claims(),
          request: request(),
        }),
      ).resolves.toMatchObject({
        status: 'sanitized_bundle_ready',
        artifactRef: 'artifact-structured',
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(received?.sanitizedContent).toContain(expected);
      expect(received?.sanitizedContent).toContain('password=<SECRET>');
      expect(JSON.stringify(received)).not.toContain(excluded);
    },
  );

  it('rejects a malformed structured source without a handoff', async () => {
    const fetchMock = vi.fn();
    const collector = await collectorForSource(
      'docker_json_file_tail',
      '{"stream":"stderr","time":"2026-07-25T00:00:00Z"}\n',
      fetchMock,
    );

    await expect(
      collector.collect({
        pluginId,
        claims: claims(),
        request: request(),
      }),
    ).resolves.toMatchObject({
      status: 'rejected',
      reasonCode: 'collector_source_format_invalid',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

async function collectorForSource(
  kind:
    | 'docker_json_file_tail'
    | 'kubernetes_cri_file_tail',
  raw: string,
  fetchImplementation: ReturnType<typeof vi.fn>,
): Promise<LocalSanitizedDiagnosticCollectorV1> {
  const directory = await mkdtemp(
    resolve(tmpdir(), 'eg-local-structured-collector-'),
  );
  const logPath = resolve(directory, 'engine.log');
  const keyPath = resolve(directory, 'collector-key.pem');
  const tokenPath = resolve(directory, 'handoff-token');
  const policyPath = resolve(directory, 'collector-policy.json');
  const keys = generateKeyPairSync('ed25519');
  await writeFile(logPath, raw);
  await writeFile(
    keyPath,
    keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  );
  await writeFile(tokenPath, 'local-handoff-token');
  await Promise.all([chmod(keyPath, 0o600), chmod(tokenPath, 0o600)]);
  await writeFile(
    policyPath,
    JSON.stringify({
      apiVersion:
        'diagnostic-collector-policy.plugin.enterpriseglue.io/v1',
      plugins: [
        {
          pluginId,
          enabled: true,
          policyRevision: 'policy-structured-1',
          signingKeyId: 'collector-key-structured-1',
          signingPrivateKeyFile: keyPath,
          bearerTokenFile: tokenPath,
          handoffEndpoint:
            'http://127.0.0.1:8788/v1/diagnostic-bundles',
          timeoutMs: 1_000,
          bundleTtlSeconds: 300,
          sources: [
            {
              sourceId: 'io.enterpriseglue.source.structured-engine-log',
              kind,
              path: logPath,
              engineRefs: ['engine-1'],
              profiles: ['incident_minimal'],
              maxBytes: 64 * 1024,
              maxLines: 1_000,
            },
          ],
        },
      ],
    }),
  );
  return new LocalSanitizedDiagnosticCollectorV1(policyPath, {
    fetch: fetchImplementation as never,
    allowLoopbackHttp: true,
    now: () => new Date('2026-07-25T00:00:00.000Z'),
  });
}

function claims(): PluginInvocationClaimsV1 {
  return {
    iss: 'enterpriseglue-oss',
    aud: pluginId,
    sub: 'user-1',
    iat: 1,
    exp: 2,
    jti: 'invocation-1',
    tenantRef: 'tenant-1',
    deploymentRef: 'deployment-1',
    operationId: `${pluginId}.collect`,
    grantedPermissions: [
      'host.engine.diagnostics.collect_sanitized' as const,
    ],
    resourceRefs: [
      { kind: 'engine' as const, ref: 'engine-1' },
      { kind: 'incident' as const, ref: 'incident-1' },
    ],
    correlationId: 'correlation-1',
  };
}

function request() {
  return {
    apiVersion:
      'diagnostic-collection-request.plugin.enterpriseglue.io/v1' as const,
    callId: 'collector-call-1',
    operationId: `${pluginId}.collect`,
    engineRef: 'engine-1',
    trigger: { kind: 'incident' as const, incidentRef: 'incident-1' },
    profile: 'incident_minimal' as const,
    mode: 'sanitized_bundle_auto' as const,
    idempotencyKey: 'diagnostic-intent-1',
    consumerContextRef: 'case-1',
  };
}
