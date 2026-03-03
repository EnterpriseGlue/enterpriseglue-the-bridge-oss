/**
 * File VCS Sync Service
 * 
 * Syncs file operations from the main files table to the VCS working_files table.
 * This ensures files are tracked in the user's personal branch for version control.
 */

import { vcsService } from './VcsService.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';

let vcsInitialized = false;

/**
 * Ensure VCS tables are initialized
 */
async function ensureVcsReady(): Promise<boolean> {
  if (vcsInitialized) return true;
  
  try {
    await getDataSource();
    vcsInitialized = true;
    return true;
  } catch (error) {
    logger.warn('VCS tables not available, file sync skipped', { error });
    return false;
  }
}

/**
 * Sync a file creation to VCS
 */
export async function syncFileCreate(
  projectId: string,
  userId: string,
  fileId: string,
  name: string,
  type: string,
  content: string,
  folderId?: string | null
): Promise<void> {
  try {
    if (!(await ensureVcsReady())) return;
    
    // Get or create user's branch
    const branch = await vcsService.getUserBranch(projectId, userId);
    
    // Save file to VCS
    await vcsService.saveFile(
      branch.id,
      projectId,
      null, // new file, no existing ID in VCS
      name,
      type,
      content,
      folderId
    );
    
    logger.debug('File synced to VCS', { projectId, fileId, branchId: branch.id });
  } catch (error) {
    // Don't fail the main operation if VCS sync fails
    logger.error('Failed to sync file create to VCS', { projectId, fileId, error });
  }
}

/**
 * Sync a file update to VCS
 */
export async function syncFileUpdate(
  projectId: string,
  userId: string,
  fileId: string,
  name: string,
  type: string,
  content: string,
  folderId?: string | null
): Promise<void> {
  try {
    if (!(await ensureVcsReady())) return;
    
    // Get user's branch
    const branch = await vcsService.getUserBranch(projectId, userId);
    
    // Find existing VCS file by matching the main file ID pattern
    // For now, we'll create/update based on name matching in the branch
    const existingFiles = await vcsService.getFiles(branch.id, folderId);
    const existingFile = existingFiles.find(f => f.name === name && f.type === type);
    
    // Save/update file in VCS
    await vcsService.saveFile(
      branch.id,
      projectId,
      existingFile?.id || null,
      name,
      type,
      content,
      folderId
    );
    
    logger.debug('File update synced to VCS', { projectId, fileId, branchId: branch.id });
  } catch (error) {
    logger.error('Failed to sync file update to VCS', { projectId, fileId, error });
  }
}

/**
 * Sync a file deletion to VCS
 */
export async function syncFileDelete(
  projectId: string,
  userId: string,
  fileId: string,
  name: string,
  type: string,
  folderId?: string | null
): Promise<void> {
  try {
    if (!(await ensureVcsReady())) return;
    
    // Get user's branch
    const branch = await vcsService.getUserBranch(projectId, userId);
    
    // Find the VCS file
    const existingFiles = await vcsService.getFiles(branch.id, folderId);
    const existingFile = existingFiles.find(f => f.name === name && f.type === type);
    
    if (existingFile) {
      await vcsService.deleteFile(existingFile.id);
      logger.debug('File delete synced to VCS', { projectId, fileId, branchId: branch.id });
    }
  } catch (error) {
    logger.error('Failed to sync file delete to VCS', { projectId, fileId, error });
  }
}

/**
 * Get the user's current branch for a project
 */
export async function getUserBranch(projectId: string, userId: string) {
  try {
    if (!(await ensureVcsReady())) return null;
    return await vcsService.getUserBranch(projectId, userId);
  } catch (error) {
    logger.error('Failed to get user branch', { projectId, userId, error });
    return null;
  }
}
