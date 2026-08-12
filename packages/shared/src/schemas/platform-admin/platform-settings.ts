import { z } from 'zod';

const PiiProviderTypeSchema = z.enum(['presidio', 'gcp_dlp', 'aws_comprehend', 'azure_pii']);
const PiiScopeSchema = z.enum(['processDetails', 'history', 'logs', 'errors', 'audit']);
const BrandingHexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const EngineOnboardingModeSchema = z.enum(['manual_allowed', 'external_only', 'hybrid'])
  .describe('Controls manual engine inventory lifecycle operations. Configuration bundles and the external registration API retain their own source-owned paths.');
export const ProjectEngineTargetPolicyModeSchema = z.enum(['manual_allowed', 'external_only', 'hybrid'])
  .describe('Controls manual project-to-engine deployment-target changes independently from project creation and engine access.');
export const AccessAuthorityModeSchema = z.enum(['manual', 'transition_to_sso', 'sso_managed'])
  .describe('Controls manual membership and scoped role-assignment mutations. SSO-managed mode preserves existing rows as effective, view-only access.');
export const AccessGovernanceOwnershipModeSchema = z.enum(['manual', 'config_locked', 'config_warn'])
  .describe('Declares whether the five governance settings are portal-owned, configuration-locked, or editable with drift tracking.');
export const AccessGovernanceDriftStatusSchema = z.enum(['in_sync', 'drifted']);
export const PlatformSettingsSectionSchema = z.enum([
  'governance', 'login', 'general', 'git_sync', 'deployment', 'invitations', 'pii', 'branding',
]);
export const PlatformSettingsSectionOwnershipSchema = z.object({
  section: PlatformSettingsSectionSchema,
  scopeKey: z.string(),
  sourceRef: z.string().nullable(),
  ownershipMode: AccessGovernanceOwnershipModeSchema,
  sourceHash: z.string().nullable(),
  lastAppliedAt: z.number().nullable(),
  driftStatus: AccessGovernanceDriftStatusSchema.nullable(),
  generation: z.number().int().nonnegative(),
}).strict();
export const LocalPasswordLoginModeSchema = z.enum(['auto', 'enabled', 'disabled'])
  .describe('Controls ordinary local password login. auto preserves safe SSO enforcement by disabling ordinary local login whenever a direct identity provider is enabled.');
export const SsoProviderSelectionModeSchema = z.enum(['auto_redirect_single', 'chooser', 'progressive'])
  .describe('Controls how the public login page selects among enabled direct identity providers.');
export const UnsupportedEngineRuntimeAuthorizationModeMessage = 'Unsupported runtime authorization mode';
export const EngineRuntimeAuthorizationModeSchema = z.enum(['enterpriseglue_authoritative', 'mirrored_engine_backstop'], {
  error: UnsupportedEngineRuntimeAuthorizationModeMessage,
}).describe('Controls runtime authorization authority independently from authentication, engine onboarding, and membership management.');
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
  ownership: PlatformSettingsSectionOwnershipSchema.nullable().optional(),
});

/** Non-secret branding available before a normal user session exists. */
export const PublicPlatformBrandingSchema = PlatformBrandingSchema.omit({ ownership: true });

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

/**
 * Derived, read-only behavior for API clients and frontend surfaces. Consumers
 * should use this object instead of reimplementing mode comparisons.
 */
export const PlatformGovernanceBehaviorSchema = z.object({
  manualEngineAccessMutationsAllowed: z.boolean(),
  manualProjectAccessMutationsAllowed: z.boolean(),
  manualEngineRegistrationAllowed: z.boolean(),
  manualProjectEngineTargetMutationsAllowed: z.boolean(),
  governanceSettingsMutations: z.enum(['allowed', 'allowed_marks_drift', 'blocked']),
}).strict();

type PlatformGovernanceBehaviorInput = {
  engineAccessAuthority: z.infer<typeof AccessAuthorityModeSchema>;
  projectAccessAuthority: z.infer<typeof AccessAuthorityModeSchema>;
  engineOnboardingMode: z.infer<typeof EngineOnboardingModeSchema>;
  projectEngineTargetMode: z.infer<typeof ProjectEngineTargetPolicyModeSchema>;
  accessGovernanceOwnershipMode: z.infer<typeof AccessGovernanceOwnershipModeSchema>;
};

