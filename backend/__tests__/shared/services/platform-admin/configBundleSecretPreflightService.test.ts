import { afterEach, describe, expect, it, vi } from 'vitest';
import { configBundleSecretPreflightService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleSecretPreflightService.js';

const bundle = {
  apiVersion: 'enterpriseglue.ai/v1alpha1',
  kind: 'EnterpriseGlueConfigBundle',
  metadata: { key: 'acme.authz', owner: 'platform' },
  tenantKey: 'acme',
  mode: 'preview_only',
  settings: {},
  imports: ['./engines.json', './identity-providers.json'],
};

afterEach(() => vi.unstubAllEnvs());

describe('configBundleSecretPreflightService', () => {
  it('reports available opaque references and locations without returning secret values', () => {
    vi.stubEnv('PAYMENTS_ENGINE_PASSWORD', 'not-returned');
    vi.stubEnv('OIDC_CLIENT_SECRET', 'not-returned');

    const result = configBundleSecretPreflightService.check({
      bundle,
      files: {
        './engines.json': { engines: [{ key: 'engine.payments', name: 'Payments', type: 'operaton', baseUrl: 'https://payments.example.test/engine-rest', auth: { type: 'basic', username: 'eg', passwordRef: 'PAYMENTS_ENGINE_PASSWORD' } }] },
        './identity-providers.json': { identityProviders: [{
          key: 'identity.oidc.main', type: 'oidc', enabled: true, authenticationMode: 'claims_only',
          sync: { triggers: ['login'], requiredForLogin: true, incompleteEntitlements: 'fail_closed' },
          oidc: { issuerUrl: 'https://login.example.test', clientId: 'enterpriseglue', clientSecretRef: 'OIDC_CLIENT_SECRET', callbackUrl: 'https://app.example.test/callback', scopes: ['openid'] },
        }] },
      },
    });

    expect(result).toMatchObject({ valid: true, available: true, errors: [] });
    expect(result.references).toEqual([
      { reference: 'OIDC_CLIENT_SECRET', locations: ['./identity-providers.json.identityProviders.0.oidc.clientSecretRef'], available: true },
      { reference: 'PAYMENTS_ENGINE_PASSWORD', locations: ['./engines.json.engines.0.auth.passwordRef'], available: true },
    ]);
    expect(JSON.stringify(result)).not.toContain('not-returned');
  });

  it('reports an unavailable reference without reading or exposing a secret', () => {
    const result = configBundleSecretPreflightService.check({
      bundle: { ...bundle, imports: ['./engines.json'] },
      files: {
        './engines.json': { engines: [{ key: 'engine.payments', name: 'Payments', type: 'operaton', baseUrl: 'https://payments.example.test/engine-rest', auth: { type: 'bearer', tokenRef: 'MISSING_ENGINE_TOKEN' } }] },
      },
    });

    expect(result).toMatchObject({ valid: true, available: false, errors: [] });
    expect(result.references).toEqual([{
      reference: 'MISSING_ENGINE_TOKEN',
      locations: ['./engines.json.engines.0.auth.tokenRef'],
      available: false,
      reason: 'environment_variable_missing',
    }]);
  });

  it('does not inspect references from an invalid bundle', () => {
    const result = configBundleSecretPreflightService.check({
      bundle,
      files: { './engines.json': { engines: [] } },
    });

    expect(result).toMatchObject({ valid: false, available: false });
    expect(result.references).toEqual([]);
  });
});
