import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { Folder } from '@enterpriseglue/shared/db/entities/Folder.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { ObjectLiteral, EntityTarget } from 'typeorm';

/**
 * Resource Service
 * 
 * Centralized resource management for checking existence and retrieving resources.
 * Provides consistent error handling and type-safe resource operations.
 */
export class ResourceService {
  /**
   * Generic method to check if a resource exists
   * @param entity - TypeORM entity class
   * @param id - Resource ID to check
   * @returns true if resource exists, false otherwise
   */
  static async exists<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    id: string
  ): Promise<boolean> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(entity);
    const count = await repo.count({ where: { id } as any });
    return count > 0;
  }

  /**
   * Generic method to get a resource or throw error
   * @param entity - TypeORM entity class
   * @param id - Resource ID to retrieve
   * @param resourceName - Human-readable resource name for error messages
   * @returns The resource object
   * @throws Error if resource not found
   */
  static async getOrThrow<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    id: string,
    resourceName: string
  ): Promise<T> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(entity);
    const result = await repo.findOneBy({ id } as any);
    
    if (!result) {
      throw new Error(`${resourceName} not found`);
    }
    
    return result;
  }

  /**
   * Generic method to get a resource or return null
   * @param entity - TypeORM entity class
   * @param id - Resource ID to retrieve
   * @returns The resource object or null if not found
   */
  static async getOrNull<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    id: string
  ): Promise<T | null> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(entity);
    return repo.findOneBy({ id } as any);
  }

  /**
   * Check if a user exists (database)
   * @param userId - User ID to check
   * @returns true if user exists, false otherwise
   */
  static async userExists(userId: string): Promise<boolean> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(User);
    const count = await repo.count({ where: { id: userId } });
    return count > 0;
  }

  /**
   * Check if a project exists
   * @param projectId - Project ID to check
   * @returns true if project exists, false otherwise
   */
  static async projectExists(projectId: string): Promise<boolean> {
    return this.exists(Project, projectId);
  }

  /**
   * Check if a folder exists
   * @param folderId - Folder ID to check
   * @returns true if folder exists, false otherwise
   */
  static async folderExists(folderId: string): Promise<boolean> {
    return this.exists(Folder, folderId);
  }

  /**
   * Check if a file exists
   * @param fileId - File ID to check
   * @returns true if file exists, false otherwise
   */
  static async fileExists(fileId: string): Promise<boolean> {
    return this.exists(File, fileId);
  }

  /**
   * Get a user or throw error (database)
   * @param userId - User ID to retrieve
   * @returns User object
   * @throws Error if user not found
   */
  static async getUserOrThrow(userId: string): Promise<User> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(User);
    const result = await repo.findOneBy({ id: userId });
    if (!result) {
      throw new Error('User not found');
    }
    return result;
  }

  /**
   * Get a project or throw error
   * @param projectId - Project ID to retrieve
   * @returns Project object
   * @throws Error if project not found
   */
  static async getProjectOrThrow(projectId: string): Promise<Project> {
    return this.getOrThrow(Project, projectId, 'Project');
  }

  /**
   * Get a folder or throw error
   * @param folderId - Folder ID to retrieve
   * @returns Folder object
   * @throws Error if folder not found
   */
  static async getFolderOrThrow(folderId: string): Promise<Folder> {
    return this.getOrThrow(Folder, folderId, 'Folder');
  }

  /**
   * Get a file or throw error
   * @param fileId - File ID to retrieve
   * @returns File object
   * @throws Error if file not found
   */
  static async getFileOrThrow(fileId: string): Promise<File> {
    return this.getOrThrow(File, fileId, 'File');
  }

  /**
   * Get a user or return null (database)
   * @param userId - User ID to retrieve
   * @returns User object or null
   */
  static async getUserOrNull(userId: string): Promise<User | null> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(User);
    return repo.findOneBy({ id: userId });
  }

  /**
   * Get a project or return null
   * @param projectId - Project ID to retrieve
   * @returns Project object or null
   */
  static async getProjectOrNull(projectId: string): Promise<Project | null> {
    return this.getOrNull(Project, projectId);
  }

  /**
   * Get a folder or return null
   * @param folderId - Folder ID to retrieve
   * @returns Folder object or null
   */
  static async getFolderOrNull(folderId: string): Promise<Folder | null> {
    return this.getOrNull(Folder, folderId);
  }

  /**
   * Get a file or return null
   * @param fileId - File ID to retrieve
   * @returns File object or null
   */
  static async getFileOrNull(fileId: string): Promise<File | null> {
    return this.getOrNull(File, fileId);
  }

  /**
   * Get the project ID for a file
   * @param fileId - File ID to look up
   * @returns Project ID or null if file not found
   */
  static async getFileProjectId(fileId: string): Promise<string | null> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(File);
    const file = await repo.findOne({ where: { id: fileId }, select: ['projectId'] });
    return file?.projectId ?? null;
  }

  /**
   * Get the project ID for a folder
   * @param folderId - Folder ID to look up
   * @returns Project ID or null if folder not found
   */
  static async getFolderProjectId(folderId: string): Promise<string | null> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(Folder);
    const folder = await repo.findOne({ where: { id: folderId }, select: ['projectId'] });
    return folder?.projectId ?? null;
  }
}
