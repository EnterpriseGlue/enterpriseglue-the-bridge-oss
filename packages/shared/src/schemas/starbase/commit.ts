import { z } from 'zod';

// Keep the route, browser contract tests and OpenAPI independent of server boot.
export const commitBodySchema = z.object({
  message: z.string().min(1).max(500),
  fileIds: z.array(z.string().uuid()).min(1)
    .refine(ids => new Set(ids).size === ids.length, 'File IDs must be distinct').optional(),
  hotfixFromCommitId: z.string().optional(),
  hotfixFromFileVersion: z.number().int().positive().optional(),
});
