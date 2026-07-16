import { afterEach, describe, expect, it } from 'vitest';
import { genericSamlService } from '@enterpriseglue/shared/services/platform-admin/GenericSamlService.js';
import { MockSamlHttpsServer } from '../../identity-mocks/index.js';

const configuration = {
  entityId: 'enterpriseglue-ai',
  callbackUrl: 'https://app.example.test/api/auth/providers/saml/callback',
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
    }, response!)).resolves.toMatchObject({ nameID: 'person@example.test', role: 'operator' });
  });
});
