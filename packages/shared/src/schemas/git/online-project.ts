import { z } from 'zod';

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

export type CreateOnlineProjectResponse = z.infer<typeof CreateOnlineProjectResponseSchema>;
