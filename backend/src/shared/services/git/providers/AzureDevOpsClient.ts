/**
 * Azure DevOps Provider Client
 * Uses azure-devops-node-api for Azure DevOps interactions
 */

import * as azdev from 'azure-devops-node-api';
import * as GitInterfaces from 'azure-devops-node-api/interfaces/GitInterfaces.js';
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
import { logger } from '@shared/utils/logger.js';

export class AzureDevOpsClient implements GitProviderClient {
  readonly type = 'azure-devops' as const;
  private connection: azdev.WebApi | null = null;
  private organization: string;
  private token: string;

  constructor(credentials: ProviderCredentials) {
    if (!credentials.organization) {
      throw new Error('Azure DevOps requires organization in credentials');
    }
    this.organization = credentials.organization;
    this.token = credentials.token;
  }

  private async getConnection(): Promise<azdev.WebApi> {
    if (!this.connection) {
      const orgUrl = `https://dev.azure.com/${this.organization}`;
      const authHandler = azdev.getPersonalAccessTokenHandler(this.token);
      this.connection = new azdev.WebApi(orgUrl, authHandler);
    }
    return this.connection;
  }

  private async getGitApi() {
    const connection = await this.getConnection();
    return connection.getGitApi();
  }

  async validateCredentials(): Promise<boolean> {
    try {
      const connection = await this.getConnection();
      await connection.connect();
      return true;
    } catch (error) {
      logger.warn('Azure DevOps credentials validation failed', { error });
      return false;
    }
  }

  async getCurrentUser(): Promise<{ id: string; username: string; email?: string }> {
    const connection = await this.getConnection();
    const connData = await connection.connect();
    return {
      id: connData.authenticatedUser?.id || '',
      username: connData.authenticatedUser?.providerDisplayName || '',
      email: undefined,
    };
  }

  async getNamespaces(): Promise<Namespace[]> {
    const namespaces: Namespace[] = [];
    
    // For Azure DevOps, the namespace is the organization + projects
    // The organization is already set in the constructor
    try {
      const connection = await this.getConnection();
      const coreApi = await connection.getCoreApi();
      const projects = await coreApi.getProjects();
      
      for (const project of projects) {
        namespaces.push({
          name: project.name || '',
          type: 'organization',
        });
      }
    } catch (error) {
      logger.warn('Failed to fetch Azure DevOps projects', { error });
    }
    
    return namespaces;
  }

  async createRepository(options: CreateRepoOptions): Promise<RepoInfo> {
    const gitApi = await this.getGitApi();
    const project = options.organization || this.organization;
    
    const repoToCreate: GitInterfaces.GitRepositoryCreateOptions = {
      name: options.name,
    };
    
    const repo = await gitApi.createRepository(repoToCreate, project);
    
    // Initialize with README if requested
    if (options.autoInit && repo.id) {
      try {
        const push: GitInterfaces.GitPush = {
          refUpdates: [{
            name: 'refs/heads/main',
            oldObjectId: '0000000000000000000000000000000000000000',
          }],
          commits: [{
            comment: 'Initial commit',
            changes: [{
              changeType: GitInterfaces.VersionControlChangeType.Add,
              item: { path: '/README.md' },
              newContent: {
                content: `# ${options.name}\n\n${options.description || ''}`,
                contentType: GitInterfaces.ItemContentType.RawText,
              },
            }],
          }],
        };
        await gitApi.createPush(push, repo.id, project);
      } catch (error) {
        logger.warn('Failed to initialize repository with README', { error });
      }
    }
    
    return this.mapRepo(repo, project);
  }

  async getRepository(repo: string): Promise<RepoInfo | null> {
    try {
      const gitApi = await this.getGitApi();
      const [project, repoName] = this.parseRepo(repo);
      const repository = await gitApi.getRepository(repoName, project);
      return repository ? this.mapRepo(repository, project) : null;
    } catch (error: any) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  }

  async listRepositories(options?: { org?: string; limit?: number }): Promise<RepoInfo[]> {
    const gitApi = await this.getGitApi();
    const project = options?.org;
    
    const repos = await gitApi.getRepositories(project);
    const limited = repos.slice(0, options?.limit ?? 100);
    
    return limited.map(r => this.mapRepo(r, project || this.organization));
  }

