import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { sendEmail } from '@enterpriseglue/shared/services/email-providers.js';

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    },
  })),
}));

vi.mock('nodemailer', () => ({
  createTransport: vi.fn().mockReturnValue({
    sendMail: vi.fn().mockResolvedValue({ messageId: 'msg-1' }),
  }),
}));

describe('email-providers', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const common = {
    apiKey: 'file-resolved-secret',
    fromName: 'EnterpriseGlue',
    fromEmail: 'sender@mail.example.com',
    to: 'recipient@example.com',
    subject: 'Test',
    html: '<p>Hello</p>',
    text: 'Hello',
  };

  it('sends SendGrid credentials only to the fixed endpoint with hardened transport options', async () => {
    fetchMock.mockResolvedValue(new Response(null, {
      status: 202,
      headers: { 'x-message-id': 'sendgrid-1' },
    }));

    await expect(sendEmail({ ...common, provider: 'sendgrid' })).resolves.toEqual({
      success: true,
      messageId: 'sendgrid-1',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      signal: expect.any(AbortSignal),
      headers: expect.objectContaining({ Authorization: 'Bearer file-resolved-secret' }),
    });
  });

  it('keeps Mailgun credentials on its fixed host and encodes the validated sender domain as a path segment', async () => {
    fetchMock.mockResolvedValue(new Response('{"id":"mailgun-1"}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(sendEmail({ ...common, provider: 'mailgun' })).resolves.toEqual({
      success: true,
      messageId: 'mailgun-1',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.mailgun.net/v3/mail.example.com/messages');
    expect(init).toMatchObject({
      redirect: 'error',
      signal: expect.any(AbortSignal),
      headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) }),
    });
  });

  it('sends Mailjet credentials only to the fixed endpoint and parses its bounded response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      Messages: [{ To: [{ MessageID: 1234 }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(sendEmail({ ...common, provider: 'mailjet', apiKey: 'public:private' })).resolves.toEqual({
      success: true,
      messageId: '1234',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.mailjet.com/v3.1/send');
    expect(init).toMatchObject({
      redirect: 'error',
      signal: expect.any(AbortSignal),
      headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) }),
    });
  });

  it('does not reflect provider response bodies or transport details in public failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('token=leaked upstream detail', { status: 401 }));
    await expect(sendEmail({ ...common, provider: 'sendgrid' })).resolves.toEqual({
      success: false,
      error: 'SendGrid request failed with HTTP 401',
    });

    fetchMock.mockRejectedValueOnce(new Error('https://private.example/token?secret=leaked'));
    await expect(sendEmail({ ...common, provider: 'mailjet' })).resolves.toEqual({
      success: false,
      error: 'Email provider request failed',
    });
  });

  it('rejects oversized provider responses and cancels their body', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers({ 'content-length': String(64 * 1024 + 1) }),
      body: { cancel },
    });

    await expect(sendEmail({ ...common, provider: 'mailgun' })).resolves.toEqual({
      success: false,
      error: 'Email provider request failed',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects an invalid Mailgun sender domain before any outbound request', async () => {
    await expect(sendEmail({
      ...common,
      provider: 'mailgun',
      fromEmail: 'sender@bad/domain',
    })).resolves.toEqual({ success: false, error: 'Mailgun sender domain is invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
