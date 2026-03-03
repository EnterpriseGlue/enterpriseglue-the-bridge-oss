import { z } from 'zod';

// Raw schema - matches TypeORM GitProvider entity
export const GitProviderSchemaRaw = z.object({
  id: z.string(),
  tenantId: z.string().nullable(),
  name: z.string(),
  type: z.string(),
  baseUrl: z.string(),
  apiUrl: z.string(),
  customBaseUrl: z.string().nullable(),
  customApiUrl: z.string().nullable(),
  supportsOAuth: z.boolean(),
  supportsPAT: z.boolean(),
  isActive: z.boolean(),
  displayOrder: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Git Provider - Select schema (API response)
export const GitProviderSchema = GitProviderSchemaRaw.transform((p) => ({
  id: p.id,
  tenantId: p.tenantId ?? undefined,
  name: p.name,
  type: p.type as 'github' | 'gitlab' | 'azure-devops' | 'bitbucket',
  baseUrl: p.baseUrl,
  apiUrl: p.apiUrl,
  customBaseUrl: p.customBaseUrl ?? undefined,
  customApiUrl: p.customApiUrl ?? undefined,
  supportsOAuth: p.supportsOAuth,
  supportsPAT: p.supportsPAT,
  isActive: p.isActive,
  displayOrder: p.displayOrder,
  createdAt: Number(p.createdAt),
  updatedAt: Number(p.updatedAt),
}));

// Git Provider - Insert schema
export const GitProviderInsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  type: z.enum(['github', 'gitlab', 'azure-devops', 'bitbucket']),
  baseUrl: z.string().url(),
  apiUrl: z.string().url(),
});

// Types
export type GitProvider = z.infer<typeof GitProviderSchema>;
