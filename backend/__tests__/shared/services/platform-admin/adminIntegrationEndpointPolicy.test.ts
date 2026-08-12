import { afterEach, describe, expect, it, vi } from 'vitest';
import { Response } from 'undici';
import {
  fetchAdminIntegrationEndpoint,
  isAllowedAdminIntegrationHost,
  validateAdminIntegrationEndpointUrl,
} from '@enterpriseglue/shared/services/platform-admin/AdminIntegrationEndpointPolicy.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.restoreAllMocks();
});

describe('AdminIntegrationEndpointPolicy', () => {
  it('forces production allowlisting and rejects broad wildcard, credentials, and metadata hosts', () => {
    process.env.NODE_ENV = 'production';
    process.env.EG_ADMIN_INTEGRATION_ALLOWED_HOSTS = '*.com,*.login.example.com,169.254.169.254';
    process.env.EG_ADMIN_INTEGRATION_ALLOW_PRIVATE_HOSTS = 'true';

    expect(() => validateAdminIntegrationEndpointUrl('https://evil.example.net/token', 'Git token URL'))
      .toThrow('host is not permitted');
    expect(() => validateAdminIntegrationEndpointUrl('https://client:secret@login.example.com/token', 'Git token URL'))
      .toThrow('embedded credentials');
    expect(() => validateAdminIntegrationEndpointUrl('https://169.254.169.254/latest/meta-data', 'PII provider endpoint'))
      .toThrow('not permitted');
    expect(isAllowedAdminIntegrationHost('tenant.login.example.com', ['*.login.example.com'])).toBe(true);
    expect(isAllowedAdminIntegrationHost('attacker.com', ['*.com'])).toBe(false);
    expect(() => validateAdminIntegrationEndpointUrl('https://api.sendgrid.com/v3/mail/send', 'SendGrid email provider'))
      .not.toThrow();
    expect(() => validateAdminIntegrationEndpointUrl('https://api.mailgun.net/v3/example/messages', 'Mailgun email provider'))
      .not.toThrow();
    expect(() => validateAdminIntegrationEndpointUrl('https://api.mailjet.com/v3.1/send', 'Mailjet email provider'))
      .not.toThrow();
  });

  it('requires both private-host opt-in and an exact reviewed entry', () => {
    process.env.NODE_ENV = 'production';
    process.env.EG_ADMIN_INTEGRATION_ALLOWED_HOSTS = 'pii.internal.example';
    expect(() => validateAdminIntegrationEndpointUrl('https://pii.internal.example/analyze', 'PII provider endpoint'))
      .not.toThrow();

    process.env.EG_ADMIN_INTEGRATION_ALLOWED_HOSTS = 'pii.local';
    expect(() => validateAdminIntegrationEndpointUrl('https://pii.local/analyze', 'PII provider endpoint'))
      .toThrow('host is private');
    process.env.EG_ADMIN_INTEGRATION_ALLOW_PRIVATE_HOSTS = 'true';
    expect(() => validateAdminIntegrationEndpointUrl('https://pii.local/analyze', 'PII provider endpoint'))
      .not.toThrow();
    process.env.EG_ADMIN_INTEGRATION_ALLOWED_HOSTS = '*.pii.local';
    expect(() => validateAdminIntegrationEndpointUrl('https://pii.local/analyze', 'PII provider endpoint'))
      .toThrow('exact endpoint-policy allowlist entry');
  });

  it('rejects DNS rebinding before fetch and never sends a token to the resolved private address', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EG_ADMIN_INTEGRATION_ALLOWED_HOSTS = 'oauth.example.com';
    const fetchImpl = vi.fn();

    await expect(fetchAdminIntegrationEndpoint('https://oauth.example.com/token', {
      method: 'POST',
      headers: { Authorization: 'Bearer should-not-leave' },
      body: 'grant_type=client_credentials',
    }, {
      label: 'Git OAuth token exchange',
      lookup: vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]),
      fetchImpl: fetchImpl as never,
    })).rejects.toThrow('resolved to a private or reserved address');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pins a validated public resolution, forces redirect rejection, and bounds responses', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EG_ADMIN_INTEGRATION_ALLOWED_HOSTS = 'oauth.example.com';
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"access_token":"ok"}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await fetchAdminIntegrationEndpoint('https://oauth.example.com/token', {
      method: 'POST',
      redirect: 'follow',
      body: 'grant_type=client_credentials',
    }, {
      label: 'Git OAuth token exchange',
      lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
      fetchImpl: fetchImpl as never,
    });

    expect(await response.json()).toEqual({ access_token: 'ok' });
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      redirect: 'error',
      dispatcher: expect.anything(),
      signal: expect.any(AbortSignal),
    }));

    const oversizedFetch = vi.fn().mockResolvedValue(new Response('x', {
      status: 200,
      headers: { 'content-length': String(1024 * 1024 + 1) },
    }));
    await expect(fetchAdminIntegrationEndpoint('https://oauth.example.com/token', { method: 'GET' }, {
      label: 'Git OAuth token exchange',
      lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
      fetchImpl: oversizedFetch as never,
    })).rejects.toThrow('response exceeds the maximum allowed size');
  });
});
