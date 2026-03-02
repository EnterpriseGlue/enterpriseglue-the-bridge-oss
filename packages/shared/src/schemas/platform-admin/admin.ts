import { z } from 'zod';

// Assign owner request (governance action)
export const AssignOwnerRequest = z.object({
  userId: z.string().uuid(),
  reason: z.string().min(1),
});

// User search result
export const UserSearchResultSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  role: z.string().optional(),
});

// User list item (admin view)
export const UserListItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  role: z.string(),
  platformRole: z.string().optional(),
  isActive: z.boolean(),
  createdAt: z.number(),
  lastLoginAt: z.number().nullable().optional(),
});

// Success response
export const SuccessResponseSchema = z.object({
  success: z.literal(true),
});

// Types
export type AssignOwner = z.infer<typeof AssignOwnerRequest>;
export type UserSearchResult = z.infer<typeof UserSearchResultSchema>;
export type UserListItem = z.infer<typeof UserListItemSchema>;
