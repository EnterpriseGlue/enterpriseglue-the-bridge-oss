import { z } from 'zod';

// Raw schema - matches TypeORM EnvironmentTag entity
export const EnvironmentTagSchemaRaw = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  manualDeployAllowed: z.boolean(),
  sortOrder: z.number(),
  isDefault: z.boolean(),
  configKey: z.string().nullable().optional(),
  sourceRef: z.string().nullable().optional(),
  ownershipMode: z.enum(['manual', 'config_locked', 'config_warn']).optional(),
  sourceHash: z.string().nullable().optional(),
  lastAppliedAt: z.number().nullable().optional(),
  driftStatus: z.enum(['in_sync', 'drifted']).nullable().optional(),
  configGeneration: z.number().int().nonnegative().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Select schema (read responses)
export const EnvironmentTagSchema = EnvironmentTagSchemaRaw.transform((t) => ({
  id: t.id,
  name: t.name,
  color: t.color,
  manualDeployAllowed: t.manualDeployAllowed,
  sortOrder: t.sortOrder,
  isDefault: t.isDefault,
  configKey: t.configKey || null,
  sourceRef: t.sourceRef || null,
  ownershipMode: t.ownershipMode || 'manual',
  sourceHash: t.sourceHash || null,
  lastAppliedAt: t.lastAppliedAt === null || t.lastAppliedAt === undefined ? null : Number(t.lastAppliedAt),
  driftStatus: t.driftStatus || null,
  configGeneration: Number(t.configGeneration || 0),
  createdAt: Number(t.createdAt),
  updatedAt: Number(t.updatedAt),
}));

// Request schemas
export const CreateEnvironmentTagRequest = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  manualDeployAllowed: z.boolean().optional(),
});

export const UpdateEnvironmentTagRequest = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  manualDeployAllowed: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export const ReorderEnvironmentTagsRequest = z.object({
  orderedIds: z.array(z.string()),
});

// Types
export type EnvironmentTag = z.infer<typeof EnvironmentTagSchema>;
export type CreateEnvironmentTag = z.infer<typeof CreateEnvironmentTagRequest>;
export type UpdateEnvironmentTag = z.infer<typeof UpdateEnvironmentTagRequest>;
