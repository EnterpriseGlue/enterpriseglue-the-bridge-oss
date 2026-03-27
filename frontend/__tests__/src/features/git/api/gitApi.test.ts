import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gitApi } from '@src/features/git/api/gitApi';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@src/shared/api/apiErrorUtils', () => ({
  parseApiError: vi.fn((error, message) => ({
    message: error?.message || message,
    hint: error?.hint,
  })),
}));

describe('gitApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('providers', () => {
    it('gets git providers', async () => {
      const mockProviders = [{ id: 'p1', name: 'GitHub', type: 'github' }];
      vi.mocked(apiClient.get).mockResolvedValue(mockProviders);
      
      const result = await gitApi.getProviders();
      
      expect(apiClient.get).toHaveBeenCalledWith('/git-api/providers', undefined, { credentials: 'include' });
      expect(result).toEqual(mockProviders);
    });
  });

  describe('repositories', () => {
    it('gets all repositories', async () => {
      const mockRepos = [{ id: 'r1', name: 'repo1', projectId: 'p1' }];
      vi.mocked(apiClient.get).mockResolvedValue(mockRepos);
      
      const result = await gitApi.getRepositories();
      
      expect(apiClient.get).toHaveBeenCalledWith('/git-api/repositories', undefined, { credentials: 'include' });
      expect(result).toEqual(mockRepos);
    });

    it('gets repository by id', async () => {
      const mockRepo = { id: 'r1', name: 'repo1', projectId: 'p1' };
      vi.mocked(apiClient.get).mockResolvedValue(mockRepo);
      
      const result = await gitApi.getRepository('r1');
      
      expect(apiClient.get).toHaveBeenCalledWith('/git-api/repositories/r1', undefined, { credentials: 'include' });
      expect(result).toEqual(mockRepo);
    });

    it('initializes a new repository', async () => {
      const mockRepo = { id: 'r1', name: 'new-repo', projectId: 'p1' };
      const initData = { projectId: 'p1', providerId: 'prov1', remoteUrl: 'https://github.com/test/repo' };
      vi.mocked(apiClient.post).mockResolvedValue(mockRepo);
      
      const result = await gitApi.initRepository(initData);
      
      expect(apiClient.post).toHaveBeenCalledWith('/git-api/repositories/init', initData, { credentials: 'include' });
      expect(result).toEqual(mockRepo);
    });

    it('clones a repository', async () => {
      const mockRepo = { id: 'r1', name: 'cloned-repo', projectId: 'p1' };
      const cloneData = { projectId: 'p1', providerId: 'prov1', remoteUrl: 'https://github.com/test/repo' };
      vi.mocked(apiClient.post).mockResolvedValue(mockRepo);
      
      const result = await gitApi.cloneRepository(cloneData);
      
      expect(apiClient.post).toHaveBeenCalledWith('/git-api/repositories/clone', cloneData, { credentials: 'include' });
      expect(result).toEqual(mockRepo);
    });

    it('deletes a repository', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue(undefined);
      
      await gitApi.deleteRepository('r1');
      
      expect(apiClient.delete).toHaveBeenCalledWith('/git-api/repositories/r1', { credentials: 'include' });
    });

    it('gets repository by project id', async () => {
      const mockRepos = [{ id: 'r1', name: 'repo1', projectId: 'p1' }];
      vi.mocked(apiClient.get).mockResolvedValue(mockRepos);
      
      const result = await gitApi.getRepositoryByProject('p1');
      
      expect(apiClient.get).toHaveBeenCalledWith('/git-api/repositories?projectId=p1', undefined, { credentials: 'include' });
      expect(result).toEqual(mockRepos[0]);
    });

    it('returns null when no repository found for project', async () => {
      vi.mocked(apiClient.get).mockResolvedValue([]);
      
      const result = await gitApi.getRepositoryByProject('p1');
      
      expect(result).toBeNull();
    });

    it('returns null when error fetching repository by project', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Not found'));
      
      const result = await gitApi.getRepositoryByProject('p1');
      
      expect(result).toBeNull();
    });

    it('disconnects from git', async () => {
      const mockRepo = { id: 'r1', name: 'repo1', projectId: 'p1' };
      vi.mocked(apiClient.get).mockResolvedValue([mockRepo]);
      vi.mocked(apiClient.delete).mockResolvedValue(undefined);
      
      await gitApi.disconnectFromGit('p1');
      
      expect(apiClient.get).toHaveBeenCalledWith('/git-api/repositories?projectId=p1', undefined, { credentials: 'include' });
      expect(apiClient.delete).toHaveBeenCalledWith('/git-api/repositories/r1', { credentials: 'include' });
    });
  });

  describe('provider repos', () => {
    it('lists repos from provider', async () => {
      const mockRepos = [
        { name: 'repo1', fullName: 'org/repo1', url: 'https://github.com/org/repo1', isPrivate: false },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockRepos);
      
      const result = await gitApi.listProviderRepos('prov1');
      
      expect(apiClient.get).toHaveBeenCalledWith('/git-api/providers/prov1/repos', undefined, { credentials: 'include' });
      expect(result).toEqual(mockRepos);
    });

    it('gets repo info', async () => {
      const mockInfo = {
        name: 'repo1',
        fullName: 'org/repo1',
        defaultBranch: 'main',
        branches: [{ name: 'main', isDefault: true }],
      };
      vi.mocked(apiClient.post).mockResolvedValue(mockInfo);
      
      const result = await gitApi.getRepoInfo('prov1', 'https://github.com/org/repo1');
      
      expect(apiClient.post).toHaveBeenCalledWith(
        '/git-api/repo-info',
        { providerId: 'prov1', repoUrl: 'https://github.com/org/repo1' },
        { credentials: 'include' }
      );
      expect(result).toEqual(mockInfo);
    });

    it('clones from git', async () => {
      const mockResponse = {
        projectId: 'p1',
        projectName: 'My Project',
        filesImported: 10,
        foldersCreated: 2,
        repositoryId: 'r1',
      };
      const cloneData = {
        providerId: 'prov1',
        repoUrl: 'https://github.com/org/repo1',
        branch: 'main',
        projectName: 'My Project',
        conflictStrategy: 'preferRemote' as const,
      };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);
      
      const result = await gitApi.cloneFromGit(cloneData);
      
      expect(apiClient.post).toHaveBeenCalledWith('/git-api/clone', cloneData, { credentials: 'include' });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('deployments', () => {
    it('deploys changes', async () => {
      const mockResponse = { deploymentId: 'd1', success: true, message: 'Deployed' };
      const deployData = { projectId: 'p1', message: 'Deploy v1.0' };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);
      
      const result = await gitApi.deploy(deployData);
      
      expect(apiClient.post).toHaveBeenCalledWith('/git-api/deploy', deployData, { credentials: 'include' });
      expect(result).toEqual(mockResponse);
    });

    it('gets deployments for project', async () => {
      const mockDeployments = [{ id: 'd1', projectId: 'p1', status: 'success' }];
      vi.mocked(apiClient.get).mockResolvedValue(mockDeployments);
      
      const result = await gitApi.getDeployments('p1');
      
      expect(apiClient.get).toHaveBeenCalledWith('/git-api/deployments?projectId=p1', undefined, { credentials: 'include' });
      expect(result).toEqual(mockDeployments);
    });

    it('gets deployment by id', async () => {
      const mockDeployment = { id: 'd1', projectId: 'p1', status: 'success' };
      vi.mocked(apiClient.get).mockResolvedValue(mockDeployment);
      
      const result = await gitApi.getDeployment('d1');
      
      expect(apiClient.get).toHaveBeenCalledWith('/git-api/deployments/d1', undefined, { credentials: 'include' });
      expect(result).toEqual(mockDeployment);
    });

    it('rolls back deployment', async () => {
      const mockResponse = { success: true, message: 'Rolled back' };
      const rollbackData = { projectId: 'p1', deploymentId: 'd1', commitSha: 'abc123' };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);
      
      const result = await gitApi.rollback(rollbackData);
      
      expect(apiClient.post).toHaveBeenCalledWith('/git-api/rollback', rollbackData, { credentials: 'include' });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('commits', () => {
    it('gets commits with default limit', async () => {
      const mockCommits = { all: [{ id: 'c1', message: 'Initial commit' }] };
      vi.mocked(apiClient.get).mockResolvedValue(mockCommits);
      
      const result = await gitApi.getCommits('p1');
      
      expect(apiClient.get).toHaveBeenCalledWith('/git-api/commits?projectId=p1&limit=100', undefined, { credentials: 'include' });
      expect(result).toEqual(mockCommits);
    });

    it('gets commits with custom limit', async () => {
      const mockCommits = { all: [{ id: 'c1', message: 'Initial commit' }] };
      vi.mocked(apiClient.get).mockResolvedValue(mockCommits);
      
      const result = await gitApi.getCommits('p1', 50);
      
      expect(apiClient.get).toHaveBeenCalledWith('/git-api/commits?projectId=p1&limit=50', undefined, { credentials: 'include' });
      expect(result).toEqual(mockCommits);
    });
  });

  describe('file locks', () => {
    it('acquires a lock', async () => {
      const mockLock = { id: 'l1', fileId: 'f1', holder: { userId: 'u1', userName: 'User' } };
      const lockData = { fileId: 'f1', force: true, visibilityState: 'visible' as const, hasInteraction: true };
      vi.mocked(apiClient.post).mockResolvedValue(mockLock);
      
      const result = await gitApi.acquireLock(lockData);
      
      expect(apiClient.post).toHaveBeenCalledWith('/git-api/locks', lockData, { credentials: 'include' });
      expect(result).toEqual(mockLock);
    });

    it('releases a lock', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue(undefined);
      
      await gitApi.releaseLock('l1');
      
      expect(apiClient.delete).toHaveBeenCalledWith('/git-api/locks/l1', { credentials: 'include' });
    });

    it('gets locks for project', async () => {
      const mockLocks = { locks: [{ id: 'l1', fileId: 'f1' }] };
      vi.mocked(apiClient.get).mockResolvedValue(mockLocks);
      
      const result = await gitApi.getLocks('p1');
      
      expect(apiClient.get).toHaveBeenCalledWith('/git-api/locks?projectId=p1', undefined, { credentials: 'include' });
      expect(result).toEqual(mockLocks);
    });

    it('sends heartbeat for lock', async () => {
      const heartbeat = { visibilityState: 'hidden' as const, hasInteraction: true };
      const mockResponse = { success: true };
      vi.mocked(apiClient.put).mockResolvedValue(mockResponse);
      
      const result = await gitApi.sendHeartbeat('l1', heartbeat);
      
      expect(apiClient.put).toHaveBeenCalledWith('/git-api/locks/l1/heartbeat', heartbeat, { credentials: 'include' });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('error handling', () => {
    it('handles API errors with hint', async () => {
      const error = { message: 'Failed', hint: 'Try again' };
      vi.mocked(apiClient.get).mockRejectedValue(error);
      
      await expect(gitApi.getProviders()).rejects.toThrow('Failed. Try again');
    });

    it('handles API errors without hint', async () => {
      const error = { message: 'Failed' };
      vi.mocked(apiClient.get).mockRejectedValue(error);
      
      await expect(gitApi.getProviders()).rejects.toThrow('Failed');
    });

    it('handles errors with no message', async () => {
      vi.mocked(apiClient.get).mockRejectedValue({});
      
      await expect(gitApi.getProviders()).rejects.toThrow('Request failed');
    });
  });
});
