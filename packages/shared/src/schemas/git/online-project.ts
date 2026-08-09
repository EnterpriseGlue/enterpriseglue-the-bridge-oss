import { z } from 'zod';

// The access token is accepted only to support the existing personal-access-
// token flow. It is deliberately request-only and is never included in a
// response schema.
export const CreateOnlineProjectRequestSchema = z.object({
  projectName: z.unknown(),
  providerId: z.unknown(),
  repositoryName: z.unknown(),
  namespace: z.unknown().optional(),
  isPrivate: z.boolean().optional(),
  description: z.string().optional(),
  token: z.string().optional(),
  importFromEngine: z.object({
    enabled: z.boolean().optional(),
    engineId: z.string().optional(),
  }).optional(),
});

// This preserves the existing credential fallback behavior: callers may send
// a token, or omit it and use their stored provider credential.
export const CheckRepositoryExistsRequestSchema = z.object({
  providerId: z.unknown(),
  repositoryName: z.unknown(),
  namespace: z.unknown().optional(),
  token: z.unknown().optional(),
});

const ExistingRepositorySummarySchema = z.object({
  name: z.string(),
  fullName: z.string(),
  url: z.string(),
});

export const CheckRepositoryExistsResponseSchema = z.object({
  exists: z.boolean(),
  repository: ExistingRepositorySummarySchema.nullable(),
});

const OnlineProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
});

const OnlineRepositorySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  fullName: z.string(),
  url: z.string(),
  cloneUrl: z.string(),
  private: z.boolean(),
});

// This response deliberately contains repository metadata only. The submitted
// access token remains request-only and is never returned by the API contract.
export const CreateOnlineProjectResponseSchema = z.object({
  project: OnlineProjectSummarySchema,
  repository: OnlineRepositorySummarySchema,
});

export type CreateOnlineProjectRequest = z.infer<typeof CreateOnlineProjectRequestSchema>;
export type CreateOnlineProjectResponse = z.infer<typeof CreateOnlineProjectResponseSchema>;
export type CheckRepositoryExistsRequest = z.infer<typeof CheckRepositoryExistsRequestSchema>;
export type CheckRepositoryExistsResponse = z.infer<typeof CheckRepositoryExistsResponseSchema>;
