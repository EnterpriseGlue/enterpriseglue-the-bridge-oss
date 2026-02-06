/**
 * Common Zod validation schemas for reuse across routes
 */
import { z } from 'zod';
import { config } from '@shared/config/index.js';

// === ID Schemas ===
export const uuidSchema = z.string().uuid();
export const idParamSchema = z.object({ id: uuidSchema });
export const projectIdParamSchema = z.object({ projectId: uuidSchema });
export const fileIdParamSchema = z.object({ fileId: uuidSchema });
export const folderIdParamSchema = z.object({ folderId: uuidSchema });
export const engineIdParamSchema = z.object({ engineId: uuidSchema });
export const userIdParamSchema = z.object({ userId: uuidSchema });
export const tenantIdParamSchema = z.object({ tenantId: uuidSchema });

// Combined param schemas
export const projectMemberParamSchema = z.object({
  projectId: uuidSchema,
  userId: uuidSchema,
});

export const fileVersionParamSchema = z.object({
  fileId: uuidSchema,
  versionId: uuidSchema,
});

// === Pagination Schemas ===
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const offsetPaginationSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// === Search/Filter Schemas ===
export const searchQuerySchema = z.object({
  q: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
});

// === Common Request Body Schemas ===
export const nameBodySchema = z.object({
  name: z.string().min(1).max(255),
});

export const emailBodySchema = z.object({
  email: z.string().email(),
});

export const optionalNameBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
});

// === File Type Schemas ===
export const fileTypeSchema = z.enum(['bpmn', 'dmn', 'form']);

export const createFileBodySchema = z.object({
  name: z.string().min(1).max(255),
  type: fileTypeSchema.default('bpmn'),
  folderId: z.string().uuid().nullable().optional(),
  xml: z.string().optional(),
});

export const updateFileXmlBodySchema = z.object({
  xml: z.string(),
  prevUpdatedAt: z.number().optional(),
});

export const renameFileBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  folderId: z.string().uuid().nullable().optional(),
});

// === Folder Schemas ===
export const createFolderBodySchema = z.object({
  name: z.string().min(1).max(255),
  parentFolderId: z.string().uuid().nullable().optional(),
});

export const renameFolderBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
});

// === Project Member Schemas ===
export const projectRoleSchema = z.enum(['owner', 'delegate', 'contributor', 'viewer']);

export const addMemberBodySchema = z.object({
  email: z.string().email(),
  role: projectRoleSchema.optional(),
  roles: z.array(projectRoleSchema).optional(),
});

export const updateMemberRoleBodySchema = z.object({
  role: projectRoleSchema.optional(),
  roles: z.array(projectRoleSchema).optional(),
});

// === Engine Schemas ===
export const engineTypeSchema = z.enum(['camunda7', 'camunda8']);

const engineBaseUrlSchema = z.string().url().refine(
  (url) => config.nodeEnv !== 'production' || url.startsWith('https://'),
  { message: 'Engine base URL must use HTTPS in production' }
);

export const createEngineBodySchema = z.object({
  name: z.string().min(1).max(255),
  baseUrl: engineBaseUrlSchema,
  type: engineTypeSchema.default('camunda7'),
  authType: z.enum(['none', 'basic', 'bearer']).default('none'),
  username: z.string().nullable().optional(),
  passwordEnc: z.string().nullable().optional(),
  active: z.boolean().default(false),
  version: z.string().nullable().optional(),
});

export const updateEngineBodySchema = createEngineBodySchema.partial();

// === VCS/Git Schemas ===
export const commitBodySchema = z.object({
  message: z.string().min(1).max(500),
  fileIds: z.array(uuidSchema).optional(),
});

export const syncBodySchema = z.object({
  projectId: uuidSchema,
  direction: z.enum(['push', 'pull']).default('push'),
  message: z.string().min(1).max(500),
});

// === Types ===
export type PaginationQuery = z.infer<typeof paginationSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type CreateFileBody = z.infer<typeof createFileBodySchema>;
export type UpdateFileXmlBody = z.infer<typeof updateFileXmlBodySchema>;
export type CreateFolderBody = z.infer<typeof createFolderBodySchema>;
export type AddMemberBody = z.infer<typeof addMemberBodySchema>;
export type CreateEngineBody = z.infer<typeof createEngineBodySchema>;
export type CommitBody = z.infer<typeof commitBodySchema>;
