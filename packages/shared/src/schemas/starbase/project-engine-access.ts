import { z } from 'zod';

/** One evaluated deployment-eligibility check, optionally redacted for non-diagnostic readers. */
export const ProjectEngineDeploymentEligibilityCheckSchema = z.object({
  id: z.string(),
  allowed: z.boolean(),
  reason: z.string(),
  remediation: z.string().optional(),
});

/** The manual or CI decision returned for a project-visible engine. */
export const ProjectEngineDeploymentEligibilityModeSchema = z.object({
  allowed: z.boolean(),
  reasons: z.array(z.string()),
  checks: z.array(ProjectEngineDeploymentEligibilityCheckSchema).optional(),
});

/** Sanitized deployment-target metadata attached to a visible project engine. */
export const ProjectEngineDeploymentTargetViewSchema = z.object({
  id: z.string(),
  status: z.string(),
  source: z.string(),
  sourceRef: z.string().nullable(),
  allowManualDeploy: z.boolean(),
  allowCiDeploy: z.boolean(),
  allowApiDeploy: z.boolean(),
  allowImport: z.boolean(),
  lastSeenAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** A project-visible engine plus evaluated deployment choices. */
export const ProjectEngineAccessedEngineSchema = z.object({
  engineId: z.string(),
  engineName: z.string(),
  baseUrl: z.string(),
  deploymentIntegration: z.enum(['enterpriseglue_proxy', 'direct_engine']).optional(),
  environment: z.object({
    name: z.string(),
    color: z.string().nullable(),
  }).nullable(),
  deploymentTarget: ProjectEngineDeploymentTargetViewSchema.optional(),
  manualDeployAllowed: z.boolean().optional(),
  manualDeployDeniedReasons: z.array(z.string()).optional(),
  ciDeployAllowed: z.boolean().optional(),
  ciDeployDeniedReasons: z.array(z.string()).optional(),
  deploymentEligibility: z.object({
    diagnosticsVisible: z.boolean().optional(),
    manual: ProjectEngineDeploymentEligibilityModeSchema,
    ci: ProjectEngineDeploymentEligibilityModeSchema.optional(),
  }).optional(),
  health: z.object({
    status: z.string(),
    latencyMs: z.number().nullable(),
  }).nullable(),
  grantedAt: z.number(),
  isLegacy: z.boolean().optional(),
});

export const ProjectEngineAccessPendingRequestSchema = z.object({
  requestId: z.string(),
  engineId: z.string(),
  engineName: z.string(),
  requestedAt: z.number(),
});

export const ProjectEngineAccessAvailableEngineSchema = z.object({
  id: z.string(),
  name: z.string(),
});

/**
 * Authorization-filtered project engine access response. It exposes only
 * visible engines and evaluator-derived deploy eligibility; it never carries
 * credentials, raw engine responses, or legacy membership as a grant source.
 */
export const ProjectEngineAccessResponseSchema = z.object({
  accessedEngines: z.array(ProjectEngineAccessedEngineSchema),
  pendingRequests: z.array(ProjectEngineAccessPendingRequestSchema),
  availableEngines: z.array(ProjectEngineAccessAvailableEngineSchema),
});

export type ProjectEngineDeploymentEligibilityCheck = z.infer<typeof ProjectEngineDeploymentEligibilityCheckSchema>;
export type ProjectEngineDeploymentEligibilityMode = z.infer<typeof ProjectEngineDeploymentEligibilityModeSchema>;
export type ProjectEngineDeploymentTargetView = z.infer<typeof ProjectEngineDeploymentTargetViewSchema>;
export type ProjectEngineAccessedEngine = z.infer<typeof ProjectEngineAccessedEngineSchema>;
export type ProjectEngineAccessPendingRequest = z.infer<typeof ProjectEngineAccessPendingRequestSchema>;
export type ProjectEngineAccessAvailableEngine = z.infer<typeof ProjectEngineAccessAvailableEngineSchema>;
export type ProjectEngineAccessResponse = z.infer<typeof ProjectEngineAccessResponseSchema>;
