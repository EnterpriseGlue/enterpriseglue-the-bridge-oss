import { z } from 'zod';

export const CommitFileSnapshotSchema = z.object({
  id: z.string().min(1),
  mainFileId: z.string().min(1).nullable(),
  folderId: z.string().nullable(),
  name: z.string(),
  type: z.string().min(1),
  content: z.string().nullable(),
  changeType: z.string().min(1),
}).strict();

export const CommitFileSnapshotsResponseSchema = z.object({
  files: z.array(CommitFileSnapshotSchema),
}).strict();

export type CommitFileSnapshot = z.infer<typeof CommitFileSnapshotSchema>;

export const CommitFileRestoreParamsSchema = z.object({
  projectId: z.string().uuid(),
  commitId: z.string().min(1).max(200),
  fileId: z.string().uuid(),
}).strict();

export const CommitFileRestoreBodySchema = z.object({}).strict().default({});
