import { z } from 'zod';

// Raw schema - matches TypeORM EngineDeployment entity
export const EngineDeploymentSchemaRaw = z.object({
  id: z.string(),
  projectId: z.string(),
  engineId: z.string(),
  engineName: z.string().nullable(),
  environmentTag: z.string().nullable(),
  engineBaseUrl: z.string().nullable(),
  gitDeploymentId: z.string().nullable(),
  gitCommitSha: z.string().nullable(),
  gitCommitMessage: z.string().nullable(),
  camundaDeploymentId: z.string().nullable(),
  camundaDeploymentName: z.string().nullable(),
  camundaDeploymentTime: z.string().nullable(),
  deployedBy: z.string(),
  deployedAt: z.number(),
  enableDuplicateFiltering: z.boolean().nullable(),
  deployChangedOnly: z.boolean().nullable(),
  resourceCount: z.number().nullable(),
  status: z.string().nullable(),
  errorMessage: z.string().nullable(),
  rawResponse: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Engine Deployment - Select schema (API response)
export const EngineDeploymentSchema = EngineDeploymentSchemaRaw.transform((d) => ({
  id: d.id,
  projectId: d.projectId,
  engineId: d.engineId,
  engineName: d.engineName ?? undefined,
  environmentTag: d.environmentTag ?? undefined,
  engineBaseUrl: d.engineBaseUrl ?? undefined,
  gitDeploymentId: d.gitDeploymentId ?? undefined,
  gitCommitSha: d.gitCommitSha ?? undefined,
  gitCommitMessage: d.gitCommitMessage ?? undefined,
  camundaDeploymentId: d.camundaDeploymentId ?? undefined,
  camundaDeploymentName: d.camundaDeploymentName ?? undefined,
  camundaDeploymentTime: d.camundaDeploymentTime ?? undefined,
  deployedBy: d.deployedBy,
  deployedAt: Number(d.deployedAt),
  enableDuplicateFiltering: d.enableDuplicateFiltering,
  deployChangedOnly: d.deployChangedOnly,
  resourceCount: d.resourceCount,
  status: d.status,
  errorMessage: d.errorMessage ?? undefined,
  createdAt: Number(d.createdAt),
  updatedAt: Number(d.updatedAt),
}));

// Engine Deployment - Insert schema
export const EngineDeploymentInsertSchema = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid(),
  engineId: z.string().uuid(),
  deployedBy: z.string().uuid(),
  deployedAt: z.number().optional(),
  status: z.enum(['success', 'failed', 'pending']).optional(),
});

// Raw schema - matches TypeORM EngineDeploymentArtifact entity
export const EngineDeploymentArtifactSchemaRaw = z.object({
  id: z.string(),
  engineDeploymentId: z.string(),
  projectId: z.string(),
  engineId: z.string(),
  fileId: z.string().nullable(),
  fileType: z.string().nullable(),
  fileName: z.string().nullable(),
  fileUpdatedAt: z.number().nullable(),
  fileContentHash: z.string().nullable(),
  fileGitCommitId: z.string().nullable(),
  fileGitCommitMessage: z.string().nullable(),
  resourceName: z.string(),
  artifactKind: z.string(),
  artifactId: z.string(),
  artifactKey: z.string(),
  artifactVersion: z.number(),
  tenantId: z.string().nullable(),
  createdAt: z.number(),
});

// Engine Deployment Artifact - Select schema (API response)
export const EngineDeploymentArtifactSchema = EngineDeploymentArtifactSchemaRaw.transform((a) => ({
  id: a.id,
  engineDeploymentId: a.engineDeploymentId,
  projectId: a.projectId,
  engineId: a.engineId,
  fileId: a.fileId ?? undefined,
  fileType: a.fileType ?? undefined,
  fileName: a.fileName ?? undefined,
  fileUpdatedAt: a.fileUpdatedAt ? Number(a.fileUpdatedAt) : undefined,
  fileContentHash: a.fileContentHash ?? undefined,
  fileGitCommitId: a.fileGitCommitId ?? undefined,
  fileGitCommitMessage: a.fileGitCommitMessage ?? undefined,
  resourceName: a.resourceName,
  artifactKind: a.artifactKind,
  artifactId: a.artifactId,
  artifactKey: a.artifactKey,
  artifactVersion: a.artifactVersion,
  tenantId: a.tenantId ?? undefined,
  createdAt: Number(a.createdAt),
}));

// Engine Deployment Artifact - Insert schema
export const EngineDeploymentArtifactInsertSchema = z.object({
  id: z.string().uuid().optional(),
  engineDeploymentId: z.string().uuid(),
  projectId: z.string().uuid(),
  engineId: z.string().uuid(),
  artifactKind: z.enum(['process', 'decision', 'drd']),
});

// Types
export type EngineDeployment = z.infer<typeof EngineDeploymentSchema>;
export type EngineDeploymentArtifact = z.infer<typeof EngineDeploymentArtifactSchema>;
