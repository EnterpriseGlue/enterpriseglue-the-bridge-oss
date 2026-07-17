import { z } from 'zod';

// Raw schema - matches TypeORM GitRepository entity
export const RepositorySchemaRaw = z.object({
  id: z.string(),
  projectId: z.string(),
  providerId: z.string(),
  connectedByUserId: z.string().nullable(),
  remoteUrl: z.string(),
  namespace: z.string().nullable(),
  repositoryName: z.string(),
  defaultBranch: z.string(),
  lastCommitSha: z.string().nullable(),
  lastSyncAt: z.number().nullable(),
  clonePath: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Select schema (database -> API response)
export const RepositorySelectSchema = RepositorySchemaRaw.transform((r) => ({
  id: r.id,
  projectId: r.projectId,
  providerId: r.providerId,
  connectedByUserId: r.connectedByUserId ?? undefined,
  remoteUrl: r.remoteUrl,
  namespace: r.namespace ?? undefined,
  repositoryName: r.repositoryName,
  defaultBranch: r.defaultBranch,
  lastCommitSha: r.lastCommitSha ?? undefined,
  lastSyncAt: r.lastSyncAt ? Number(r.lastSyncAt) : undefined,
  clonePath: r.clonePath,
  createdAt: Number(r.createdAt),
  updatedAt: Number(r.updatedAt),
}));

// Insert schema (API request -> database)
export const RepositoryInsertSchema = z.object({
  id: z.string().uuid().optional(),
  remoteUrl: z.string().url(),
  repositoryName: z.string().min(1).max(255),
  defaultBranch: z.string().default('main'),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

// API-specific schemas
export const InitRepositoryRequestSchema = z.object({
  projectId: z.string().uuid(),
  providerId: z.string().uuid(),
  remoteUrl: z.string().url(),
  namespace: z.string().optional(),
});

export const CloneRepositoryRequestSchema = z.object({
  projectId: z.string().uuid(),
  providerId: z.string().uuid(),
  remoteUrl: z.string().url(),
  namespace: z.string().optional(),
  // Retained for the existing clone UI. Repository connection currently
  // delegates conflict resolution to the subsequent sync flow.
  conflictStrategy: z.enum(['preferRemote', 'preferLocal']).optional(),
});

export const CloneFromGitRequestSchema = z.object({
  providerId: z.string(),
  repoUrl: z.string(),
  branch: z.string().optional(),
  projectName: z.string().optional(),
  conflictStrategy: z.enum(['preferRemote', 'preferLocal']).optional(),
});

export const CloneFromGitResponseSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  filesImported: z.number().int().nonnegative(),
  foldersCreated: z.number().int().nonnegative(),
  repositoryId: z.string(),
}).strict();

export const GitCredentialSchema = z.object({
  id: z.string(), userId: z.string(), providerId: z.string(),
  providerName: z.string(), providerType: z.string(),
  name: z.string().optional(), authType: z.enum(['pat', 'oauth']),
  providerUsername: z.string().optional(), expiresAt: z.number().optional(),
  scopes: z.string().optional(), createdAt: z.number(), updatedAt: z.number(),
}).strict();
export const SaveGitCredentialRequestSchema = z.object({ providerId: z.string().min(1), token: z.string().min(1), name: z.string().optional() });
export const RenameGitCredentialRequestSchema = z.object({ name: z.string().min(1) });
export const GitCredentialNamespaceSchema = z.object({ name: z.string(), type: z.enum(['user', 'organization']), avatarUrl: z.string().optional() }).passthrough();
export const GitProviderRepositorySchema = z.object({ name: z.string(), fullName: z.string(), url: z.string(), isPrivate: z.boolean() }).strict();

export const RepositoryResponseSchema = RepositorySelectSchema;

// Types
export type Repository = z.infer<typeof RepositorySelectSchema>;
export type RepositoryInsert = z.infer<typeof RepositoryInsertSchema>;
export type InitRepositoryRequest = z.infer<typeof InitRepositoryRequestSchema>;
export type CloneRepositoryRequest = z.infer<typeof CloneRepositoryRequestSchema>;
export type CloneFromGitRequest = z.infer<typeof CloneFromGitRequestSchema>;
export type CloneFromGitResponse = z.infer<typeof CloneFromGitResponseSchema>;
export type GitCredential = z.infer<typeof GitCredentialSchema>;
export type SaveGitCredentialRequest = z.infer<typeof SaveGitCredentialRequestSchema>;
export type RenameGitCredentialRequest = z.infer<typeof RenameGitCredentialRequestSchema>;
export type GitCredentialNamespace = z.infer<typeof GitCredentialNamespaceSchema>;
export type GitProviderRepository = z.infer<typeof GitProviderRepositorySchema>;
