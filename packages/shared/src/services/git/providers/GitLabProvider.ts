import { BaseGitProvider, PullRequestParams, PullRequest, CreateRepositoryParams, Repository } from './BaseProvider.js';

/**
 * GitLab API provider adapter
 * Documentation: https://docs.gitlab.com/ee/api/
 */
export class GitLabProvider extends BaseGitProvider {
  constructor(baseUrl = 'https://gitlab.com', apiUrl = 'https://gitlab.com/api/v4') {
    super(baseUrl, apiUrl);
  }

  async createPullRequest(params: PullRequestParams, accessToken: string): Promise<PullRequest> {
    // GitLab calls PRs "Merge Requests"
    // Project ID format: namespace%2Frepo (URL encoded)
    const projectId = encodeURIComponent(`${params.owner}/${params.repo}`);
    const url = `${this.apiUrl}/projects/${projectId}/merge_requests`;
    
    const response = await this.makeRequest<any>(url, 'POST', accessToken, {
      title: params.title,
      description: params.body,
      source_branch: params.head,
      target_branch: params.base,
    });

    return this.normalizePullRequest(response);
  }

  async getPullRequest(owner: string, repo: string, prNumber: number, accessToken: string): Promise<PullRequest> {
    const projectId = encodeURIComponent(`${owner}/${repo}`);
    const url = `${this.apiUrl}/projects/${projectId}/merge_requests/${prNumber}`;
    const response = await this.makeRequest<any>(url, 'GET', accessToken);
    return this.normalizePullRequest(response);
  }

  async listPullRequests(owner: string, repo: string, accessToken: string): Promise<PullRequest[]> {
    const projectId = encodeURIComponent(`${owner}/${repo}`);
    const url = `${this.apiUrl}/projects/${projectId}/merge_requests?state=all`;
    const response = await this.makeRequest<any[]>(url, 'GET', accessToken);
    return response.map(mr => this.normalizePullRequest(mr));
  }

  async mergePullRequest(owner: string, repo: string, prNumber: number, accessToken: string): Promise<void> {
    const projectId = encodeURIComponent(`${owner}/${repo}`);
    const url = `${this.apiUrl}/projects/${projectId}/merge_requests/${prNumber}/merge`;
    await this.makeRequest<any>(url, 'PUT', accessToken, {
      merge_when_pipeline_succeeds: false,
    });
  }

  async createRepository(params: CreateRepositoryParams, accessToken: string): Promise<Repository> {
    // If namespace is provided, create in group/namespace
    const url = `${this.apiUrl}/projects`;

    const body: any = {
      name: params.name,
      visibility: params.private ? 'private' : 'public',
      initialize_with_readme: params.autoInit ?? true,
      description: params.description,
    };

    if (params.namespace) {
      body.namespace_id = params.namespace;
    }

    const response = await this.makeRequest<any>(url, 'POST', accessToken, body);

    return this.normalizeRepository(response);
  }

  async getRepository(owner: string, repo: string, accessToken: string): Promise<Repository> {
    const projectId = encodeURIComponent(`${owner}/${repo}`);
    const url = `${this.apiUrl}/projects/${projectId}`;
    const response = await this.makeRequest<any>(url, 'GET', accessToken);
    return this.normalizeRepository(response);
  }

  /**
   * Normalize GitLab MR response to common PR format
   */
  private normalizePullRequest(mr: any): PullRequest {
    return {
      id: mr.id,
      number: mr.iid, // GitLab uses iid for the MR number
      title: mr.title,
      body: mr.description || '',
      state: mr.merged_at ? 'merged' : mr.state,
      url: mr.web_url,
      createdAt: mr.created_at,
      updatedAt: mr.updated_at,
      author: {
        username: mr.author.username,
        avatar: mr.author.avatar_url,
      },
    };
  }

  /**
   * Normalize GitLab project response to common repo format
   */
  private normalizeRepository(project: any): Repository {
    return {
      id: project.id,
      name: project.name,
      fullName: project.path_with_namespace,
      url: project.web_url,
      cloneUrl: project.http_url_to_repo,
      defaultBranch: project.default_branch || 'main',
      isPrivate: project.visibility === 'private',
    };
  }

  /**
   * Override makeRequest to use GitLab's header format
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
        'PRIVATE-TOKEN': accessToken, // GitLab uses PRIVATE-TOKEN header
        'Content-Type': 'application/json',
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
