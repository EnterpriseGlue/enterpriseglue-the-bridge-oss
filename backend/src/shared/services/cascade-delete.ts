import { getDataSource } from '@shared/db/data-source.js';
import { Project } from '@shared/db/entities/Project.js';
import { Folder } from '@shared/db/entities/Folder.js';
import { File } from '@shared/db/entities/File.js';
import { Version } from '@shared/db/entities/Version.js';
import { Comment } from '@shared/db/entities/Comment.js';
import { GitRepository } from '@shared/db/entities/GitRepository.js';
import { vcsService } from './versioning/index.js';

/**
 * Cascade Delete Service
 * 
 * Centralized service for handling complex cascade deletions.
 * Ensures proper deletion order and handles relationships between resources.
 */
export class CascadeDeleteService {
  /**
   * Delete a project and all its resources (folders, files, versions, comments)
   * 
   * Deletion order:
   * 1. VCS data (branches, commits, working files, etc.)
   * 2. Git repository metadata
   * 3. Comments on files
   * 4. File versions
   * 5. Files
   * 6. Folders
   * 7. Project
   * 
   * @param projectId - Project ID to delete
   */
  static async deleteProject(projectId: string): Promise<void> {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(File);
    
    // Delete VCS data first (separate concern, outside transaction)
    await vcsService.deleteProject(projectId);
    
    // Collect file IDs before transaction (read-only)
    const filesResult = await fileRepo.find({ where: { projectId }, select: ['id'] });
    const fileIds = filesResult.map((row) => row.id);
    
    // Delete all DB resources in a single transaction
    await dataSource.transaction(async (manager) => {
      // Delete git repository metadata
      await manager.getRepository(GitRepository).delete({ projectId });
      
      // Delete comments for each file
      for (const fileId of fileIds) {
        await manager.getRepository(Comment).delete({ fileId });
      }
      
      // Delete versions for each file
      for (const fileId of fileIds) {
        await manager.getRepository(Version).delete({ fileId });
      }
      
      // Delete all files in project
      await manager.getRepository(File).delete({ projectId });
      
      // Delete all folders in project
      await manager.getRepository(Folder).delete({ projectId });
      
      // Delete the project itself
      await manager.getRepository(Project).delete({ id: projectId });
    });
  }

  /**
   * Delete a folder and all its contents (subfolders, files, versions, comments)
   * 
   * This performs a recursive traversal to collect all folders and files in the subtree,
   * then deletes them in the correct order.
   * 
   * Deletion order:
   * 1. Comments on files
   * 2. File versions
   * 3. Files
   * 4. Folders (bottom-up)
   * 
   * @param folderId - Folder ID to delete
   */
  static async deleteFolder(folderId: string): Promise<void> {
    const dataSource = await getDataSource();
    
    // Collect all folders and files in the subtree (read-only, outside transaction)
    const subtree = await this.collectSubtree(folderId);
    
    // Delete all resources in a single transaction
    await dataSource.transaction(async (manager) => {
      // Delete comments for each file
      for (const fileId of subtree.files) {
        await manager.getRepository(Comment).delete({ fileId });
      }
      
      // Delete versions for each file
      for (const fileId of subtree.files) {
        await manager.getRepository(Version).delete({ fileId });
      }
      
      // Delete all files
      for (const fileId of subtree.files) {
        await manager.getRepository(File).delete({ id: fileId });
      }
      
      // Delete folders bottom-up (children before parents)
      for (const folderIdToDelete of subtree.folders.reverse()) {
        await manager.getRepository(Folder).delete({ id: folderIdToDelete });
      }
    });
  }

  /**
   * Delete a file and all its associated data (versions, comments)
   * 
   * Deletion order:
   * 1. Comments
   * 2. Versions
   * 3. File
   * 
   * @param fileId - File ID to delete
   */
  static async deleteFile(fileId: string): Promise<void> {
    const dataSource = await getDataSource();
    
    // Delete all resources in a single transaction
    await dataSource.transaction(async (manager) => {
      // Delete comments
      await manager.getRepository(Comment).delete({ fileId });
      
      // Delete versions
      await manager.getRepository(Version).delete({ fileId });
      
      // Delete file
      await manager.getRepository(File).delete({ id: fileId });
    });
  }

