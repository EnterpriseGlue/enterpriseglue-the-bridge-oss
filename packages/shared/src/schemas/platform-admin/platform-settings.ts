import { z } from 'zod';

const PiiProviderTypeSchema = z.enum(['presidio', 'gcp_dlp', 'aws_comprehend', 'azure_pii']);
const PiiScopeSchema = z.enum(['processDetails', 'history', 'logs', 'errors', 'audit']);
const BrandingHexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const EngineOnboardingModeSchema = z.enum(['manual_allowed', 'external_only', 'hybrid']);
export const ProjectEngineTargetPolicyModeSchema = z.enum(['manual_allowed', 'external_only', 'hybrid']);
export const AccessAuthorityModeSchema = z.enum(['manual', 'transition_to_sso', 'sso_managed']);
export const UnsupportedEngineRuntimeAuthorizationModeMessage = 'Unsupported runtime authorization mode; v1 supports only enterpriseglue_authoritative';
export const EngineRuntimeAuthorizationModeSchema = z.literal('enterpriseglue_authoritative', {
  error: UnsupportedEngineRuntimeAuthorizationModeMessage,
});
export const UnsupportedEngineRuntimeAuthorizationModeErrorSchema = z.object({
  error: z.literal('Validation failed'),
  issues: z.array(z.object({
    path: z.string(),
    message: z.literal(UnsupportedEngineRuntimeAuthorizationModeMessage),
    code: z.literal('invalid_value'),
  })).min(1),
});

/** Platform-wide branding returned to the administrator settings surface. */
export const PlatformBrandingSchema = z.object({
  logoUrl: z.string().nullable(),
  loginLogoUrl: z.string().nullable(),
  loginTitleVerticalOffset: z.number(),
  loginTitleColor: z.string().nullable(),
  logoTitle: z.string().nullable(),
  logoScale: z.number(),
  titleFontUrl: z.string().nullable(),
  titleFontWeight: z.string(),
  titleFontSize: z.number(),
  titleVerticalOffset: z.number(),
  menuAccentColor: z.string().nullable(),
  faviconUrl: z.string().nullable(),
});

/** Non-secret branding available before a normal user session exists. */
export const PublicPlatformBrandingSchema = PlatformBrandingSchema.extend({
  ssoAutoRedirectSingleProvider: z.boolean(),
});

export const UpdatePlatformBrandingRequestSchema = z.object({
  logoUrl: z.string().nullable().optional(),
  loginLogoUrl: z.string().nullable().optional(),
  loginTitleVerticalOffset: z.number().min(-50).max(50).optional(),
  loginTitleColor: BrandingHexColorSchema.nullable().optional(),
  logoTitle: z.string().nullable().optional(),
  logoScale: z.number().min(50).max(200).optional(),
  titleFontUrl: z.string().nullable().optional(),
  titleFontWeight: z.string().optional(),
  titleFontSize: z.number().min(10).max(32).optional(),
  titleVerticalOffset: z.number().min(-20).max(20).optional(),
  menuAccentColor: BrandingHexColorSchema.nullable().optional(),
  faviconUrl: z.string().nullable().optional(),
});

// Select schema (read responses)
export const PlatformSettingsSchema = z.object({
  defaultEnvironmentTagId: z.string().nullable(),
  syncPushEnabled: z.boolean(),
  syncPullEnabled: z.boolean(),
  gitProjectTokenSharingEnabled: z.boolean(),
  defaultDeployRoles: z.array(z.string()),
  engineOnboardingMode: EngineOnboardingModeSchema,
  projectEngineTargetMode: ProjectEngineTargetPolicyModeSchema,
  engineAccessAuthority: AccessAuthorityModeSchema,
  projectAccessAuthority: AccessAuthorityModeSchema,
  engineRuntimeAuthorizationMode: EngineRuntimeAuthorizationModeSchema,
  credentiallessCustomerSidecarsEnabled: z.boolean(),
  inviteAllowAllDomains: z.boolean(),
  inviteAllowedDomains: z.array(z.string()),
  ssoAutoRedirectSingleProvider: z.boolean(),
  ssoAllEnginesAssignmentMappingsEnabled: z.boolean(),
  ssoEngineOwnerAssignmentMappingsEnabled: z.boolean(),
  ssoEngineDelegateAssignmentMappingsEnabled: z.boolean(),
  ssoRegexClaimMappingsEnabled: z.boolean(),
  ssoBroadEntitlementMappingsEnabled: z.boolean(),
  ssoSecretViewMappingsEnabled: z.boolean(),
  ssoUnredactedAuditMappingsEnabled: z.boolean(),
  ssoPermanentDeleteMappingsEnabled: z.boolean(),
  piiRegexEnabled: z.boolean(),
  piiExternalProviderEnabled: z.boolean(),
  piiExternalProviderType: PiiProviderTypeSchema.nullable(),
  piiExternalProviderEndpoint: z.string().nullable(),
  piiExternalProviderAuthHeader: z.string().nullable(),
  piiExternalProviderAuthToken: z.string().nullable(),
  piiExternalProviderProjectId: z.string().nullable(),
  piiExternalProviderRegion: z.string().nullable(),
  piiRedactionStyle: z.string(),
  piiScopes: z.array(PiiScopeSchema),
  piiMaxPayloadSizeBytes: z.number(),
});

