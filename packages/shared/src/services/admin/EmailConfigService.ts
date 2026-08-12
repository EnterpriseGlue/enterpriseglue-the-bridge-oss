import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EmailSendConfig } from '@enterpriseglue/shared/infrastructure/persistence/entities/EmailSendConfig.js';
import { Errors } from '@enterpriseglue/shared/interfaces/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { encrypt, decrypt } from '@enterpriseglue/shared/utils/crypto.js';
import { secretResolver } from '@enterpriseglue/shared/services/platform-admin/SecretResolver.js';
import { adminConfigObjectOwnershipService } from '@enterpriseglue/shared/services/platform-admin/AdminConfigObjectOwnershipService.js';

function resolveEmailCredential(value: string): string {
  return value.startsWith('ref:') ? secretResolver.resolveStored(value)! : decrypt(value);
}

export interface EmailConfigSummary {
  id: string;
  name: string;
  provider: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUser: string | null;
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateEmailConfigInput {
  name: string;
  provider: string;
  apiKey: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean;
  smtpUser?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
  userId: string;
}

export interface UpdateEmailConfigInput {
  name?: string;
  provider?: string;
  apiKey?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string | null;
  enabled?: boolean;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
  smtpUser?: string | null;
  userId: string;
}

class EmailConfigServiceImpl {
  async list(): Promise<EmailConfigSummary[]> {
    const dataSource = await getDataSource();
    const configRepo = dataSource.getRepository(EmailSendConfig);
    return configRepo.find({
      select: ['id', 'name', 'provider', 'fromName', 'fromEmail', 'replyTo', 'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'enabled', 'isDefault', 'createdAt', 'updatedAt'],
      order: { createdAt: 'DESC' },
    });
  }

  async getById(id: string): Promise<EmailConfigSummary | null> {
    const dataSource = await getDataSource();
    const configRepo = dataSource.getRepository(EmailSendConfig);
    return configRepo.findOne({
      where: { id },
      select: ['id', 'name', 'provider', 'fromName', 'fromEmail', 'replyTo', 'enabled', 'isDefault', 'createdAt', 'updatedAt'],
    });
  }

  async getByIdOrThrow(id: string): Promise<EmailConfigSummary> {
    const config = await this.getById(id);
    if (!config) throw Errors.notFound('Email configuration');
    return config;
  }

  async create(input: CreateEmailConfigInput): Promise<EmailConfigSummary> {
    const dataSource = await getDataSource();
    const configRepo = dataSource.getRepository(EmailSendConfig);
    const now = Date.now();
    const id = generateId();
    const apiKeyEncrypted = encrypt(input.apiKey);

    // If this is set as default, unset other defaults
    if (input.isDefault) {
      await configRepo.update({ isDefault: true }, { isDefault: false, updatedAt: now });
    }

    await configRepo.insert({
      id,
      name: input.name,
      provider: input.provider,
      apiKeyEncrypted,
      fromName: input.fromName,
      fromEmail: input.fromEmail,
      replyTo: input.replyTo || null,
      smtpHost: input.smtpHost || null,
      smtpPort: input.smtpPort || null,
      smtpSecure: input.smtpSecure ?? true,
      smtpUser: input.smtpUser || null,
      enabled: input.enabled ?? true,
      isDefault: input.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
      createdByUserId: input.userId,
      updatedByUserId: input.userId,
    });

    return {
      id,
      name: input.name,
      provider: input.provider,
      fromName: input.fromName,
      fromEmail: input.fromEmail,
      replyTo: input.replyTo || null,
      smtpHost: input.smtpHost || null,
      smtpPort: input.smtpPort || null,
      smtpSecure: input.smtpSecure ?? true,
      smtpUser: input.smtpUser || null,
      enabled: input.enabled ?? true,
      isDefault: input.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    };
  }

  async update(id: string, input: UpdateEmailConfigInput): Promise<void> {
    const dataSource = await getDataSource();
    const now = Date.now();

    const updates: Record<string, unknown> = {
      updatedAt: now,
      updatedByUserId: input.userId,
    };

    if (input.name !== undefined) updates.name = input.name;
    if (input.provider !== undefined) updates.provider = input.provider;
    if (input.apiKey !== undefined) updates.apiKeyEncrypted = encrypt(input.apiKey);
    if (input.fromName !== undefined) updates.fromName = input.fromName;
    if (input.fromEmail !== undefined) updates.fromEmail = input.fromEmail;
    if (input.replyTo !== undefined) updates.replyTo = input.replyTo;
    if (input.enabled !== undefined) updates.enabled = input.enabled;
    if (input.smtpHost !== undefined) updates.smtpHost = input.smtpHost;
    if (input.smtpPort !== undefined) updates.smtpPort = input.smtpPort;
    if (input.smtpSecure !== undefined) updates.smtpSecure = input.smtpSecure;
    if (input.smtpUser !== undefined) updates.smtpUser = input.smtpUser;

    await dataSource.transaction(async (manager) => {
      const configRepo = manager.getRepository(EmailSendConfig);
      const existing = await configRepo.findOneBy({ id });
      if (!existing) throw Errors.notFound('Email configuration');
      await adminConfigObjectOwnershipService.claimManualMutation(manager, 'email_configuration', id);
      await configRepo.update({ id }, updates);
    });
  }

  async delete(id: string): Promise<void> {
    const dataSource = await getDataSource();
    await dataSource.transaction(async (manager) => {
      const configRepo = manager.getRepository(EmailSendConfig);
      const existing = await configRepo.findOne({ where: { id }, select: ['id', 'isDefault'] });
      if (!existing) throw Errors.notFound('Email configuration');
      if (existing.isDefault) throw Errors.validation('Cannot delete the default email configuration');
      await adminConfigObjectOwnershipService.claimManualMutation(manager, 'email_configuration', id);
      await configRepo.delete({ id });
    });
  }

  async setDefault(id: string, userId: string): Promise<void> {
    const dataSource = await getDataSource();
    const now = Date.now();
    await dataSource.transaction(async (manager) => {
      const configRepo = manager.getRepository(EmailSendConfig);
      const existing = await configRepo.findOneBy({ id });
      if (!existing) throw Errors.notFound('Email configuration');
      await adminConfigObjectOwnershipService.claimManualMutation(manager, 'email_configuration', id);
      await configRepo.update({ isDefault: true }, { isDefault: false, updatedAt: now });
      await configRepo.update({ id }, { isDefault: true, updatedAt: now, updatedByUserId: userId });
    });
  }

  async getDecryptedConfig(id: string): Promise<{
    provider: string;
    fromName: string;
    fromEmail: string;
    apiKey: string;
    smtpHost: string | null;
    smtpPort: number | null;
    smtpSecure: boolean;
    smtpUser: string | null;
  }> {
    const dataSource = await getDataSource();
    const configRepo = dataSource.getRepository(EmailSendConfig);

    const config = await configRepo.findOneBy({ id });
    if (!config) throw Errors.notFound('Email configuration');

    const apiKey = resolveEmailCredential(config.apiKeyEncrypted);
    return {
      provider: config.provider,
      fromName: config.fromName,
      fromEmail: config.fromEmail,
      apiKey,
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort,
      smtpSecure: config.smtpSecure,
      smtpUser: config.smtpUser,
    };
  }
}

export const emailConfigService = new EmailConfigServiceImpl();
