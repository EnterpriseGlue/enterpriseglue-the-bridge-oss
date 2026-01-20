/**
 * GitHub Provider Client
 * Uses Octokit for GitHub API interactions
 */

import { Octokit } from 'octokit';
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

export class GitHubClient implements GitProviderClient {
  readonly type = 'github' as const;
  private octokit: Octokit;

  constructor(credentials: ProviderCredentials) {
    this.octokit = new Octokit({ auth: credentials.token });
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.octokit.rest.users.getAuthenticated();
      return true;
    } catch (error) {
      logger.warn('GitHub credentials validation failed', { error });
      return false;
    }
  }

  async getCurrentUser(): Promise<{ id: string; username: string; email?: string }> {
    const { data } = await this.octokit.rest.users.getAuthenticated();
    return {
      id: String(data.id),
      username: data.login,
      email: data.email || undefined,
    };
  }

  async getNamespaces(): Promise<Namespace[]> {
    const namespaces: Namespace[] = [];
    
    // Get current user (personal namespace)
    const { data: user } = await this.octokit.rest.users.getAuthenticated();
    namespaces.push({
      name: user.login,
      type: 'user',
      avatarUrl: user.avatar_url,
    });
    
    // Get organizations the user belongs to
    try {
      const { data: orgs } = await this.octokit.rest.orgs.listForAuthenticatedUser();
      for (const org of orgs) {
        namespaces.push({
          name: org.login,
          type: 'organization',
          avatarUrl: org.avatar_url,
        });
      }
    } catch (error) {
      logger.warn('Failed to fetch organizations', { error });
    }
    
    return namespaces;
  }

  async createRepository(options: CreateRepoOptions): Promise<RepoInfo> {
    let data;
    
    // Check if organization is actually an organization (not the user's personal account)
    let isOrg = false;
    if (options.organization) {
      const currentUser = await this.getCurrentUser();
      // If the namespace matches the current user's username, use personal account endpoint
      if (options.organization.toLowerCase() !== currentUser.username.toLowerCase()) {
        isOrg = true;
      }
    }
    
    if (isOrg && options.organization) {
      const response = await this.octokit.rest.repos.createInOrg({
        org: options.organization,
        name: options.name,
        description: options.description,
        private: options.private ?? true,
        auto_init: options.autoInit ?? true,
      });
      data = response.data;
    } else {
      const response = await this.octokit.rest.repos.createForAuthenticatedUser({
        name: options.name,
        description: options.description,
        private: options.private ?? true,
        auto_init: options.autoInit ?? true,
      });
      data = response.data;
    }

    return this.mapRepo(data);
  }

  async getRepository(repo: string): Promise<RepoInfo | null> {
    try {
      const [owner, name] = this.parseRepo(repo);
      const { data } = await this.octokit.rest.repos.get({ owner, repo: name });
      return this.mapRepo(data);
    } catch (error: any) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async listRepositories(options?: { org?: string; limit?: number }): Promise<RepoInfo[]> {
    const limit = options?.limit ?? 100;
    
    if (options?.org) {
      const { data } = await this.octokit.rest.repos.listForOrg({
        org: options.org,
        per_page: limit,
        sort: 'updated',
      });
      return data.map(r => this.mapRepo(r));
    }
    
    const { data } = await this.octokit.rest.repos.listForAuthenticatedUser({
      per_page: limit,
      sort: 'updated',
    });
    return data.map(r => this.mapRepo(r));
  }

  async deleteRepository(repo: string): Promise<void> {
    const [owner, name] = this.parseRepo(repo);
    await this.octokit.rest.repos.delete({ owner, repo: name });
  }

  async getBranches(repo: string): Promise<BranchInfo[]> {
    const [owner, name] = this.parseRepo(repo);
    const { data: branches } = await this.octokit.rest.repos.listBranches({
      owner,
      repo: name,
      per_page: 100,
    });
    
    const { data: repoData } = await this.octokit.rest.repos.get({ owner, repo: name });
    const defaultBranch = repoData.default_branch;
    
    return branches.map(b => ({
      name: b.name,
      sha: b.commit.sha,
      isDefault: b.name === defaultBranch,
      protected: b.protected,
    }));
  }

  async createBranch(repo: string, branchName: string, fromBranch?: string): Promise<BranchInfo> {
    const [owner, name] = this.parseRepo(repo);
    
    // Get the SHA of the source branch
    const sourceBranch = fromBranch || 'main';
    const { data: ref } = await this.octokit.rest.git.getRef({
      owner,
      repo: name,
      ref: `heads/${sourceBranch}`,
    });
    
    // Create new branch
    await this.octokit.rest.git.createRef({
      owner,
      repo: name,
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha,
    });
    
    return {
      name: branchName,
      sha: ref.object.sha,
      isDefault: false,
      protected: false,
    };
  }

  async pushFiles(options: PushOptions): Promise<CommitInfo> {
    const [owner, repo] = this.parseRepo(options.repo);
    
    // Get the current commit SHA
    let baseSha: string;
    try {
      const { data: ref } = await this.octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${options.branch}`,
      });
      baseSha = ref.object.sha;
    } catch (error: any) {
      if (error.status === 404 && options.createBranch) {
        // Create branch from default branch
        const { data: repoData } = await this.octokit.rest.repos.get({ owner, repo });
        const { data: defaultRef } = await this.octokit.rest.git.getRef({
          owner,
          repo,
          ref: `heads/${repoData.default_branch}`,
        });
        baseSha = defaultRef.object.sha;
        
        await this.octokit.rest.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${options.branch}`,
          sha: baseSha,
        });
      } else {
        throw error;
      }
    }
    
    // Get the base tree
    const { data: baseCommit } = await this.octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: baseSha,
    });
    
    // Create blobs for each file
    const fileEntries = await Promise.all(
      options.files.map(async (file) => {
        const { data: blob } = await this.octokit.rest.git.createBlob({
          owner,
          repo,
          content: file.encoding === 'base64' ? file.content : Buffer.from(file.content).toString('base64'),
          encoding: 'base64',
        });
        return {
          path: file.path,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: blob.sha,
        };
      })
    );

    // Add deletion entries (sha: null tells GitHub to delete the file)
    const deletionEntries = (options.deletions || []).map(path => ({
      path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: null,
    }));

    // Combine file updates and deletions
    const tree = [...fileEntries, ...deletionEntries];
    
    // Create tree
    const { data: newTree } = await this.octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: baseCommit.tree.sha,
      tree: tree as any, // sha can be null for deletions
    });
    
    // Create commit
    const { data: newCommit } = await this.octokit.rest.git.createCommit({
      owner,
      repo,
      message: options.message,
      tree: newTree.sha,
      parents: [baseSha],
    });
    
    // Update branch reference
    await this.octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${options.branch}`,
      sha: newCommit.sha,
    });
    
    return {
      sha: newCommit.sha,
      message: newCommit.message,
      author: newCommit.author?.name || 'unknown',
      date: new Date(newCommit.author?.date || Date.now()),
    };
  }

  async pullFiles(options: PullOptions): Promise<PullResult> {
    const [owner, repo] = this.parseRepo(options.repo);
    
    logger.info('Pulling files from GitHub', { owner, repo, branch: options.branch, patterns: options.patterns });
    
    // Get tree recursively
    const { data: ref } = await this.octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${options.branch}`,
    });
    
    logger.info('Got ref', { sha: ref.object.sha });
    
    const { data: commit } = await this.octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: ref.object.sha,
    });
    
    const { data: tree } = await this.octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: commit.tree.sha,
      recursive: 'true',
    });
    
    // Filter and fetch files
    const files: FileEntry[] = [];
    const blobs = tree.tree.filter(item => item.type === 'blob');
    
    logger.info('Found blobs in tree', { 
      blobCount: blobs.length, 
      blobPaths: blobs.map(b => b.path) 
    });
    
    // Apply pattern filtering if provided
    const filteredBlobs = options.patterns
      ? blobs.filter(b => this.matchesPatterns(b.path!, options.patterns!))
      : blobs;
    
    logger.info('After pattern filtering', { 
      filteredCount: filteredBlobs.length, 
      filteredPaths: filteredBlobs.map(b => b.path) 
    });
    
    for (const blob of filteredBlobs) {
      if (!blob.sha || !blob.path) continue;
      
      const { data } = await this.octokit.rest.git.getBlob({
        owner,
        repo,
        file_sha: blob.sha,
      });
      
      files.push({
        path: blob.path,
        content: Buffer.from(data.content, 'base64').toString('utf-8'),
        encoding: 'utf-8',
      });
    }
    
    logger.info('Pulled files', { fileCount: files.length, commitMessage: commit.message });
    
    return {
      files,
      commit: {
        sha: ref.object.sha,
        message: commit.message,
        author: commit.author?.name || 'unknown',
        date: new Date(commit.author?.date || Date.now()),
      },
    };
  }

  async getFile(repo: string, branch: string, path: string): Promise<FileEntry | null> {
    try {
      const [owner, name] = this.parseRepo(repo);
      const { data } = await this.octokit.rest.repos.getContent({
        owner,
        repo: name,
        path,
        ref: branch,
      });
      
      if ('content' in data && data.type === 'file') {
        return {
          path,
          content: Buffer.from(data.content, 'base64').toString('utf-8'),
          encoding: 'utf-8',
        };
      }
      return null;
    } catch (error: any) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async getTree(repo: string, branch: string): Promise<TreeEntry[]> {
    const [owner, name] = this.parseRepo(repo);
    
    // Get branch ref
    const { data: ref } = await this.octokit.rest.git.getRef({
      owner,
      repo: name,
      ref: `heads/${branch}`,
    });
    
    // Get commit
    const { data: commit } = await this.octokit.rest.git.getCommit({
      owner,
      repo: name,
      commit_sha: ref.object.sha,
    });
    
    // Get tree recursively
    const { data: tree } = await this.octokit.rest.git.getTree({
      owner,
      repo: name,
      tree_sha: commit.tree.sha,
      recursive: 'true',
    });
    
    return tree.tree
      .filter(item => item.path && item.type)
      .map(item => ({
        path: item.path!,
        type: item.type === 'blob' ? 'blob' as const : 'tree' as const,
        sha: item.sha,
        size: item.size,
      }));
  }

  async getCommits(repo: string, branch: string, limit = 50): Promise<CommitInfo[]> {
    const [owner, name] = this.parseRepo(repo);
    const { data } = await this.octokit.rest.repos.listCommits({
      owner,
      repo: name,
      sha: branch,
      per_page: limit,
    });
    
    return data.map(c => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.commit.author?.name || c.author?.login || 'unknown',
      date: new Date(c.commit.author?.date || Date.now()),
    }));
  }

  // Helper methods
  private parseRepo(repo: string): [string, string] {
    const parts = repo.replace(/\.git$/, '').split('/');
    if (parts.length < 2) {
      throw new Error(`Invalid repository format: ${repo}. Expected 'owner/repo'`);
    }
    return [parts[parts.length - 2], parts[parts.length - 1]];
  }

  private mapRepo(data: any): RepoInfo {
    return {
      id: String(data.id),
      name: data.name,
      fullName: data.full_name,
      cloneUrl: data.clone_url,
      htmlUrl: data.html_url,
      defaultBranch: data.default_branch || 'main',
      private: data.private,
    };
  }

  private matchesPatterns(path: string, patterns: string[]): boolean {
    // Simple glob matching - supports * and **
    for (const pattern of patterns) {
      // Handle **/*.ext pattern specially - match files with extension anywhere
      if (pattern.startsWith('**/')) {
        const suffix = pattern.slice(3); // Remove **/
        const suffixRegex = new RegExp(
          suffix
            .replace(/\\/g, '\\\\')
            .replace(/\./g, '\\.')
            .replace(/\*/g, '[^/]*') + '$'
        );
        if (suffixRegex.test(path)) {
          logger.info('Pattern match (glob)', { path, pattern, matched: true });
          return true;
        }
      } else {
        // Standard pattern matching
        const regex = new RegExp(
          '^' + pattern
            .replace(/\\/g, '\\\\')
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
            .replace(/\*/g, '[^/]*')
            .replace(/<<<DOUBLESTAR>>>/g, '.*') + '$'
        );
        if (regex.test(path)) {
          logger.info('Pattern match', { path, pattern, matched: true });
          return true;
        }
      }
    }
    logger.info('No pattern match', { path, patterns });
    return false;
  }
}
