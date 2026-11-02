import { z } from 'zod'
import { toTimestamp } from '@enterpriseglue/shared/utils/schema-helpers.js'

// Raw schema - matches TypeORM Folder entity
export const FolderSchemaRaw = z.object({
  id: z.string(),
  projectId: z.string(),
  parentFolderId: z.string().nullable(),
  name: z.string(),
  createdBy: z.string().nullable().optional(),
  updatedBy: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

// Select schema (DB -> API) - transformed from Raw
export const FolderSchema = FolderSchemaRaw.transform((f) => ({
  id: f.id,
  projectId: f.projectId,
  parentFolderId: f.parentFolderId ?? null,
  name: f.name,
  createdAt: toTimestamp(f.createdAt),
  updatedAt: toTimestamp(f.updatedAt),
}))

export const FolderSummarySchema = FolderSchemaRaw.pick({ id: true, name: true, parentFolderId: true })

export const CreateFolderRequest = z.object({
  name: z.string().trim().min(1).max(255),
  parentFolderId: z.string().uuid().nullable().optional()
})

export const UpdateFolderRequest = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  parentFolderId: z.string().uuid().nullable().optional()
}).refine(value => value.name !== undefined || value.parentFolderId !== undefined, { message: 'A folder name or destination is required' })

export const CreateFolderResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  parentFolderId: z.string().uuid().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const UpdateFolderResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  parentFolderId: z.string().uuid().nullable(),
  updatedAt: z.number(),
})

export const ProjectContentsFolderSchema = FolderSummarySchema.extend({
  createdBy: z.string().nullable().optional(),
  updatedBy: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const ProjectContentsFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['bpmn', 'dmn', 'form']),
  createdBy: z.string().nullable().optional(),
  updatedBy: z.string().nullable().optional(),
  updatedAt: z.number(),
  createdAt: z.number(),
});

export const ProjectContentsSchema = z.object({
  breadcrumb: z.array(FolderSchema).default([]),
  folders: z.array(ProjectContentsFolderSchema),
  files: z.array(ProjectContentsFileSchema),
})

export const FolderDeletePreviewSchema = z.object({
  folderCount: z.number().int().positive().safe(),
  fileCount: z.number().int().nonnegative().safe(),
  filesByType: z.object({ bpmn: z.number().int().nonnegative().safe(), dmn: z.number().int().nonnegative().safe(), other: z.number().int().nonnegative().safe() }).strict(),
  samplePaths: z.array(z.string()).max(10)
}).strict().refine(value => value.fileCount === value.filesByType.bpmn + value.filesByType.dmn + value.filesByType.other, { message: 'Folder preview counts do not match' })

export const FolderListResponseSchema = z.array(FolderSummarySchema.extend({ id: z.string().uuid(), parentFolderId: z.string().uuid().nullable() }).strict()).superRefine((rows, context) => {
  const byId = new Map(rows.map(row => [row.id, row]));
  if (byId.size !== rows.length) { context.addIssue({ code: 'custom', message: 'Folder identities are not unique' }); return; }
  const resolved = new Set<string>();
  for (const row of rows) {
    const path = new Set<string>(); let current: string | null = row.id;
    while (current && !resolved.has(current)) {
      const found = byId.get(current);
      if (!found || path.has(current)) { context.addIssue({ code: 'custom', message: 'Folder ancestry is invalid' }); return; }
      path.add(current); current = found.parentFolderId;
    }
    for (const id of path) resolved.add(id);
  }
});

export type Folder = z.infer<typeof FolderSchema>
export type CreateFolder = z.infer<typeof CreateFolderRequest>
export type CreateFolderResponse = z.infer<typeof CreateFolderResponseSchema>
export type FolderDeletePreview = z.infer<typeof FolderDeletePreviewSchema>
export type FolderSummary = z.infer<typeof FolderSummarySchema>
export type ProjectContents = z.infer<typeof ProjectContentsSchema>
export type UpdateFolder = z.infer<typeof UpdateFolderRequest>
export type UpdateFolderResponse = z.infer<typeof UpdateFolderResponseSchema>

// Exact metadata receipt for an archive import at the project root.
export const ProjectArchiveImportResponseSchema = z.object({
  foldersCreated: z.number().int().nonnegative().safe(),
  filesCreated: z.number().int().nonnegative().safe(),
  linksRewritten: z.number().int().nonnegative().safe(),
  warnings: z.array(z.string()),
}).strict();
export type ProjectArchiveImportResponse = z.infer<typeof ProjectArchiveImportResponseSchema>;
