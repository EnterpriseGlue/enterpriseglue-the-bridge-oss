/**
 * Git API client
 * Handles all Git versioning API calls
 */

import type {
  Repository,
  GitProvider,
  Deployment,
  Commit,
  FileLock,
  InitRepositoryRequest,
  CloneRepositoryRequest,
  DeployRequest,
  RollbackRequest,
  AcquireLockRequest,
  DeploymentResponse,
  LockResponse,
  LockHolder,
} from '../types/git';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';

// Use relative path - proxied to backend in dev, same origin in production
const API_BASE = '/git-api';

class GitApi {
  private async fetch<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const method = String(options?.method || 'GET').toUpperCase();
    const { method: _method, body, ...rest } = options || {};
    const headers = options?.headers;
    const baseOptions = { ...rest, headers, credentials: 'include' as const };
    const payload = typeof body === 'string' ? (() => {
      try {
        return JSON.parse(body as string);
      } catch {
        return body;
      }
    })() : body;

    try {
      switch (method) {
        case 'POST':
          return await apiClient.post<T>(`${API_BASE}${endpoint}`, payload, baseOptions);
        case 'PUT':
          return await apiClient.put<T>(`${API_BASE}${endpoint}`, payload, baseOptions);
        case 'PATCH':
          return await apiClient.patch<T>(`${API_BASE}${endpoint}`, payload, baseOptions);
        case 'DELETE':
          return await apiClient.delete<T>(`${API_BASE}${endpoint}`, baseOptions);
        default:
          return await apiClient.get<T>(`${API_BASE}${endpoint}`, undefined, baseOptions);
      }
    } catch (error) {
      const parsed = parseApiError(error, 'Request failed');
      const combined = parsed.hint ? `${parsed.message}. ${parsed.hint}` : parsed.message;
      throw new Error(combined || 'Request failed');
    }
  }

  // Providers
  async getProviders(): Promise<GitProvider[]> {
    return this.fetch<GitProvider[]>('/providers');
  }

  // Repositories
  async getRepositories(): Promise<Repository[]> {
    return this.fetch<Repository[]>('/repositories');
  }

  async getRepository(id: string): Promise<Repository> {
    return this.fetch<Repository>(`/repositories/${id}`);
  }

  async initRepository(data: InitRepositoryRequest): Promise<Repository> {
    return this.fetch<Repository>('/repositories/init', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async cloneRepository(data: CloneRepositoryRequest): Promise<Repository> {
    return this.fetch<Repository>('/repositories/clone', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // List repos from provider (for "connect to existing" flow)
  async listProviderRepos(providerId: string): Promise<{
    name: string;
    fullName: string;
    url: string;
    isPrivate: boolean;
  }[]> {
    return this.fetch(`/providers/${providerId}/repos`);
  }

  // New clone flow
  async getRepoInfo(providerId: string, repoUrl: string): Promise<{
    name: string;
    fullName: string;
    defaultBranch: string;
    branches: { name: string; isDefault: boolean }[];
  }> {
    return this.fetch('/repo-info', {
      method: 'POST',
      body: JSON.stringify({ providerId, repoUrl }),
    });
  }

  async cloneFromGit(data: {
    providerId: string;
    repoUrl: string;
    branch?: string;
    projectName?: string;
    conflictStrategy?: 'preferRemote' | 'preferLocal';
  }): Promise<{
    projectId: string;
    projectName: string;
    filesImported: number;
    foldersCreated: number;
    repositoryId: string;
  }> {
    return this.fetch('/clone', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteRepository(id: string): Promise<void> {
    await this.fetch<void>(`/repositories/${id}`, {
      method: 'DELETE',
    });
  }

  async getRepositoryByProject(projectId: string): Promise<Repository | null> {
    try {
      const repos = await this.fetch<Repository[]>(`/repositories?projectId=${projectId}`);
      return repos.length > 0 ? repos[0] : null;
    } catch {
      return null;
    }
  }

  async disconnectFromGit(projectId: string): Promise<void> {
    const repo = await this.getRepositoryByProject(projectId);
    if (repo) {
      await this.deleteRepository(repo.id);
    }
  }

  // Deployments
  async deploy(data: DeployRequest): Promise<DeploymentResponse> {
    return this.fetch<DeploymentResponse>('/deploy', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getDeployments(projectId: string): Promise<Deployment[]> {
    return this.fetch<Deployment[]>(`/deployments?projectId=${projectId}`);
  }

  async getDeployment(id: string): Promise<Deployment> {
    return this.fetch<Deployment>(`/deployments/${id}`);
  }

  async rollback(data: RollbackRequest): Promise<{ success: boolean; message: string }> {
    return this.fetch('/rollback', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Commits
  async getCommits(projectId: string, limit = 100): Promise<{ all: Commit[] }> {
    return this.fetch(`/commits?projectId=${projectId}&limit=${limit}`);
  }

  // File Locks
  async acquireLock(data: AcquireLockRequest): Promise<LockResponse> {
    return this.fetch<LockResponse>('/locks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async releaseLock(lockId: string): Promise<void> {
    await this.fetch<void>(`/locks/${lockId}`, {
      method: 'DELETE',
    });
  }

  async getLocks(projectId: string): Promise<{ locks: LockResponse[] }> {
    return this.fetch(`/locks?projectId=${projectId}`);
  }

  async sendHeartbeat(lockId: string): Promise<{ success: boolean }> {
    return this.fetch(`/locks/${lockId}/heartbeat`, {
      method: 'PUT',
    });
  }
}

export const gitApi = new GitApi();
