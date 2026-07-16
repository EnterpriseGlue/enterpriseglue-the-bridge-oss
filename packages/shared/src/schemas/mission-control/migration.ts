import { z } from 'zod';

// Migration plans retain engine-compatible shapes. These aggregate responses,
// however, are owned by EnterpriseGlue and have stable public contracts.
export const MigrationPreviewResponseSchema = z.object({
  count: z.number().int().nonnegative(),
}).strict();

export const MigrationActiveSourcesResponseSchema = z.record(
  z.string(),
  z.number().int().nonnegative(),
);

export type MigrationPreviewResponse = z.infer<typeof MigrationPreviewResponseSchema>;
export type MigrationActiveSourcesResponse = z.infer<typeof MigrationActiveSourcesResponseSchema>;
