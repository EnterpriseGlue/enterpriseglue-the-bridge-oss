import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { Folder } from '@enterpriseglue/shared/db/entities/Folder.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { GitRepository } from '@enterpriseglue/shared/db/entities/GitRepository.js';
import { ProjectMember } from '@enterpriseglue/shared/db/entities/ProjectMember.js';

/**
 * Authorization Service
 * 
 * Centralized authorization logic for verifying resource ownership.
 * Ensures consistent authorization checks across all routes.
 */
export class AuthorizationService {
  static async verifyProjectAccess(
    projectId: string,
    userId: string
  ): Promise<boolean> {
    const dataSource = await getDataSource();
    const memberRepo = dataSource.getRepository(ProjectMember);

    const member = await memberRepo.findOneBy({ projectId, userId });
    if (member) return true;

    return this.verifyProjectOwnership(projectId, userId);
  }

  static async verifyFileAccess(
    fileId: string,
    userId: string
  ): Promise<boolean> {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(File);
    const file = await fileRepo.findOneBy({ id: fileId });
    if (!file) return false;
    return this.verifyProjectAccess(file.projectId, userId);
  }

  static async verifyFolderAccess(
    folderId: string,
    userId: string
  ): Promise<boolean> {
    const dataSource = await getDataSource();
    const folderRepo = dataSource.getRepository(Folder);
    const folder = await folderRepo.findOneBy({ id: folderId });
    if (!folder) return false;
    return this.verifyProjectAccess(folder.projectId, userId);
  }

  static async verifyRepositoryAccess(
    repositoryId: string,
    userId: string
  ): Promise<boolean> {
    const dataSource = await getDataSource();
    const repoRepo = dataSource.getRepository(GitRepository);
    const repo = await repoRepo.findOneBy({ id: repositoryId });
    if (!repo) return false;
    return this.verifyProjectAccess(repo.projectId, userId);
  }

  /**
   * Verify user owns a project
   * @param projectId - Project ID to check
   * @param userId - User ID to verify ownership
   * @returns true if user owns the project, false otherwise
   */
  static async verifyProjectOwnership(
    projectId: string, 
    userId: string
  ): Promise<boolean> {
    const dataSource = await getDataSource();
    const projectRepo = dataSource.getRepository(Project);
    const project = await projectRepo.findOneBy({ id: projectId, ownerId: userId });
    return !!project;
  }

  /**
   * Verify user owns the project containing a file
   * @param fileId - File ID to check
   * @param userId - User ID to verify ownership
   * @returns true if user owns the project containing the file, false otherwise
   */
  static async verifyFileOwnership(
    fileId: string, 
    userId: string
  ): Promise<boolean> {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(File);
    const projectRepo = dataSource.getRepository(Project);
    
    const file = await fileRepo.findOneBy({ id: fileId });
    if (!file) return false;
    
    const project = await projectRepo.findOneBy({ id: file.projectId, ownerId: userId });
    return !!project;
  }

  /**
   * Verify user owns the project containing a folder
   * @param folderId - Folder ID to check
   * @param userId - User ID to verify ownership
   * @returns true if user owns the project containing the folder, false otherwise
   */
  static async verifyFolderOwnership(
    folderId: string, 
    userId: string
  ): Promise<boolean> {
    const dataSource = await getDataSource();
    const folderRepo = dataSource.getRepository(Folder);
    const projectRepo = dataSource.getRepository(Project);
    
    const folder = await folderRepo.findOneBy({ id: folderId });
    if (!folder) return false;
    
    const project = await projectRepo.findOneBy({ id: folder.projectId, ownerId: userId });
    return !!project;
  }

  /**
   * Verify user owns the project containing a git repository
   * @param repositoryId - Repository ID to check
   * @param userId - User ID to verify ownership
   * @returns true if user owns the project containing the repository, false otherwise
   */
  static async verifyRepositoryOwnership(
    repositoryId: string, 
    userId: string
  ): Promise<boolean> {
    const dataSource = await getDataSource();
    const repoRepo = dataSource.getRepository(GitRepository);
    const projectRepo = dataSource.getRepository(Project);
    
    const repo = await repoRepo.findOneBy({ id: repositoryId });
    if (!repo) return false;
    
    const project = await projectRepo.findOneBy({ id: repo.projectId, ownerId: userId });
    return !!project;
  }

  /**
   * Require project ownership or throw error
   * @param projectId - Project ID to check
   * @param userId - User ID to verify ownership
   * @throws Error if user does not own the project
   */
  static async requireProjectOwnership(
    projectId: string, 
    userId: string
  ): Promise<void> {
    if (!(await this.verifyProjectOwnership(projectId, userId))) {
      throw new Error('Project not found or access denied');
    }
  }

  static async requireFileAccess(
    fileId: string,
    userId: string
  ): Promise<void> {
    if (!(await this.verifyFileAccess(fileId, userId))) {
      throw new Error('File not found or access denied');
    }
  }

  static async requireFolderAccess(
    folderId: string,
    userId: string
  ): Promise<void> {
    if (!(await this.verifyFolderAccess(folderId, userId))) {
      throw new Error('Folder not found or access denied');
    }
  }

  static async requireRepositoryAccess(
    repositoryId: string,
    userId: string
  ): Promise<void> {
    if (!(await this.verifyRepositoryAccess(repositoryId, userId))) {
      throw new Error('Repository not found or access denied');
    }
  }

  static async requireProjectAccess(
    projectId: string,
    userId: string
  ): Promise<void> {
    if (!(await this.verifyProjectAccess(projectId, userId))) {
      throw new Error('Project not found or access denied');
    }
  }

  /**
   * Require file ownership or throw error
   * @param fileId - File ID to check
   * @param userId - User ID to verify ownership
   * @throws Error if user does not own the project containing the file
   */
  static async requireFileOwnership(
    fileId: string, 
    userId: string
  ): Promise<void> {
    if (!(await this.verifyFileOwnership(fileId, userId))) {
      throw new Error('File not found or access denied');
    }
  }

  /**
   * Require folder ownership or throw error
   * @param folderId - Folder ID to check
   * @param userId - User ID to verify ownership
   * @throws Error if user does not own the project containing the folder
   */
  static async requireFolderOwnership(
    folderId: string, 
    userId: string
  ): Promise<void> {
    if (!(await this.verifyFolderOwnership(folderId, userId))) {
      throw new Error('Folder not found or access denied');
    }
  }

  /**
   * Require repository ownership or throw error
   * @param repositoryId - Repository ID to check
   * @param userId - User ID to verify ownership
   * @throws Error if user does not own the project containing the repository
   */
  static async requireRepositoryOwnership(
    repositoryId: string, 
    userId: string
  ): Promise<void> {
    if (!(await this.verifyRepositoryOwnership(repositoryId, userId))) {
      throw new Error('Repository not found or access denied');
    }
  }
}
