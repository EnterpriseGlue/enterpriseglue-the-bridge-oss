import { sendEmailWithConfig } from './config.js';

export interface TenantDiscoveryEmailParams {
  to: string;
  firstName?: string;
  discoveryUrl: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}

export async function sendTenantDiscoveryEmail(params: TenantDiscoveryEmailParams): Promise<{ success: boolean; error?: string }> {
  const greeting = params.firstName?.trim() ? `Hi ${params.firstName.trim()},` : 'Hello,';
  const safeGreeting = escapeHtml(greeting);
  const safeUrl = escapeHtml(params.discoveryUrl);
  return sendEmailWithConfig(
    undefined,
    params.to,
    'Find your EnterpriseGlue organization',
    `<p>${safeGreeting}</p><p>Use this single-use link to choose an EnterpriseGlue organization associated with your account.</p><p><a href="${safeUrl}">Choose an organization</a></p><p>This link expires in 15 minutes. If you did not request it, you can ignore this email.</p>`,
    `${greeting}\n\nUse this single-use link to choose an EnterpriseGlue organization associated with your account:\n\n${params.discoveryUrl}\n\nThis link expires in 15 minutes. If you did not request it, you can ignore this email.`,
  );
}
