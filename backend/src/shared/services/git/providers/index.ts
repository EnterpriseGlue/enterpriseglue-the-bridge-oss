/**
 * Git Provider Factory
 * Creates the appropriate client based on provider type
 */

export * from './types.js';
export { GitHubClient } from './GitHubClient.js';
export { GitLabClient } from './GitLabClient.js';
export { BitbucketClient } from './BitbucketClient.js';
export { AzureDevOpsClient } from './AzureDevOpsClient.js';

import type { GitProviderClient, ProviderType, ProviderCredentials } from './types.js';
import { GitHubClient } from './GitHubClient.js';
import { GitLabClient } from './GitLabClient.js';
import { BitbucketClient } from './BitbucketClient.js';
import { AzureDevOpsClient } from './AzureDevOpsClient.js';

/**
 * Create a Git provider client based on provider type
 */
export function createGitProviderClient(
  type: ProviderType,
  credentials: ProviderCredentials,
  options?: { host?: string }
): GitProviderClient {
  switch (type) {
    case 'github':
      return new GitHubClient(credentials);
    case 'gitlab':
      return new GitLabClient(credentials, options?.host);
    case 'bitbucket':
      return new BitbucketClient(credentials);
    case 'azure-devops':
      return new AzureDevOpsClient(credentials);
    default:
      throw new Error(`Unsupported provider type: ${type}`);
  }
}

/**
 * Detect provider type from URL
 */
export function detectProviderFromUrl(url: string): ProviderType | null {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    
    if (hostname === 'github.com' || hostname.endsWith('.github.com')) {
      return 'github';
    }
    if (hostname === 'gitlab.com' || hostname.endsWith('.gitlab.com')) {
      return 'gitlab';
    }
    if (hostname === 'bitbucket.org' || hostname.endsWith('.bitbucket.org')) {
      return 'bitbucket';
    }
    if (hostname === 'dev.azure.com' || hostname.endsWith('.visualstudio.com')) {
      return 'azure-devops';
    }
    
    return null;
  } catch {
    // Invalid URL, return null
    return null;
  }
}
