import { Resend } from 'resend';
import { logger } from '@shared/utils/logger.js';
import { config } from '@shared/config/index.js';
import { getDataSource } from '@shared/db/data-source.js';
import { EmailSendConfig } from '@shared/db/entities/EmailSendConfig.js';
// TenantSettings removed - multi-tenancy is EE-only
import { decrypt } from '@shared/utils/crypto.js';
import { sendEmail as sendWithProvider, type EmailProvider } from '../email-providers.js';

let resend: Resend | null = null;

export function getResendClient(): Resend | null {
  if (!config.resendApiKey) {
    logger.warn('⚠️  RESEND_API_KEY not configured. Email sending is disabled.');
    return null;
  }

  if (!resend) {
    resend = new Resend(config.resendApiKey);
  }

  return resend;
}

export interface EmailConfig {
  provider: EmailProvider;
  apiKey: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
}

/**
 * Get email config, falling back to default config or env config
 * Note: Tenant-specific email config is an EE-only feature
 */
export async function getEmailConfigForTenant(_tenantId?: string): Promise<EmailConfig | null> {
  const dataSource = await getDataSource();

  try {
    // OSS single-tenant mode: tenant-specific config lookup removed (EE-only feature)
    // Always use default config

    // Fallback to default config
    const configRepo = dataSource.getRepository(EmailSendConfig);
    const defaultConfig = await configRepo.findOneBy({
      isDefault: true,
      enabled: true,
    });

    if (defaultConfig) {
      return {
        provider: defaultConfig.provider as EmailProvider,
        apiKey: decrypt(defaultConfig.apiKeyEncrypted),
        fromName: defaultConfig.fromName,
        fromEmail: defaultConfig.fromEmail,
        replyTo: defaultConfig.replyTo,
      };
    }

    // No config found, return null (will use env-based Resend)
    return null;
  } catch (error) {
    logger.warn('Error loading email config:', error);
    return null;
  }
}

/**
 * Send email using tenant-specific or default config
 */
export async function sendEmailWithConfig(
  tenantId: string | undefined,
  to: string,
  subject: string,
  html: string,
  text?: string
): Promise<{ success: boolean; error?: string }> {
  const emailConfig = await getEmailConfigForTenant(tenantId);

  if (emailConfig) {
    // Use configured provider
    return sendWithProvider({
      provider: emailConfig.provider,
      apiKey: emailConfig.apiKey,
      fromName: emailConfig.fromName,
      fromEmail: emailConfig.fromEmail,
      replyTo: emailConfig.replyTo || undefined,
      to,
      subject,
      html,
      text,
    });
  }

  // Fallback to env-based Resend client
  const client = getResendClient();
  if (!client) {
    logger.warn(`⚠️  Would send email to ${to} (email disabled)`);
    return { success: false, error: 'Email service not configured' };
  }

  try {
    const result = await client.emails.send({
      from: 'EnterpriseGlue <noreply@enterpriseglue.ai>',
      to: [to],
      subject,
      html,
      text,
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
