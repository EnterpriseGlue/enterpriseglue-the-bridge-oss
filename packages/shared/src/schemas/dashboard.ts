import { z } from 'zod';

export const DashboardStatsSchema = z.object({
  totalProjects: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
  fileTypes: z.object({
    bpmn: z.number().int().nonnegative(),
    dmn: z.number().int().nonnegative(),
    form: z.number().int().nonnegative(),
  }),
});

export const DashboardContextSchema = z.object({
  isPlatformAdmin: z.boolean(),
  // Retained display metadata. Authorization continues to use the evaluator
  // snapshot rather than these response fields.
  ownedEngineIds: z.array(z.string()),
  delegatedEngineIds: z.array(z.string()),
  accessibleEngineIds: z.array(z.string()),
  runtimeScopedEngineIds: z.array(z.string()),
  projectMemberships: z.array(z.object({
    projectId: z.string(),
    projectName: z.string(),
    role: z.string(),
  })),
  canViewActiveUsers: z.boolean(),
  canViewAllProjects: z.boolean(),
  canViewEngines: z.boolean(),
  canViewProcessData: z.boolean(),
  canViewDeployments: z.boolean(),
  canViewMetrics: z.boolean(),
});

export type DashboardStats = z.infer<typeof DashboardStatsSchema>;
export type DashboardContext = z.infer<typeof DashboardContextSchema>;
