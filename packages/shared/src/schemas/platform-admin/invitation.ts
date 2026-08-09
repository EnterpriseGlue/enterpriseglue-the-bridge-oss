import { z } from 'zod';

/**
 * Tenant-scoped invitation contracts used by the generic administration UI.
 * Project and engine member flows have more specific contracts; this module
 * covers the shared invitation endpoint that can address all three scopes.
 */
/** Resource scopes retained in public invitation status responses. */
export const InvitationResourceTypeSchema = z.enum(['platform_user', 'tenant', 'project', 'engine']);
/** The generic create endpoint deliberately cannot mint platform-user invites. */
export const InvitationCreationResourceTypeSchema = z.enum(['tenant', 'project', 'engine']);
export const InvitationDeliveryMethodSchema = z.enum(['email', 'manual']);
export const InvitationDisplayStatusSchema = z.enum(['pending', 'expired', 'onboarding']);

export const InvitationCapabilitiesResponseSchema = z.object({
  ssoRequired: z.boolean(),
  emailConfigured: z.boolean(),
});

export const CreateInvitationRequestSchema = z.object({
  email: z.string().email(),
  resourceType: InvitationCreationResourceTypeSchema,
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

/** Safe, token-scoped display data returned to the public acceptance page. */
export const InvitationInfoSchema = z.object({
  email: z.string().email(),
  tenantSlug: z.string(),
  resourceType: InvitationResourceTypeSchema,
  resourceName: z.string().nullable(),
  resourceRole: z.string().nullable(),
  resourceRoles: z.array(z.string()),
  deliveryMethod: InvitationDeliveryMethodSchema,
  expiresAt: z.number(),
  status: InvitationDisplayStatusSchema,
});

export const VerifyInvitationOtpRequestSchema = z.object({
  oneTimePassword: z.string().min(1),
});

export const CompleteOnboardingRequestSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  newPassword: z.string().min(8),
});

export const InvitationOnboardingResponseSchema = z.object({
  requiresPasswordSet: z.literal(true),
  tenantSlug: z.string(),
  deliveryMethod: InvitationDeliveryMethodSchema,
});

export type InvitationResourceType = z.infer<typeof InvitationResourceTypeSchema>;
export type InvitationCreationResourceType = z.infer<typeof InvitationCreationResourceTypeSchema>;
export type InvitationDeliveryMethod = z.infer<typeof InvitationDeliveryMethodSchema>;
export type InvitationDisplayStatus = z.infer<typeof InvitationDisplayStatusSchema>;
export type InvitationCapabilitiesResponse = z.infer<typeof InvitationCapabilitiesResponseSchema>;
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>;
export type CreateInvitationResponse = z.infer<typeof CreateInvitationResponseSchema>;
export type InvitationTokenParams = z.infer<typeof InvitationTokenParamsSchema>;
export type InvitationInfo = z.infer<typeof InvitationInfoSchema>;
export type VerifyInvitationOtpRequest = z.infer<typeof VerifyInvitationOtpRequestSchema>;
export type CompleteOnboardingRequest = z.infer<typeof CompleteOnboardingRequestSchema>;
export type InvitationOnboardingResponse = z.infer<typeof InvitationOnboardingResponseSchema>;
