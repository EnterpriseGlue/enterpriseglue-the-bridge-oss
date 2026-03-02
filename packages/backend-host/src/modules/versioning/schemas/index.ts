import { z } from 'zod';

// Branch - Raw schema - matches TypeORM Branch entity
export const BranchSchemaRaw = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  userId: z.string().nullable(),
  baseCommitId: z.string().nullable(),
  headCommitId: z.string().nullable(),
  isDefault: z.boolean(),
  type: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Branch - Select schema (API response)
export const BranchSchema = BranchSchemaRaw.transform((b) => ({
  id: b.id,
  projectId: b.projectId,
  name: b.name,
  userId: b.userId ?? undefined,
  baseCommitId: b.baseCommitId ?? undefined,
  headCommitId: b.headCommitId ?? undefined,
  isDefault: b.isDefault,
  createdAt: Number(b.createdAt),
  updatedAt: Number(b.updatedAt),
}));

// Branch - Insert schema
export const BranchInsertSchema = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid(),
  name: z.string().min(1),
});

// Commit - Raw schema - matches TypeORM Commit entity
export const CommitSchemaRaw = z.object({
  id: z.string(),
  projectId: z.string(),
  branchId: z.string(),
  parentCommitId: z.string().nullable(),
  userId: z.string(),
  message: z.string().nullable(),
  hash: z.string().nullable(),
  versionNumber: z.number().nullable(),
  isRemote: z.boolean(),
  createdAt: z.number(),
});

// Commit - Select schema (API response)
export const CommitSchema = CommitSchemaRaw.transform((c) => ({
  id: c.id,
  projectId: c.projectId,
  branchId: c.branchId,
  parentCommitId: c.parentCommitId ?? undefined,
  userId: c.userId,
  message: c.message,
  hash: c.hash,
  versionNumber: c.versionNumber ?? undefined,
  isRemote: c.isRemote,
  createdAt: Number(c.createdAt),
}));

// Commit - Insert schema
export const CommitInsertSchema = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid(),
  branchId: z.string().uuid(),
  userId: z.string().uuid(),
  message: z.string().min(1),
  hash: z.string(),
});

// Working File - Raw schema - matches TypeORM WorkingFile entity
export const WorkingFileSchemaRaw = z.object({
  id: z.string(),
  branchId: z.string(),
  projectId: z.string(),
  folderId: z.string().nullable(),
  name: z.string(),
  type: z.string(),
  content: z.string().nullable(),
  contentHash: z.string().nullable(),
  isDeleted: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Working File - Select schema (API response)
export const WorkingFileSchema = WorkingFileSchemaRaw.transform((f) => ({
  id: f.id,
  branchId: f.branchId,
  projectId: f.projectId,
  folderId: f.folderId ?? undefined,
  name: f.name,
  type: f.type as 'bpmn' | 'dmn' | 'form' | 'folder',
  content: f.content ?? undefined,
  contentHash: f.contentHash ?? undefined,
  isDeleted: f.isDeleted,
  createdAt: Number(f.createdAt),
  updatedAt: Number(f.updatedAt),
}));

// Working Folder - Raw schema - matches TypeORM WorkingFolder entity
export const WorkingFolderSchemaRaw = z.object({
  id: z.string(),
  branchId: z.string(),
  projectId: z.string(),
  parentFolderId: z.string().nullable(),
  name: z.string(),
  isDeleted: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Working Folder - Select schema (API response)
export const WorkingFolderSchema = WorkingFolderSchemaRaw.transform((f) => ({
  id: f.id,
  branchId: f.branchId,
  projectId: f.projectId,
  parentFolderId: f.parentFolderId ?? undefined,
  name: f.name,
  isDeleted: f.isDeleted,
  createdAt: Number(f.createdAt),
  updatedAt: Number(f.updatedAt),
}));

// File Snapshot - Raw schema - matches TypeORM FileSnapshot entity
export const FileSnapshotSchemaRaw = z.object({
  id: z.string(),
  commitId: z.string(),
  workingFileId: z.string(),
  folderId: z.string().nullable(),
  name: z.string(),
  type: z.string(),
  content: z.string().nullable(),
  contentHash: z.string().nullable(),
  changeType: z.string(),
});

// File Snapshot - Select schema (API response)
export const FileSnapshotSchema = FileSnapshotSchemaRaw.transform((s) => ({
  id: s.id,
  commitId: s.commitId,
  workingFileId: s.workingFileId,
  folderId: s.folderId ?? undefined,
  name: s.name,
  type: s.type,
  content: s.content ?? undefined,
  contentHash: s.contentHash ?? undefined,
  changeType: s.changeType as 'added' | 'modified' | 'deleted',
}));

// Remote Sync State - Raw schema - matches TypeORM RemoteSyncState entity
export const RemoteSyncStateSchemaRaw = z.object({
  id: z.string(),
  projectId: z.string(),
  branchId: z.string(),
  remoteUrl: z.string(),
  remoteBranch: z.string(),
  lastPushCommitId: z.string().nullable(),
  lastPullCommitId: z.string().nullable(),
  lastPushAt: z.number().nullable(),
  lastPullAt: z.number().nullable(),
  syncStatus: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Remote Sync State - Select schema (API response)
export const RemoteSyncStateSchema = RemoteSyncStateSchemaRaw.transform((s) => ({
  id: s.id,
  projectId: s.projectId,
  branchId: s.branchId,
  remoteUrl: s.remoteUrl,
  remoteBranch: s.remoteBranch,
  lastPushCommitId: s.lastPushCommitId ?? undefined,
  lastPullCommitId: s.lastPullCommitId ?? undefined,
  lastPushAt: s.lastPushAt ? Number(s.lastPushAt) : undefined,
  lastPullAt: s.lastPullAt ? Number(s.lastPullAt) : undefined,
  syncStatus: s.syncStatus as 'synced' | 'ahead' | 'behind' | 'diverged',
  createdAt: Number(s.createdAt),
  updatedAt: Number(s.updatedAt),
}));

// Pending Change - Raw schema - matches TypeORM PendingChange entity
export const PendingChangeSchemaRaw = z.object({
  id: z.string(),
  branchId: z.string(),
  workingFileId: z.string(),
  changeType: z.string(),
  previousContentHash: z.string().nullable(),
  newContentHash: z.string().nullable(),
  createdAt: z.number(),
});

// Pending Change - Select schema (API response)
export const PendingChangeSchema = PendingChangeSchemaRaw.transform((c) => ({
  id: c.id,
  branchId: c.branchId,
  workingFileId: c.workingFileId,
  changeType: c.changeType as 'create' | 'update' | 'delete',
  previousContentHash: c.previousContentHash ?? undefined,
  newContentHash: c.newContentHash ?? undefined,
  createdAt: Number(c.createdAt),
}));

// Types
export type Branch = z.infer<typeof BranchSchema>;
export type Commit = z.infer<typeof CommitSchema>;
export type WorkingFile = z.infer<typeof WorkingFileSchema>;
export type WorkingFolder = z.infer<typeof WorkingFolderSchema>;
export type FileSnapshot = z.infer<typeof FileSnapshotSchema>;
export type RemoteSyncState = z.infer<typeof RemoteSyncStateSchema>;
export type PendingChange = z.infer<typeof PendingChangeSchema>;
