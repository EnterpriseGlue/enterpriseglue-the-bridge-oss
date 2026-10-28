/**
 * Bitbucket Provider Client
 * Uses Bitbucket API for interactions
 */

import type {
  GitProviderClient,
  ProviderCredentials,
  RepoInfo,
  BranchInfo,
  FileEntry,
  TreeEntry,
  CommitInfo,
  CreateRepoOptions,
  PushOptions,
  PullOptions,
  PullResult,
  Namespace,
} from './types.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';

type RepositoryPath = { workspace: string; repo_slug: string };
const requestError = (status: number) =>
  Object.assign(new Error(`Bitbucket request failed (HTTP ${status})`), { status });
const segment = (value: string) => {
  if (!value || value === '.' || value === '..') throw new Error('Invalid Bitbucket path segment');
  return encodeURIComponent(value);
};
const repositoryPath = ({ workspace, repo_slug }: RepositoryPath) =>
  `/repositories/${segment(workspace)}/${segment(repo_slug)}`;

// Only the endpoints this provider uses. Native fetch avoids the obsolete SDK's
// deepmerge dependency; request data is never merged into client defaults.
function createBitbucketApi(token: string) {
  const request = async (path: string, method = 'GET', query?: Record<string, string | number>, body?: unknown) => {
    const url = new URL(`https://api.bitbucket.org/2.0${path}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
    const response = await fetch(url, {
      method, redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw requestError(response.status);
    }
    const text = await response.text();
    return { data: text && /(?:application\/json|\+json)(?:;|$)/i.test(response.headers.get('content-type') ?? '') ? JSON.parse(text) : text };
  };
  const refs = (p: RepositoryPath, kind: 'branches' | 'tags') => `${repositoryPath(p)}/refs/${kind}`;
  return {
    user: { get: (_options: Record<string, never>) => request('/user') },
    workspaces: { getWorkspaces: (_options: Record<string, never>) => request('/workspaces') },
    repositories: {
      create: (p: RepositoryPath & { _body: unknown }) => request(repositoryPath(p), 'POST', undefined, p._body),
      get: (p: RepositoryPath) => request(repositoryPath(p)),
      list: (p: { workspace: string; pagelen: number; sort: string }) => request(`/repositories/${segment(p.workspace)}`, 'GET', { pagelen: p.pagelen, sort: p.sort }),
      delete: (p: RepositoryPath) => request(repositoryPath(p), 'DELETE'),
      listBranches: (p: RepositoryPath) => request(refs(p, 'branches')),
      getBranch: (p: RepositoryPath & { name: string }) => request(`${refs(p, 'branches')}/${segment(p.name)}`),
      listCommits: (p: RepositoryPath & { pagelen: number }) => request(`${repositoryPath(p)}/commits`, 'GET', { pagelen: p.pagelen }),
      readSrc: (p: RepositoryPath & { commit: string; path: string }) => request(`${repositoryPath(p)}/src/${segment(p.commit)}/${p.path ? p.path.split('/').map(segment).join('/') : ''}`),
    },
    refs: {
      createBranch: (p: RepositoryPath & { _body: unknown }) => request(refs(p, 'branches'), 'POST', undefined, p._body),
      tags: { create: (p: RepositoryPath & { _body: unknown }) => request(refs(p, 'tags'), 'POST', undefined, p._body) },
    },
  };
}

export class BitbucketClient implements GitProviderClient {
  readonly type = 'bitbucket' as const;
  private bitbucket: ReturnType<typeof createBitbucketApi>;
  private readonly token: string;
  private username: string | null = null;

  constructor(credentials: ProviderCredentials) {
    this.token = credentials.token;
    this.bitbucket = createBitbucketApi(this.token);
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.bitbucket.user.get({});
      return true;
    } catch (error) {
      logger.warn('Bitbucket credentials validation failed', { error });
      return false;
    }
  }

  async getCurrentUser(): Promise<{ id: string; username: string; email?: string }> {
    const { data } = await this.bitbucket.user.get({});
    this.username = String((data as any).username || '') || null;
    return {
      id: String((data as any).uuid || ''),
      username: String((data as any).username || ''),
      email: undefined, // Bitbucket doesn't return email in user endpoint
    };
  }

  async getNamespaces(): Promise<Namespace[]> {
    const namespaces: Namespace[] = [];
    
    // Get current user
    const { data: user } = await this.bitbucket.user.get({});
    const username = String((user as any).username || '');
    namespaces.push({
      name: username,
      type: 'user',
      avatarUrl: (user as any).links?.avatar?.href,
    });
    
    // Get workspaces the user belongs to
    try {
      const { data: workspacesData } = await this.bitbucket.workspaces.getWorkspaces({});
      const workspaces = (workspacesData as any).values || [];
      for (const workspace of workspaces) {
        if (workspace.slug !== username) {
          namespaces.push({
            name: workspace.slug,
            type: 'organization',
            avatarUrl: workspace.links?.avatar?.href,
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to fetch Bitbucket workspaces', { error });
    }
    
    return namespaces;
  }

  async createRepository(options: CreateRepoOptions): Promise<RepoInfo> {
    // Ensure we have the username
    if (!this.username) {
      await this.getCurrentUser();
    }
    
    const workspace = options.organization || this.username!;
    
    const { data } = await this.bitbucket.repositories.create({
      workspace,
      repo_slug: options.name,
      _body: {
        name: options.name,
        description: options.description,
        is_private: options.private ?? true,
        scm: 'git',
      } as any,
    });
    
    return this.mapRepo(data, workspace);
  }

  async getRepository(repo: string): Promise<RepoInfo | null> {
    try {
      const [workspace, repoSlug] = this.parseRepo(repo);
      const { data } = await this.bitbucket.repositories.get({
        workspace,
        repo_slug: repoSlug,
      });
      return this.mapRepo(data, workspace);
    } catch (error: any) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async listRepositories(options?: { org?: string; limit?: number }): Promise<RepoInfo[]> {
    if (!this.username) {
      await this.getCurrentUser();
    }
    
    const workspace = options?.org || this.username!;
    const { data } = await this.bitbucket.repositories.list({
      workspace,
      pagelen: options?.limit ?? 100,
      sort: '-updated_on',
    });
    
    return (data.values || []).map((r: any) => this.mapRepo(r, workspace));
  }

  async deleteRepository(repo: string): Promise<void> {
    const [workspace, repoSlug] = this.parseRepo(repo);
    await this.bitbucket.repositories.delete({
      workspace,
      repo_slug: repoSlug,
    });
  }

  async getBranches(repo: string): Promise<BranchInfo[]> {
    const [workspace, repoSlug] = this.parseRepo(repo);
    const { data } = await this.bitbucket.repositories.listBranches({
      workspace,
      repo_slug: repoSlug,
    });
    
    // Get default branch
    const { data: repoData } = await this.bitbucket.repositories.get({
      workspace,
      repo_slug: repoSlug,
    });
    const defaultBranch = (repoData.mainbranch as any)?.name || 'main';
    
    return (data.values || []).map((b: any) => ({
      name: b.name,
      sha: b.target?.hash || '',
      isDefault: b.name === defaultBranch,
      protected: false, // Bitbucket handles this differently
    }));
  }

  async createBranch(repo: string, branchName: string, fromBranch?: string): Promise<BranchInfo> {
    const [workspace, repoSlug] = this.parseRepo(repo);
    
    // Get source branch SHA
    const sourceBranch = fromBranch || 'main';
    const { data: branchData } = await this.bitbucket.repositories.getBranch({
      workspace,
      repo_slug: repoSlug,
      name: sourceBranch,
    });
    
    const sha = (branchData.target as any)?.hash;
    
    // Create branch via refs endpoint
    const { data } = await this.bitbucket.refs.createBranch({
      workspace,
      repo_slug: repoSlug,
      _body: {
        name: branchName,
        target: { hash: sha },
      },
    });
    
    return {
      name: data.name || branchName,
      sha: (data.target as any)?.hash || sha,
      isDefault: false,
      protected: false,
    };
  }

  async pushFiles(options: PushOptions): Promise<CommitInfo> {
    const [workspace, repoSlug] = this.parseRepo(options.repo);
    
    // Bitbucket uses multipart form data for commits
    // Build form data with files
    const formData = new FormData();
    formData.append('message', options.message);
    formData.append('branch', options.branch);
    
    for (const file of options.files) {
      formData.append(file.path, new Blob([file.content]), file.path);
    }
    
    // Use raw fetch for multipart upload
    const response = await fetch(
      `https://api.bitbucket.org/2.0${repositoryPath({ workspace, repo_slug: repoSlug })}/src`,
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Authorization': `Bearer ${this.token}`,
        },
        body: formData,
      }
    );
    
    if (!response.ok) {
      await response.body?.cancel();
      throw requestError(response.status);
    }
    await response.body?.cancel();
    
    // Get the latest commit
    const { data: commits } = await this.bitbucket.repositories.listCommits({
      workspace,
      repo_slug: repoSlug,
      pagelen: 1,
    });
    
    const latestCommit = commits.values?.[0];
    
    return {
      sha: latestCommit?.hash || '',
      message: options.message,
      author: (latestCommit?.author as any)?.raw || 'unknown',
      date: new Date(latestCommit?.date || Date.now()),
    };
  }

  async pullFiles(options: PullOptions): Promise<PullResult> {
    const [workspace, repoSlug] = this.parseRepo(options.repo);
    
    // Get directory listing recursively
    const files: FileEntry[] = [];
    
    const fetchDir = async (path: string = '') => {
      const { data } = await this.bitbucket.repositories.readSrc({
        workspace,
        repo_slug: repoSlug,
        commit: options.branch,
        path,
      });
      
      if (Array.isArray((data as any).values)) {
        for (const item of (data as any).values) {
          if (item.type === 'commit_directory') {
            await fetchDir(item.path);
          } else if (item.type === 'commit_file') {
            // Apply pattern filtering
            if (options.patterns && !this.matchesPatterns(item.path, options.patterns)) {
              continue;
            }
            
            const fileContent = await this.getFile(options.repo, options.branch, item.path);
            if (fileContent) {
              files.push(fileContent);
            }
          }
        }
      }
    };
    
    await fetchDir();
    return {
      files,
      commit: {
        sha: 'unknown',
        message: `Pull from ${options.repo}`,
        author: 'unknown',
        date: new Date(),
      },
    };
  }

  async getFile(repo: string, branch: string, path: string): Promise<FileEntry | null> {
    try {
      const [workspace, repoSlug] = this.parseRepo(repo);
      const { data } = await this.bitbucket.repositories.readSrc({
        workspace,
        repo_slug: repoSlug,
        commit: branch,
        path,
      });
      
      return {
        path,
        content: typeof data === 'string' ? data : JSON.stringify(data),
        encoding: 'utf-8',
      };
    } catch (error: any) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async getTree(repo: string, branch: string): Promise<TreeEntry[]> {
    const [workspace, repoSlug] = this.parseRepo(repo);
    const entries: TreeEntry[] = [];
    
    const fetchDir = async (path: string = '') => {
      const { data } = await this.bitbucket.repositories.readSrc({
        workspace,
        repo_slug: repoSlug,
        commit: branch,
        path,
      });
      
      if (Array.isArray((data as any).values)) {
        for (const item of (data as any).values) {
          if (item.type === 'commit_directory') {
            entries.push({
              path: item.path,
              type: 'tree',
            });
            await fetchDir(item.path);
          } else if (item.type === 'commit_file') {
            entries.push({
              path: item.path,
              type: 'blob',
              size: item.size,
            });
          }
        }
      }
    };
    
    await fetchDir();
    return entries;
  }

  async getCommits(repo: string, branch: string, limit = 50): Promise<CommitInfo[]> {
    const [workspace, repoSlug] = this.parseRepo(repo);
    const { data } = await this.bitbucket.repositories.listCommits({
      workspace,
      repo_slug: repoSlug,
      pagelen: limit,
    });
    
    return (data.values || []).map((c: any) => ({
      sha: c.hash,
      message: c.message,
      author: c.author?.raw || 'unknown',
      date: new Date(c.date),
    }));
  }

  async createTag(repo: string, tagName: string, commitSha: string, _message?: string): Promise<{ name: string; sha: string }> {
    const [workspace, repoSlug] = this.parseRepo(repo);
    const { data } = await (this.bitbucket as any).refs.tags.create({
      workspace,
      repo_slug: repoSlug,
      _body: { name: tagName, target: { hash: commitSha } },
    });
    return { name: data.name, sha: data.target?.hash || commitSha };
  }

  async testWriteAccess(repo: string): Promise<boolean> {
    const [workspace, repoSlug] = this.parseRepo(repo);
    // Bitbucket: attempt to read repo; write access is inferred from app password scopes
    await (this.bitbucket as any).repositories.get({ workspace, repo_slug: repoSlug });
    return true;
  }

  // Helper methods
  private parseRepo(repo: string): [string, string] {
    const parts = repo
      .replace(/\.git$/, '')
      .replace(/^https?:\/\/[^/]+\//, '')
      .split('/');
    
    if (parts.length < 2) {
      throw new Error(`Invalid repository format: ${repo}. Expected 'workspace/repo'`);
    }
    return [parts[parts.length - 2], parts[parts.length - 1]];
  }

  private mapRepo(data: any, workspace: string): RepoInfo {
    return {
      id: data.uuid || '',
      name: data.name,
      fullName: data.full_name || `${workspace}/${data.slug || data.name}`,
      cloneUrl: data.links?.clone?.find((l: any) => l.name === 'https')?.href || '',
      htmlUrl: data.links?.html?.href || '',
      defaultBranch: data.mainbranch?.name || 'main',
      private: data.is_private ?? true,
    };
  }

  private matchesPatterns(path: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      const regex = new RegExp(
        '^' + pattern
          .replace(/\\/g, '\\\\')
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*') + '$'
      );
      if (regex.test(path)) return true;
    }
    return false;
  }
}
