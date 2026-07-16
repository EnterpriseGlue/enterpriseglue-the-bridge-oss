import { z } from 'zod';
import { EngineDeploymentSchemaRaw } from './engine-deployment.js';

/** Project deployment metadata with the persisted raw engine response removed. */
export const ProjectEngineDeploymentViewSchema = EngineDeploymentSchemaRaw.partial().transform(({ rawResponse: _rawResponse, ...deployment }) => deployment);

/** A deployed engine artifact correlated to one Starbase file. */
export const DeploymentArtifactSummarySchema = z.object({
  kind: z.string(),
  key: z.string(),
  version: z.number(),
  id: z.string(),
});

/** Common visible engine/file deployment lineage. */
export const DeploymentArtifactProjectFileBaseSchema = z.object({
  engineId: z.string(),
  engineDeploymentId: z.string(),
  fileId: z.string(),
  fileType: z.string().nullable(),
  fileName: z.string().nullable(),
  fileGitCommitId: z.string().nullable(),
  artifacts: z.array(DeploymentArtifactSummarySchema),
  deployedAt: z.number().nullable(),
  engineName: z.string().nullable(),
  environmentTag: z.string().nullable(),
});

/** Deployment history returned for one Starbase file, filtered to visible engines. */
export const FileDeploymentSummarySchema = DeploymentArtifactProjectFileBaseSchema.extend({
  fileVersionNumber: z.number().nullable(),
});

/** Latest deployment artifact per visible engine/file pair for a Starbase project. */
export const LatestProjectDeploymentArtifactSchema = DeploymentArtifactProjectFileBaseSchema.extend({
  fileUpdatedAt: z.number().nullable(),
  fileContentHash: z.string().nullable(),
  fileGitCommitMessage: z.string().nullable(),
  resourceName: z.string(),
  artifactVersions: z.record(z.string(), z.number()),
  gitDeploymentId: z.string().nullable(),
  gitCommitSha: z.string().nullable(),
  gitCommitMessage: z.string().nullable(),
  camundaDeploymentId: z.string().nullable(),
  camundaDeploymentName: z.string().nullable(),
  camundaDeploymentTime: z.string().nullable(),
});

export type DeploymentArtifactSummary = z.infer<typeof DeploymentArtifactSummarySchema>;
export type ProjectEngineDeploymentView = z.infer<typeof ProjectEngineDeploymentViewSchema>;
export type DeploymentArtifactProjectFileBase = z.infer<typeof DeploymentArtifactProjectFileBaseSchema>;
export type FileDeploymentSummary = z.infer<typeof FileDeploymentSummarySchema>;
export type LatestProjectDeploymentArtifact = z.infer<typeof LatestProjectDeploymentArtifactSchema>;
