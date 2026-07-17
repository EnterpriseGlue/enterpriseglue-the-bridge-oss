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
