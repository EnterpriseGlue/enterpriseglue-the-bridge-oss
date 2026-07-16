import { describe, expect, it } from 'vitest';
import {
  IdentitySyncDiagnosticSchema,
  NormalizedExternalIdentitySchema,
  ProviderIdentityInputSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/identity.js';

describe('provider-neutral identity shared contracts', () => {
  it('accepts normalized identity and adapter input without protocol payload fields', () => {
    expect(ProviderIdentityInputSchema.parse({
      providerKey: 'identity.oidc.example', subjectId: 'subject-1', claims: { groups: ['operators'] },
    })).toMatchObject({ providerKey: 'identity.oidc.example', subjectId: 'subject-1' });
    expect(NormalizedExternalIdentitySchema.parse({
      providerKey: 'identity.oidc.example', providerType: 'oidc', subjectId: 'subject-1', observedAt: 1,
      entitlements: [{ type: 'group', externalId: 'operators' }],
    })).toMatchObject({ providerType: 'oidc', entitlements: [{ type: 'group', externalId: 'operators' }] });
  });

  it('rejects raw or unbounded fields from normalized identity and diagnostics', () => {
    expect(() => NormalizedExternalIdentitySchema.parse({
      providerKey: 'identity.oidc.example', providerType: 'oidc', subjectId: 'subject-1', observedAt: 1,
      entitlements: [], rawToken: 'secret',
    })).toThrow();
    expect(() => IdentitySyncDiagnosticSchema.parse({
      providerKey: 'identity.oidc.example', status: 'failed', occurredAt: 1, rawAssertion: '<Assertion />',
    })).toThrow();
  });
});
