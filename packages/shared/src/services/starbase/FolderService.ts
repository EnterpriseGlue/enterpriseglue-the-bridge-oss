/**
 * FolderService
 * Centralized service for folder operations
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Folder } from '@enterpriseglue/shared/infrastructure/persistence/entities/Folder.js';
import { IsNull } from 'typeorm';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId, unixTimestamp } from '@enterpriseglue/shared/utils/id.js';
import { CreateFolderRequest, UpdateFolderRequest } from '../../schemas/starbase/folder.js';
import { CascadeDeleteService } from '../cascade-delete.js';
import { lockFolderProject, readFolderAncestors } from './folder-tree.js';
import { caseInsensitiveColumn } from '@enterpriseglue/shared/infrastructure/persistence/adapters/QueryHelpers.js';

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
    const request = CreateFolderRequest.parse({ name: input.name, parentFolderId: input.parentFolderId });
    const dataSource = await getDataSource();
    return dataSource.transaction(async manager => {
      await lockFolderProject(manager, input.projectId);
      const parentFolderId = request.parentFolderId || null;
      await readFolderAncestors(manager, input.projectId, parentFolderId);
      const repo = manager.getRepository(Folder);
      const duplicate = await repo.createQueryBuilder('f').where('f.projectId = :projectId', { projectId: input.projectId })
        .andWhere(parentFolderId ? 'f.parentFolderId = :parentFolderId' : 'f.parentFolderId IS NULL', { parentFolderId })
        .andWhere(`${caseInsensitiveColumn('f.name')} = ${caseInsensitiveColumn(':name')}`, { name: request.name }).getMany();
      if (duplicate.length) throw Errors.conflict('A folder with this name already exists here');
      const now = unixTimestamp(), row = { id: generateId(), projectId: input.projectId, parentFolderId, name: request.name,
        createdBy: input.userId, updatedBy: input.userId, createdAt: now, updatedAt: now };
      await repo.insert(row); return row;
    });
  }

  async rename(input: RenameFolderInput): Promise<FolderResult> {
    const request = UpdateFolderRequest.parse({ name: input.name, parentFolderId: input.parentFolderId });
    const existing = await this.getByIdOrThrow(input.folderId);
    const dataSource = await getDataSource();
    return dataSource.transaction(async manager => {
      await lockFolderProject(manager, existing.projectId);
      const repo = manager.getRepository(Folder);
      const row = await repo.findOne({ where: { id: input.folderId, projectId: existing.projectId } });
      if (!row) throw Errors.notFound('Folder');
      const parentFolderId = request.parentFolderId === undefined ? row.parentFolderId : request.parentFolderId;
      const ancestors = await readFolderAncestors(manager, row.projectId, parentFolderId);
      if (ancestors.some(parent => parent.id === row.id)) throw Errors.validation('Cannot move a folder into itself or its descendant');
      const name = request.name ?? row.name;
      const duplicate = await repo.createQueryBuilder('f').where('f.projectId = :projectId', { projectId: row.projectId })
        .andWhere(parentFolderId ? 'f.parentFolderId = :parentFolderId' : 'f.parentFolderId IS NULL', { parentFolderId })
        .andWhere(`${caseInsensitiveColumn('f.name')} = ${caseInsensitiveColumn(':name')}`, { name })
        .andWhere('f.id <> :id', { id: row.id }).getMany();
      if (duplicate.length) throw Errors.conflict('A folder with this name already exists here');
      const updatedAt = unixTimestamp();
      await repo.update({ id: row.id, projectId: row.projectId }, { name, parentFolderId, updatedBy: input.userId, updatedAt });
      return { id: row.id, projectId: row.projectId, name, parentFolderId, createdAt: Number(row.createdAt), updatedAt };
    });
  }

  async delete(folderId: string): Promise<void> {
    await CascadeDeleteService.deleteFolder(folderId);
  }

  /**
   * List folders in a project
   */
  async listByProject(projectId: string, parentFolderId?: string | null): Promise<FolderResult[]> {
    const dataSource = await getDataSource();
    const folderRepo = dataSource.getRepository(Folder);
    
    if (parentFolderId) await readFolderAncestors(dataSource, projectId, parentFolderId);
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
    const root = await folderRepo.findOne({ where: { id: folderId }, select: ['id', 'projectId'] });
    if (!root) throw Errors.notFound('Folder');
    const rows = await readFolderAncestors(dataSource, root.projectId, folderId);
    return rows.map(row => ({ id: row.id, name: row.name }));
  }
}

export const folderService = new FolderServiceImpl();
