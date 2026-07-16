import { describe, expect, it } from 'vitest';
import {
  ConfigBundleApplyResultSchema,
  ConfigBundleApplyRunSchema,
  ConfigBundleIdentityReplayTaskSchema,
  ConfigBundleRuntimeReconciliationTaskSchema,
  ConfigEnginesFileSchema,
  ConfigIdentityProvidersFileSchema,
  ConfigProjectEngineTargetsFileSchema,
  ConfigRolesFileSchema,
  EnterpriseGlueConfigBundleSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
import {
  canonicalizeConfigJson,
  hashCanonicalConfig,
} from '@enterpriseglue/shared/services/platform-admin/config-bundle-hash.js';

describe('EnterpriseGlue configuration bundle contracts', () => {
  it('accepts a deterministic production manifest with only declared imports', () => {
    const result = EnterpriseGlueConfigBundleSchema.parse({
      apiVersion: 'enterpriseglue.ai/v1alpha1',
      kind: 'EnterpriseGlueConfigBundle',
      metadata: {
        key: 'acme-prod-authz',
        owner: 'iam-platform-team',
      },
      tenantKey: 'default',
      mode: 'authoritative',
      settings: {
        engineAccessAuthority: 'sso_managed',
        projectAccessAuthority: 'manual',
        engineOnboardingMode: 'external_only',
        projectEngineTargetMode: 'hybrid',
        engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative',
      },
      imports: ['./roles.json', './groups.json', './identity-providers.json'],
    });

    expect(result.metadata.key).toBe('acme-prod-authz');
    expect(result.settings.engineRuntimeAuthorizationMode).toBe('enterpriseglue_authoritative');
  });

  it('rejects duplicate and test-only manifest imports', () => {
    const input = {
      apiVersion: 'enterpriseglue.ai/v1alpha1',
      kind: 'EnterpriseGlueConfigBundle',
      metadata: { key: 'acme-prod-authz', owner: 'iam-platform-team' },
      tenantKey: 'default',
      mode: 'preview_only',
      settings: {},
      imports: ['./roles.json', './roles.json', './test/identity-mocks/subjects.json'],
    };

    expect(EnterpriseGlueConfigBundleSchema.safeParse(input).success).toBe(false);
  });

  it('allows explicit custom roles and rejects system-role mutation', () => {
    expect(ConfigRolesFileSchema.safeParse({
      roles: [{
        key: 'custom.engine.viewer',
        name: 'Engine Viewer',
        scope: 'engine',
        permissions: ['engine:view', 'engine:runtime:process-instances:view'],
      }],
    }).success).toBe(true);

    expect(ConfigRolesFileSchema.safeParse({
      roles: [{
        key: 'system.engine.viewer',
        name: 'Mutated default',
        scope: 'engine',
        permissions: ['engine:view'],
      }],
    }).success).toBe(false);
  });

  it('rejects duplicate configuration object keys', () => {
    expect(ConfigRolesFileSchema.safeParse({
      roles: [
        { key: 'custom.engine.viewer', name: 'Viewer', scope: 'engine', permissions: ['engine:view'] },
        { key: 'custom.engine.viewer', name: 'Duplicate viewer', scope: 'engine', permissions: ['engine:view'] },
      ],
    }).success).toBe(false);
  });

  it('requires immutable project IDs in project-engine target references', () => {
    const target = {
      engineRef: { engineKey: 'engine-prod-payments' },
      allowCiDeploy: true,
    };
    expect(ConfigProjectEngineTargetsFileSchema.safeParse({
      projectEngineTargets: [{ ...target, projectRef: { id: '00000000-0000-4000-8000-000000000001' } }],
    }).success).toBe(true);
    expect(ConfigProjectEngineTargetsFileSchema.safeParse({
      projectEngineTargets: [{ ...target, projectRef: { key: 'project.payments' } }],
    }).success).toBe(false);
  });

  it('rejects duplicate project-engine target pairs and optional config keys', () => {
    const target = {
      key: 'target.payments',
      projectRef: { id: '00000000-0000-4000-8000-000000000001' },
      engineRef: { engineKey: 'engine-prod-payments' },
      allowCiDeploy: true,
    };
    expect(ConfigProjectEngineTargetsFileSchema.safeParse({
      projectEngineTargets: [target, { ...target, key: 'target.payments-secondary' }],
    }).success).toBe(false);
    expect(ConfigProjectEngineTargetsFileSchema.safeParse({
      projectEngineTargets: [target, {
        ...target,
        projectRef: { id: '00000000-0000-4000-8000-000000000002' },
      }],
    }).success).toBe(false);
  });

  it('allows only opaque secret references and requires sidecar mode for credentialless engines', () => {
    expect(ConfigEnginesFileSchema.safeParse({
      engines: [{
        key: 'engine-prod-payments',
        name: 'Payments sidecar',
        type: 'operaton',
        baseUrl: 'https://payments-sidecar.internal/engine-rest',
        connectionMode: 'customer_sidecar',
        auth: { type: 'none' },
      }],
    }).success).toBe(true);

    expect(ConfigEnginesFileSchema.safeParse({
      engines: [{
        key: 'engine-prod-payments',
        name: 'Unsafe direct engine',
        type: 'operaton',
        baseUrl: 'https://engine.example.com/engine-rest',
        connectionMode: 'direct',
        auth: { type: 'none' },
      }],
    }).success).toBe(false);

    expect(ConfigEnginesFileSchema.safeParse({
      engines: [{
        key: 'engine-prod-payments',
        name: 'Plaintext secret',
        type: 'operaton',
        baseUrl: 'https://engine.example.com/engine-rest',
        auth: { type: 'basic', username: 'eg-client', password: 'not-a-reference' },
      }],
    }).success).toBe(false);
  });

  it('forbids plaintext credential fields across engine and identity-provider bundle contracts', () => {
    const engine = {
      key: 'engine-prod-payments',
      name: 'Payments',
      type: 'operaton',
      baseUrl: 'https://engine.example.com/engine-rest',
    };

    for (const auth of [
      { type: 'basic', username: 'eg-client', password: 'engine-basic-secret-sentinel' },
      { type: 'bearer', token: 'engine-bearer-secret-sentinel' },
      { type: 'oauth2-client-credentials', username: 'eg-client', password: 'engine-oauth-secret-sentinel', tokenUrl: 'https://identity.example.com/token' },
    ]) {
      expect(ConfigEnginesFileSchema.safeParse({ engines: [{ ...engine, auth }] }).success).toBe(false);
    }

    const provider = {
      key: 'customer-oidc',
      type: 'oidc',
      sync: { triggers: ['login'] },
      oidc: {
        issuerUrl: 'https://login.example.com',
        clientId: 'client-id',
        callbackUrl: 'https://enterpriseglue.ai/auth/callback',
        scopes: ['openid'],
      },
    };
    expect(ConfigIdentityProvidersFileSchema.safeParse({
      identityProviders: [{ ...provider, oidc: { ...provider.oidc, clientSecret: 'oidc-secret-sentinel' } }],
    }).success).toBe(false);
    expect(ConfigIdentityProvidersFileSchema.safeParse({
      identityProviders: [{
        key: 'customer-ldap', type: 'ldap', sync: { triggers: ['login'] },
        ldap: {
          url: 'ldaps://directory.example.com:636', bindDn: 'CN=EnterpriseGlue,DC=example,DC=com', bindPassword: 'ldap-secret-sentinel',
          userBaseDn: 'OU=Users,DC=example,DC=com', userSearchFilter: '(uid={{username}})', groupBaseDn: 'OU=Groups,DC=example,DC=com',
          groupIdAttribute: 'entryUUID', membershipMode: 'memberOf',
        },
      }],
    }).success).toBe(false);
    expect(ConfigIdentityProvidersFileSchema.safeParse({
      identityProviders: [{
        key: 'customer-saml', type: 'saml', sync: { triggers: ['login'] },
        saml: {
          entityId: 'enterpriseglue-ai', callbackUrl: 'https://app.example.test/callback', ssoUrl: 'https://idp.example.test/sso',
          signingCertificate: 'saml-certificate-sentinel', nameIdAttribute: 'nameID',
        },
      }],
    }).success).toBe(false);
  });

  it('accepts stable engine metadata labels and rejects display-oriented keys', () => {
    expect(ConfigEnginesFileSchema.safeParse({
      engines: [{ key: 'engine-prod-payments', name: 'Payments', type: 'operaton', baseUrl: 'https://engine.example.com/engine-rest', labels: { country: 'TR', businessUnit: 'payments', customer_segment: 'enterprise' }, auth: { type: 'bearer', tokenRef: 'EG_ENGINE_TOKEN' } }],
    }).success).toBe(true);
    expect(ConfigEnginesFileSchema.safeParse({
      engines: [{ key: 'engine-prod-payments', name: 'Payments', type: 'operaton', baseUrl: 'https://engine.example.com/engine-rest', labels: { 'Business Unit': 'payments' }, auth: { type: 'bearer', tokenRef: 'EG_ENGINE_TOKEN' } }],
    }).success).toBe(false);
  });

  it('keeps protocol-specific provider fields scoped to the selected adapter', () => {
    expect(ConfigIdentityProvidersFileSchema.safeParse({
      identityProviders: [{
        key: 'turkiye-ldap',
        type: 'ldap',
        sync: { triggers: ['login'], requiredForLogin: true, incompleteEntitlements: 'fail_closed' },
        ldap: {
          url: 'ldaps://directory.customer.local:636',
          bindDn: 'CN=EnterpriseGlue,OU=ServiceAccounts,DC=customer,DC=local',
          bindPasswordRef: 'EG_LDAP_BIND_PASSWORD',
          userBaseDn: 'OU=Users,DC=customer,DC=local',
          userSearchFilter: '(sAMAccountName={{username}})',
          groupBaseDn: 'OU=SecurityGroups,DC=customer,DC=local',
          groupIdAttribute: 'entryUUID',
          membershipMode: 'memberOf',
        },
      }],
    }).success).toBe(true);

    expect(ConfigIdentityProvidersFileSchema.safeParse({
      identityProviders: [{
        key: 'invalid-oidc',
        type: 'oidc',
        sync: { triggers: ['login'] },
        oidc: {
          issuerUrl: 'https://login.example.com',
          clientId: 'client-id',
          callbackUrl: 'https://enterpriseglue.ai/auth/callback',
          scopes: ['openid'],
          clientSecret: 'plaintext',
        },
      }],
    }).success).toBe(false);
  });

  it('requires complete direct SAML runtime configuration with a secret reference', () => {
    const provider = {
      key: 'customer-saml', type: 'saml', authenticationMode: 'direct', sync: { triggers: ['login'] },
      saml: {
        entityId: 'enterpriseglue-ai',
        callbackUrl: 'https://app.example.test/api/auth/providers/saml/callback',
        ssoUrl: 'https://idp.example.test/sso',
        signingCertificateRef: 'EG_SAML_SIGNING_CERT',
        nameIdAttribute: 'nameID',
      },
    };
    expect(ConfigIdentityProvidersFileSchema.safeParse({ identityProviders: [provider] }).success).toBe(true);
    expect(ConfigIdentityProvidersFileSchema.safeParse({ identityProviders: [{ ...provider, saml: { ...provider.saml, signingCertificateRef: undefined } }] }).success).toBe(false);
    expect(ConfigIdentityProvidersFileSchema.parse({ identityProviders: [{ ...provider, allowVerifiedEmailLinking: true }] }).identityProviders[0].allowVerifiedEmailLinking).toBe(true);
  });

  it('canonicalizes object key order but preserves array order for exact preview hashes', () => {
    const left = { metadata: { owner: 'iam', key: 'acme' }, imports: ['./roles.json', './groups.json'] };
    const right = { imports: ['./roles.json', './groups.json'], metadata: { key: 'acme', owner: 'iam' } };
    const reorderedArray = { imports: ['./groups.json', './roles.json'], metadata: { key: 'acme', owner: 'iam' } };

    expect(canonicalizeConfigJson(left)).toBe(canonicalizeConfigJson(right));
    expect(hashCanonicalConfig(left)).toBe(hashCanonicalConfig(right));
    expect(hashCanonicalConfig(left)).not.toBe(hashCanonicalConfig(reorderedArray));
  });

  it('validates sanitized apply receipts and durable reconciliation tasks', () => {
    const reconciliation = {
      status: 'completed' as const, engineSetCount: 1, runtimeResourceSetCount: 1, engineCount: 2,
      identitySnapshot: { mode: 'apply' as const, status: 'truncated' as const, providerCount: 1, scanned: 500, created: 2, removed: 1, failed: 0 },
      runtimeReconciliation: { status: 'queued' as const, taskId: 'task-1', engineSetCount: 1, runtimeResourceSetCount: 1, engineCount: 2 },
    };
    expect(ConfigBundleApplyResultSchema.parse({ canonicalHash: 'hash-1', created: 1, updated: 2, archived: 0, changes: [], reconciliation, applyRunId: 'run-1' }).reconciliation.identitySnapshot.status).toBe('truncated');
    expect(ConfigBundleApplyRunSchema.parse({ id: 'run-1', bundleKey: 'acme-prod-authz', bundleApiVersion: 'enterpriseglue.ai/v1alpha1', idempotencyKey: 'idempotency-1', actorId: 'user-1', status: 'succeeded', errorMessage: null, completedAt: 2, createdAt: 1, canonicalHash: 'hash-1', reconciliation }).canonicalHash).toBe('hash-1');
    expect(ConfigBundleIdentityReplayTaskSchema.parse({ id: 'identity-task-1', providerId: 'provider-1', syncRunId: 'sync-1', status: 'queued', attempts: 0, nextAttemptAt: 2, scanned: 500, created: 2, removed: 1, failed: 0, lastError: null, completedAt: null, createdAt: 1, updatedAt: 1 }).providerId).toBe('provider-1');
    expect(ConfigBundleRuntimeReconciliationTaskSchema.parse({ id: 'runtime-task-1', status: 'queued', attempts: 0, nextAttemptAt: 2, engineSetIds: ['set-1'], runtimeResourceSetIds: ['resource-set-1'], engineIds: ['engine-1'], lastError: null, completedAt: null, createdAt: 1, updatedAt: 1 }).engineIds).toEqual(['engine-1']);
  });
});
