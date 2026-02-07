import { z } from 'zod';

// Select schema (read responses)
export const PlatformSettingsSchema = z.object({
  defaultEnvironmentTagId: z.string().nullable(),
  syncPushEnabled: z.boolean(),
  syncPullEnabled: z.boolean(),
  gitProjectTokenSharingEnabled: z.boolean(),
  defaultDeployRoles: z.array(z.string()),
  inviteAllowAllDomains: z.boolean(),
  inviteAllowedDomains: z.array(z.string()),
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
});

// Types
export type PlatformSettings = z.infer<typeof PlatformSettingsSchema>;
export type UpdatePlatformSettings = z.infer<typeof UpdatePlatformSettingsRequest>;
