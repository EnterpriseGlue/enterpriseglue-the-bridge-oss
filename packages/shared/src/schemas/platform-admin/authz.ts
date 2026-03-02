import { z } from 'zod';

// Raw schema - matches TypeORM AuthzPolicy entity
export const AuthzPolicySchemaRaw = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  effect: z.string(),
  priority: z.number(),
  resourceType: z.string().nullable(),
  action: z.string().nullable(),
  conditions: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  createdById: z.string().nullable(),
});

// Authorization Policy - Select schema (API response)
export const AuthzPolicySchema = AuthzPolicySchemaRaw.transform((p) => ({
  id: p.id,
  name: p.name,
  description: p.description ?? undefined,
  effect: p.effect as 'allow' | 'deny',
  priority: p.priority,
  resourceType: p.resourceType ?? undefined,
  action: p.action ?? undefined,
  conditions: p.conditions,
  isActive: p.isActive,
  createdAt: Number(p.createdAt),
  updatedAt: Number(p.updatedAt),
  createdById: p.createdById ?? undefined,
}));

// Authorization Policy - Insert schema
export const AuthzPolicyInsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  effect: z.enum(['allow', 'deny']).optional(),
  priority: z.number().int().optional(),
  conditions: z.string().optional(),
});

// Raw schema - matches TypeORM AuthzAuditLog entity
export const AuthzAuditLogSchemaRaw = z.object({
  id: z.string(),
  userId: z.string(),
  action: z.string(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  decision: z.string(),
  reason: z.string().nullable(),
  policyId: z.string().nullable(),
  context: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  timestamp: z.number(),
});

// Authorization Audit Log - Select schema (API response)
export const AuthzAuditLogSchema = AuthzAuditLogSchemaRaw.transform((l) => ({
  id: l.id,
  userId: l.userId,
  action: l.action,
  resourceType: l.resourceType ?? undefined,
  resourceId: l.resourceId ?? undefined,
  decision: l.decision as 'allow' | 'deny',
  reason: l.reason,
  policyId: l.policyId ?? undefined,
  context: l.context,
  ipAddress: l.ipAddress ?? undefined,
  userAgent: l.userAgent ?? undefined,
  timestamp: Number(l.timestamp),
}));

// Raw schema - matches TypeORM SsoProvider entity
export const SsoProviderSchemaRaw = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  clientId: z.string().nullable(),
  tenantId: z.string().nullable(),
  issuerUrl: z.string().nullable(),
  scopes: z.string().nullable(),
  callbackUrl: z.string().nullable(),
  iconUrl: z.string().nullable(),
  buttonLabel: z.string().nullable(),
  buttonColor: z.string().nullable(),
  displayOrder: z.number(),
  autoProvision: z.boolean(),
  defaultRole: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// SSO Provider - Select schema (API response)
export const SsoProviderSchema = SsoProviderSchemaRaw.transform((p) => ({
  id: p.id,
  name: p.name,
  type: p.type as 'microsoft' | 'google' | 'saml' | 'oidc',
  enabled: p.enabled,
  clientId: p.clientId ?? undefined,
  tenantId: p.tenantId ?? undefined,
  issuerUrl: p.issuerUrl ?? undefined,
  scopes: p.scopes ?? undefined,
  callbackUrl: p.callbackUrl ?? undefined,
  iconUrl: p.iconUrl ?? undefined,
  buttonLabel: p.buttonLabel ?? undefined,
  buttonColor: p.buttonColor ?? undefined,
  displayOrder: p.displayOrder,
  autoProvision: p.autoProvision,
  defaultRole: p.defaultRole as 'admin' | 'developer' | 'user',
  createdAt: Number(p.createdAt),
  updatedAt: Number(p.updatedAt),
}));

// SSO Provider - Insert schema
export const SsoProviderInsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  type: z.enum(['microsoft', 'google', 'saml', 'oidc']),
  defaultRole: z.enum(['admin', 'developer', 'user']).optional(),
});

// Raw schema - matches TypeORM SsoClaimsMapping entity
export const SsoClaimsMappingSchemaRaw = z.object({
  id: z.string(),
  providerId: z.string().nullable(),
  claimType: z.string(),
  claimKey: z.string(),
  claimValue: z.string(),
  targetRole: z.string(),
  priority: z.number(),
  isActive: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// SSO Claims Mapping - Select schema (API response)
export const SsoClaimsMappingSchema = SsoClaimsMappingSchemaRaw.transform((m) => ({
  id: m.id,
  providerId: m.providerId ?? undefined,
  claimType: m.claimType as 'group' | 'role' | 'email_domain' | 'custom',
  claimKey: m.claimKey,
  claimValue: m.claimValue,
  targetRole: m.targetRole as 'admin' | 'developer' | 'user',
  priority: m.priority,
  isActive: m.isActive,
  createdAt: Number(m.createdAt),
  updatedAt: Number(m.updatedAt),
}));

// SSO Claims Mapping - Insert schema
export const SsoClaimsMappingInsertSchema = z.object({
  id: z.string().uuid().optional(),
  claimType: z.enum(['group', 'role', 'email_domain', 'custom']),
  claimKey: z.string().min(1),
  claimValue: z.string().min(1),
  targetRole: z.enum(['admin', 'developer', 'user']),
});

// Types
export type AuthzPolicy = z.infer<typeof AuthzPolicySchema>;
export type AuthzAuditLogEntry = z.infer<typeof AuthzAuditLogSchema>;
export type SsoProvider = z.infer<typeof SsoProviderSchema>;
export type SsoClaimsMapping = z.infer<typeof SsoClaimsMappingSchema>;
