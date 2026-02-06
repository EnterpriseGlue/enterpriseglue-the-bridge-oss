/**
 * Email Send Configurations API Routes
 * Super admin only - manages email provider configurations
 */

import { Router, Request, Response } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { logger } from '@shared/utils/logger.js';
import { z } from 'zod';
import { requireAuth } from '@shared/middleware/auth.js';
import { requirePermission } from '@shared/middleware/requirePermission.js';
import { asyncHandler, AppError, Errors } from '@shared/middleware/errorHandler.js';
import { getDataSource } from '@shared/db/data-source.js';
import { EmailSendConfig } from '@shared/db/entities/EmailSendConfig.js';
import { generateId } from '@shared/utils/id.js';
import { encrypt, decrypt } from '@shared/utils/crypto.js';
import { logAudit, AuditActions } from '@shared/services/audit.js';
import { PlatformPermissions } from '@shared/services/platform-admin/permissions.js';

const router = Router();

const createConfigSchema = z.object({
  name: z.string().min(1).max(100),
  provider: z.enum(['resend', 'sendgrid', 'mailgun', 'mailjet', 'smtp']),
  apiKey: z.string().min(1),
  fromName: z.string().min(1).max(100),
  fromEmail: z.string().email(),
  replyTo: z.string().email().optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  // SMTP-specific fields
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().optional(),
});

const updateConfigSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  provider: z.enum(['resend', 'sendgrid', 'mailgun', 'mailjet', 'smtp']).optional(),
  apiKey: z.string().min(1).optional(),
  fromName: z.string().min(1).max(100).optional(),
  fromEmail: z.string().email().optional(),
  replyTo: z.string().email().nullable().optional(),
  enabled: z.boolean().optional(),
  // SMTP-specific fields
  smtpHost: z.string().nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).nullable().optional(),
  smtpSecure: z.boolean().nullable().optional(),
  smtpUser: z.string().nullable().optional(),
});

/**
 * GET /api/admin/email-configs
 * List all email configurations (super admin only)
 */
router.get('/api/admin/email-configs', apiLimiter, requireAuth, requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const dataSource = await getDataSource();
    const configRepo = dataSource.getRepository(EmailSendConfig);
    const configs = await configRepo.find({
      select: ['id', 'name', 'provider', 'fromName', 'fromEmail', 'replyTo', 'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'enabled', 'isDefault', 'createdAt', 'updatedAt'],
      order: { createdAt: 'DESC' },
    });

    res.json(configs);
  } catch (error) {
    logger.error('List email configs error:', error);
    throw Errors.internal('Failed to list email configurations');
  }
}));

/**
 * GET /api/admin/email-configs/:id
 * Get a single email configuration (super admin only)
 */
router.get('/api/admin/email-configs/:id', apiLimiter, requireAuth, requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const dataSource = await getDataSource();
    const configRepo = dataSource.getRepository(EmailSendConfig);

    const config = await configRepo.findOne({
      where: { id },
      select: ['id', 'name', 'provider', 'fromName', 'fromEmail', 'replyTo', 'enabled', 'isDefault', 'createdAt', 'updatedAt'],
    });

    if (!config) {
      throw Errors.notFound('Email configuration');
    }

    res.json(config);
  } catch (error) {
    logger.error('Get email config error:', error);
    throw Errors.internal('Failed to get email configuration');
  }
}));

/**
 * POST /api/admin/email-configs
 * Create a new email configuration (super admin only)
 */
