import { afterEach, describe, expect, it } from 'vitest';
import { genericSamlService } from '@enterpriseglue/shared/services/platform-admin/GenericSamlService.js';
import { MOCK_SAML_REQUEST_ID, MockSamlHttpsServer, MockSamlIdentityProvider } from '../../identity-mocks/index.js';

const configuration = {
  entityId: 'enterpriseglue-ai',
  idpEntityId: 'https://saml-mock.example.test',
  callbackUrl: 'http://localhost:5173/api/auth/providers/saml/callback',
  ssoUrl: 'https://idp.example.test/sso',
  signingCertificateRef: 'EG_SAML_PROTOCOL_CERT',
  nameIdAttribute: 'urn:example:subject',
  emailAttribute: 'urn:example:email',
  groupAttribute: 'urn:example:groups',
};

describe('loopback SAML protocol mock', () => {
  let transport: MockSamlHttpsServer | null = null;

  afterEach(async () => {
    delete process.env.EG_SAML_PROTOCOL_CERT;
    await transport?.stop();
    transport = null;
  });

  it('serves metadata and a signed browser-post response over an ephemeral loopback port', async () => {
    transport = new MockSamlHttpsServer();
    await transport.start();
    process.env.EG_SAML_PROTOCOL_CERT = transport.provider!.certificate();

    const metadata = await transport.fetch(`${transport.issuer}/metadata`);
    expect(metadata.status).toBe(200);
    await expect(metadata.text()).resolves.toContain('SingleSignOnService');

    const sso = await transport.fetch(`${transport.issuer}/sso?RelayState=state-1`);
    const html = await sso.text();
    const response = html.match(/name="SAMLResponse" value="([^"]+)"/)?.[1];
    expect(response).toBeTruthy();
    expect(html).toContain('name="RelayState" value="state-1"');

    await expect(genericSamlService.validatePostResponse({
      ...configuration,
      ssoUrl: `${transport.issuer}/sso`,
      idpEntityId: transport.issuer,
    }, response!, MOCK_SAML_REQUEST_ID)).resolves.toMatchObject({ nameID: 'person@example.test', role: 'operator' });
  });

  it('applies in-process subject and multi-valued group changes to the next browser-post assertion', async () => {
    transport = new MockSamlHttpsServer();
    await transport.start();
    transport.provider!.setAttributes({
      nameID: 'changed@example.test',
      'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups': ['operations', 'payments'],
      role: ['operator', 'reviewer'],
    });
    process.env.EG_SAML_PROTOCOL_CERT = transport.provider!.certificate();

    const html = await (await transport.fetch(`${transport.issuer}/sso`)).text();
    const response = html.match(/name="SAMLResponse" value="([^"]+)"/)?.[1];
    const profile = await genericSamlService.validatePostResponse({
      ...configuration,
      ssoUrl: `${transport.issuer}/sso`, idpEntityId: transport.issuer,
    }, response!, MOCK_SAML_REQUEST_ID);

    expect(profile).toMatchObject({
      nameID: 'changed@example.test',
      role: ['operator', 'reviewer'],
      'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups': ['operations', 'payments'],
    });
  });

  it.each([
    ['a wrong audience', { audience: 'another-service' }],
    ['a wrong recipient', { callbackUrl: 'https://other.example.test/saml/callback' }],
    ['an expired assertion', { notBefore: new Date(Date.now() - 420_000), notOnOrAfter: new Date(Date.now() - 360_000) }],
  ])('rejects a correctly signed assertion with %s', async (_label, options) => {
    const provider = new MockSamlIdentityProvider();
    process.env.EG_SAML_PROTOCOL_CERT = provider.certificate();

    await expect(genericSamlService.validatePostResponse(configuration, provider.signedResponse(options), MOCK_SAML_REQUEST_ID))
      .rejects.toThrow();
  });

  it('normalizes a missing NameID through the configured immutable email attribute', async () => {
    const provider = new MockSamlIdentityProvider();
    provider.setAttributes({ nameID: '', 'urn:example:email': 'NoNameId@Example.test' });
    process.env.EG_SAML_PROTOCOL_CERT = provider.certificate();

    const profile = await genericSamlService.validatePostResponse(configuration, provider.signedResponse(), MOCK_SAML_REQUEST_ID);
    expect(genericSamlService.extractUserClaims(configuration, profile)).toMatchObject({
      subjectId: 'NoNameId@Example.test',
      email: 'nonameid@example.test',
    });
  });

  it('rejects malformed SAML before a profile can be produced', async () => {
    const provider = new MockSamlIdentityProvider();
    process.env.EG_SAML_PROTOCOL_CERT = provider.certificate();

    await expect(genericSamlService.validatePostResponse(configuration, Buffer.from('<not-saml/>').toString('base64'), MOCK_SAML_REQUEST_ID))
      .rejects.toThrow();
  });
});
