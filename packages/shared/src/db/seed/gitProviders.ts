import { getDataSource } from '../data-source.js';
import { GitProvider } from '../entities/GitProvider.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { encrypt } from '@enterpriseglue/shared/services/encryption.js';

/**
 * Seed default Git providers (GitHub, GitLab, Azure DevOps, Bitbucket)
 * Git providers are stored in the database alongside git_credentials
 */
export async function seedGitProviders() {
  const dataSource = await getDataSource();
  const providerRepo = dataSource.getRepository(GitProvider);

  try {
    logger.info('Seeding Git providers...');

    const providers = [
      {
        id: generateId(),
        tenantId: null,
        name: 'GitHub',
        type: 'github',
        baseUrl: 'https://github.com',
        apiUrl: 'https://api.github.com',
        customBaseUrl: null,
        customApiUrl: null,
        // OAuth config - set via env vars: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
        oauthClientId: process.env.GITHUB_CLIENT_ID || null,
        oauthClientSecret: process.env.GITHUB_CLIENT_SECRET ? encrypt(process.env.GITHUB_CLIENT_SECRET) : null,
        oauthScopes: 'repo,read:user,user:email',
        oauthAuthUrl: 'https://github.com/login/oauth/authorize',
        oauthTokenUrl: 'https://github.com/login/oauth/access_token',
        supportsOAuth: true,
        supportsPAT: true,
        isActive: true,
        displayOrder: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: generateId(),
        tenantId: null,
        name: 'GitLab',
        type: 'gitlab',
        baseUrl: 'https://gitlab.com',
        apiUrl: 'https://gitlab.com/api/v4',
        customBaseUrl: null,
        customApiUrl: null,
        // OAuth config - set via env vars: GITLAB_CLIENT_ID, GITLAB_CLIENT_SECRET
        oauthClientId: process.env.GITLAB_CLIENT_ID || null,
        oauthClientSecret: process.env.GITLAB_CLIENT_SECRET ? encrypt(process.env.GITLAB_CLIENT_SECRET) : null,
        oauthScopes: 'api,read_user,read_repository,write_repository',
        oauthAuthUrl: 'https://gitlab.com/oauth/authorize',
        oauthTokenUrl: 'https://gitlab.com/oauth/token',
        supportsOAuth: true,
        supportsPAT: true,
        isActive: true,
        displayOrder: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: generateId(),
        tenantId: null,
        name: 'Azure DevOps',
        type: 'azure-devops',
        baseUrl: 'https://dev.azure.com',
        apiUrl: 'https://dev.azure.com',
        customBaseUrl: null,
        customApiUrl: null,
        // OAuth config - set via env vars: AZURE_DEVOPS_CLIENT_ID, AZURE_DEVOPS_CLIENT_SECRET
        oauthClientId: process.env.AZURE_DEVOPS_CLIENT_ID || null,
        oauthClientSecret: process.env.AZURE_DEVOPS_CLIENT_SECRET ? encrypt(process.env.AZURE_DEVOPS_CLIENT_SECRET) : null,
        oauthScopes: 'vso.code_write,vso.project',
        oauthAuthUrl: 'https://app.vssps.visualstudio.com/oauth2/authorize',
        oauthTokenUrl: 'https://app.vssps.visualstudio.com/oauth2/token',
        supportsOAuth: true,
        supportsPAT: true,
        isActive: true,
        displayOrder: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: generateId(),
        tenantId: null,
        name: 'Bitbucket',
        type: 'bitbucket',
        baseUrl: 'https://bitbucket.org',
        apiUrl: 'https://api.bitbucket.org/2.0',
        customBaseUrl: null,
        customApiUrl: null,
        // OAuth config - set via env vars: BITBUCKET_CLIENT_ID, BITBUCKET_CLIENT_SECRET
        oauthClientId: process.env.BITBUCKET_CLIENT_ID || null,
        oauthClientSecret: process.env.BITBUCKET_CLIENT_SECRET ? encrypt(process.env.BITBUCKET_CLIENT_SECRET) : null,
        oauthScopes: 'repository,repository:write,account',
        oauthAuthUrl: 'https://bitbucket.org/site/oauth2/authorize',
        oauthTokenUrl: 'https://bitbucket.org/site/oauth2/access_token',
        supportsOAuth: true,
        supportsPAT: true,
        isActive: true,
        displayOrder: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    // Check if providers already exist
    const existingCount = await providerRepo.count();

    if (existingCount > 0) {
      logger.info('Git providers already seeded');
      return;
    }

    // Insert providers using TypeORM
    for (const provider of providers) {
      await providerRepo.insert(provider);
    }

    logger.info(`✅ Seeded ${providers.length} Git providers`);
    providers.forEach(p => logger.info(`   - ${p.name} (${p.type})`));
  } catch (error) {
    logger.error('Failed to seed Git providers', error);
    throw error;
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedGitProviders()
    .then(() => {
      logger.info('Git providers seeding complete');
      process.exit(0);
    })
    .catch(error => {
      logger.error('Git providers seeding failed', error);
      process.exit(1);
    });
}
