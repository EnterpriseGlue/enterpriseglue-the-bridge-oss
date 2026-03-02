import { z } from 'zod';
import { toTimestamp } from '@enterpriseglue/shared/utils/schema-helpers.js';

// Raw schema - matches TypeORM File entity
export const FileSchemaRaw = z.object({
  id: z.string(),
  projectId: z.string(),
  folderId: z.string().nullable(),
  name: z.string(),
  type: z.string(),
  xml: z.string().nullable(),
  bpmnProcessId: z.string().nullable().optional(),
  dmnDecisionId: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Select schema (read responses) - transformed from Raw
export const FileSchema = FileSchemaRaw.transform((f) => ({
  id: f.id,
  projectId: f.projectId,
  folderId: f.folderId ?? null,
  name: f.name,
  type: f.type as 'bpmn' | 'dmn' | 'form',
  xml: f.xml,
  bpmnProcessId: f.bpmnProcessId ?? null,
  dmnDecisionId: f.dmnDecisionId ?? null,
  createdAt: toTimestamp(f.createdAt),
  updatedAt: toTimestamp(f.updatedAt),
}));

// Insert schema
export const FileInsertSchema = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid(),
  folderId: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  type: z.enum(['bpmn', 'dmn', 'form']),
  xml: z.string(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

// Request schemas
export const CreateFileRequest = z.object({
  name: z.string().optional(),
  type: z.enum(['bpmn', 'dmn']).optional(),
  folderId: z.string().nullable().optional(),
});

export const UpdateFileXmlRequest = z.object({
  xml: z.string(),
  prevUpdatedAt: z.number().optional(),
});

export const RenameFileRequest = z.object({
  name: z.string().min(1),
});

// Types
export type File = z.infer<typeof FileSchema>;
export type CreateFile = z.infer<typeof CreateFileRequest>;