  async deleteRepository(repo: string): Promise<void> {
    const gitApi = await this.getGitApi();
    const [project, repoName] = this.parseRepo(repo);
    const repository = await gitApi.getRepository(repoName, project);
    if (repository?.id) {
      await gitApi.deleteRepository(repository.id, project);
    }
  }

  async getBranches(repo: string): Promise<BranchInfo[]> {
    const gitApi = await this.getGitApi();
    const [project, repoName] = this.parseRepo(repo);
    
    const repository = await gitApi.getRepository(repoName, project);
    if (!repository?.id) throw new Error('Repository not found');
    
    const branches = await gitApi.getBranches(repository.id, project);
    const defaultBranch = repository.defaultBranch?.replace('refs/heads/', '') || 'main';
    
    return branches.map(b => ({
      name: b.name || '',
      sha: b.commit?.commitId || '',
      isDefault: b.name === defaultBranch,
      protected: (b as any).isLocked || false,
    }));
  }

  async createBranch(repo: string, branchName: string, fromBranch?: string): Promise<BranchInfo> {
    const gitApi = await this.getGitApi();
    const [project, repoName] = this.parseRepo(repo);
    
    const repository = await gitApi.getRepository(repoName, project);
    if (!repository?.id) throw new Error('Repository not found');
    
    // Get source branch SHA
    const sourceBranch = fromBranch || 'main';
    const branches = await gitApi.getBranches(repository.id, project);
    const source = branches.find(b => b.name === sourceBranch);
    if (!source?.commit?.commitId) throw new Error(`Source branch ${sourceBranch} not found`);
    
    // Create ref
    const refUpdate: GitInterfaces.GitRefUpdate = {
      name: `refs/heads/${branchName}`,
      oldObjectId: '0000000000000000000000000000000000000000',
      newObjectId: source.commit.commitId,
    };
    
    await gitApi.updateRefs([refUpdate], repository.id, project);
    
    return {
      name: branchName,
      sha: source.commit.commitId,
      isDefault: false,
      protected: false,
    };
  }

  async pushFiles(options: PushOptions): Promise<CommitInfo> {
    const gitApi = await this.getGitApi();
    const [project, repoName] = this.parseRepo(options.repo);
    
    const repository = await gitApi.getRepository(repoName, project);
    if (!repository?.id) throw new Error('Repository not found');
    
    // Get current branch SHA
    let oldObjectId: string;
    try {
      const refs = await gitApi.getRefs(repository.id, project, `heads/${options.branch}`);
      oldObjectId = refs[0]?.objectId || '0000000000000000000000000000000000000000';
    } catch {
      oldObjectId = '0000000000000000000000000000000000000000';
    }
    
    // Build changes
    const changes: GitInterfaces.GitChange[] = options.files.map(file => ({
      changeType: GitInterfaces.VersionControlChangeType.Edit,
      item: { path: file.path.startsWith('/') ? file.path : `/${file.path}` },
      newContent: {
        content: file.content,
        contentType: GitInterfaces.ItemContentType.RawText,
      },
    }));
    
    // Create push
    const push: GitInterfaces.GitPush = {
      refUpdates: [{
        name: `refs/heads/${options.branch}`,
        oldObjectId,
      }],
      commits: [{
        comment: options.message,
        changes,
      }],
    };
    
    const result = await gitApi.createPush(push, repository.id, project);
    const commit = result.commits?.[0];
    
    return {
      sha: commit?.commitId || '',
      message: options.message,
      author: commit?.author?.name || 'unknown',
      date: commit?.author?.date ? new Date(commit.author.date) : new Date(),
    };
  }

