import { BaseGitProvider, PullRequestParams, PullRequest, CreateRepositoryParams, Repository } from './BaseProvider.js';

/**
 * GitHub API provider adapter
 * Documentation: https://docs.github.com/en/rest
 */
export class GitHubProvider extends BaseGitProvider {
  constructor(baseUrl = 'https://github.com', apiUrl = 'https://api.github.com') {
    super(baseUrl, apiUrl);
  }

  async createPullRequest(params: PullRequestParams, accessToken: string): Promise<PullRequest> {
    const url = `${this.apiUrl}/repos/${params.owner}/${params.repo}/pulls`;
    
    const response = await this.makeRequest<any>(url, 'POST', accessToken, {
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
    });

    return this.normalizePullRequest(response);
  }

  async getPullRequest(owner: string, repo: string, prNumber: number, accessToken: string): Promise<PullRequest> {
    const url = `${this.apiUrl}/repos/${owner}/${repo}/pulls/${prNumber}`;
    const response = await this.makeRequest<any>(url, 'GET', accessToken);
    return this.normalizePullRequest(response);
  }

  async listPullRequests(owner: string, repo: string, accessToken: string): Promise<PullRequest[]> {
    const url = `${this.apiUrl}/repos/${owner}/${repo}/pulls?state=all`;
    const response = await this.makeRequest<any[]>(url, 'GET', accessToken);
    return response.map(pr => this.normalizePullRequest(pr));
  }

  async mergePullRequest(owner: string, repo: string, prNumber: number, accessToken: string): Promise<void> {
    const url = `${this.apiUrl}/repos/${owner}/${repo}/pulls/${prNumber}/merge`;
    await this.makeRequest<any>(url, 'PUT', accessToken, {
      merge_method: 'merge',
    });
  }

  async createRepository(params: CreateRepositoryParams, accessToken: string): Promise<Repository> {
    // If namespace is provided, create in organization, otherwise create in user account
    const url = params.namespace
      ? `${this.apiUrl}/orgs/${params.namespace}/repos`
      : `${this.apiUrl}/user/repos`;

    const response = await this.makeRequest<any>(url, 'POST', accessToken, {
      name: params.name,
      private: params.private ?? true,
      auto_init: params.autoInit ?? true,
      description: params.description,
    });

    return this.normalizeRepository(response);
  }

  async getRepository(owner: string, repo: string, accessToken: string): Promise<Repository> {
    const url = `${this.apiUrl}/repos/${owner}/${repo}`;
    const response = await this.makeRequest<any>(url, 'GET', accessToken);
    return this.normalizeRepository(response);
  }

  /**
   * Normalize GitHub PR response to common format
   */
  private normalizePullRequest(pr: any): PullRequest {
    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      body: pr.body || '',
      state: pr.merged_at ? 'merged' : pr.state,
      url: pr.html_url,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      author: {
        username: pr.user.login,
        avatar: pr.user.avatar_url,
      },
    };
  }

  /**
   * Normalize GitHub repo response to common format
   */
  private normalizeRepository(repo: any): Repository {
    return {
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      url: repo.html_url,
      cloneUrl: repo.clone_url,
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
    };
  }
}
