/**
 * Email Templates API Routes
 * Platform admin only - manages email templates
 */

import { Router, Request, Response } from 'express';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { z } from 'zod';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { asyncHandler, AppError, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EmailTemplate } from '@enterpriseglue/shared/infrastructure/persistence/entities/EmailTemplate.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logAudit, AuditActions } from '@enterpriseglue/shared/services/audit.js';
import {
  adminConfigObjectOwnershipService,
  adminConfigOwnershipFields,
} from '@enterpriseglue/shared/services/platform-admin/AdminConfigObjectOwnershipService.js';
import { platformSettingsService } from '@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js';
import { platformSettingsSectionOwnershipService } from '@enterpriseglue/shared/services/platform-admin/PlatformSettingsSectionOwnershipService.js';
import {
  EmailTemplatePreviewRequestSchema,
  EmailTemplatePreviewResponseSchema,
  UpdateEmailPlatformNameRequestSchema,
  UpdateEmailTemplateRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/email-administration.js';

const router = Router();

const idParamSchema = z.object({
  id: z.string().min(1),
});

router.get('/api/admin/email-platform-name', apiLimiter, requireAuth, requireAction('platform.settings.read'), asyncHandler(async (_req: Request, res: Response) => {
  const dataSource = await getDataSource();
  const settingsRepo = dataSource.getRepository(PlatformSettings);
  const settings = await settingsRepo.findOne({
    where: { id: 'default' },
    select: ['emailPlatformName'],
  });

  const ownership = (await platformSettingsSectionOwnershipService.list(dataSource))
    .find((row) => row.section === 'general') || null;
  res.json({ emailPlatformName: settings?.emailPlatformName || 'EnterpriseGlue', ownership });
}));

router.put('/api/admin/email-platform-name', apiLimiter, requireAuth, requireAction('platform.settings.manage'), validateBody(UpdateEmailPlatformNameRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const body = req.body;
    await platformSettingsService.update({ emailPlatformName: body.emailPlatformName }, req.user!.userId);

    await logAudit({
      action: AuditActions.USER_UPDATE,
      userId: req.user!.userId,
      resourceType: 'platform_settings',
      resourceId: 'default',
      details: { updated: ['emailPlatformName'] },
      ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    if (error instanceof z.ZodError) {
      throw Errors.validation('Validation failed');
    }
    logger.error('Update email platform name error:', error);
    throw Errors.internal('Failed to update email platform name');
  }
}));

/**
 * GET /api/admin/email-templates
 * List all email templates (platform admin only)
 */
router.get('/api/admin/email-templates', apiLimiter, requireAuth, requireAction('platform.settings.read'), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource();
  const templateRepo = dataSource.getRepository(EmailTemplate);
  const [templates, ownershipRows] = await Promise.all([
    templateRepo.find({
      select: ['id', 'type', 'name', 'subject', 'htmlTemplate', 'textTemplate', 'variables', 'isActive', 'createdAt', 'updatedAt'],
      order: { type: 'ASC' },
    }),
    adminConfigObjectOwnershipService.listForObjectType(dataSource, 'email_template'),
  ]);
  const ownershipById = new Map(ownershipRows.map((row) => [row.objectId, row]));

  // Parse variables JSON
  const parsed = templates.map((t) => ({
    ...t,
    variables: JSON.parse(t.variables || '[]'),
    ...adminConfigOwnershipFields(ownershipById.get(t.id)),
  }));

  res.json(parsed);
}));

/**
 * GET /api/admin/email-templates/:id
 * Get a single email template (platform admin only)
 */
router.get('/api/admin/email-templates/:id', apiLimiter, requireAuth, requireAction('platform.settings.read'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const dataSource = await getDataSource();
  const templateRepo = dataSource.getRepository(EmailTemplate);

  const template = await templateRepo.findOneBy({ id });

  if (!template) {
    throw Errors.notFound('Email template');
  }

  res.json({
    ...template,
    variables: JSON.parse(template.variables || '[]'),
    ...adminConfigOwnershipFields(await adminConfigObjectOwnershipService.findForObject(dataSource, 'email_template', template.id)),
  });
}));

/**
 * PATCH /api/admin/email-templates/:id
 * Update an email template (platform admin only)
 */
router.patch('/api/admin/email-templates/:id', apiLimiter, requireAuth, requireAction('platform.settings.manage'), validateParams(idParamSchema), validateBody(UpdateEmailTemplateRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const body = req.body;
    const dataSource = await getDataSource();
    const templateRepo = dataSource.getRepository(EmailTemplate);
    const now = Date.now();

    const existing = await templateRepo.findOneBy({ id });

    if (!existing) {
      throw Errors.notFound('Email template');
    }

    const updates: any = {
      updatedAt: now,
      updatedByUserId: req.user!.userId,
    };

    if (body.name !== undefined) updates.name = body.name;
    if (body.subject !== undefined) updates.subject = body.subject;
    if (body.htmlTemplate !== undefined) updates.htmlTemplate = body.htmlTemplate;
    if (body.textTemplate !== undefined) updates.textTemplate = body.textTemplate;
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    await dataSource.transaction(async (manager) => {
      await adminConfigObjectOwnershipService.claimManualMutation(manager, 'email_template', id);
      await manager.getRepository(EmailTemplate).update({ id }, updates);
    });

    await logAudit({
      action: AuditActions.USER_UPDATE,
      userId: req.user!.userId,
      resourceType: 'email_template',
      resourceId: id,
      details: { updated: Object.keys(body) },
      ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    if (error instanceof z.ZodError) {
      throw Errors.validation('Validation failed');
    }
    logger.error('Update email template error:', error);
    throw Errors.internal('Failed to update email template');
  }
}));

