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
  name: z.string().min(1),
  parentFolderId: z.string().nullable().optional()
})

export const UpdateFolderRequest = z.object({
  name: z.string().min(1).optional(),
  parentFolderId: z.string().nullable().optional()
})

export const ProjectContentsSchema = z.object({
  breadcrumb: z.array(FolderSchema).default([]),
  folders: z.array(FolderSummarySchema),
  files: z.array(
    z.object({ id: z.string(), name: z.string(), type: z.enum(['bpmn','dmn','form']), updatedAt: z.number(), createdAt: z.number() })
  )
})

export const FolderDeletePreviewSchema = z.object({
  folderCount: z.number(),
  fileCount: z.number(),
  filesByType: z.object({ bpmn: z.number(), dmn: z.number(), other: z.number() }),
  samplePaths: z.array(z.string()).max(10)
})

export type Folder = z.infer<typeof FolderSchema>
export type CreateFolder = z.infer<typeof CreateFolderRequest>
