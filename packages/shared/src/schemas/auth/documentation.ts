import { z } from 'zod';

export const DocumentationConfigurationResponseSchema = z.object({ documentationOrigin: z.url(), accountOrigin: z.url() }).strict();

export const DocumentationGrantRequestSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/), challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
export const DocumentationGrantResponseSchema = z.object({ callbackUrl: z.url() }).strict();
export const DocumentationExchangeRequestSchema = z.object({
  code: z.string().min(100).max(4096), verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
export const DocumentationExchangeResponseSchema = z.object({ session: z.string().min(100).max(4096) }).strict();
export const DocumentationAccessResponseSchema = z.object({ authenticated: z.literal(true), permission: z.literal('documentation:read') }).strict();
export const DocumentationLogoutResponseSchema = z.object({ signedOut: z.literal(true) }).strict();
