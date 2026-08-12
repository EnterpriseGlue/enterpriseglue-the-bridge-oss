import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EmailSendConfig } from '@enterpriseglue/shared/infrastructure/persistence/entities/EmailSendConfig.js';
// TenantSettings removed - multi-tenancy is EE-only
import { decrypt } from '@enterpriseglue/shared/utils/crypto.js';
import { secretResolver } from '@enterpriseglue/shared/services/platform-admin/SecretResolver.js';
import { sendEmail as sendWithProvider, type EmailProvider } from '../email-providers.js';

export interface EmailConfig {
  provider: EmailProvider;
  apiKey: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean;
  smtpUser?: string | null;
}

/**
 * Get the default email config from the database.
 * Note: Tenant-specific email config is an EE-only feature.
 */
export async function getEmailConfigForTenant(_tenantId?: string): Promise<EmailConfig | null> {
  const dataSource = await getDataSource();

  try {
    const configRepo = dataSource.getRepository(EmailSendConfig);
    const defaultConfig = await configRepo.findOneBy({
      isDefault: true,
      enabled: true,
    });

    if (defaultConfig) {
      return {
        provider: defaultConfig.provider as EmailProvider,
        apiKey: defaultConfig.apiKeyEncrypted.startsWith('ref:')
          ? secretResolver.resolveStored(defaultConfig.apiKeyEncrypted)!
          : decrypt(defaultConfig.apiKeyEncrypted),
        fromName: defaultConfig.fromName,
        fromEmail: defaultConfig.fromEmail,
        replyTo: defaultConfig.replyTo,
        smtpHost: defaultConfig.smtpHost,
        smtpPort: defaultConfig.smtpPort,
        smtpSecure: defaultConfig.smtpSecure,
        smtpUser: defaultConfig.smtpUser,
      };
    }

    return null;
  } catch (error) {
    logger.warn('Error loading email config:', error);
    return null;
  }
}

/**
 * Send email using the configured provider.
 * The default email config is seeded from EMAIL_* env vars on first deploy.
 * After that, email configs can still be managed in the Admin UI if needed.
 */
export async function sendEmailWithConfig(
  tenantId: string | undefined,
  to: string,
  subject: string,
  html: string,
  text?: string
): Promise<{ success: boolean; error?: string }> {
  const emailConfig = await getEmailConfigForTenant(tenantId);

  if (!emailConfig) {
    logger.warn(`⚠️  Would send email to ${to} (email not configured — seed EMAIL_* env vars for first deploy or add a default config in Admin UI)`);
    return { success: false, error: 'Email service not configured. Seed EMAIL_* env vars for first deploy or create a default email configuration.' };
  }

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
    smtpHost: emailConfig.smtpHost || undefined,
    smtpPort: emailConfig.smtpPort || undefined,
    smtpSecure: emailConfig.smtpSecure,
    smtpUser: emailConfig.smtpUser || undefined,
  });
}
