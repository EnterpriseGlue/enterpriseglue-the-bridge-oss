/**
 * GitLab Provider Client
 * Uses Gitbeaker for GitLab API interactions
 */

import { Gitlab } from '@gitbeaker/rest';
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

export class GitLabClient implements GitProviderClient {
  readonly type = 'gitlab' as const;
  private gitlab: InstanceType<typeof Gitlab>;
  private host: string;

  constructor(credentials: ProviderCredentials, host = 'https://gitlab.com') {
    this.host = host;
    this.gitlab = new Gitlab({
      token: credentials.token,
      host,
    });
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.gitlab.Users.showCurrentUser();
      return true;
    } catch (error) {
      logger.warn('GitLab credentials validation failed', { error });
      return false;
    }
  }

  async getCurrentUser(): Promise<{ id: string; username: string; email?: string }> {
    const user = await this.gitlab.Users.showCurrentUser();
    return {
      id: String(user.id),
      username: user.username,
      email: user.email || undefined,
    };
  }

  async getNamespaces(): Promise<Namespace[]> {
    const namespaces: Namespace[] = [];
    
    // Get current user
    const user = await this.gitlab.Users.showCurrentUser();
    namespaces.push({
      name: user.username,
      type: 'user',
      avatarUrl: String(user.avatar_url || ''),
    });
    
    // Get groups the user belongs to
    try {
      const groups = await this.gitlab.Groups.all({ minAccessLevel: 30 }); // Developer access or higher
      for (const group of groups) {
        namespaces.push({
          name: String(group.path),
          type: 'organization',
          avatarUrl: group.avatar_url ? String(group.avatar_url) : undefined,
        });
      }
    } catch (error) {
      logger.warn('Failed to fetch GitLab groups', { error });
    }
    
    return namespaces;
  }

  async createRepository(options: CreateRepoOptions): Promise<RepoInfo> {
    const createOptions: any = {
      name: options.name,
      description: options.description,
      visibility: options.private ? 'private' : 'public',
      initialize_with_readme: options.autoInit ?? true,
    };

    if (options.organization) {
      // Find group ID
      const groups = await this.gitlab.Groups.search(options.organization);
      const group = groups.find((g: any) => g.path === options.organization || g.full_path === options.organization);
      if (group) {
        createOptions.namespace_id = group.id;
      }
    }

    const project = await this.gitlab.Projects.create(createOptions);
    return this.mapProject(project);
  }

  async getRepository(repo: string): Promise<RepoInfo | null> {
    try {
      const projectPath = this.normalizeProjectPath(repo);
      const project = await this.gitlab.Projects.show(projectPath);
      return this.mapProject(project);
    } catch (error: any) {
      if (error.cause?.response?.status === 404) return null;
      throw error;
    }
  }

  async listRepositories(options?: { org?: string; limit?: number }): Promise<RepoInfo[]> {
    const limit = options?.limit ?? 100;
    
    let projects: any[];
    if (options?.org) {
      projects = await this.gitlab.Groups.allProjects(options.org, {
        perPage: limit,
      } as any);
    } else {
      projects = await this.gitlab.Projects.all({
        membership: true,
        perPage: limit,
      } as any);
    }
    
    return projects.map((p: any) => this.mapProject(p));
  }

  async deleteRepository(repo: string): Promise<void> {
    const projectPath = this.normalizeProjectPath(repo);
    await this.gitlab.Projects.remove(projectPath);
  }

  async getBranches(repo: string): Promise<BranchInfo[]> {
    const projectPath = this.normalizeProjectPath(repo);
    const branches = await this.gitlab.Branches.all(projectPath);
    
    return branches.map((b: any) => ({
      name: b.name,
      sha: b.commit?.id || '',
      isDefault: b.default || false,
      protected: b.protected || false,
    }));
  }

  async createBranch(repo: string, branchName: string, fromBranch?: string): Promise<BranchInfo> {
    const projectPath = this.normalizeProjectPath(repo);
    const sourceBranch = fromBranch || 'main';
    
    const branch = await this.gitlab.Branches.create(projectPath, branchName, sourceBranch);
    
    return {
      name: branch.name,
      sha: branch.commit?.id || '',
      isDefault: false,
      protected: branch.protected || false,
    };
  }

  async pushFiles(options: PushOptions): Promise<CommitInfo> {
    const projectPath = this.normalizeProjectPath(options.repo);
    
    // Build commit actions
    const actions = await Promise.all(
      options.files.map(async (file) => {
        // Check if file exists to determine action type
        let action: 'create' | 'update' = 'create';
        try {
          await this.gitlab.RepositoryFiles.show(projectPath, file.path, options.branch);
          action = 'update';
        } catch {
          action = 'create';
        }
        
        return {
          action,
          filePath: file.path,
          content: file.content,
        };
      })
    );
    
    // Create branch if needed
    if (options.createBranch) {
      try {
        await this.gitlab.Branches.show(projectPath, options.branch);
      } catch {
        // Branch doesn't exist, create it
        const project = await this.gitlab.Projects.show(projectPath);
        await this.gitlab.Branches.create(projectPath, options.branch, String((project as any).default_branch || 'main'));
      }
    }
    
    const commit = await this.gitlab.Commits.create(projectPath, options.branch, options.message, actions);
    
    return {
      sha: String((commit as any).id || ''),
      message: String((commit as any).message || ''),
      author: String((commit as any).author_name || 'unknown'),
      date: new Date(String((commit as any).created_at || Date.now())),
    };
  }

  async pullFiles(options: PullOptions): Promise<PullResult> {
    const projectPath = this.normalizeProjectPath(options.repo);
    
    // Get repository tree
    const tree = await this.gitlab.Repositories.allRepositoryTrees(projectPath, {
      ref: options.branch,
      recursive: true,
    });
    
    // Filter blobs
    const blobs = tree.filter((item: any) => item.type === 'blob');
    
    // Apply pattern filtering if provided
    const filteredBlobs = options.patterns
      ? blobs.filter((b: any) => this.matchesPatterns(b.path, options.patterns!))
      : blobs;
    
    // Fetch file contents
    const files: FileEntry[] = [];
    for (const blob of filteredBlobs) {
      try {
        const file = await this.gitlab.RepositoryFiles.show(projectPath, String(blob.path), options.branch);
        files.push({
          path: String(blob.path),
          content: Buffer.from(String(file.content), 'base64').toString('utf-8'),
          encoding: 'utf-8',
        });
      } catch (error) {
        logger.warn('Failed to fetch file', { path: blob.path, error });
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
      const projectPath = this.normalizeProjectPath(repo);
      const file = await this.gitlab.RepositoryFiles.show(projectPath, path, branch);
      
      return {
        path,
        content: Buffer.from(file.content, 'base64').toString('utf-8'),
        encoding: 'utf-8',
      };
    } catch (error: any) {
      if (error.cause?.response?.status === 404) return null;
      throw error;
    }
  }

  async getTree(repo: string, branch: string): Promise<TreeEntry[]> {
    const projectPath = this.normalizeProjectPath(repo);
    
    const tree = await this.gitlab.Repositories.allRepositoryTrees(projectPath, {
      ref: branch,
      recursive: true,
    });
    
    return tree.map((item: any) => ({
      path: String(item.path),
      type: item.type === 'blob' ? 'blob' as const : 'tree' as const,
      sha: item.id,
    }));
  }

  async getCommits(repo: string, branch: string, limit = 50): Promise<CommitInfo[]> {
    const projectPath = this.normalizeProjectPath(repo);
    const commits = await this.gitlab.Commits.all(projectPath, {
      refName: branch,
      perPage: limit,
    });
    
    return commits.map((c: any) => ({
      sha: c.id,
      message: c.message,
      author: c.author_name || 'unknown',
      date: new Date(c.created_at),
    }));
  }

  async createTag(repo: string, tagName: string, commitSha: string, message?: string): Promise<{ name: string; sha: string }> {
    const projectPath = this.normalizeProjectPath(repo);
    const tag = await (this.gitlab as any).Tags.create(projectPath, tagName, commitSha, { message });
    return { name: tag.name, sha: tag.commit?.id || commitSha };
  }

  // Helper methods
  private normalizeProjectPath(repo: string): string {
    // Remove .git suffix and URL parts
    return repo
      .replace(/\.git$/, '')
      .replace(/^https?:\/\/[^/]+\//, '')
      .replace(/^git@[^:]+:/, '');
  }

  private mapProject(project: any): RepoInfo {
    return {
      id: String(project.id),
      name: project.name,
      fullName: project.path_with_namespace,
      cloneUrl: project.http_url_to_repo,
      htmlUrl: project.web_url,
      defaultBranch: project.default_branch || 'main',
      private: project.visibility === 'private',
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
