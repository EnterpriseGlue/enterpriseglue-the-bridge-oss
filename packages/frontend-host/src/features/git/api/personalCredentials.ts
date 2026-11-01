import {
  GitCredentialSchema, GitCredentialIdParamsSchema, GitProviderIdParamsSchema,
  GitProviderSummarySchema, GitCredentialOperationReceiptSchema,
  SaveGitCredentialRequestSchema, RenameGitCredentialRequestSchema,
  type GitCredential, type SaveGitCredentialRequest,
} from '@enterpriseglue/shared/schemas/git/repository.js';
import { apiClient } from '../../../shared/api/client';

export function verifiedPersonalCredential(raw: unknown, userId: string, providerId?: string): GitCredential {
  const result = GitCredentialSchema.safeParse(raw);
  if (!userId || !result.success || result.data.userId !== userId || (providerId !== undefined && result.data.providerId !== providerId)
    || !GitCredentialIdParamsSchema.safeParse({ credentialId: result.data.id }).success
    || !GitProviderIdParamsSchema.safeParse({ providerId: result.data.providerId }).success) throw new Error('Git credential response was not verified');
  return result.data;
}

export async function listPersonalGitCredentials(userId: string) {
  if (!userId) throw new Error('Current Git credential owner is unavailable');
  const parsed = GitCredentialSchema.array().safeParse(await apiClient.get('/git-api/credentials'));
  if (!parsed.success) throw new Error('Git credential list was not verified');
  const rows = parsed.data.map(row => verifiedPersonalCredential(row, userId));
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Git credential list was not verified');
  return rows;
}

export async function listGitCredentialProviders() {
  const result = GitProviderSummarySchema.array().safeParse(await apiClient.get('/git-api/providers'));
  if (!result.success || new Set(result.data.map(row => row.id)).size !== result.data.length
    || result.data.some(row => !GitProviderIdParamsSchema.safeParse({ providerId: row.id }).success)) throw new Error('Git provider list was not verified');
  return result.data;
}

export async function getPersonalGitCredential(userId: string, providerId: string) {
  if (!userId || !GitProviderIdParamsSchema.safeParse({ providerId }).success) throw new Error('Git credential request was not verified');
  return verifiedPersonalCredential(await apiClient.get(`/git-api/credentials/${encodeURIComponent(providerId)}`), userId, providerId);
}

export async function savePersonalGitCredential(userId: string, request: SaveGitCredentialRequest, assertCurrent: () => void, expectedCredentialId?: string) {
  const parsed = SaveGitCredentialRequestSchema.safeParse({ ...request });
  if (!userId || !parsed.success || !GitProviderIdParamsSchema.safeParse({ providerId: parsed.data.providerId }).success) throw new Error('Git credential request was not verified');
  assertCurrent();
  const raw = await apiClient.post('/git-api/credentials', parsed.data);
  assertCurrent();
  const result = verifiedPersonalCredential(raw, userId, parsed.data.providerId);
  if (result.authType !== 'pat' || (expectedCredentialId !== undefined && result.id !== expectedCredentialId) || (parsed.data.name !== undefined && result.name !== parsed.data.name)) throw new Error('Git credential response was not verified');
  return result;
}

export async function renamePersonalGitCredential(userId: string, credential: GitCredential, name: string, assertCurrent: () => void) {
  const captured = verifiedPersonalCredential({ ...credential }, userId);
  const parsed = RenameGitCredentialRequestSchema.safeParse({ name });
  if (!parsed.success) throw new Error('Git credential request was not verified');
  assertCurrent();
  const raw = await apiClient.patch(`/git-api/credentials/${encodeURIComponent(captured.id)}`, parsed.data);
  assertCurrent();
  if (!GitCredentialOperationReceiptSchema.safeParse(raw).success) throw new Error('Git credential response was not verified');
}

export async function disconnectPersonalGitCredential(userId: string, credential: GitCredential, assertCurrent: () => void) {
  const captured = verifiedPersonalCredential({ ...credential }, userId);
  assertCurrent();
  const raw = await apiClient.delete(`/git-api/credentials/${encodeURIComponent(captured.providerId)}`);
  assertCurrent();
  // This route's canonical success is HTTP 204, decoded as undefined by apiClient.
  if (raw !== undefined) throw new Error('Git disconnect response was not verified');
}
