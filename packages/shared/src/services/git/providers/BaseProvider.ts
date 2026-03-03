/**
 * Base interface for Git provider adapters
 * Supports GitHub, GitLab, Azure DevOps, Bitbucket
 */

export interface PullRequestParams {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface PullRequest {
  id: string | number;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  url: string;
  createdAt: string;
  updatedAt: string;
  author: {
    username: string;
    avatar?: string;
  };
}

export interface Repository {
  id: string | number;
  name: string;
  fullName: string;
  url: string;
  cloneUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
}

export interface CreateRepositoryParams {
  name: string;
  namespace?: string;
  private?: boolean;
  autoInit?: boolean;
  description?: string;
}

export abstract class BaseGitProvider {
  protected baseUrl: string;
  protected apiUrl: string;

  constructor(baseUrl: string, apiUrl: string) {
    this.baseUrl = baseUrl;
    this.apiUrl = apiUrl;
  }

  /**
   * Create a pull request
   */
  abstract createPullRequest(params: PullRequestParams, accessToken: string): Promise<PullRequest>;

  /**
   * Get pull request details
   */
  abstract getPullRequest(owner: string, repo: string, prNumber: number, accessToken: string): Promise<PullRequest>;

  /**
   * List pull requests
   */
  abstract listPullRequests(owner: string, repo: string, accessToken: string): Promise<PullRequest[]>;

  /**
   * Merge a pull request
   */
  abstract mergePullRequest(owner: string, repo: string, prNumber: number, accessToken: string): Promise<void>;

  /**
   * Create a repository
   */
  abstract createRepository(params: CreateRepositoryParams, accessToken: string): Promise<Repository>;

  /**
   * Get repository details
   */
  abstract getRepository(owner: string, repo: string, accessToken: string): Promise<Repository>;

  /**
   * Helper method to make authenticated API requests
   */
  protected async makeRequest<T>(
    url: string,
    method: string,
    accessToken: string,
    body?: any
  ): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${method} ${url} failed: ${response.status} ${error}`);
    }

    return await response.json();
  }
}
