import { describe, expect, it } from 'vitest';
import { genericSamlService } from '@enterpriseglue/shared/services/platform-admin/GenericSamlService.js';

const configuration = {
  entityId: 'enterpriseglue-ai',
  callbackUrl: 'https://app.example.test/api/auth/providers/saml/callback',
  ssoUrl: 'https://idp.example.test/sso',
  signingCertificateRef: 'EG_SAML_CERT',
  nameIdAttribute: 'urn:example:subject',
  emailAttribute: 'urn:example:email',
  groupAttribute: 'urn:example:groups',
};

describe('GenericSamlService', () => {
  it('normalizes configured SAML attributes for provider-neutral provisioning and mappings', () => {
    const result = genericSamlService.extractUserClaims(configuration, {
      'urn:example:subject': 'subject-123',
      'urn:example:email': 'Person@Example.test',
      'urn:example:groups': ['finance', 'workflow-admins'],
      givenName: 'Person',
      sn: 'Example',
    });

    expect(result).toEqual(expect.objectContaining({
      subjectId: 'subject-123',
      email: 'person@example.test',
      firstName: 'Person',
      lastName: 'Example',
      claims: expect.objectContaining({ sub: 'subject-123', email: 'person@example.test', groups: ['finance', 'workflow-admins'] }),
    }));
  });

  it('fails closed when a SAML assertion has no configured or standard email attribute', () => {
    expect(() => genericSamlService.extractUserClaims(configuration, { 'urn:example:subject': 'subject-123' }))
      .toThrow('SAML assertion must contain an email address');
  });

  it('rejects SHA-1 SAML signature configuration', () => {
    expect(() => genericSamlService.extractUserClaims({ ...configuration, signatureAlgorithm: 'sha1' }, {
      'urn:example:subject': 'subject-123',
      'urn:example:email': 'person@example.test',
    })).toThrow('SAML signatureAlgorithm must be sha256 or sha512');
  });
});