/** Safe settings required by authenticated, non-admin UI surfaces. */
export const PublicPlatformSettingsSchema = PlatformSettingsSchema.pick({
  syncPushEnabled: true,
  syncPullEnabled: true,
  gitProjectTokenSharingEnabled: true,
  defaultDeployRoles: true,
  engineOnboardingMode: true,
  projectEngineTargetMode: true,
  engineAccessAuthority: true,
  projectAccessAuthority: true,
  engineRuntimeAuthorizationMode: true,
  credentiallessCustomerSidecarsEnabled: true,
  ssoAllEnginesAssignmentMappingsEnabled: true,
  ssoEngineOwnerAssignmentMappingsEnabled: true,
  ssoEngineDelegateAssignmentMappingsEnabled: true,
  ssoRegexClaimMappingsEnabled: true,
  ssoBroadEntitlementMappingsEnabled: true,
  ssoSecretViewMappingsEnabled: true,
  ssoUnredactedAuditMappingsEnabled: true,
  ssoPermanentDeleteMappingsEnabled: true,
});

// Request schemas
export const UpdatePlatformSettingsRequest = z.object({
  defaultEnvironmentTagId: z.string().nullable().optional(),
  syncPushEnabled: z.boolean().optional(),
  syncPullEnabled: z.boolean().optional(),
  gitProjectTokenSharingEnabled: z.boolean().optional(),
  defaultDeployRoles: z.array(z.string()).optional(),
  engineOnboardingMode: EngineOnboardingModeSchema.optional(),
  projectEngineTargetMode: ProjectEngineTargetPolicyModeSchema.optional(),
  engineAccessAuthority: AccessAuthorityModeSchema.optional(),
  projectAccessAuthority: AccessAuthorityModeSchema.optional(),
  engineRuntimeAuthorizationMode: EngineRuntimeAuthorizationModeSchema.optional(),
  credentiallessCustomerSidecarsEnabled: z.boolean().optional(),
  inviteAllowAllDomains: z.boolean().optional(),
  inviteAllowedDomains: z.array(z.string()).optional(),
  ssoAutoRedirectSingleProvider: z.boolean().optional(),
  ssoAllEnginesAssignmentMappingsEnabled: z.boolean().optional(),
  ssoEngineOwnerAssignmentMappingsEnabled: z.boolean().optional(),
  ssoEngineDelegateAssignmentMappingsEnabled: z.boolean().optional(),
  ssoRegexClaimMappingsEnabled: z.boolean().optional(),
  ssoBroadEntitlementMappingsEnabled: z.boolean().optional(),
  ssoSecretViewMappingsEnabled: z.boolean().optional(),
  ssoUnredactedAuditMappingsEnabled: z.boolean().optional(),
  ssoPermanentDeleteMappingsEnabled: z.boolean().optional(),
  piiRegexEnabled: z.boolean().optional(),
  piiExternalProviderEnabled: z.boolean().optional(),
  piiExternalProviderType: PiiProviderTypeSchema.optional().nullable(),
  piiExternalProviderEndpoint: z.string().optional().nullable(),
  piiExternalProviderAuthHeader: z.string().optional().nullable(),
  piiExternalProviderAuthToken: z.string().optional().nullable(),
  piiExternalProviderProjectId: z.string().optional().nullable(),
  piiExternalProviderRegion: z.string().optional().nullable(),
  piiRedactionStyle: z.string().optional(),
  piiScopes: z.array(PiiScopeSchema).optional(),
  piiMaxPayloadSizeBytes: z.number().optional(),
});

// Types
export type PlatformSettings = z.infer<typeof PlatformSettingsSchema>;
export type PublicPlatformSettings = z.infer<typeof PublicPlatformSettingsSchema>;
export type UpdatePlatformSettings = z.infer<typeof UpdatePlatformSettingsRequest>;
export type PlatformBranding = z.infer<typeof PlatformBrandingSchema>;
export type PublicPlatformBranding = z.infer<typeof PublicPlatformBrandingSchema>;
export type UpdatePlatformBrandingRequest = z.infer<typeof UpdatePlatformBrandingRequestSchema>;
export type EngineOnboardingMode = z.infer<typeof EngineOnboardingModeSchema>;
export type ProjectEngineTargetPolicyMode = z.infer<typeof ProjectEngineTargetPolicyModeSchema>;
export type AccessAuthorityMode = z.infer<typeof AccessAuthorityModeSchema>;
export type EngineRuntimeAuthorizationMode = z.infer<typeof EngineRuntimeAuthorizationModeSchema>;
