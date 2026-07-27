import { describe, expect, it } from 'vitest';

import {
  pluginBackendCapabilitiesV1Schema,
  pluginInvocationClaimsV1Schema,
  pluginSecretBrokerPolicyV1Schema,
  pluginSecretUseRequestV1Schema,
} from './backend.js';

const hash = 'b'.repeat(64);

describe('plugin backend contracts', () => {
  it('accepts bounded namespaced invocation claims', () => {
    const claims = pluginInvocationClaimsV1Schema.parse({
      iss: 'enterpriseglue-oss',
      aud: 'io.enterpriseglue.ion-support',
      sub: 'subject-1',
      iat: 100,
      exp: 160,
      jti: 'invocation-1',
      tenantRef: 'tenant-1',
      deploymentRef: 'deployment-1',
      operationId: 'io.enterpriseglue.ion-support.create-case',
      grantedPermissions: ['host.identity.read_safe'],
      resourceRefs: [{ kind: 'incident', ref: 'incident-1' }],
      correlationId: 'correlation-1',
    });

    expect(claims.aud).toBe('io.enterpriseglue.ion-support');
  });

  it('rejects wrong-audience operation claims and invalid lifetimes', () => {
    const result = pluginInvocationClaimsV1Schema.safeParse({
      iss: 'enterpriseglue-oss',
      aud: 'io.enterpriseglue.ion-support',
      sub: 'subject-1',
      iat: 160,
      exp: 100,
      jti: 'invocation-1',
      deploymentRef: 'deployment-1',
      operationId: 'io.attacker.operation',
      grantedPermissions: [],
      correlationId: 'correlation-1',
    });

    expect(result.success).toBe(false);
  });

  it('accepts safe capabilities and rejects duplicate operation IDs', () => {
    const capability = {
      protocol: 'backend.plugin.enterpriseglue.io/v1',
      pluginId: 'io.enterpriseglue.ion-support',
      pluginVersion: '1.0.0',
      apiRevision: '2026-07-24',
      schemaRevision: 1,
      operations: [
        {
          operationId: 'io.enterpriseglue.ion-support.create-case',
          requestSchemaSha256: hash,
          responseSchemaSha256: hash,
        },
      ],
      optionalFeatures: ['case_events'],
      entitlement: {
        feature: 'ion_support',
        status: 'active',
        reasonCode: 'active',
      },
    };

    expect(pluginBackendCapabilitiesV1Schema.safeParse(capability).success).toBe(
      true,
    );

    capability.operations.push({ ...capability.operations[0] });
    expect(pluginBackendCapabilitiesV1Schema.safeParse(capability).success).toBe(
      false,
    );
  });

  it('accepts a closed tenant-bound secret-use policy and request', () => {
    expect(
      pluginSecretBrokerPolicyV1Schema.parse({
        apiVersion: 'secret-broker-policy.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginSecretBrokerPolicy',
        entries: [
          {
            pluginId: 'io.enterpriseglue.ion-support',
            reference: 'ion-support-access-token',
            operation: 'http.bearer-json-v1',
            invocationOperations: [
              'io.enterpriseglue.ion-support.create-case',
            ],
            baseUrl: 'https://support.enterpriseglue.io',
            tenantBoundPath: 't/{tenant}/support-agent-api/v1',
            allowedMethods: ['POST'],
            allowedPathPrefixes: ['cases'],
            credentialFile:
              '/run/enterpriseglue/plugin-broker/secrets/ion-support-access-token',
            timeoutMs: 10_000,
            maxRequestBytes: 24_576,
            maxResponseBytes: 65_536,
          },
        ],
      }).entries,
    ).toHaveLength(1);

    expect(
      pluginSecretUseRequestV1Schema.parse({
        apiVersion: 'secret-use.plugin.enterpriseglue.io/v1',
        callId: 'create-case',
        operationId: 'io.enterpriseglue.ion-support.create-case',
        reference: 'ion-support-access-token',
        operation: 'http.bearer-json-v1',
        payload: {
          method: 'POST',
          path: 'cases',
          body: { title: 'Sanitized question' },
          idempotencyKey: 'plugin-invocation-1',
        },
      }).payload.path,
    ).toBe('cases');
  });

  it('rejects duplicate, cross-plugin, or non-tenant-bound broker policy', () => {
    const entry = {
      pluginId: 'io.enterpriseglue.ion-support',
      reference: 'ion-support-access-token',
      operation: 'http.bearer-json-v1',
      invocationOperations: ['io.attacker.create-case'],
      baseUrl: 'https://support.enterpriseglue.io',
      tenantBoundPath: 'support-agent-api/v1',
      allowedMethods: ['POST'],
      allowedPathPrefixes: ['cases'],
      credentialFile:
        '/run/enterpriseglue/plugin-broker/secrets/ion-support-access-token',
      timeoutMs: 10_000,
      maxRequestBytes: 24_576,
      maxResponseBytes: 65_536,
    };
    expect(
      pluginSecretBrokerPolicyV1Schema.safeParse({
        apiVersion: 'secret-broker-policy.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginSecretBrokerPolicy',
        entries: [entry, entry],
      }).success,
    ).toBe(false);
    expect(
      pluginSecretUseRequestV1Schema.safeParse({
        apiVersion: 'secret-use.plugin.enterpriseglue.io/v1',
        callId: 'create-case',
        operationId: 'io.enterpriseglue.ion-support.create-case',
        reference: 'ion-support-access-token',
        operation: 'http.bearer-json-v1',
        payload: {
          method: 'POST',
          path: 'cases/%2e%2e/admin',
        },
      }).success,
    ).toBe(false);
  });
});
