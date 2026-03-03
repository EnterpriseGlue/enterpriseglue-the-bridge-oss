import { z } from 'zod';

// Raw schema - matches TypeORM EmailTemplate entity
export const EmailTemplateSchemaRaw = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  subject: z.string(),
  htmlTemplate: z.string(),
  textTemplate: z.string().nullable(),
  variables: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  createdByUserId: z.string().nullable(),
  updatedByUserId: z.string().nullable(),
});

// Email Template - Select schema (API response)
export const EmailTemplateSchema = EmailTemplateSchemaRaw.transform((t) => ({
  id: t.id,
  type: t.type as 'invite' | 'password_reset' | 'welcome' | 'email_verification',
  name: t.name,
  subject: t.subject,
  htmlTemplate: t.htmlTemplate,
  textTemplate: t.textTemplate ?? undefined,
  variables: t.variables,
  isActive: t.isActive,
  createdAt: Number(t.createdAt),
  updatedAt: Number(t.updatedAt),
  createdByUserId: t.createdByUserId ?? undefined,
  updatedByUserId: t.updatedByUserId ?? undefined,
}));

// Email Template - Insert schema
export const EmailTemplateInsertSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(['invite', 'password_reset', 'welcome', 'email_verification']),
  name: z.string().min(1),
  subject: z.string().min(1),
  htmlTemplate: z.string().min(1),
});

// Types
export type EmailTemplate = z.infer<typeof EmailTemplateSchema>;
