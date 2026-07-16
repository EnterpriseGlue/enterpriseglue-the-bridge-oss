import { z } from 'zod';

/**
 * Tenant-scoped invitation contracts used by the generic administration UI.
 * Project and engine member flows have more specific contracts; this module
 * covers the shared invitation endpoint that can address all three scopes.
 */
export const InvitationResourceTypeSchema = z.enum(['tenant', 'project', 'engine']);
export const InvitationDeliveryMethodSchema = z.enum(['email', 'manual']);

export const InvitationCapabilitiesResponseSchema = z.object({
  ssoRequired: z.boolean(),
  emailConfigured: z.boolean(),
});

export const CreateInvitationRequestSchema = z.object({
  email: z.string().email(),
  resourceType: InvitationResourceTypeSchema,
  resourceId: z.string().optional(),
  resourceName: z.string().optional(),
  role: z.string().optional(),
  deliveryMethod: InvitationDeliveryMethodSchema.default('email'),
});

/**
 * Manual-delivery values are reveal-once. Consumers must never persist or
 * refetch these fields after rendering the initial response.
 */
export const CreateInvitationResponseSchema = z.object({
  invited: z.literal(true),
  emailSent: z.boolean(),
  emailError: z.string().optional(),
  inviteUrl: z.string().optional(),
  oneTimePassword: z.string().optional(),
});

export const InvitationTokenParamsSchema = z.object({
  token: z.string().min(1),
});

export const VerifyInvitationOtpRequestSchema = z.object({
  oneTimePassword: z.string().min(1),
});

export const InvitationOnboardingResponseSchema = z.object({
  requiresPasswordSet: z.literal(true),
  tenantSlug: z.string(),
  deliveryMethod: InvitationDeliveryMethodSchema,
});

export type InvitationResourceType = z.infer<typeof InvitationResourceTypeSchema>;
export type InvitationDeliveryMethod = z.infer<typeof InvitationDeliveryMethodSchema>;
export type InvitationCapabilitiesResponse = z.infer<typeof InvitationCapabilitiesResponseSchema>;
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>;
export type CreateInvitationResponse = z.infer<typeof CreateInvitationResponseSchema>;
export type InvitationTokenParams = z.infer<typeof InvitationTokenParamsSchema>;
export type VerifyInvitationOtpRequest = z.infer<typeof VerifyInvitationOtpRequestSchema>;
export type InvitationOnboardingResponse = z.infer<typeof InvitationOnboardingResponseSchema>;
