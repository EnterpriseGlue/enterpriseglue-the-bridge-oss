/**
 * Environment Tag Service
 * Manages environment tags (Dev, Test, Staging, Production)
 */

import { getDataSource } from '@shared/db/data-source.js';
import { logger } from '@shared/utils/logger.js';
import { EnvironmentTag } from '@shared/db/entities/EnvironmentTag.js';
import { Engine } from '@shared/db/entities/Engine.js';
import { generateId } from '@shared/utils/id.js';

export class EnvironmentTagService {
  /**
   * Get all environment tags ordered by sortOrder
   */
  async getAll(): Promise<EnvironmentTag[]> {
    const dataSource = await getDataSource();
    const tagRepo = dataSource.getRepository(EnvironmentTag);
    return tagRepo.find({ order: { sortOrder: 'ASC' } });
  }

  /**
   * Get an environment tag by ID
   */
  async getById(id: string): Promise<EnvironmentTag | null> {
    const dataSource = await getDataSource();
    const tagRepo = dataSource.getRepository(EnvironmentTag);
    return tagRepo.findOneBy({ id });
  }

  /**
   * Get the default environment tag
   */
  async getDefault(): Promise<EnvironmentTag | null> {
    const dataSource = await getDataSource();
    const tagRepo = dataSource.getRepository(EnvironmentTag);
    return tagRepo.findOneBy({ isDefault: true });
  }

  /**
   * Create a new environment tag
   */
  async create(data: {
    name: string;
    color?: string;
    manualDeployAllowed?: boolean;
  }): Promise<EnvironmentTag> {
    const dataSource = await getDataSource();
    const tagRepo = dataSource.getRepository(EnvironmentTag);
    const now = Date.now();
    
    // Get max sortOrder
    const existing = await this.getAll();
    const maxSortOrder = existing.length > 0 
      ? Math.max(...existing.map(t => t.sortOrder)) 
      : -1;

    const id = `env-${data.name.toLowerCase().replace(/\s+/g, '-')}`;
    
    const newTag = {
      id,
      name: data.name,
      color: data.color || '#6b7280',
      manualDeployAllowed: data.manualDeployAllowed ?? true,
      sortOrder: maxSortOrder + 1,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    };

    await tagRepo.insert(newTag);
    
    return { ...newTag } as EnvironmentTag;
  }

  /**
   * Update an environment tag
   */
  async update(id: string, data: Partial<{
    name: string;
    color: string;
    manualDeployAllowed: boolean;
    isDefault: boolean;
  }>): Promise<void> {
    const dataSource = await getDataSource();
    const tagRepo = dataSource.getRepository(EnvironmentTag);
    
    // If setting as default, unset other defaults
    if (data.isDefault) {
      await tagRepo.update({ isDefault: true }, { isDefault: false, updatedAt: Date.now() });
    }

    await tagRepo.update({ id }, { ...data, updatedAt: Date.now() });
  }

  /**
   * Delete an environment tag
   * Throws if tag is in use by any engine
   */
  async delete(id: string): Promise<void> {
    const dataSource = await getDataSource();
    const tagRepo = dataSource.getRepository(EnvironmentTag);
    const engineRepo = dataSource.getRepository(Engine);
    
    // Check if any engines use this tag
    const engineUsingTag = await engineRepo.findOne({
      where: { environmentTagId: id },
      select: ['id'],
    });

    if (engineUsingTag) {
      throw new Error('Cannot delete environment tag that is in use by engines');
    }

    await tagRepo.delete({ id });
  }

  /**
   * Reorder environment tags
   */
  async reorder(orderedIds: string[]): Promise<void> {
    const dataSource = await getDataSource();
    const tagRepo = dataSource.getRepository(EnvironmentTag);
    const now = Date.now();

    // Limit to reasonable maximum to prevent DoS
    const MAX_TAGS = 1000;
    const length = Math.min(orderedIds.length, MAX_TAGS);
    
    for (let i = 0; i < length; i++) {
      await tagRepo.update({ id: orderedIds[i] }, { sortOrder: i, updatedAt: now });
    }
  }

  /**
   * Set the default environment tag
   */
  async setDefault(id: string): Promise<void> {
    await this.update(id, { isDefault: true });
  }

  /**
   * Seed default environment tags if none exist
   * Creates: Dev, Test, Staging, Production
   */
  async seedDefaults(): Promise<void> {
    const existing = await this.getAll();
    if (existing.length > 0) {
      return; // Already have tags, don't seed
    }

    const dataSource = await getDataSource();
    const tagRepo = dataSource.getRepository(EnvironmentTag);
    const now = Date.now();

    const defaults = [
      { id: 'env-dev', name: 'Dev', color: '#24a148', manualDeployAllowed: true, sortOrder: 0 },
      { id: 'env-test', name: 'Test', color: '#f1c21b', manualDeployAllowed: true, sortOrder: 1 },
      { id: 'env-staging', name: 'Staging', color: '#ff832b', manualDeployAllowed: true, sortOrder: 2 },
      { id: 'env-production', name: 'Production', color: '#da1e28', manualDeployAllowed: false, sortOrder: 3 },
    ];

    for (const tag of defaults) {
      await tagRepo.createQueryBuilder()
        .insert()
        .values({
          ...tag,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        })
        .orIgnore()
        .execute();
    }

    logger.info('Seeded default environment tags: Dev, Test, Staging, Production');
  }
}

// Export singleton instance
export const environmentTagService = new EnvironmentTagService();
