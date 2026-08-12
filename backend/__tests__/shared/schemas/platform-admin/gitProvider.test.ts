import { describe, expect, it } from 'vitest';
import {
  GitProviderAdminSummarySchema,
  GitProviderAdminUpdateResponseSchema,
  UpdateGitProviderRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/git-provider.js';

const persistedProvider = {
  id: 'provider-1',
  tenantId: null,
  name: 'GitHub',
  type: 'github',
  baseUrl: 'https://github.com',
  apiUrl: 'https://api.github.com',
  customBaseUrl: null,
  customApiUrl: null,
  supportsOAuth: true,
  supportsPAT: true,
  isActive: true,
  displayOrder: 1,
  createdAt: 1,
  updatedAt: 2,
  oauthClientId: 'client-id',
  oauthClientSecret: 'encrypted-secret',
  oauthScopes: 'repo',
  configKey: null,
  sourceRef: null,
  ownershipMode: 'manual',
  driftStatus: null,
};

describe('Git provider administrator contracts', () => {
  it('accepts write-only OAuth update fields but strips them from response contracts', () => {
    expect(UpdateGitProviderRequestSchema.parse({
      oauthClientId: 'client-id',
      oauthClientSecret: 'plain-secret',
      oauthScopes: 'repo',
    })).toMatchObject({ oauthClientSecret: 'plain-secret' });

    const updateResponse = GitProviderAdminUpdateResponseSchema.parse(persistedProvider);
    expect(updateResponse).not.toHaveProperty('oauthClientId');
    expect(updateResponse).not.toHaveProperty('oauthClientSecret');
    expect(updateResponse).not.toHaveProperty('oauthScopes');
  });

  it('exposes only safe usage indicators in the administrator inventory', () => {
    const summary = GitProviderAdminSummarySchema.parse({
      ...persistedProvider,
      projectConnectionsCount: 2,
      gitConnectionsCount: 3,
      hasProjectConnections: true,
      hasGitConnections: true,
    });

    expect(summary).toMatchObject({ projectConnectionsCount: 2, hasGitConnections: true });
    expect(summary).not.toHaveProperty('oauthClientSecret');
  });
});
