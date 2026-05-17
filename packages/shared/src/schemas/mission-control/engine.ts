import { z } from 'zod';
import { toTimestamp, nullToUndefined } from '@enterpriseglue/shared/utils/schema-helpers.js';

export const EngineTypeSchema = z.enum(['ion', 'operaton', 'camunda7']);
export type EngineType = z.infer<typeof EngineTypeSchema>;
export const EngineAuthTypeSchema = z.enum(['none', 'basic', 'bearer', 'oauth2-client-credentials']);
export type EngineAuthType = z.infer<typeof EngineAuthTypeSchema>;

export function normalizeEngineType(value: unknown): EngineType {
  const parsed = EngineTypeSchema.safeParse(value ?? 'camunda7');
  return parsed.success ? parsed.data : 'camunda7';
}

// Raw schema - matches TypeORM Engine entity
export const EngineSchemaRaw = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  type: z.string().nullable(),
  authType: z.string().nullable(),
  username: z.string().nullable(),
  passwordEnc: z.string().nullable(),
  oauthTokenUrl: z.string().nullable().optional(),
  oauthScopes: z.string().nullable().optional(),
  oauthAudience: z.string().nullable().optional(),
  active: z.boolean().nullable(),
  version: z.string().nullable(),
  ownerId: z.string().nullable().optional(),
  delegateId: z.string().nullable().optional(),
  environmentTagId: z.string().nullable().optional(),
  environmentLocked: z.boolean().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Engine schema - transformed from Raw (for API responses)
export const EngineSchema = EngineSchemaRaw.transform((e) => ({
  id: e.id,
  name: e.name,
  baseUrl: e.baseUrl,
  type: normalizeEngineType(e.type),
  authType: e.authType as EngineAuthType | undefined,
  username: nullToUndefined(e.username),
  passwordEnc: nullToUndefined(e.passwordEnc),
  oauthTokenUrl: nullToUndefined(e.oauthTokenUrl ?? null),
  oauthScopes: nullToUndefined(e.oauthScopes ?? null),
  oauthAudience: nullToUndefined(e.oauthAudience ?? null),
  active: Boolean(e.active),
  version: nullToUndefined(e.version),
  createdAt: toTimestamp(e.createdAt),
  updatedAt: toTimestamp(e.updatedAt),
}));

export const EngineInsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  type: EngineTypeSchema.optional(),
  authType: EngineAuthTypeSchema.optional(),
  username: z.string().optional(),
  passwordEnc: z.string().optional(),
  oauthTokenUrl: z.string().url().optional(),
  oauthScopes: z.string().optional(),
  oauthAudience: z.string().optional(),
  active: z.boolean().optional(),
  version: z.string().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

// Raw schema - matches TypeORM EngineHealth entity
export const EngineHealthSchemaRaw = z.object({
  id: z.string(),
  engineId: z.string(),
  status: z.string(),
  latencyMs: z.number().nullable(),
  message: z.string().nullable(),
  checkedAt: z.number(),
});

// Engine health schemas
export const EngineHealthSchema = EngineHealthSchemaRaw.transform((h) => ({
  id: h.id,
  engineId: h.engineId,
  status: h.status as 'connected' | 'disconnected' | 'unknown',
  latencyMs: h.latencyMs ?? undefined,
  message: h.message ?? undefined,
  checkedAt: Number(h.checkedAt ?? 0),
}));

export const EngineHealthInsertSchema = z.object({
  id: z.string().uuid().optional(),
  engineId: z.string().uuid(),
  status: z.enum(['connected', 'disconnected', 'unknown']),
  latencyMs: z.number().optional(),
  message: z.string().optional(),
  checkedAt: z.number().optional(),
});

// Types
export type Engine = z.infer<typeof EngineSchema>;
export type EngineHealth = z.infer<typeof EngineHealthSchema>;
