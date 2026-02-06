/**
 * Unified Git Provider Types
 * Common interfaces for all Git providers (GitHub, GitLab, Bitbucket, Azure DevOps)
 */

export type ProviderType = 'github' | 'gitlab' | 'bitbucket' | 'azure-devops';

export interface ProviderCredentials {
  token: string;
  // For Azure DevOps
  organization?: string;
}

export interface RepoInfo {
  id: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
}

export interface BranchInfo {
  name: string;
  sha: string;
  isDefault: boolean;
  protected: boolean;
}

export interface FileEntry {
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
}

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';  // blob = file, tree = directory
  sha?: string;
  size?: number;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: Date;
}

export interface CreateRepoOptions {
  name: string;
  organization?: string;
  description?: string;
  private?: boolean;
  autoInit?: boolean;
}

export interface PushOptions {
  repo: string;
  branch: string;
  files: FileEntry[];
  message: string;
  /** Create branch if it doesn't exist */
  createBranch?: boolean;
  /** Paths to delete from the repository */
  deletions?: string[];
}

export interface PullOptions {
  repo: string;
  branch: string;
  /** Glob patterns to filter files */
  patterns?: string[];
}

export interface PullResult {
  files: FileEntry[];
  commit: {
    sha: string;
    message: string;
    author: string;
    date: Date;
  };
}

/**
 * Unified interface for all Git providers
 */
export interface Namespace {
  name: string;
  type: 'user' | 'organization';
  avatarUrl?: string;
}

export interface GitProviderClient {
  readonly type: ProviderType;
  
  /**
   * Validate credentials and connection
   */
  validateCredentials(): Promise<boolean>;
  
  /**
   * Get authenticated user info
   */
  getCurrentUser(): Promise<{ id: string; username: string; email?: string }>;
  
  /**
   * Get available namespaces (user + organizations)
   */
  getNamespaces(): Promise<Namespace[]>;
  
  /**
   * Create a new repository
   */
  createRepository(options: CreateRepoOptions): Promise<RepoInfo>;
  
  /**
   * Get repository info
   */
  getRepository(repo: string): Promise<RepoInfo | null>;
  
  /**
   * List repositories accessible to the user
   */
  listRepositories(options?: { org?: string; limit?: number }): Promise<RepoInfo[]>;
  
  /**
   * Delete a repository
   */
  deleteRepository(repo: string): Promise<void>;
  
  /**
   * Get branches for a repository
   */
  getBranches(repo: string): Promise<BranchInfo[]>;
  
  /**
   * Create a new branch
   */
  createBranch(repo: string, branchName: string, fromBranch?: string): Promise<BranchInfo>;
  
  /**
   * Push files to a repository
   */
  pushFiles(options: PushOptions): Promise<CommitInfo>;
  
  /**
   * Pull/fetch files from a repository
   */
  pullFiles(options: PullOptions): Promise<PullResult>;
  
  /**
   * Get file content
   */
  getFile(repo: string, branch: string, path: string): Promise<FileEntry | null>;
  
  /**
   * Get repository tree (list of files and directories)
   */
  getTree(repo: string, branch: string): Promise<TreeEntry[]>;
  
  /**
   * Get commit history
   */
  getCommits(repo: string, branch: string, limit?: number): Promise<CommitInfo[]>;

  /**
   * Create a lightweight tag pointing to a commit SHA
   */
  createTag(repo: string, tagName: string, commitSha: string, message?: string): Promise<{ name: string; sha: string }>;
}
