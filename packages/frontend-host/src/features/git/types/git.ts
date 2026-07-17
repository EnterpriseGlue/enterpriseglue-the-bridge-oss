/**
 * Git versioning types
 * Matches backend API schemas
 */

import type {
  AcquireLockRequest as SharedAcquireLockRequest,
  DeployRequest as SharedDeployRequest,
  DeploymentResponse as SharedDeploymentResponse,
  LockHeartbeatRequest as SharedLockHeartbeatRequest,
  LockHolder as SharedLockHolder,
  LockResponse as SharedLockResponse,
  RollbackRequest as SharedRollbackRequest,
  InitRepositoryRequest as SharedInitRepositoryRequest,
  CloneRepositoryRequest as SharedCloneRepositoryRequest,
} from '@enterpriseglue/shared/schemas/git/index.js';

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
export type InitRepositoryRequest = SharedInitRepositoryRequest;
export type CloneRepositoryRequest = SharedCloneRepositoryRequest;

export interface CloneFromGitRequest {
  providerId: string;
  repoUrl: string;
  branch?: string;
  projectName?: string;
  conflictStrategy?: 'preferRemote' | 'preferLocal';
}

export type DeployRequest = SharedDeployRequest;
export type RollbackRequest = SharedRollbackRequest;
export type AcquireLockRequest = SharedAcquireLockRequest;
export type LockHeartbeatRequest = SharedLockHeartbeatRequest;
export type DeploymentResponse = SharedDeploymentResponse;
export type LockResponse = SharedLockResponse;
export type LockHolder = SharedLockHolder;
