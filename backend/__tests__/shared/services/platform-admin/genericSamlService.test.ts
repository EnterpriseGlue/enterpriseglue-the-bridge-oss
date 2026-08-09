import { afterEach, describe, expect, it } from 'vitest';
import { genericSamlService } from '@enterpriseglue/shared/services/platform-admin/GenericSamlService.js';
import { MOCK_SAML_REQUEST_ID, MockSamlIdentityProvider } from '../../../../test/identity-mocks/index.js';

const configuration = {
  entityId: 'enterpriseglue-ai',
  idpEntityId: 'https://saml-mock.example.test',
  callbackUrl: 'http://localhost:5173/api/auth/providers/saml/callback',
  ssoUrl: 'https://idp.example.test/sso',
  signingCertificateRef: 'EG_SAML_CERT',
  nameIdAttribute: 'urn:example:subject',
  emailAttribute: 'urn:example:email',
  groupAttribute: 'urn:example:groups',
};

describe('GenericSamlService', () => {
  afterEach(async () => {
    delete process.env.EG_SAML_PROTOCOL_CERT;
  });

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
    const extract = () => genericSamlService.extractUserClaims(configuration, { 'urn:example:subject': 'subject-123' });
    expect(extract)
      .toThrow('SAML assertion must contain an email address');
    expect(extract).toThrow(expect.objectContaining({ code: 'missing_subject' }));
  });

  it('rejects SHA-1 SAML signature configuration', () => {
    expect(() => genericSamlService.extractUserClaims({ ...configuration, signatureAlgorithm: 'sha1' }, {
      'urn:example:subject': 'subject-123',
      'urn:example:email': 'person@example.test',
    })).toThrow('SAML signatureAlgorithm must be sha256 or sha512');
  });

  it('validates a signed SAML response from the protocol mock', async () => {
    const provider = new MockSamlIdentityProvider();
    process.env.EG_SAML_PROTOCOL_CERT = provider.certificate();

    const profile = await genericSamlService.validatePostResponse({
      ...configuration,
      signingCertificateRef: 'EG_SAML_PROTOCOL_CERT',
    }, provider.signedResponse(), MOCK_SAML_REQUEST_ID);

    expect(profile).toMatchObject({
      nameID: 'person@example.test',
      role: 'operator',
      'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups': ['payments', 'operations'],
    });
  });

  it('rejects a signed SAML assertion modified after signing', async () => {
    const provider = new MockSamlIdentityProvider();
    process.env.EG_SAML_PROTOCOL_CERT = provider.certificate();
    const tampered = Buffer.from(
      Buffer.from(provider.signedResponse(), 'base64').toString('utf8').replace('payments', 'administrators'),
    ).toString('base64');

    await expect(genericSamlService.validatePostResponse({
      ...configuration,
      signingCertificateRef: 'EG_SAML_PROTOCOL_CERT',
    }, tampered, MOCK_SAML_REQUEST_ID)).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('requires the configured certificate to rotate with SAML signing material', async () => {
    const provider = new MockSamlIdentityProvider();
    process.env.EG_SAML_PROTOCOL_CERT = provider.certificate();
    provider.rotateSigningMaterial();
    const response = provider.signedResponse();

    await expect(genericSamlService.validatePostResponse({
      ...configuration,
      signingCertificateRef: 'EG_SAML_PROTOCOL_CERT',
    }, response, MOCK_SAML_REQUEST_ID)).rejects.toThrow(/signature/i);

    process.env.EG_SAML_PROTOCOL_CERT = provider.certificate();
    await expect(genericSamlService.validatePostResponse({
      ...configuration,
      signingCertificateRef: 'EG_SAML_PROTOCOL_CERT',
    }, response, MOCK_SAML_REQUEST_ID)).resolves.toMatchObject({ nameID: 'person@example.test' });

  });

  it.each([
    ['missing request correlation', { inResponseTo: null }],
    ['wrong request correlation', { inResponseTo: '_wrong_authentication_request_000000000000000000000000000001' }],
    ['wrong identity provider issuer', { issuer: 'https://another-idp.example.test' }],
  ])('rejects a signed response with %s', async (_label, options) => {
    const provider = new MockSamlIdentityProvider();
    process.env.EG_SAML_PROTOCOL_CERT = provider.certificate();
    await expect(genericSamlService.validatePostResponse({
      ...configuration,
      signingCertificateRef: 'EG_SAML_PROTOCOL_CERT',
    }, provider.signedResponse(options), MOCK_SAML_REQUEST_ID)).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('uses fresh signing material for each test provider instance', () => {
    const first = new MockSamlIdentityProvider();
    const second = new MockSamlIdentityProvider();

    expect(first.certificate()).not.toEqual(second.certificate());
  });

});
