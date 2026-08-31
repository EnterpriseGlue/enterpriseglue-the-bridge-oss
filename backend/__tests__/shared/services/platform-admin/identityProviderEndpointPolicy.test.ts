import { afterEach, describe, expect, it } from 'vitest';
import {
  isAllowedIdentityProviderHost,
  readBoundedIdentityProviderResponse,
  validateIdentityProviderCallbackUrl,
  validateIdentityProviderEndpointUrl,
} from '@enterpriseglue/shared/services/platform-admin/IdentityProviderEndpointPolicy.js';

describe('identity provider endpoint policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY;
    delete process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS;
    delete process.env.EG_IDENTITY_PROVIDER_ALLOW_PRIVATE_HOSTS;
  });

  it('fails closed by default in production and permits explicit local emulator use only outside production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => validateIdentityProviderEndpointUrl('https://idp.example.test', 'OIDC issuerUrl', ['https:'])).toThrow('not permitted');
    process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY = 'false';
    expect(() => validateIdentityProviderEndpointUrl('https://localhost', 'OIDC issuerUrl', ['https:'])).toThrow('is private');
    expect(() => validateIdentityProviderCallbackUrl('http://localhost:5173/api/auth/identity/callback', 'oidc')).toThrow('HTTPS in production');

    vi.stubEnv('NODE_ENV', 'test');
    expect(validateIdentityProviderEndpointUrl('https://localhost', 'OIDC issuerUrl', ['https:']).hostname).toBe('localhost');
  });

  it('matches exact and wildcard hosts without crossing the suffix boundary', () => {
    expect(isAllowedIdentityProviderHost('LOGIN.EXAMPLE.COM.', ['login.example.com'])).toBe(true);
    expect(isAllowedIdentityProviderHost('tenant.login.example.com', ['*.login.example.com'])).toBe(true);
    expect(isAllowedIdentityProviderHost('login.example.com', ['*.login.example.com'])).toBe(false);
    expect(isAllowedIdentityProviderHost('evillogin.example.com', ['*.login.example.com'])).toBe(false);
  });

  it('rejects broad or malformed wildcard trust patterns', () => {
    expect(isAllowedIdentityProviderHost('login.example.com', ['*'])).toBe(false);
    expect(isAllowedIdentityProviderHost('login.example.com', ['*.com'])).toBe(false);
    expect(isAllowedIdentityProviderHost('login.example.co.uk', ['*.co.uk'])).toBe(false);
    expect(isAllowedIdentityProviderHost('tenant.login.example.com', ['*.login.example.com'])).toBe(true);
    expect(isAllowedIdentityProviderHost('tenant.login.example.com', ['*.login..example.com'])).toBe(false);
  });

  it('fails closed with an empty allowlist and rejects credentials, metadata, private literals, and bad protocols', () => {
    process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY = 'true';
    expect(() => validateIdentityProviderEndpointUrl('https://idp.example.test', 'OIDC issuerUrl', ['https:'])).toThrow('not permitted');
    process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS = 'idp.example.test,metadata.google.internal,127.0.0.1';
    expect(() => validateIdentityProviderEndpointUrl('https://user:secret@idp.example.test', 'OIDC issuerUrl', ['https:'])).toThrow('embedded credentials');
    expect(() => validateIdentityProviderEndpointUrl('http://idp.example.test', 'OIDC issuerUrl', ['https:'])).toThrow('must use HTTPS');
    expect(() => validateIdentityProviderEndpointUrl('https://metadata.google.internal/latest', 'OIDC issuerUrl', ['https:'])).toThrow('not permitted');
    expect(() => validateIdentityProviderEndpointUrl('ldaps://127.0.0.1:636', 'LDAP URL', ['ldaps:'])).toThrow('is private');
  });

  it.each([
    'https://[::ffff:127.0.0.1]',
    'https://[::ffff:10.0.0.1]',
    'https://[::ffff:172.16.0.1]',
    'https://[::ffff:192.168.0.1]',
    'https://[::ffff:169.254.169.254]',
    'https://[::ffff:100.64.0.1]',
  ])('classifies canonical IPv4-mapped IPv6 private address %s as private', (url) => {
    process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY = 'true';
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS = host;
    expect(() => validateIdentityProviderEndpointUrl(url, 'OIDC issuerUrl', ['https:'])).toThrow(/private|not permitted/);
  });

  it('does not misclassify a public IPv4-mapped IPv6 address when explicitly allowlisted', () => {
    process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY = 'true';
    const url = 'https://[::ffff:8.8.8.8]';
    process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS = new URL(url).hostname.replace(/^\[|\]$/g, '');
    expect(validateIdentityProviderEndpointUrl(url, 'OIDC issuerUrl', ['https:']).hostname).toContain('::ffff:808:808');
  });

  it('does not require the private-host opt-in for an explicitly allowlisted public IPv6 address', () => {
    process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY = 'true';
    const url = 'https://[2606:4700:4700::1111]';
    process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS = new URL(url).hostname.replace(/^\[|\]$/g, '');
    expect(validateIdentityProviderEndpointUrl(url, 'OIDC issuerUrl', ['https:']).hostname).toContain('2606:4700:4700');
  });

  it('requires an explicit private-network opt-in and exact allowlist entry', () => {
    process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY = 'true';
    process.env.EG_IDENTITY_PROVIDER_ALLOW_PRIVATE_HOSTS = 'true';
    process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS = 'directory.local';
    expect(validateIdentityProviderEndpointUrl('ldaps://directory.local:636', 'LDAP URL', ['ldaps:']).hostname).toBe('directory.local');

    process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS = '*.local';
    expect(() => validateIdentityProviderEndpointUrl('ldaps://directory.local:636', 'LDAP URL', ['ldaps:'])).toThrow('exact endpoint-policy allowlist entry');
  });

  it('binds callbacks to the configured EnterpriseGlue origin and canonical protocol path', () => {
    expect(validateIdentityProviderCallbackUrl('http://localhost:5173/api/auth/identity/callback', 'oidc').pathname).toBe('/api/auth/identity/callback');
    expect(validateIdentityProviderCallbackUrl('http://localhost:5173/api/auth/providers/saml/callback', 'saml').pathname).toBe('/api/auth/providers/saml/callback');
    expect(validateIdentityProviderCallbackUrl('http://localhost:5173/api/t/acme/auth/identity/callback', 'oidc').pathname).toBe('/api/t/acme/auth/identity/callback');
    expect(validateIdentityProviderCallbackUrl('http://localhost:5173/api/t/acme/auth/providers/saml/callback', 'saml').pathname).toBe('/api/t/acme/auth/providers/saml/callback');
    expect(() => validateIdentityProviderCallbackUrl('http://localhost:5173/api/t/Other/auth/identity/callback', 'oidc')).toThrow('canonical');
    expect(() => validateIdentityProviderCallbackUrl('https://attacker.example.test/api/auth/identity/callback', 'oidc')).toThrow('canonical');
    expect(() => validateIdentityProviderCallbackUrl('http://localhost:5173/api/auth/identity/callback?next=evil', 'oidc')).toThrow('query');
    expect(() => validateIdentityProviderCallbackUrl('http://localhost:5173/wrong', 'saml')).toThrow('canonical');
  });

  it('bounds streamed responses even without a content-length header', async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    }));
    await expect(readBoundedIdentityProviderResponse(response, 'identity response', 12)).rejects.toThrow('maximum allowed size');
  });
});
