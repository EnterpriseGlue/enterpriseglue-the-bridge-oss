import { describe, expect, it } from 'vitest';
import {
  ConfigEnginesFileSchema,
  ConfigIdentityProvidersFileSchema,
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

  it('canonicalizes object key order but preserves array order for exact preview hashes', () => {
    const left = { metadata: { owner: 'iam', key: 'acme' }, imports: ['./roles.json', './groups.json'] };
    const right = { imports: ['./roles.json', './groups.json'], metadata: { key: 'acme', owner: 'iam' } };
    const reorderedArray = { imports: ['./groups.json', './roles.json'], metadata: { key: 'acme', owner: 'iam' } };

    expect(canonicalizeConfigJson(left)).toBe(canonicalizeConfigJson(right));
    expect(hashCanonicalConfig(left)).toBe(hashCanonicalConfig(right));
    expect(hashCanonicalConfig(left)).not.toBe(hashCanonicalConfig(reorderedArray));
  });
});
