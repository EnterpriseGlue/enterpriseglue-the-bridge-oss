import { z } from 'zod';

const PiiProviderTypeSchema = z.enum(['presidio', 'gcp_dlp', 'aws_comprehend', 'azure_pii']);
const PiiScopeSchema = z.enum(['processDetails', 'history', 'logs', 'errors', 'audit']);
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
export type UpdatePlatformSettings = z.infer<typeof UpdatePlatformSettingsRequest>;
export type EngineOnboardingMode = z.infer<typeof EngineOnboardingModeSchema>;
export type ProjectEngineTargetPolicyMode = z.infer<typeof ProjectEngineTargetPolicyModeSchema>;
export type AccessAuthorityMode = z.infer<typeof AccessAuthorityModeSchema>;
export type EngineRuntimeAuthorizationMode = z.infer<typeof EngineRuntimeAuthorizationModeSchema>;