  async pullFiles(options: PullOptions): Promise<PullResult> {
    const gitApi = await this.getGitApi();
    const [project, repoName] = this.parseRepo(options.repo);
    
    const repository = await gitApi.getRepository(repoName, project);
    if (!repository?.id) throw new Error('Repository not found');
    
    // Get items recursively
    const versionDescriptor: GitInterfaces.GitVersionDescriptor = {
      version: options.branch,
      versionType: GitInterfaces.GitVersionType.Branch
    };
    const items = await gitApi.getItems(
      repository.id,
      project,
      '/',
      GitInterfaces.VersionControlRecursionType.Full,
      true, // includeContentMetadata
      false, // includeContent - we'll fetch individually
      false, // includeLinks
      false, // latestProcessedChange
      versionDescriptor
    );
    
    const files: FileEntry[] = [];
    
    for (const item of items) {
      if (item.gitObjectType !== GitInterfaces.GitObjectType.Blob) continue;
      if (!item.path) continue;
      
      // Apply pattern filtering
      if (options.patterns && !this.matchesPatterns(item.path, options.patterns)) {
        continue;
      }
      
      // Fetch file content
      const content = await this.getFile(options.repo, options.branch, item.path);
      if (content) {
        files.push(content);
      }
    }
    
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
      const gitApi = await this.getGitApi();
      const [project, repoName] = this.parseRepo(repo);
      
      const repository = await gitApi.getRepository(repoName, project);
      if (!repository?.id) return null;
      
      const item = await gitApi.getItemContent(
        repository.id,
        path,
        project,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { version: branch, versionType: GitInterfaces.GitVersionType.Branch }
      );
      
      // Convert stream to string
      const chunks: Buffer[] = [];
      for await (const chunk of item) {
        chunks.push(Buffer.from(chunk));
      }
      const content = Buffer.concat(chunks).toString('utf-8');
      
      return {
        path,
        content,
        encoding: 'utf-8',
      };
    } catch (error: any) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  }

  async getTree(repo: string, branch: string): Promise<TreeEntry[]> {
    const gitApi = await this.getGitApi();
    const [project, repoName] = this.parseRepo(repo);
    
    const repository = await gitApi.getRepository(repoName, project);
    if (!repository?.id) throw new Error('Repository not found');
    
    const versionDescriptor: GitInterfaces.GitVersionDescriptor = {
      version: branch,
      versionType: GitInterfaces.GitVersionType.Branch
    };
    
    const items = await gitApi.getItems(
      repository.id,
      project,
      '/',
      GitInterfaces.VersionControlRecursionType.Full,
      true,
      false,
      false,
      false,
      versionDescriptor
    );
    
    return items
      .filter(item => item.path)
      .map(item => ({
        path: item.path!,
        type: item.gitObjectType === GitInterfaces.GitObjectType.Blob ? 'blob' as const : 'tree' as const,
        sha: item.objectId,
      }));
  }

  async getCommits(repo: string, branch: string, limit = 50): Promise<CommitInfo[]> {
    const gitApi = await this.getGitApi();
    const [project, repoName] = this.parseRepo(repo);
    
    const repository = await gitApi.getRepository(repoName, project);
    if (!repository?.id) throw new Error('Repository not found');
    
    const searchCriteria: GitInterfaces.GitQueryCommitsCriteria = {
      itemVersion: { version: branch, versionType: GitInterfaces.GitVersionType.Branch },
      $top: limit,
    };
    
    const commits = await gitApi.getCommits(repository.id, searchCriteria, project);
    
    return commits.map(c => ({
      sha: c.commitId || '',
      message: c.comment || '',
      author: c.author?.name || 'unknown',
      date: c.author?.date ? new Date(c.author.date) : new Date(),
    }));
  }

  // Helper methods
  private parseRepo(repo: string): [string, string] {
    // Format: project/repo or just repo (uses default project)
    const parts = repo
      .replace(/\.git$/, '')
      .replace(/^https?:\/\/[^/]+\/[^/]+\//, '') // Remove org URL
      .split('/');
    
    if (parts.length >= 2) {
      return [parts[0], parts[1]];
    }
    return [this.organization, parts[0]];
  }

  private mapRepo(repo: GitInterfaces.GitRepository, project: string): RepoInfo {
    return {
      id: repo.id || '',
      name: repo.name || '',
      fullName: `${project}/${repo.name}`,
      cloneUrl: repo.remoteUrl || '',
      htmlUrl: repo.webUrl || '',
      defaultBranch: repo.defaultBranch?.replace('refs/heads/', '') || 'main',
      private: true, // Azure DevOps repos are private by default
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
