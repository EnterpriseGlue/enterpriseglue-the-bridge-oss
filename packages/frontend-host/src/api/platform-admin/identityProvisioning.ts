import type {
  IdentityProvisioningCredentialIssued,
  IdentityProvisioningCredentialListResponse,
  IdentityProvisioningDiagnosticsListResponse,
  IdentityProvisioningDirectoryCreate,
  IdentityProvisioningDirectoryListResponse,
  IdentityProvisioningDirectoryRecord,
  IdentityProvisioningDirectoryTestResponse,
  IdentityProvisioningDirectoryUpdate,
} from '@enterpriseglue/shared/schemas/platform-admin/provisioning.js';
import { apiClient } from '../../shared/api/client';

function directoryPath(key: string): string {
  return `/api/identity/provisioning-directories/${encodeURIComponent(key)}`;
}

export const identityProvisioningApi = {
  list: () => apiClient.get<IdentityProvisioningDirectoryListResponse>('/api/identity/provisioning-directories', { limit: 200, offset: 0 }),
  create: (input: IdentityProvisioningDirectoryCreate) =>
    apiClient.post<IdentityProvisioningDirectoryRecord>('/api/identity/provisioning-directories', input),
  update: (key: string, input: IdentityProvisioningDirectoryUpdate) =>
    apiClient.put<IdentityProvisioningDirectoryRecord>(directoryPath(key), input),
  archive: (key: string) => apiClient.delete<void>(directoryPath(key)),
  test: (key: string) => apiClient.post<IdentityProvisioningDirectoryTestResponse>(`${directoryPath(key)}/test`),
  credentials: (key: string) => apiClient.get<IdentityProvisioningCredentialListResponse>(`${directoryPath(key)}/credentials`),
  issueCredential: (key: string, name: string, expiresAt: number | null = null) =>
    apiClient.post<IdentityProvisioningCredentialIssued>(`${directoryPath(key)}/credentials`, { name, expiresAt }),
  rotateCredential: (key: string, credentialId: string, input: { name?: string; expiresAt?: number | null; overlapSeconds?: number }) =>
    apiClient.post<IdentityProvisioningCredentialIssued>(`${directoryPath(key)}/credentials/${encodeURIComponent(credentialId)}/rotate`, input),
  revokeCredential: (key: string, credentialId: string) =>
    apiClient.delete<void>(`${directoryPath(key)}/credentials/${encodeURIComponent(credentialId)}`),
  events: (key: string) => apiClient.get<IdentityProvisioningDiagnosticsListResponse>(`${directoryPath(key)}/events`, { limit: 50 }),
};