export function derivePlatformGovernanceBehavior(
  input: PlatformGovernanceBehaviorInput,
): z.infer<typeof PlatformGovernanceBehaviorSchema> {
  return {
    manualEngineAccessMutationsAllowed: input.engineAccessAuthority !== 'sso_managed',
    manualProjectAccessMutationsAllowed: input.projectAccessAuthority !== 'sso_managed',
    manualEngineRegistrationAllowed: input.engineOnboardingMode !== 'external_only',
    manualProjectEngineTargetMutationsAllowed: input.projectEngineTargetMode !== 'external_only',
    governanceSettingsMutations: input.accessGovernanceOwnershipMode === 'config_locked'
      ? 'blocked'
      : input.accessGovernanceOwnershipMode === 'config_warn'
        ? 'allowed_marks_drift'
        : 'allowed',
  };
}

// Select schema (read responses)
export const PlatformSettingsSchema = z.object({
  defaultEnvironmentTagId: z.string().nullable(),
  syncPushEnabled: z.boolean(),
  syncPullEnabled: z.boolean(),
  syncBothEnabled: z.boolean(),
  gitProjectTokenSharingEnabled: z.boolean(),
  defaultDeployRoles: z.array(z.string()),
  engineOnboardingMode: EngineOnboardingModeSchema,
  projectEngineTargetMode: ProjectEngineTargetPolicyModeSchema,
  engineAccessAuthority: AccessAuthorityModeSchema,
  projectAccessAuthority: AccessAuthorityModeSchema,
  engineRuntimeAuthorizationMode: EngineRuntimeAuthorizationModeSchema,
  accessGovernanceSourceRef: z.string().nullable(),
  accessGovernanceOwnershipMode: AccessGovernanceOwnershipModeSchema,
  accessGovernanceSourceHash: z.string().nullable(),
  accessGovernanceLastAppliedAt: z.number().nullable(),
  accessGovernanceDriftStatus: AccessGovernanceDriftStatusSchema.nullable(),
  governanceBehavior: PlatformGovernanceBehaviorSchema,
  credentiallessCustomerSidecarsEnabled: z.boolean(),
  inviteAllowAllDomains: z.boolean(),
  inviteAllowedDomains: z.array(z.string()),
  localPasswordLoginMode: LocalPasswordLoginModeSchema,
  ssoProviderSelectionMode: SsoProviderSelectionModeSchema,
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
  emailPlatformName: z.string(),
  sectionOwnership: z.array(PlatformSettingsSectionOwnershipSchema),
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
  governanceBehavior: true,
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
  syncBothEnabled: z.boolean().optional(),
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
  localPasswordLoginMode: LocalPasswordLoginModeSchema.optional(),
  ssoProviderSelectionMode: SsoProviderSelectionModeSchema.optional(),
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
  piiExternalProviderEndpoint: z.string().url().max(2048).optional().nullable(),
  piiExternalProviderAuthHeader: z.string().optional().nullable(),
  piiExternalProviderAuthToken: z.string().optional().nullable(),
  piiExternalProviderProjectId: z.string().optional().nullable(),
  piiExternalProviderRegion: z.string().optional().nullable(),
  piiRedactionStyle: z.string().optional(),
  piiScopes: z.array(PiiScopeSchema).optional(),
  piiMaxPayloadSizeBytes: z.number().optional(),
  emailPlatformName: z.string().trim().min(1).max(160).optional(),
}).strict();

// Types
export type PlatformSettings = z.infer<typeof PlatformSettingsSchema>;
export type PublicPlatformSettings = z.infer<typeof PublicPlatformSettingsSchema>;
export type UpdatePlatformSettings = z.infer<typeof UpdatePlatformSettingsRequest>;
export type PlatformBranding = z.infer<typeof PlatformBrandingSchema>;
export type PublicPlatformBranding = z.infer<typeof PublicPlatformBrandingSchema>;
export type UpdatePlatformBrandingRequest = z.infer<typeof UpdatePlatformBrandingRequestSchema>;
export type EngineOnboardingMode = z.infer<typeof EngineOnboardingModeSchema>;
export type LocalPasswordLoginMode = z.infer<typeof LocalPasswordLoginModeSchema>;
export type SsoProviderSelectionMode = z.infer<typeof SsoProviderSelectionModeSchema>;
export type ProjectEngineTargetPolicyMode = z.infer<typeof ProjectEngineTargetPolicyModeSchema>;
export type AccessAuthorityMode = z.infer<typeof AccessAuthorityModeSchema>;
export type AccessGovernanceOwnershipMode = z.infer<typeof AccessGovernanceOwnershipModeSchema>;
export type AccessGovernanceDriftStatus = z.infer<typeof AccessGovernanceDriftStatusSchema>;
export type PlatformGovernanceBehavior = z.infer<typeof PlatformGovernanceBehaviorSchema>;
export type EngineRuntimeAuthorizationMode = z.infer<typeof EngineRuntimeAuthorizationModeSchema>;
export type PlatformSettingsSectionOwnership = z.infer<typeof PlatformSettingsSectionOwnershipSchema>;