  /**
   * Collect all folders and files in a folder subtree
   * 
   * Performs a depth-first traversal to collect all descendant folders and files.
   * Returns folders in top-down order (parent before children).
   * 
   * @param rootFolderId - Root folder ID to start traversal
   * @returns Object containing arrays of folder IDs and file IDs
   * @private
   */
  private static async collectSubtree(
    rootFolderId: string
  ): Promise<{ folders: string[]; files: string[] }> {
    const dataSource = await getDataSource();
    const folderRepo = dataSource.getRepository(Folder);
    const fileRepo = dataSource.getRepository(File);
    
    const foldersOut: string[] = [];
    const filesOut: string[] = [];
    const stack: string[] = [rootFolderId];
    
    while (stack.length > 0) {
      const currentFolderId = stack.pop() as string;
      foldersOut.push(currentFolderId);
      
      // Find child folders
      const childFolders = await folderRepo.find({
        where: { parentFolderId: currentFolderId },
        select: ['id'],
      });
      
      for (const row of childFolders) {
        stack.push(row.id);
      }
      
      // Collect files in this folder
      const folderFiles = await fileRepo.find({
        where: { folderId: currentFolderId },
        select: ['id'],
      });
      
      for (const row of folderFiles) {
        filesOut.push(row.id);
      }
    }
    
    return { folders: foldersOut, files: filesOut };
  }

  /**
   * Get deletion statistics for a project (preview before delete)
   * 
   * @param projectId - Project ID to analyze
   * @returns Statistics about what will be deleted
   */
  static async getProjectDeletionStats(projectId: string): Promise<{
    folderCount: number;
    fileCount: number;
    versionCount: number;
    commentCount: number;
  }> {
    const dataSource = await getDataSource();
    const folderRepo = dataSource.getRepository(Folder);
    const fileRepo = dataSource.getRepository(File);
    const versionRepo = dataSource.getRepository(Version);
    const commentRepo = dataSource.getRepository(Comment);
    
    // Count folders
    const folderCount = await folderRepo.count({ where: { projectId } });
    
    // Count files
    const filesResult = await fileRepo.find({ where: { projectId }, select: ['id'] });
    const fileCount = filesResult.length;
    const fileIds = filesResult.map((row) => row.id);
    
    // Count versions
    let versionCount = 0;
    for (const fileId of fileIds) {
      versionCount += await versionRepo.count({ where: { fileId } });
    }
    
    // Count comments
    let commentCount = 0;
    for (const fileId of fileIds) {
      commentCount += await commentRepo.count({ where: { fileId } });
    }
    
    return {
      folderCount,
      fileCount,
      versionCount,
      commentCount,
    };
  }

  /**
   * Get deletion statistics for a folder (preview before delete)
   * 
   * @param folderId - Folder ID to analyze
   * @returns Statistics about what will be deleted
   */
  static async getFolderDeletionStats(folderId: string): Promise<{
    folderCount: number;
    fileCount: number;
    versionCount: number;
    commentCount: number;
  }> {
    const dataSource = await getDataSource();
    const versionRepo = dataSource.getRepository(Version);
    const commentRepo = dataSource.getRepository(Comment);
    
    // Collect subtree
    const subtree = await this.collectSubtree(folderId);
    
    // Count versions
    let versionCount = 0;
    for (const fileId of subtree.files) {
      versionCount += await versionRepo.count({ where: { fileId } });
    }
    
    // Count comments
    let commentCount = 0;
    for (const fileId of subtree.files) {
      commentCount += await commentRepo.count({ where: { fileId } });
    }
    
    return {
      folderCount: subtree.folders.length,
      fileCount: subtree.files.length,
      versionCount,
      commentCount,
    };
  }
}
