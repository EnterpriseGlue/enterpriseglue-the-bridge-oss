/**
 * Email Provider Adapters
 * Supports multiple email providers: Resend, SendGrid, Mailgun, Mailjet, SMTP
 */

import { Resend } from 'resend';
import * as nodemailer from 'nodemailer';
import escapeHtml from 'escape-html';
import { logger } from '@shared/utils/logger.js';

export type EmailProvider = 'resend' | 'sendgrid' | 'mailgun' | 'mailjet' | 'smtp';

export interface SendEmailParams {
  provider: EmailProvider;
  apiKey: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  // SMTP-specific fields
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface TestEmailParams {
  provider: EmailProvider;
  apiKey: string;
  fromName: string;
  fromEmail: string;
  toEmail: string;
  // SMTP-specific fields
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
}

/**
 * Send an email using the specified provider
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { provider, apiKey, fromName, fromEmail, replyTo, to, subject, html, text, smtpHost, smtpPort, smtpSecure, smtpUser } = params;

  try {
    switch (provider) {
      case 'resend':
        return await sendWithResend({ apiKey, fromName, fromEmail, replyTo, to, subject, html, text });
      case 'sendgrid':
        return await sendWithSendGrid({ apiKey, fromName, fromEmail, replyTo, to, subject, html, text });
      case 'mailgun':
        return await sendWithMailgun({ apiKey, fromName, fromEmail, replyTo, to, subject, html, text });
      case 'mailjet':
        return await sendWithMailjet({ apiKey, fromName, fromEmail, replyTo, to, subject, html, text });
      case 'smtp':
        return await sendWithSMTP({ apiKey, fromName, fromEmail, replyTo, to, subject, html, text, smtpHost, smtpPort, smtpSecure, smtpUser });
      default:
        return { success: false, error: `Unsupported provider: ${provider}` };
    }
  } catch (error) {
    logger.error(`Email send error (${provider}):`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Send a test email using the specified provider
 */
export async function sendTestEmail(params: TestEmailParams): Promise<SendEmailResult> {
  const { provider, apiKey, fromName, fromEmail, toEmail, smtpHost, smtpPort, smtpSecure, smtpUser } = params;

  const subject = 'EnterpriseGlue - Test Email Configuration';
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto;">
          <h1 style="color: #198038;">✅ Email Configuration Test Successful</h1>
          <p>Your email configuration is working correctly.</p>
          <table style="border-collapse: collapse; margin-top: 20px;">
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Provider:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(provider)}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>From Name:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(fromName)}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>From Email:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(fromEmail)}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Sent At:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${new Date().toISOString()}</td></tr>
          </table>
          <p style="color: #666; margin-top: 20px; font-size: 14px;">
            This is a test email from EnterpriseGlue to verify your email configuration.
          </p>
        </div>
      </body>
    </html>
  `;
  const text = `Email Configuration Test Successful\n\nProvider: ${provider}\nFrom: ${fromName} <${fromEmail}>\nSent: ${new Date().toISOString()}`;

  return sendEmail({
    provider,
    apiKey,
    fromName,
    fromEmail,
    to: toEmail,
    subject,
    html,
    text,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUser,
  });
}

// Provider-specific implementations

interface ProviderEmailParams {
  apiKey: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}

async function sendWithResend(params: ProviderEmailParams): Promise<SendEmailResult> {
  const { apiKey, fromName, fromEmail, replyTo, to, subject, html, text } = params;
  
  const resend = new Resend(apiKey);
  
  const result = await resend.emails.send({
    from: `${fromName} <${fromEmail}>`,
    to: [to],
    replyTo: replyTo,
    subject,
    html,
    text,
  });

  if (result.error) {
    return { success: false, error: result.error.message };
  }

  return { success: true, messageId: result.data?.id };
}

async function sendWithSendGrid(params: ProviderEmailParams): Promise<SendEmailResult> {
  const { apiKey, fromName, fromEmail, replyTo, to, subject, html, text } = params;

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail, name: fromName },
      reply_to: replyTo ? { email: replyTo } : undefined,
      subject,
      content: [
        { type: 'text/plain', value: text || '' },
        { type: 'text/html', value: html },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return { success: false, error: `SendGrid error: ${response.status} - ${errorText}` };
  }

  const messageId = response.headers.get('x-message-id');
  return { success: true, messageId: messageId || undefined };
}

async function sendWithMailgun(params: ProviderEmailParams): Promise<SendEmailResult> {
  const { apiKey, fromName, fromEmail, replyTo, to, subject, html, text } = params;

  // Mailgun API key format: api:key-xxxxx or just the key
  // Domain is typically extracted from fromEmail
  const domain = fromEmail.split('@')[1];
  
  const formData = new URLSearchParams();
  formData.append('from', `${fromName} <${fromEmail}>`);
  formData.append('to', to);
  formData.append('subject', subject);
  formData.append('html', html);
  if (text) formData.append('text', text);
  if (replyTo) formData.append('h:Reply-To', replyTo);

  const response = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return { success: false, error: `Mailgun error: ${response.status} - ${errorText}` };
  }

  const result = await response.json();
  return { success: true, messageId: result.id };
}

async function sendWithMailjet(params: ProviderEmailParams): Promise<SendEmailResult> {
  const { apiKey, fromName, fromEmail, replyTo, to, subject, html, text } = params;

  // Mailjet uses API key:secret format
  const [apiKeyPart, secretKey] = apiKey.includes(':') ? apiKey.split(':') : [apiKey, ''];
  
  const response = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${apiKeyPart}:${secretKey}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: fromEmail, Name: fromName },
          To: [{ Email: to }],
          ReplyTo: replyTo ? { Email: replyTo } : undefined,
          Subject: subject,
          TextPart: text || '',
          HTMLPart: html,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return { success: false, error: `Mailjet error: ${response.status} - ${errorText}` };
  }

  const result = await response.json();
  const messageId = result.Messages?.[0]?.To?.[0]?.MessageID;
  return { success: true, messageId: messageId?.toString() };
}

interface SMTPEmailParams extends ProviderEmailParams {
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
}

async function sendWithSMTP(params: SMTPEmailParams): Promise<SendEmailResult> {
  const { apiKey, fromName, fromEmail, replyTo, to, subject, html, text, smtpHost, smtpPort, smtpSecure, smtpUser } = params;

  if (!smtpHost) {
    return { success: false, error: 'SMTP host is required' };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort || 587,
    secure: smtpSecure ?? (smtpPort === 465),
    auth: {
      user: smtpUser || fromEmail,
      pass: apiKey, // apiKey stores the SMTP password
    },
  });

  try {
    const info = await transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to,
      replyTo,
      subject,
      html,
      text,
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'SMTP send failed' };
  }
}
