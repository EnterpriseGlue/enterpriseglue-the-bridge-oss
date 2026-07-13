import { getDataSource } from './data-source.js';
import { User } from '../infrastructure/persistence/entities/User.js';
import { EmailSendConfig } from '../infrastructure/persistence/entities/EmailSendConfig.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { hashPassword } from '@enterpriseglue/shared/utils/password.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { encrypt } from '@enterpriseglue/shared/utils/crypto.js';
import { authzGroupService } from '../services/platform-admin/AuthzGroupService.js';

/**
 * Bootstrap admin account on first run
 * Creates the initial admin user if no users exist
 */
export async function bootstrapAdmin(options: { allowPlatformAdmin?: boolean } = {}) {
  const { allowPlatformAdmin = true } = options;
  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);

  try {
    // Check if any users exist
    const userCount = await userRepo.count();

    if (userCount > 0) {
      console.log('ℹ️  Users already exist, skipping admin bootstrap');
      return;
    }

    // No users exist, create admin account
    console.log('🔧 Creating admin account...');

    const adminId = generateId();
    const passwordHash = await hashPassword(config.adminPassword);
    const now = Date.now();

    const admin = userRepo.create({
      id: adminId,
      email: config.adminEmail,
      authProvider: 'local',
      passwordHash: passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      // Compatibility metadata only; access comes from the canonical group below.
      platformRole: 'user',
      isActive: true,
      mustResetPassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      isEmailVerified: true,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      createdByUserId: null,
    });

    await dataSource.transaction(async (manager) => {
      await manager.getRepository(User).save(admin);
      await authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager, adminId);
      if (allowPlatformAdmin) {
        await authzGroupService.ensureBootstrapPlatformAdministratorMembershipWithManager(manager, adminId);
      }
    });

    console.log(`✅ Admin account created: ${config.adminEmail}`);
    console.log(`   Password: [REDACTED - check ADMIN_PASSWORD environment variable]`);
    console.log(`   Platform access: ${allowPlatformAdmin ? 'administrator' : 'user'}`);
    console.log(`⚠️  IMPORTANT: Change the admin password in production!`);
  } catch (error) {
    console.error('❌ Failed to bootstrap admin account:', error);
    throw error;
  }
}

/**
 * Bootstrap the default email configuration on first run when EMAIL_* env vars are present.
 */
export async function bootstrapDefaultEmailConfig() {
  const dataSource = await getDataSource();
  const emailConfigRepo = dataSource.getRepository(EmailSendConfig);

  const provider = config.emailProvider?.trim();
  const apiKey = config.emailApiKey?.trim();
  const fromName = config.emailFromName?.trim();
  const fromEmail = config.emailFromEmail?.trim();
  const replyTo = config.emailReplyTo?.trim() || null;
  const smtpHost = config.emailSmtpHost?.trim() || null;
  const smtpPort = config.emailSmtpPort ?? null;
  const smtpSecure = config.emailSmtpSecure ?? (smtpPort === 465);
  const smtpUser = config.emailSmtpUser?.trim() || null;

  const hasAnyEmailBootstrapSetting = Boolean(
    provider ||
      apiKey ||
      fromName ||
      fromEmail ||
      replyTo ||
      smtpHost ||
      smtpPort !== null ||
      config.emailSmtpSecure !== undefined ||
      smtpUser
  );

  if (!hasAnyEmailBootstrapSetting) {
    console.log('ℹ️  No EMAIL_* bootstrap settings found, skipping email config bootstrap');
    return;
  }

  if (!provider || !apiKey || !fromName || !fromEmail) {
    throw new Error(
      'Incomplete EMAIL_* bootstrap configuration. Set EMAIL_PROVIDER, EMAIL_API_KEY, EMAIL_FROM_NAME, and EMAIL_FROM_EMAIL.'
    );
  }

  if (provider === 'smtp' && !smtpHost) {
    throw new Error('EMAIL_SMTP_HOST is required when EMAIL_PROVIDER=smtp');
  }

  const existingCount = await emailConfigRepo.count();
  if (existingCount > 0) {
    console.log('ℹ️  Email configurations already exist, skipping email config bootstrap');
    return;
  }

  const now = Date.now();
  const id = 'default-email-config';

  await emailConfigRepo.insert({
    id,
    name: config.emailConfigName?.trim() || 'Default Email Configuration',
    provider,
    apiKeyEncrypted: encrypt(apiKey),
    fromName,
    fromEmail,
    replyTo,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUser,
    enabled: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    createdByUserId: null,
    updatedByUserId: null,
  });

  console.log(`✅ Default email configuration seeded from environment (${provider})`);
}