/**
 * POST /api/admin/email-templates/:id/reset
 * Reset an email template to default (platform admin only)
 */
router.post('/api/admin/email-templates/:id/reset', apiLimiter, requireAuth, requireAction('platform.settings.manage'), validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const dataSource = await getDataSource();
  const templateRepo = dataSource.getRepository(EmailTemplate);
  const now = Date.now();

  const existing = await templateRepo.findOne({
    where: { id },
    select: ['type'],
  });

  if (!existing) {
    throw Errors.notFound('Email template');
  }

  // Default templates
  const defaults: Record<string, { name: string; subject: string; htmlTemplate: string; textTemplate: string; variables: string }> = {
      invite: {
        name: 'User Invitation',
        subject: "You've been invited to {{platformName}}",
        htmlTemplate: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin:0;padding:0;background-color:#f5f7fb;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f7fb;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#ffffff;border:1px solid #e6e8eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:22px 24px 0 24px;">
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:18px;color:#6b7280;">
                  {{platformName}}
                </div>
                <h1 style="margin:8px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:28px;font-weight:700;color:#111827;">
                  You are invited
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 0 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:#111827;">
                <p style="margin:0 0 16px 0;">
                  <strong>{{inviterName}}</strong> invited you to join <strong>{{platformName}}</strong>.
                </p>
                <p style="margin:0 0 16px 0;">
                  Click the button below to accept the invitation.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 24px 18px 24px;">
                <a href="{{inviteLink}}" style="display:inline-block;background-color:#0f62fe;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;">
                  Accept invitation
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 22px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#6b7280;">
                <p style="margin:0 0 12px 0;">This invitation expires in {{expiresIn}}.</p>
                <p style="margin:0 0 8px 0;">If the button does not work, copy and paste this link into your browser:</p>
                <p style="margin:0;word-break:break-all;">
                  <a href="{{inviteLink}}" style="color:#0f62fe;text-decoration:none;">{{inviteLink}}</a>
                </p>
              </td>
            </tr>
          </table>

          <div style="max-width:600px;margin:12px auto 0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#9ca3af;text-align:center;">
            This is an automated message. Please do not reply.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`,
        textTemplate: 'Welcome to {{platformName}}\n\nYou have been invited by {{inviterName}} to join {{platformName}}.\n\nAccept your invitation: {{inviteLink}}\n\nThis invitation expires in {{expiresIn}}.',
        variables: '["platformName", "inviterName", "inviteLink", "expiresIn"]',
      },
      password_reset: {
        name: 'Password Reset',
        subject: 'Reset your {{platformName}} password',
        htmlTemplate: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin:0;padding:0;background-color:#f5f7fb;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f7fb;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#ffffff;border:1px solid #e6e8eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:22px 24px 0 24px;">
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:18px;color:#6b7280;">
                  {{platformName}}
                </div>
                <h1 style="margin:8px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:28px;font-weight:700;color:#111827;">
                  Reset your password
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 0 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:#111827;">
                <p style="margin:0 0 16px 0;">We received a request to reset your password for <strong>{{platformName}}</strong>.</p>
                <p style="margin:0 0 16px 0;">If you did not request this, you can safely ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 24px 18px 24px;">
                <a href="{{resetLink}}" style="display:inline-block;background-color:#0f62fe;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;">
                  Reset password
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 22px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#6b7280;">
                <p style="margin:0 0 12px 0;">This link expires in {{expiresIn}}.</p>
                <p style="margin:0 0 8px 0;">If the button does not work, copy and paste this link into your browser:</p>
                <p style="margin:0;word-break:break-all;">
                  <a href="{{resetLink}}" style="color:#0f62fe;text-decoration:none;">{{resetLink}}</a>
                </p>
              </td>
            </tr>
          </table>

          <div style="max-width:600px;margin:12px auto 0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#9ca3af;text-align:center;">
            This is an automated message. Please do not reply.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`,
        textTemplate: 'Password Reset Request\n\nWe received a request to reset your password for {{platformName}}.\n\nReset your password: {{resetLink}}\n\nIf you didn\'t request this, you can safely ignore this email.\n\nThis link expires in {{expiresIn}}.',
        variables: '["platformName", "resetLink", "expiresIn"]',
      },
      welcome: {
        name: 'Welcome Email',
        subject: 'Welcome to {{platformName}}!',
        htmlTemplate: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin:0;padding:0;background-color:#f5f7fb;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f7fb;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#ffffff;border:1px solid #e6e8eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:22px 24px 0 24px;">
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:18px;color:#6b7280;">
                  {{platformName}}
                </div>
                <h1 style="margin:8px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:28px;font-weight:700;color:#111827;">
                  Welcome
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 0 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:#111827;">
                <p style="margin:0 0 16px 0;">Hi {{userName}},</p>
                <p style="margin:0 0 16px 0;">Your account has been created successfully.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 24px 18px 24px;">
                <a href="{{loginLink}}" style="display:inline-block;background-color:#0f62fe;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;">
                  Login to get started
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 22px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#6b7280;">
                <p style="margin:0 0 8px 0;">If the button does not work, copy and paste this link into your browser:</p>
                <p style="margin:0;word-break:break-all;">
                  <a href="{{loginLink}}" style="color:#0f62fe;text-decoration:none;">{{loginLink}}</a>
                </p>
              </td>
            </tr>
          </table>

          <div style="max-width:600px;margin:12px auto 0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#9ca3af;text-align:center;">
            This is an automated message. Please do not reply.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`,
        textTemplate: 'Welcome to {{platformName}}!\n\nHi {{userName}},\n\nYour account has been created successfully.\n\nLogin to get started: {{loginLink}}',
        variables: '["platformName", "userName", "loginLink"]',
      },
      email_verification: {
        name: 'Email Verification',
        subject: 'Verify your email for {{platformName}}',
        htmlTemplate: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin:0;padding:0;background-color:#f5f7fb;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f7fb;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#ffffff;border:1px solid #e6e8eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:22px 24px 0 24px;">
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:18px;color:#6b7280;">
                  {{platformName}}
                </div>
                <h1 style="margin:8px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:28px;font-weight:700;color:#111827;">
                  Verify your email
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 0 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:#111827;">
                <p style="margin:0 0 16px 0;">Hi {{userName}},</p>
                <p style="margin:0 0 16px 0;">Please verify your email address by clicking the button below.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 24px 18px 24px;">
                <a href="{{verifyLink}}" style="display:inline-block;background-color:#0f62fe;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;">
                  Verify email
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 22px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#6b7280;">
                <p style="margin:0 0 12px 0;">This link expires in {{expiresIn}}.</p>
                <p style="margin:0 0 8px 0;">If the button does not work, copy and paste this link into your browser:</p>
                <p style="margin:0;word-break:break-all;">
                  <a href="{{verifyLink}}" style="color:#0f62fe;text-decoration:none;">{{verifyLink}}</a>
                </p>
              </td>
            </tr>
          </table>

          <div style="max-width:600px;margin:12px auto 0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#9ca3af;text-align:center;">
            This is an automated message. Please do not reply.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`,
        textTemplate: 'Verify Your Email\n\nHi {{userName}},\n\nPlease verify your email address: {{verifyLink}}\n\nThis link expires in {{expiresIn}}.',
        variables: '["platformName", "userName", "verifyLink", "expiresIn"]',
      },
    };

  const templateType = existing.type;
  const defaultTemplate = defaults[templateType];

  if (!defaultTemplate) {
    throw Errors.validation('No default template available for this type');
  }

  await dataSource.transaction(async (manager) => {
    await adminConfigObjectOwnershipService.claimManualMutation(manager, 'email_template', id);
    await manager.getRepository(EmailTemplate).update({ id }, {
      ...defaultTemplate,
      updatedAt: now,
      updatedByUserId: req.user!.userId,
    });
  });

  res.json({ success: true });
}));

