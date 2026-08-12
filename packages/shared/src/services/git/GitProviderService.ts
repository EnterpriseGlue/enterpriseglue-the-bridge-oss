import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitProvider } from '@enterpriseglue/shared/db/entities/GitProvider.js';
import { GitRepository } from '@enterpriseglue/shared/db/entities/GitRepository.js';
import { GitCredential } from '@enterpriseglue/shared/db/entities/GitCredential.js';
import { encrypt as encryptSecret, isEncrypted as isEncryptedValue } from '@enterpriseglue/shared/services/encryption.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { remoteGitService } from '@enterpriseglue/shared/services/git/RemoteGitService.js';
import { adminConfigObjectOwnershipService } from '@enterpriseglue/shared/services/platform-admin/AdminConfigObjectOwnershipService.js';
import { validateAdminIntegrationEndpointUrl } from '@enterpriseglue/shared/services/platform-admin/AdminIntegrationEndpointPolicy.js';

export interface ProviderSummary {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  apiUrl: string;
  supportsOAuth: boolean;
  supportsPAT: boolean;
}

export interface ProviderRepositoryListItem {
  name: string;
  fullName: string;
  url: string;
  isPrivate: boolean;
}

class GitProviderServiceImpl {
  async listActive(): Promise<ProviderSummary[]> {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(GitProvider);

    const providers = await providerRepo.find({
      where: { isActive: true },
      order: { displayOrder: 'ASC', name: 'ASC' },
    });

    return providers.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      baseUrl: p.customBaseUrl || p.baseUrl,
      apiUrl: p.customApiUrl || p.apiUrl,
      supportsOAuth: p.supportsOAuth,
      supportsPAT: p.supportsPAT,
    }));
  }

  async getById(id: string) {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(GitProvider);
    const provider = await providerRepo.findOneBy({ id });
    if (!provider) throw Errors.providerNotFound();
    return {
      ...provider,
      effectiveBaseUrl: provider.customBaseUrl || provider.baseUrl,
      effectiveApiUrl: provider.customApiUrl || provider.apiUrl,
    };
  }

  async listRepositories(providerId: string, accessToken: string): Promise<ProviderRepositoryListItem[]> {
    const client = await remoteGitService.getClient(providerId, accessToken);
    const repos = await client.listRepositories({ limit: 100 });

    return repos.map((repo) => ({
      name: repo.name,
      fullName: repo.fullName,
      url: repo.cloneUrl,
      isPrivate: repo.private,
    }));
  }

  async listAllWithUsage() {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(GitProvider);
    const gitRepoRepo = dataSource.getRepository(GitRepository);
    const credentialRepo = dataSource.getRepository(GitCredential);

    const [providers, repoCounts, credentialCounts] = await Promise.all([
      providerRepo.find({
        order: { displayOrder: 'ASC', name: 'ASC' },
      }),
      gitRepoRepo.createQueryBuilder('r')
        .select('r.providerId', 'providerId')
        .addSelect('COUNT(*)', 'projectConnectionsCount')
        .groupBy('r.providerId')
        .getRawMany(),
      credentialRepo.createQueryBuilder('c')
        .select('c.providerId', 'providerId')
        .addSelect('COUNT(*)', 'gitConnectionsCount')
        .groupBy('c.providerId')
        .getRawMany(),
    ]);

    const repoCountMap = new Map<string, number>();
    for (const row of repoCounts) {
      repoCountMap.set(row.providerId, Number(row.projectConnectionsCount || 0));
    }

    const credentialCountMap = new Map<string, number>();
    for (const row of credentialCounts) {
      credentialCountMap.set(row.providerId, Number(row.gitConnectionsCount || 0));
    }

    return providers.map((p: any) => {
      const projectConnectionsCount = repoCountMap.get(p.id) || 0;
      const gitConnectionsCount = credentialCountMap.get(p.id) || 0;

      return {
        ...p,
        projectConnectionsCount,
        gitConnectionsCount,
        hasProjectConnections: projectConnectionsCount > 0,
        hasGitConnections: gitConnectionsCount > 0,
      };
    });
  }

  async update(id: string, input: {
    isActive?: boolean;
    customBaseUrl?: string | null;
    customApiUrl?: string | null;
    oauthClientId?: string | null;
    oauthClientSecret?: string | null;
    oauthScopes?: string | null;
    displayOrder?: number;
  }) {
    const dataSource = await getDataSource();
    if (input.customBaseUrl) validateAdminIntegrationEndpointUrl(input.customBaseUrl, 'Custom Git base URL');
    if (input.customApiUrl) validateAdminIntegrationEndpointUrl(input.customApiUrl, 'Custom Git API URL');

    const updates: any = { updatedAt: Date.now() };

    if (input.isActive !== undefined) updates.isActive = input.isActive;
    if (input.customBaseUrl !== undefined) updates.customBaseUrl = input.customBaseUrl || null;
    if (input.customApiUrl !== undefined) updates.customApiUrl = input.customApiUrl || null;
    if (input.oauthClientId !== undefined) updates.oauthClientId = input.oauthClientId || null;
    if (input.oauthClientSecret !== undefined) {
      if (!input.oauthClientSecret) {
        updates.oauthClientSecret = null;
      } else {
        updates.oauthClientSecret = isEncryptedValue(input.oauthClientSecret)
          ? input.oauthClientSecret
          : encryptSecret(input.oauthClientSecret);
      }
    }
    if (input.oauthScopes !== undefined) updates.oauthScopes = input.oauthScopes || null;
    if (input.displayOrder !== undefined) updates.displayOrder = input.displayOrder;

    return dataSource.transaction(async (manager) => {
      const providerRepo = manager.getRepository(GitProvider);
      const existing = await providerRepo.findOneBy({ id });
      if (!existing) throw Errors.providerNotFound();
      await adminConfigObjectOwnershipService.claimManualMutation(manager, 'git_provider', id);
      await providerRepo.update({ id }, updates);
      return providerRepo.findOneBy({ id });
    });
  }
}

export const gitProviderService = new GitProviderServiceImpl();
