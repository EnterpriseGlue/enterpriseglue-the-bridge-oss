import { z } from 'zod';
import { PlatformSettingsSectionOwnershipSchema } from './platform-settings.js';

export const AdminConfigOwnershipMetadataSchema = z.object({
  configKey: z.string().nullable(),
  sourceRef: z.string().nullable(),
  ownershipMode: z.enum(['manual', 'config_locked', 'config_warn']),
  driftStatus: z.enum(['in_sync', 'drifted']).nullable(),
}).strict();

export const EmailProviderSchema = z.enum(['resend', 'sendgrid', 'mailgun', 'mailjet', 'smtp']);

export const EmailConfigurationAdminResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: EmailProviderSchema,
  fromName: z.string(),
  fromEmail: z.string().email(),
  replyTo: z.string().email().nullable(),
  smtpHost: z.string().nullable(),
  smtpPort: z.number().int().nullable(),
  smtpSecure: z.boolean(),
  smtpUser: z.string().nullable(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).merge(AdminConfigOwnershipMetadataSchema);

export const CreateEmailConfigurationRequestSchema = z.object({
  name: z.string().min(1).max(100),
  provider: EmailProviderSchema,
  apiKey: z.string().min(1),
  fromName: z.string().min(1).max(100),
  fromEmail: z.string().email(),
  replyTo: z.string().email().optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().optional(),
}).strict();

export const UpdateEmailConfigurationRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  provider: EmailProviderSchema.optional(),
  apiKey: z.string().min(1).optional(),
  fromName: z.string().min(1).max(100).optional(),
  fromEmail: z.string().email().optional(),
  replyTo: z.string().email().nullable().optional(),
  enabled: z.boolean().optional(),
  smtpHost: z.string().nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).nullable().optional(),
  smtpSecure: z.boolean().nullable().optional(),
  smtpUser: z.string().nullable().optional(),
}).strict();

export const EmailTemplateAdminResponseSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  subject: z.string(),
  htmlTemplate: z.string(),
  textTemplate: z.string().nullable(),
  variables: z.array(z.string()),
  isActive: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).merge(AdminConfigOwnershipMetadataSchema);

export const UpdateEmailTemplateRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  subject: z.string().min(1).max(200).optional(),
  htmlTemplate: z.string().min(1).optional(),
  textTemplate: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
}).strict();

export const EmailPlatformNameResponseSchema = z.object({
  emailPlatformName: z.string(),
  ownership: PlatformSettingsSectionOwnershipSchema.nullable(),
}).strict();

export const UpdateEmailPlatformNameRequestSchema = z.object({
  emailPlatformName: z.string().trim().min(1).max(160),
}).strict();

export const EmailTemplatePreviewRequestSchema = z.object({
  variables: z.record(
    z.string().trim().min(1).max(160).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    z.string().max(10_000),
  ).refine((value) => Object.keys(value).length <= 100, 'At most 100 preview variables are allowed').optional(),
}).strict();

export const EmailTemplatePreviewResponseSchema = z.object({
  subject: z.string().max(200),
  html: z.string().max(1024 * 1024),
  text: z.string().max(1024 * 1024),
}).strict();

export const EmailTestRequestSchema = z.object({
  toEmail: z.string().email(),
}).strict();

export const AdminMutationSuccessResponseSchema = z.object({ success: z.literal(true) }).strict();
export const EmailTestResponseSchema = AdminMutationSuccessResponseSchema.extend({ message: z.string() });

export type EmailConfigurationAdminResponse = z.infer<typeof EmailConfigurationAdminResponseSchema>;
export type EmailTemplateAdminResponse = z.infer<typeof EmailTemplateAdminResponseSchema>;
