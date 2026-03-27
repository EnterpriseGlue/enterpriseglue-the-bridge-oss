/**
 * Git versioning types
 * Matches backend API schemas
 */

export interface Repository {
  id: string;
  projectId: string;
  providerId: string;
  remoteUrl: string;
  namespace: string | null;
  repositoryName: string;
  defaultBranch: string;
  lastCommitSha: string | null;
  lastSyncAt: number | null;
  clonePath: string;
  createdAt: number;
  updatedAt: number;
}

export interface GitProvider {
  id: string;
  tenantId?: string | null;
  name: string;
  type: 'github' | 'gitlab' | 'azure-devops' | 'bitbucket';
  baseUrl: string;
  apiUrl: string;
  supportsOAuth?: boolean;
  supportsPAT?: boolean;
  isActive?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface Deployment {
  id: string;
  projectId: string;
  repositoryId: string;
  commitSha: string;
  commitMessage: string;
  tag: string | null;
  deployedBy: string;
  deployedAt: number;
  environment: 'dev' | 'staging' | 'production' | null;
  status: 'success' | 'failed' | 'pending';
  errorMessage: string | null;
  filesChanged: number | null;
  metadata: string | null;
}

export interface FileLock {
  id: string;
  fileId: string;
  userId: string;
  acquiredAt: number;
  lastInteractionAt: number;
  expiresAt: number;
  heartbeatAt: number;
  visibilityState: 'visible' | 'hidden';
  visibilityChangedAt: number;
  sessionStatus: 'active' | 'idle' | 'hidden';
}

export interface Commit {
  oid: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      timestamp: number;
    };
  };
}

// Request types
export interface InitRepositoryRequest {
  projectId: string;
  providerId: string;
  remoteUrl: string;
  namespace?: string;
}

export interface CloneRepositoryRequest {
  projectId: string;
  providerId: string;
  remoteUrl: string;
  namespace?: string;
  conflictStrategy?: 'preferRemote' | 'preferLocal';
}

export interface CloneFromGitRequest {
  providerId: string;
  repoUrl: string;
  branch?: string;
  projectName?: string;
  conflictStrategy?: 'preferRemote' | 'preferLocal';
}

export interface DeployRequest {
  projectId: string;
  message: string;
  environment?: string;
  createTag?: boolean;
  tagName?: string;
}

export interface RollbackRequest {
  projectId: string;
  commitSha: string;
}

export interface AcquireLockRequest {
  fileId: string;
  force?: boolean;
  visibilityState?: 'visible' | 'hidden';
  hasInteraction?: boolean;
}

export interface LockHeartbeatRequest {
  visibilityState?: 'visible' | 'hidden';
  hasInteraction?: boolean;
}

// Response types
export interface DeploymentResponse {
  deploymentId: string;
  commitSha: string;
  tag?: string;
  filesChanged: number;
}

export interface LockResponse {
  id: string;
  fileId: string;
  userId: string;
  acquiredAt: number;
  lastInteractionAt: number;
  expiresAt: number;
  heartbeatAt: number;
  visibilityState: 'visible' | 'hidden';
  visibilityChangedAt: number;
  sessionStatus: 'active' | 'idle' | 'hidden';
  userName?: string;
}

export interface LockHolder {
  userId: string;
  name: string;
  acquiredAt: number;
  heartbeatAt: number;
  lastInteractionAt: number;
  visibilityState: 'visible' | 'hidden';
  visibilityChangedAt: number;
  sessionStatus: 'active' | 'idle' | 'hidden';
}
