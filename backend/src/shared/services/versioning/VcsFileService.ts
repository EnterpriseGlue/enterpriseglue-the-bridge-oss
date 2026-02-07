/**
 * VCS File Service - File operations
 */

import { getDataSource } from '@shared/db/data-source.js';
import { WorkingFile } from '@shared/db/entities/WorkingFile.js';
import { File as MainFile } from '@shared/db/entities/File.js';
import { IsNull } from 'typeorm';
import { generateId } from '@shared/utils/id.js';
import { logger } from '@shared/utils/logger.js';
import { WorkingFileInfo, hashContent, mapWorkingFile, normalizeFolderId } from './vcs-types.js';

export class VcsFileService {
  /**
   * Create or update a file in a user's branch
   */
  async saveFile(
    branchId: string,
    projectId: string,
    fileId: string | null,
    name: string,
    type: string,
    content: string,
    folderId?: string | null
  ): Promise<WorkingFileInfo> {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(WorkingFile);
    const now = Date.now();
    const contentHash = hashContent(content);

    if (!fileId) {
      const normalizedFolderId = folderId ?? null;

      const qb = fileRepo.createQueryBuilder('wf')
        .where('wf.branchId = :branchId', { branchId })
        .andWhere('wf.projectId = :projectId', { projectId })
        .andWhere('wf.name = :name', { name })
        .andWhere('wf.type = :type', { type })
        .andWhere('wf.isDeleted = :isDeleted', { isDeleted: false });
      
      if (normalizedFolderId === null) {
        qb.andWhere('(wf.folderId IS NULL OR wf.folderId = :empty)', { empty: '' });
      } else {
        qb.andWhere('wf.folderId = :folderId', { folderId: normalizedFolderId });
      }
      
      const existing = await qb.orderBy('wf.updatedAt', 'DESC').getOne();

      if (existing) {
        fileId = existing.id;
      }
    }

    if (fileId) {
      // Update existing file
      await fileRepo.update({ id: fileId }, {
        name,
        content,
        contentHash,
        folderId: folderId ?? null,
        updatedAt: now,
      });
      
      const updated = await fileRepo.findOne({ where: { id: fileId } });
      return mapWorkingFile(updated!);
    } else {
      // Create new file
      const newFileId = generateId();
      const newFile = {
        id: newFileId,
        branchId,
        projectId,
        folderId: folderId ?? null,
        name,
        type,
        content,
        contentHash,
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
      };
      
      await fileRepo.insert(newFile);
      return mapWorkingFile(newFile);
    }
  }
  
  /**
   * Get files in a branch
   */
  async getFiles(branchId: string, folderId?: string | null): Promise<WorkingFileInfo[]> {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(WorkingFile);
    
    const qb = fileRepo.createQueryBuilder('wf')
      .where('wf.branchId = :branchId', { branchId })
      .andWhere('wf.isDeleted = :isDeleted', { isDeleted: false });
    
    if (folderId !== undefined) {
      if (folderId === null) {
        qb.andWhere('(wf.folderId IS NULL OR wf.folderId = :empty)', { empty: '' });
      } else {
        qb.andWhere('wf.folderId = :folderId', { folderId });
      }
    }
    
    const files = await qb.getMany();
    
    return files.map(f => mapWorkingFile(f));
  }
  
  /**
   * Get a single file
   */
  async getFile(fileId: string): Promise<WorkingFileInfo | null> {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(WorkingFile);
    const file = await fileRepo.findOne({ where: { id: fileId } });
    return file ? mapWorkingFile(file) : null;
  }
  
  /**
   * Delete a file (soft delete)
   */
  async deleteFile(fileId: string): Promise<void> {
    const dataSource = await getDataSource();
    const fileRepo = dataSource.getRepository(WorkingFile);
    await fileRepo.update({ id: fileId }, { isDeleted: true, updatedAt: Date.now() });
  }

  /**
   * Sync files from main database to VCS draft branch
   */
  async syncFromMainDb(projectId: string, userId: string, branchId: string): Promise<void> {
    const syncStart = Date.now();
    const dataSource = await getDataSource();
    const mainFileRepo = dataSource.getRepository(MainFile);
    const workingFileRepo = dataSource.getRepository(WorkingFile);
    
    // Get all files from main database
    const dbFiles = await mainFileRepo.find({ where: { projectId } });
    
    // Get current VCS working files
    const vcsFiles = await workingFileRepo.find({
      where: { branchId, isDeleted: false }
    });
    
    const now = Date.now();
    
    // Build map of VCS files by folder+name+type
    const vcsFileMap = new Map(
      vcsFiles.map(f => [`${normalizeFolderId(f.folderId)}:${f.name}:${f.type}`, f])
    );
    const dbFileKeys = new Set<string>();
    
    // Collect batch operations instead of sequential awaits
    const updatePromises: Promise<any>[] = [];
    const newRows: any[] = [];
    
    for (const dbFile of dbFiles) {
      const key = `${normalizeFolderId((dbFile as any).folderId)}:${dbFile.name}:${dbFile.type}`;
      dbFileKeys.add(key);
      const existingVcsFile = vcsFileMap.get(key);
      const content = String((dbFile as any).xml || '');
      const contentHash = hashContent(content);
      const normalizedFolderId = normalizeFolderId((dbFile as any).folderId);
      
      if (existingVcsFile) {
        const existingFolderId = normalizeFolderId(existingVcsFile.folderId);
        if (existingVcsFile.contentHash !== contentHash || existingFolderId !== normalizedFolderId) {
          updatePromises.push(workingFileRepo.update({ id: existingVcsFile.id }, {
            content,
            contentHash,
            folderId: (dbFile as any).folderId || '',
            updatedAt: now,
          }));
        }
      } else {
        newRows.push({
          id: generateId(),
          branchId,
          projectId,
          folderId: (dbFile as any).folderId || '',
          name: dbFile.name,
          type: dbFile.type,
          content,
          contentHash,
          isDeleted: false,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Mark deleted files
    for (const [key, vcsFile] of vcsFileMap.entries()) {
      if (!dbFileKeys.has(key)) {
        updatePromises.push(workingFileRepo.update({ id: vcsFile.id }, { isDeleted: true, updatedAt: now }));
      }
    }

    // Execute all updates in parallel + batch insert new rows
    await Promise.all([
      ...updatePromises,
      ...(newRows.length > 0 ? [workingFileRepo.insert(newRows)] : []),
    ]);
    
    logger.info('Synced main DB files to VCS', { projectId, branchId, fileCount: dbFiles.length, updated: updatePromises.length, inserted: newRows.length, ms: Date.now() - syncStart });
  }
}

export const vcsFileService = new VcsFileService();
