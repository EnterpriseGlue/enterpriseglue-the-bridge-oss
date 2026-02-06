/**
 * VCS Shared Types and Utilities
 */

import crypto from 'crypto';

export interface BranchInfo {
  id: string;
  projectId: string;
  name: string;
  userId: string | null;
  headCommitId: string | null;
  isDefault: boolean;
}

export interface CommitInfo {
  id: string;
  projectId: string;
  branchId: string;
  parentCommitId: string | null;
  userId: string;
  message: string;
  hash: string;
  versionNumber: number | null;
  isRemote: boolean;
  createdAt: number;
}

export interface WorkingFileInfo {
  id: string;
  branchId: string;
  projectId: string;
  folderId: string | null;
  name: string;
  type: string;
  content: string | null;
  contentHash: string | null;
}

export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

export function mapBranch(row: any): BranchInfo {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    userId: row.userId,
    headCommitId: row.headCommitId,
    isDefault: row.isDefault,
  };
}

export function mapCommit(row: any): CommitInfo {
  return {
    id: row.id,
    projectId: row.projectId,
    branchId: row.branchId,
    parentCommitId: row.parentCommitId,
    userId: row.userId,
    message: row.message,
    hash: row.hash,
    versionNumber: row.versionNumber ?? null,
    isRemote: row.isRemote ?? false,
    createdAt: Number(row.createdAt),
  };
}

export function mapWorkingFile(row: any): WorkingFileInfo {
  return {
    id: row.id,
    branchId: row.branchId,
    projectId: row.projectId,
    folderId: row.folderId,
    name: row.name,
    type: row.type,
    content: row.content,
    contentHash: row.contentHash,
  };
}

export function normalizeFolderId(id: unknown): string {
  if (id === null || typeof id === 'undefined') return '';
  return String(id);
}
