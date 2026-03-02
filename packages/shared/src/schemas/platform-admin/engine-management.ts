import { z } from 'zod';
import { UserSummarySchema } from './project-member.js';

// Engine roles
export const EngineRoleSchema = z.enum(['owner', 'delegate', 'operator', 'deployer']);

// Engine member schema (read responses)
export const EngineMemberSchema = z.object({
  id: z.string(),
  engineId: z.string(),
  userId: z.string(),
  role: z.string(),
  grantedById: z.string().nullable().optional(),
  createdAt: z.number(),
  user: UserSummarySchema.nullable().optional(),
});

// Engine with details (for my-engines endpoint)
export const EngineWithDetailsSchema = z.object({
  engine: z.object({
    id: z.string(),
    name: z.string(),
    baseUrl: z.string(),
    type: z.string().nullable().optional(),
    authType: z.string().nullable().optional(),
    ownerId: z.string().nullable().optional(),
    delegateId: z.string().nullable().optional(),
    environmentTagId: z.string().nullable().optional(),
    environmentLocked: z.boolean().optional(),
    version: z.string().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
  role: EngineRoleSchema,
  environmentTag: z.object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    manualDeployAllowed: z.boolean(),
  }).nullable().optional(),
});

// Request schemas
export const AddEngineMemberRequest = z.object({
  email: z.string().email(),
  role: z.enum(['operator', 'deployer']),
});

export const UpdateEngineMemberRoleRequest = z.object({
  role: z.enum(['operator', 'deployer']),
});

export const AssignDelegateRequest = z.object({
  email: z.string().email().nullable(),
});

export const TransferEngineOwnershipRequest = z.object({
  newOwnerEmail: z.string().email(),
});

export const SetEnvironmentRequest = z.object({
  environmentTagId: z.string(),
});

export const SetLockedRequest = z.object({
  locked: z.boolean(),
});

export const RequestAccessRequest = z.object({
  projectId: z.string().uuid(),
});

export const EngineRoleResponse = z.object({
  role: EngineRoleSchema.nullable(),
});

// Types
export type EngineRole = z.infer<typeof EngineRoleSchema>;
export type EngineMember = z.infer<typeof EngineMemberSchema>;
export type EngineWithDetails = z.infer<typeof EngineWithDetailsSchema>;
