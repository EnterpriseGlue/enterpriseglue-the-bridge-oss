import { z } from 'zod';

const PiiProviderTypeSchema = z.enum(['presidio', 'gcp_dlp', 'aws_comprehend', 'azure_pii']);
const PiiScopeSchema = z.enum(['processDetails', 'history', 'logs', 'errors', 'audit']);

// Select schema (read responses)
export const PlatformSettingsSchema = z.object({
  defaultEnvironmentTagId: z.string().nullable(),
  syncPushEnabled: z.boolean(),
  syncPullEnabled: z.boolean(),
  gitProjectTokenSharingEnabled: z.boolean(),
  defaultDeployRoles: z.array(z.string()),
  inviteAllowAllDomains: z.boolean(),
  inviteAllowedDomains: z.array(z.string()),
  ssoAutoRedirectSingleProvider: z.boolean(),
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
  inviteAllowAllDomains: z.boolean().optional(),
  inviteAllowedDomains: z.array(z.string()).optional(),
  ssoAutoRedirectSingleProvider: z.boolean().optional(),
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
