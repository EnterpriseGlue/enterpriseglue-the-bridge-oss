import { z } from 'zod';

export const DocumentationConfigurationResponseSchema = z.object({ documentationOrigin: z.url(), accountOrigin: z.url(), workspaceContract: z.literal('customer-documentation/v2') }).strict();

export const DocumentationGrantRequestSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/), challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
export const DocumentationGrantResponseSchema = z.object({ callbackUrl: z.url() }).strict();
export const DocumentationExchangeRequestSchema = z.object({
  code: z.string().min(100).max(4096), verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
export const DocumentationExchangeResponseSchema = z.object({ session: z.string().min(100).max(4096) }).strict();
export const DocumentationWorkspaceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
export const DocumentationWorkspaceSummarySchema = z.object({ id: DocumentationWorkspaceIdSchema, name: z.string().trim().min(1).max(120) }).strict();
export const DocumentationWorkspacesResponseSchema = z.object({ workspaceContract: z.literal('customer-documentation/v2'), workspaces: z.array(DocumentationWorkspaceSummarySchema).max(32) }).strict();
export const DocumentationWorkspaceQuerySchema = z.object({ workspace: DocumentationWorkspaceIdSchema.optional() }).strict();
export const DocumentationAccessResponseSchema = z.object({ authenticated: z.literal(true), permission: z.literal('documentation:read'), workspaceContract: z.literal('customer-documentation/v2'), workspaceId: DocumentationWorkspaceIdSchema.optional() }).strict();

// Domain admission is an explicit publisher policy. Existing policies retain
// individual reader checks unless verified_domain is deliberately selected.
export const DocumentationWorkspacePolicySchema = z.object({
  schemaVersion: z.literal(1),
  workspaces: z.array(DocumentationWorkspaceSummarySchema.extend({
    active: z.boolean(),
    accessMode: z.enum(['explicit_readers', 'verified_domain']).default('explicit_readers'),
    allowedEmailDomains: z.array(z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/)).min(1).max(32),
    readers: z.array(z.object({ userId: z.string().min(1).max(255), expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()).max(500).default([]),
  }).strict()).max(32),
}).strict().superRefine((policy, context) => {
  if (new Set(policy.workspaces.map(workspace => workspace.id)).size !== policy.workspaces.length) context.addIssue({ code: 'custom', message: 'Duplicate workspace identifier' });
  for (const workspace of policy.workspaces) {
    if (workspace.accessMode === 'verified_domain' && workspace.readers.length) context.addIssue({ code: 'custom', message: 'Domain admission cannot contain ignored reader restrictions' });
    if (new Set(workspace.readers.map(reader => reader.userId)).size !== workspace.readers.length) context.addIssue({ code: 'custom', message: 'Duplicate reader grant' });
  }
});
export const DocumentationLogoutResponseSchema = z.object({ signedOut: z.literal(true) }).strict();
