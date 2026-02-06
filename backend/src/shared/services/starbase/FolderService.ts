/**
 * FolderService
 * Centralized service for folder operations
 */

import { getDataSource } from '@shared/db/data-source.js';
import { Folder } from '@shared/db/entities/Folder.js';
import { File } from '@shared/db/entities/File.js';
import { IsNull, Raw } from 'typeorm';
import { Errors } from '@shared/middleware/errorHandler.js';
import { generateId, unixTimestamp } from '@shared/utils/id.js';
import { caseInsensitiveColumn } from '@shared/db/adapters/QueryHelpers.js';

export interface CreateFolderInput {
  projectId: string;
  name: string;
  parentFolderId?: string | null;
  userId: string;
}

export interface RenameFolderInput {
  folderId: string;
  name?: string;
  parentFolderId?: string | null;
  userId: string;
}

export interface FolderResult {
  id: string;
  projectId: string;
  parentFolderId: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
}

class FolderServiceImpl {
  /**
   * Get a folder by ID
   */
  async getById(folderId: string): Promise<FolderResult | null> {
    const dataSource = await getDataSource();
    const folderRepo = dataSource.getRepository(Folder);
    const row = await folderRepo.findOne({ where: { id: folderId } });
    
    if (!row) return null;
    
    return {
      id: row.id,
      projectId: row.projectId,
      parentFolderId: row.parentFolderId,
      name: row.name,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    };
  }

  /**
   * Get a folder by ID or throw 404
   */
  async getByIdOrThrow(folderId: string): Promise<FolderResult> {
    const folder = await this.getById(folderId);
    if (!folder) {
      throw Errors.notFound('Folder', folderId);
    }
    return folder;
  }

  /**
   * Create a new folder
   */
  async create(input: CreateFolderInput): Promise<FolderResult> {
    const dataSource = await getDataSource();
    const folderRepo = dataSource.getRepository(Folder);
    const now = unixTimestamp();
    const folderId = generateId();
    const trimmedName = input.name.trim();

    // Check for duplicate names (case-insensitive)
    const dupCheck = await folderRepo.createQueryBuilder('f')
      .where('f.projectId = :projectId', { projectId: input.projectId })
      .andWhere(input.parentFolderId 
        ? 'f.parentFolderId = :parentFolderId' 
        : 'f.parentFolderId IS NULL', 
        input.parentFolderId ? { parentFolderId: input.parentFolderId } : {})
      .andWhere(`${caseInsensitiveColumn('f.name')} = ${caseInsensitiveColumn(':name')}`, { name: trimmedName })
      .getMany();

    if (dupCheck.length > 0) {
      throw Errors.conflict('A folder with this name already exists here');
    }

    await folderRepo.insert({
      id: folderId,
      projectId: input.projectId,
      parentFolderId: input.parentFolderId || null,
      name: trimmedName,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: folderId,
      projectId: input.projectId,
      parentFolderId: input.parentFolderId || null,
      name: trimmedName,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Rename or move a folder
   */
  async rename(input: RenameFolderInput): Promise<FolderResult> {
    const dataSource = await getDataSource();
    const folderRepo = dataSource.getRepository(Folder);
    const now = unixTimestamp();

    const folder = await this.getByIdOrThrow(input.folderId);

    const updates: Record<string, unknown> = { updatedAt: now };
    
    if (input.name !== undefined) {
      const trimmedName = input.name.trim();
      
      // Check for duplicate names if renaming
      const targetParentId = input.parentFolderId !== undefined 
        ? input.parentFolderId 
        : folder.parentFolderId;
      
      const qb = folderRepo.createQueryBuilder('f')
        .where('f.projectId = :projectId', { projectId: folder.projectId })
        .andWhere(targetParentId 
          ? 'f.parentFolderId = :parentFolderId' 
          : 'f.parentFolderId IS NULL',
          targetParentId ? { parentFolderId: targetParentId } : {})
        .andWhere(`${caseInsensitiveColumn('f.name')} = ${caseInsensitiveColumn(':name')}`, { name: trimmedName })
        .andWhere('f.id != :folderId', { folderId: input.folderId });
      
      const dupCheck = await qb.getMany();

      if (dupCheck.length > 0) {
        throw Errors.conflict('A folder with this name already exists here');
      }
      
      updates.name = trimmedName;
    }
    
    if (input.parentFolderId !== undefined) {
      // Prevent circular references
      if (input.parentFolderId === input.folderId) {
        throw Errors.validation('Cannot move folder into itself');
      }
      updates.parentFolderId = input.parentFolderId;
    }

    await folderRepo.update({ id: input.folderId }, updates);

    return {
      ...folder,
      name: input.name?.trim() ?? folder.name,
      parentFolderId: input.parentFolderId !== undefined ? input.parentFolderId : folder.parentFolderId,
      updatedAt: now,
    };
  }

  /**
   * Delete a folder and all its contents
   */
  async delete(folderId: string): Promise<void> {
    const dataSource = await getDataSource();
    const folderRepo = dataSource.getRepository(Folder);
    const fileRepo = dataSource.getRepository(File);
    const folder = await this.getByIdOrThrow(folderId);

    // Get all nested folder IDs recursively
    const allFolderIds = await this.getAllNestedFolderIds(folder.projectId, folderId);
    allFolderIds.push(folderId);

    // Delete all files in these folders
    for (const fId of allFolderIds) {
      await fileRepo.delete({ folderId: fId });
    }

    // Delete all folders (children first)
    for (const fId of allFolderIds.reverse()) {
      await folderRepo.delete({ id: fId });
    }
  }

  /**
   * Get all nested folder IDs recursively
   */
  private async getAllNestedFolderIds(projectId: string, parentId: string): Promise<string[]> {
    const dataSource = await getDataSource();
    const folderRepo = dataSource.getRepository(Folder);
    const result: string[] = [];

    const children = await folderRepo.find({
      where: { projectId, parentFolderId: parentId },
      select: ['id']
    });

    for (const child of children) {
      result.push(child.id);
      const nested = await this.getAllNestedFolderIds(projectId, child.id);
      result.push(...nested);
    }

    return result;
  }

  /**
   * List folders in a project
   */
  async listByProject(projectId: string, parentFolderId?: string | null): Promise<FolderResult[]> {
    const dataSource = await getDataSource();
    const folderRepo = dataSource.getRepository(Folder);
    
    const whereClause: any = { projectId };
    
    if (parentFolderId !== undefined) {
      whereClause.parentFolderId = parentFolderId ? parentFolderId : IsNull();
    }

    const result = await folderRepo.find({ where: whereClause });
    
    return result.map((row: Folder) => ({
      id: row.id,
      projectId: row.projectId,
      parentFolderId: row.parentFolderId,
      name: row.name,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    }));
  }

  /**
   * Get folder breadcrumb trail
   */
  async getBreadcrumb(folderId: string | null): Promise<Array<{ id: string; name: string }>> {
    if (!folderId) return [];
    
    const dataSource = await getDataSource();
    const folderRepo = dataSource.getRepository(Folder);
    const breadcrumb: Array<{ id: string; name: string }> = [];
    let currentId: string | null = folderId;

    while (currentId) {
      const row = await folderRepo.findOne({
        where: { id: currentId },
        select: ['id', 'name', 'parentFolderId']
      });

      if (!row) break;

      breadcrumb.unshift({ id: row.id, name: row.name });
      currentId = row.parentFolderId || null;
    }

    return breadcrumb;
  }
}

export const folderService = new FolderServiceImpl();
