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

export const RepositoryInfoRequestSchema = z.object({
  providerId: z.string(),
  repoUrl: z.string(),
});

export const RepositoryInfoResponseSchema = z.object({
  name: z.string(),
  fullName: z.string(),
  defaultBranch: z.string(),
  branches: z.array(z.object({
    name: z.string(),
    isDefault: z.boolean(),
  })),
}).strict();

export const GitSyncStatusQuerySchema = z.object({
  projectId: z.string().uuid(),
});

export const GitSyncStatusResponseSchema = z.object({
  hasLocalChanges: z.boolean(),
  hasRemoteChanges: z.boolean(),
  lastSyncAt: z.number().nullable(),
  localCommitCount: z.number().int().nonnegative(),
  remoteCommitCount: z.number().int().nonnegative(),
}).strict();

export const GitSyncRequestSchema = z.object({
  projectId: z.string().uuid(),
  direction: z.enum(['push', 'pull', 'both']).default('push'),
  message: z.string().min(1).max(500),
});

export const GitSyncResponseSchema = z.object({
  success: z.literal(true),
  pushed: z.boolean(),
  pulled: z.boolean(),
  filesChanged: z.number().int().nonnegative(),
  commitSha: z.string().optional(),
  error: z.string().optional(),
  isFirstSync: z.boolean().optional(),
}).strict();

// Project service tokens are accepted only by write requests. Connection
// status is intentionally redacted to `hasToken` and never exposes a secret.
export const ProjectGitConnectionQuerySchema = z.object({
  projectId: z.string().uuid(),
});

export const ProjectGitConnectionRequestSchema = z.object({
  projectId: z.string().uuid(),
  providerId: z.string().min(1),
  repositoryName: z.string().min(1),
  namespace: z.string().optional(),
  defaultBranch: z.string().default('main'),
  token: z.string().min(1),
});

export const UpdateProjectGitConnectionTokenRequestSchema = z.object({
  projectId: z.string().uuid(),
  token: z.string().min(1),
});

export const DisconnectProjectGitConnectionRequestSchema = z.object({
  projectId: z.string().uuid(),
});

export const ProjectGitConnectionSchema = z.union([
  z.object({ connected: z.literal(false) }).strict(),
  z.object({
    connected: z.literal(true),
    providerId: z.string(),
    repositoryName: z.string(),
    namespace: z.string().nullable(),
    defaultBranch: z.string(),
    remoteUrl: z.string(),
    hasToken: z.boolean(),
    lastValidatedAt: z.number().nullable(),
    tokenScopeHint: z.string().nullable(),
    connectedByUserId: z.string().nullable(),
    lastSyncAt: z.number().nullable(),
  }).strict(),
]);

export const ProjectGitConnectionReceiptSchema = z.object({
  success: z.literal(true),
  repoFullName: z.string(),
}).strict();

export const ProjectGitConnectionOperationReceiptSchema = z.object({
  success: z.literal(true),
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
export const GitProviderSummarySchema = z.object({
  id: z.string(), name: z.string(), type: z.string(), baseUrl: z.string(), apiUrl: z.string(),
  supportsOAuth: z.boolean(), supportsPAT: z.boolean(),
}).strict();
export const GitProviderDetailSchema = GitProviderSummarySchema.extend({
  effectiveBaseUrl: z.string(), effectiveApiUrl: z.string(), isActive: z.boolean(),
}).strict();

export const RepositoryResponseSchema = RepositorySelectSchema;

// Types
export type Repository = z.infer<typeof RepositorySelectSchema>;
export type RepositoryInsert = z.infer<typeof RepositoryInsertSchema>;
export type InitRepositoryRequest = z.infer<typeof InitRepositoryRequestSchema>;
export type CloneRepositoryRequest = z.infer<typeof CloneRepositoryRequestSchema>;
export type CloneFromGitRequest = z.infer<typeof CloneFromGitRequestSchema>;
export type CloneFromGitResponse = z.infer<typeof CloneFromGitResponseSchema>;
export type RepositoryInfoRequest = z.infer<typeof RepositoryInfoRequestSchema>;
export type RepositoryInfoResponse = z.infer<typeof RepositoryInfoResponseSchema>;
export type GitSyncStatusQuery = z.input<typeof GitSyncStatusQuerySchema>;
export type GitSyncStatusResponse = z.infer<typeof GitSyncStatusResponseSchema>;
export type GitSyncRequest = z.infer<typeof GitSyncRequestSchema>;
export type GitSyncResponse = z.infer<typeof GitSyncResponseSchema>;
export type ProjectGitConnectionQuery = z.input<typeof ProjectGitConnectionQuerySchema>;
export type ProjectGitConnectionRequest = z.input<typeof ProjectGitConnectionRequestSchema>;
export type UpdateProjectGitConnectionTokenRequest = z.input<typeof UpdateProjectGitConnectionTokenRequestSchema>;
export type DisconnectProjectGitConnectionRequest = z.input<typeof DisconnectProjectGitConnectionRequestSchema>;
export type ProjectGitConnection = z.infer<typeof ProjectGitConnectionSchema>;
export type ProjectGitConnectionReceipt = z.infer<typeof ProjectGitConnectionReceiptSchema>;
export type ProjectGitConnectionOperationReceipt = z.infer<typeof ProjectGitConnectionOperationReceiptSchema>;
export type GitCredential = z.infer<typeof GitCredentialSchema>;
export type SaveGitCredentialRequest = z.infer<typeof SaveGitCredentialRequestSchema>;
export type RenameGitCredentialRequest = z.infer<typeof RenameGitCredentialRequestSchema>;
export type GitCredentialNamespace = z.infer<typeof GitCredentialNamespaceSchema>;
export type GitProviderRepository = z.infer<typeof GitProviderRepositorySchema>;
export type GitProviderSummary = z.infer<typeof GitProviderSummarySchema>;
export type GitProviderDetail = z.infer<typeof GitProviderDetailSchema>;
