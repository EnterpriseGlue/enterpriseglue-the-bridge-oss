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
});

export const RepositoryResponseSchema = RepositorySelectSchema;

// Types
export type Repository = z.infer<typeof RepositorySelectSchema>;
export type RepositoryInsert = z.infer<typeof RepositoryInsertSchema>;
export type InitRepositoryRequest = z.infer<typeof InitRepositoryRequestSchema>;
export type CloneRepositoryRequest = z.infer<typeof CloneRepositoryRequestSchema>;
