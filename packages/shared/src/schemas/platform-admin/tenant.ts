import { z } from 'zod';

// Tenant - Raw schema - matches TypeORM Tenant entity
export const TenantSchemaRaw = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  createdByUserId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Tenant - Select schema (API response)
export const TenantSchema = TenantSchemaRaw.transform((t) => ({
  id: t.id,
  name: t.name,
  slug: t.slug,
  status: t.status as 'active' | 'inactive' | 'suspended',
  createdByUserId: t.createdByUserId ?? undefined,
  createdAt: Number(t.createdAt),
  updatedAt: Number(t.updatedAt),
}));

// Tenant - Insert schema
export const TenantInsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
});

// Tenant Settings - Raw schema - matches TypeORM TenantSettings entity
export const TenantSettingsSchemaRaw = z.object({
  tenantId: z.string(),
  inviteAllowAllDomains: z.boolean(),
  inviteAllowedDomains: z.string().nullable(),
  emailSendConfigId: z.string().nullable(),
  logoUrl: z.string().nullable(),
  logoTitle: z.string().nullable(),
  logoScale: z.number().nullable(),
  titleFontUrl: z.string().nullable(),
  titleFontWeight: z.string().nullable(),
  titleFontSize: z.string().nullable(),
  titleVerticalOffset: z.string().nullable(),
  menuAccentColor: z.string().nullable(),
  updatedAt: z.number(),
  updatedByUserId: z.string().nullable(),
});

// Tenant Settings - Select schema (API response)
export const TenantSettingsSchema = TenantSettingsSchemaRaw.transform((s) => ({
  tenantId: s.tenantId,
  inviteAllowAllDomains: s.inviteAllowAllDomains,
  inviteAllowedDomains: s.inviteAllowedDomains,
  emailSendConfigId: s.emailSendConfigId ?? undefined,
  logoUrl: s.logoUrl ?? undefined,
  logoTitle: s.logoTitle ?? undefined,
  logoScale: s.logoScale ?? undefined,
  titleFontUrl: s.titleFontUrl ?? undefined,
  titleFontWeight: s.titleFontWeight ?? undefined,
  titleFontSize: s.titleFontSize ?? undefined,
  titleVerticalOffset: s.titleVerticalOffset ?? undefined,
  menuAccentColor: s.menuAccentColor ?? undefined,
  updatedAt: Number(s.updatedAt),
  updatedByUserId: s.updatedByUserId ?? undefined,
}));

// Tenant Membership - Raw schema - matches TypeORM TenantMembership entity
export const TenantMembershipSchemaRaw = z.object({
  id: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  role: z.string(),
  createdAt: z.number(),
});

// Tenant Membership - Select schema (API response)
export const TenantMembershipSchema = TenantMembershipSchemaRaw.transform((m) => ({
  id: m.id,
  tenantId: m.tenantId,
  userId: m.userId,
  role: m.role as 'owner' | 'admin' | 'member',
  createdAt: Number(m.createdAt),
}));

// Tenant Membership - Insert schema
export const TenantMembershipInsertSchema = z.object({
  id: z.string().uuid().optional(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member']).optional(),
});

// Types
export type Tenant = z.infer<typeof TenantSchema>;
export type TenantSettings = z.infer<typeof TenantSettingsSchema>;
export type TenantMembership = z.infer<typeof TenantMembershipSchema>;