router.post('/api/admin/email-configs', apiLimiter, requireAuth, requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const body = createConfigSchema.parse(req.body);
    const dataSource = await getDataSource();
    const configRepo = dataSource.getRepository(EmailSendConfig);
    const now = Date.now();

    const id = generateId();
    const apiKeyEncrypted = encrypt(body.apiKey);

    // If this is set as default, unset other defaults
    if (body.isDefault) {
      await configRepo.update({ isDefault: true }, { isDefault: false, updatedAt: now });
    }

    await configRepo.insert({
      id,
      name: body.name,
      provider: body.provider,
      apiKeyEncrypted,
      fromName: body.fromName,
      fromEmail: body.fromEmail,
      replyTo: body.replyTo || null,
      smtpHost: body.smtpHost || null,
      smtpPort: body.smtpPort || null,
      smtpSecure: body.smtpSecure ?? true,
      smtpUser: body.smtpUser || null,
      enabled: body.enabled ?? true,
      isDefault: body.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
      createdByUserId: req.user!.userId,
      updatedByUserId: req.user!.userId,
    });

    await logAudit({
      action: AuditActions.USER_CREATE,
      userId: req.user!.userId,
      resourceType: 'email_config',
      resourceId: id,
      details: { name: body.name, provider: body.provider },
      ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json({
      id,
      name: body.name,
      provider: body.provider,
      fromName: body.fromName,
      fromEmail: body.fromEmail,
      replyTo: body.replyTo,
      enabled: body.enabled ?? true,
      isDefault: body.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    if (error instanceof z.ZodError) {
      throw Errors.validation('Validation failed', error.errors);
    }
    logger.error('Create email config error:', error);
    throw Errors.internal('Failed to create email configuration');
  }
}));

/**
 * PATCH /api/admin/email-configs/:id
 * Update an email configuration (super admin only)
 */
router.patch('/api/admin/email-configs/:id', apiLimiter, requireAuth, requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = updateConfigSchema.parse(req.body);
    const dataSource = await getDataSource();
    const configRepo = dataSource.getRepository(EmailSendConfig);
    const now = Date.now();

    const existing = await configRepo.findOneBy({ id });

    if (!existing) {
      throw Errors.notFound('Email configuration');
    }

    const updates: any = {
      updatedAt: now,
      updatedByUserId: req.user!.userId,
    };

    if (body.name !== undefined) updates.name = body.name;
    if (body.provider !== undefined) updates.provider = body.provider;
    if (body.apiKey !== undefined) updates.apiKeyEncrypted = encrypt(body.apiKey);
    if (body.fromName !== undefined) updates.fromName = body.fromName;
    if (body.fromEmail !== undefined) updates.fromEmail = body.fromEmail;
    if (body.replyTo !== undefined) updates.replyTo = body.replyTo;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.smtpHost !== undefined) updates.smtpHost = body.smtpHost;
    if (body.smtpPort !== undefined) updates.smtpPort = body.smtpPort;
    if (body.smtpSecure !== undefined) updates.smtpSecure = body.smtpSecure;
    if (body.smtpUser !== undefined) updates.smtpUser = body.smtpUser;

    await configRepo.update({ id }, updates);

    await logAudit({
      action: AuditActions.USER_UPDATE,
      userId: req.user!.userId,
      resourceType: 'email_config',
      resourceId: id,
      details: { updated: Object.keys(body) },
      ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    if (error instanceof z.ZodError) {
      throw Errors.validation('Validation failed', error.errors);
    }
    logger.error('Update email config error:', error);
    throw Errors.internal('Failed to update email configuration');
  }
}));

/**
 * DELETE /api/admin/email-configs/:id
 * Delete an email configuration (super admin only)
 */
router.delete('/api/admin/email-configs/:id', apiLimiter, requireAuth, requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const dataSource = await getDataSource();
    const configRepo = dataSource.getRepository(EmailSendConfig);

    const existing = await configRepo.findOne({
      where: { id },
      select: ['id', 'isDefault'],
    });

    if (!existing) {
      throw Errors.notFound('Email configuration');
    }

    if (existing.isDefault) {
      throw Errors.validation('Cannot delete the default email configuration');
    }

    await configRepo.delete({ id });

    await logAudit({
      action: AuditActions.USER_DELETE,
      userId: req.user!.userId,
      resourceType: 'email_config',
      resourceId: id,
      ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Delete email config error:', error);
    throw Errors.internal('Failed to delete email configuration');
  }
}));

/**
 * POST /api/admin/email-configs/:id/set-default
 * Set an email configuration as the default (super admin only)
 */
router.post('/api/admin/email-configs/:id/set-default', apiLimiter, requireAuth, requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const dataSource = await getDataSource();
    const configRepo = dataSource.getRepository(EmailSendConfig);
    const now = Date.now();

    const existing = await configRepo.findOneBy({ id });

    if (!existing) {
      throw Errors.notFound('Email configuration');
    }

    // Unset all defaults
    await configRepo.update({ isDefault: true }, { isDefault: false, updatedAt: now });

    // Set this one as default
    await configRepo.update({ id }, { isDefault: true, updatedAt: now, updatedByUserId: req.user!.userId });

    res.json({ success: true });
  } catch (error) {
    logger.error('Set default email config error:', error);
    throw Errors.internal('Failed to set default email configuration');
  }
}));

/**
 * POST /api/admin/email-configs/:id/test
 * Send a test email using this configuration (super admin only)
 */
router.post('/api/admin/email-configs/:id/test', apiLimiter, requireAuth, requirePermission({ permission: PlatformPermissions.SETTINGS_MANAGE }), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { toEmail } = req.body as { toEmail?: string };
    
    if (!toEmail) {
      throw Errors.validation('toEmail is required');
    }

    const dataSource = await getDataSource();
    const configRepo = dataSource.getRepository(EmailSendConfig);

    const config = await configRepo.findOneBy({ id });

    if (!config) {
      throw Errors.notFound('Email configuration');
    }
    const apiKey = decrypt(config.apiKeyEncrypted);

    // Import provider adapter
    const { sendTestEmail } = await import('@shared/services/email-providers.js');
    
    const sendResult = await sendTestEmail({
      provider: config.provider as 'resend' | 'sendgrid' | 'mailgun' | 'mailjet' | 'smtp',
      apiKey,
      fromName: config.fromName,
      fromEmail: config.fromEmail,
      toEmail,
      smtpHost: config.smtpHost || undefined,
      smtpPort: config.smtpPort || undefined,
      smtpSecure: config.smtpSecure ?? undefined,
      smtpUser: config.smtpUser || undefined,
    });

    if (sendResult.success) {
      res.json({ success: true, message: 'Test email sent successfully' });
    } else {
      throw Errors.badRequest(sendResult.error || 'Failed to send test email');
    }
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    logger.error('Test email config error:', error);
    throw Errors.internal(error?.message || 'Failed to send test email');
  }
}));

export default router;