/**
 * POST /api/admin/email-templates/:id/preview
 * Preview an email template with sample data (platform admin only)
 */
router.post('/api/admin/email-templates/:id/preview', apiLimiter, requireAuth, requireAction('platform.settings.read'), validateParams(idParamSchema), validateBody(EmailTemplatePreviewRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { variables } = req.body as { variables?: Record<string, string> };
  const dataSource = await getDataSource();
  const templateRepo = dataSource.getRepository(EmailTemplate);
  const settingsRepo = dataSource.getRepository(PlatformSettings);

  const template = await templateRepo.findOneBy({ id });

  if (!template) {
    throw Errors.notFound('Email template');
  }

  const settings = await settingsRepo.findOne({
    where: { id: 'default' },
    select: ['emailPlatformName'],
  });
  const platformName = settings?.emailPlatformName || 'EnterpriseGlue';
  
  // Sample data for preview
  const sampleData: Record<string, string> = {
    platformName,
    userName: 'John Doe',
    inviterName: 'Jane Smith',
    inviteLink: 'https://app.example.com/invite/abc123',
    resetLink: 'https://app.example.com/reset/abc123',
    verifyLink: 'https://app.example.com/verify/abc123',
    loginLink: 'https://app.example.com/login',
    expiresIn: '24 hours',
    ...variables,
  };

  // Replace variables in template
  let html = template.htmlTemplate;
  let text = template.textTemplate || '';
  let subject = template.subject;

  for (const [key, value] of Object.entries(sampleData)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    html = html.replace(regex, value);
    text = text.replace(regex, value);
    subject = subject.replace(regex, value);
  }

  res.json(EmailTemplatePreviewResponseSchema.parse({
    subject,
    html,
    text,
  }));
}));

export default router;
