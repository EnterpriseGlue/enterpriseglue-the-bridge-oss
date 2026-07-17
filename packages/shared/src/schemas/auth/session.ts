import { z } from 'zod';

/**
 * Request-derived identity context returned by authenticated browser endpoints.
 * It deliberately is not a reusable JWT claim: tenant selection can differ on
 * a subsequent request.
 */
export const AuthenticatedSessionContextSchema = z.object({
  principal: z.object({ type: z.literal('user'), id: z.string() }),
  tenant: z.object({ id: z.string().nullable() }),
});

/**
 * Canonical minimum profile returned by an authenticated browser session.
 * Profile fields vary by endpoint while legacy profile extensions remain
 * compatible, so preserve extensions after validating the authorization-
 * relevant identity and session boundary.
 */
export const AuthenticatedSessionUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  platformRole: z.enum(['admin', 'user']).optional(),
  capabilities: z.record(z.string(), z.boolean()).optional(),
  isActive: z.boolean().optional(),
  isEmailVerified: z.boolean().optional(),
  mustResetPassword: z.boolean().optional(),
  createdAt: z.number().optional(),
  lastLoginAt: z.number().optional(),
  session: AuthenticatedSessionContextSchema,
}).passthrough();

export const AuthenticatedSessionLoginResponseSchema = z.object({
  user: AuthenticatedSessionUserSchema,
  expiresIn: z.number().positive(),
  emailVerificationRequired: z.boolean().optional(),
}).strict();

export const AuthenticatedSessionOnboardingResponseSchema = AuthenticatedSessionLoginResponseSchema.extend({
  emailVerificationRequired: z.literal(false),
});

export const RefreshAccessTokenResponseSchema = z.object({
  expiresIn: z.number().positive(),
}).strict();

export type AuthenticatedSessionContext = z.infer<typeof AuthenticatedSessionContextSchema>;
export type AuthenticatedSessionUser = z.infer<typeof AuthenticatedSessionUserSchema>;
export type AuthenticatedSessionLoginResponse = z.infer<typeof AuthenticatedSessionLoginResponseSchema>;
export type AuthenticatedSessionOnboardingResponse = z.infer<typeof AuthenticatedSessionOnboardingResponseSchema>;
export type RefreshAccessTokenResponse = z.infer<typeof RefreshAccessTokenResponseSchema>;
