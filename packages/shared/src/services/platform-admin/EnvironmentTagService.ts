/**
 * Environment Tag Service
 * Manages environment tags (Dev, Test, Staging, Production)
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { EnvironmentTag } from '@enterpriseglue/shared/infrastructure/persistence/entities/EnvironmentTag.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { hashCanonicalConfig } from './config-bundle-hash.js';
import { adminConfigScopeKey } from './AdminConfigObjectOwnershipService.js';

type Store = DataSource | EntityManager;

const SEEDED_ENVIRONMENT_TAGS: Record<string, Array<{
  name: string;
  color: string;
  manualDeployAllowed: boolean;
  sortOrder: number;
}>> = {
  'env-dev': [
    { name: 'Dev', color: '#22c55e', manualDeployAllowed: true, sortOrder: 0 },
    { name: 'Dev', color: '#24a148', manualDeployAllowed: true, sortOrder: 0 },
  ],
  'env-test': [
    { name: 'Test', color: '#eab308', manualDeployAllowed: true, sortOrder: 1 },
    { name: 'Test', color: '#f1c21b', manualDeployAllowed: true, sortOrder: 1 },
  ],
  'env-staging': [
    { name: 'Staging', color: '#f97316', manualDeployAllowed: false, sortOrder: 2 },
    { name: 'Staging', color: '#ff832b', manualDeployAllowed: true, sortOrder: 2 },
  ],
  'env-production': [
    { name: 'Production', color: '#ef4444', manualDeployAllowed: false, sortOrder: 3 },
    { name: 'Production', color: '#da1e28', manualDeployAllowed: false, sortOrder: 3 },
  ],
};

/** Product seed rows are safe for the first headless apply to supersede. */
export function isProductSeededEnvironmentTag(tag: EnvironmentTag): boolean {
  if (tag.configKey || tag.sourceRef || tag.sourceHash || tag.lastAppliedAt || Number(tag.configGeneration || 0) !== 0) return false;
  return (SEEDED_ENVIRONMENT_TAGS[tag.id] || []).some((seed) =>
    tag.name === seed.name
    && tag.color.toLowerCase() === seed.color.toLowerCase()
    && tag.manualDeployAllowed === seed.manualDeployAllowed
    && tag.sortOrder === seed.sortOrder);
}

function tagFingerprint(tag: {
  key: string;
  name: string;
  color: string;
  manualDeployAllowed: boolean;
  sortOrder: number;
  isDefault: boolean;
  ownershipMode: string;
}): string {
  return hashCanonicalConfig({ kind: 'environment_tag', key: tag.key, value: tag });
}

async function claimManualTags(repo: Repository<EnvironmentTag>, tags: EnvironmentTag[]): Promise<void> {
  const locked = tags.find((tag) => tag.sourceRef && tag.ownershipMode === 'config_locked');
  if (locked) throw Errors.forbidden(`Environment tag ${locked.name} is managed by configuration`);
  const now = Date.now();
  for (const tag of tags) {
    const generation = Number(tag.configGeneration || 0);
    const result = await repo.update(
      { id: tag.id, configGeneration: generation },
      {
        configGeneration: generation + 1,
        driftStatus: tag.sourceRef && tag.ownershipMode === 'config_warn' ? 'drifted' : tag.driftStatus,
        updatedAt: now,
      },
    );
    if (result.affected !== 1) throw Errors.conflict('Environment tags changed; reload and retry');
  }
}

export class EnvironmentTagService {
  /**
   * Get all environment tags ordered by sortOrder
   */
  async getAll(store?: Store): Promise<EnvironmentTag[]> {
    const dataSource = store || await getDataSource();
    const tagRepo = dataSource.getRepository(EnvironmentTag);
    return tagRepo.find({ order: { sortOrder: 'ASC' } });
  }

  /**
   * Get an environment tag by ID
   */
  async getById(id: string, store?: Store): Promise<EnvironmentTag | null> {
    const dataSource = store || await getDataSource();
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
      configKey: null,
      sourceRef: null,
      configScopeKey: null,
      ownershipMode: 'manual' as const,
      sourceHash: null,
      lastAppliedAt: null,
      driftStatus: null,
      configGeneration: 0,
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
  }>, store?: Store): Promise<void> {
    if (!store) {
      const dataSource = await getDataSource();
      await dataSource.transaction((manager) => this.update(id, data, manager));
      return;
    }
    const dataSource = store;
    const tagRepo = dataSource.getRepository(EnvironmentTag);
    const existing = await tagRepo.findOneBy({ id });
    if (!existing) throw Errors.notFound('Environment tag', id);
    const defaults = data.isDefault
      ? await tagRepo.find({ where: { isDefault: true } })
      : [];
    const claimed = [...defaults, existing].filter((tag, index, tags) => tags.findIndex((candidate) => candidate.id === tag.id) === index);
    await claimManualTags(tagRepo, claimed);
    
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
  async delete(id: string, store?: Store): Promise<void> {
    if (!store) {
      const dataSource = await getDataSource();
      await dataSource.transaction((manager) => this.delete(id, manager));
      return;
    }
    const dataSource = store;
    const tagRepo = dataSource.getRepository(EnvironmentTag);
    const engineRepo = dataSource.getRepository(Engine);
    
    const existing = await tagRepo.findOneBy({ id });
    if (!existing) throw Errors.notFound('Environment tag', id);
    await claimManualTags(tagRepo, [existing]);

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
  async reorder(orderedIds: string[], store?: Store): Promise<void> {
    if (!store) {
      const dataSource = await getDataSource();
      await dataSource.transaction((manager) => this.reorder(orderedIds, manager));
      return;
    }
    const dataSource = store;
    const tagRepo = dataSource.getRepository(EnvironmentTag);
    const now = Date.now();

    // Limit to reasonable maximum to prevent DoS
    const MAX_TAGS = 1000;
    const length = Math.min(orderedIds.length, MAX_TAGS);
    const selected = (await tagRepo.find()).filter((tag) => orderedIds.slice(0, length).includes(tag.id));
    await claimManualTags(tagRepo, selected);
    
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

  /** Applies config-owned tags atomically and removes only absent tags owned by the same source. */
  async applyConfiguration(
    store: Store,
    desiredTags: Array<{
      key: string;
      name: string;
      color: string;
      manualDeployAllowed: boolean;
      sortOrder: number;
      isDefault: boolean;
      ownershipMode: 'manual' | 'config_locked' | 'config_warn';
    }>,
    input: {
      sourceRef: string;
      tenantId?: string | null;
      mode: 'additive' | 'authoritative' | 'preview_only';
      appliedAt: number;
      expectedGenerations?: Record<string, { updatedAt: number; generation: number }>;
    },
  ): Promise<void> {
    const tagRepo = store.getRepository(EnvironmentTag);
    const engineRepo = store.getRepository(Engine);
    const settingsRepo = store.getRepository(PlatformSettings);
    const existing = await tagRepo.find();
    const byKey = new Map(existing.filter((tag) => tag.configKey).map((tag) => [tag.configKey!, tag]));
    const byName = new Map(existing.map((tag) => [tag.name.toLowerCase(), tag]));
    const desiredKeys = new Set(desiredTags.map((tag) => tag.key));
    const scopeKey = adminConfigScopeKey(input.tenantId);

    for (const desired of desiredTags) {
      const current = byKey.get(desired.key) || byName.get(desired.name.toLowerCase());
      if (current?.sourceRef && (current.sourceRef !== input.sourceRef || current.configScopeKey !== scopeKey)) {
        throw Errors.conflict(`Environment tag ${desired.key} is owned by another configuration bundle`);
      }
    }

    const desiredDefault = desiredTags.find((tag) => tag.isDefault);
    if (desiredDefault) {
      const target = byKey.get(desiredDefault.key) || byName.get(desiredDefault.name.toLowerCase());
      for (const current of existing.filter((tag) => tag.isDefault && tag.id !== target?.id)) {
        if (current.sourceRef !== input.sourceRef && !isProductSeededEnvironmentTag(current)) {
          throw Errors.conflict('The default environment tag is manual or owned by another configuration bundle');
        }
      }
      await tagRepo.update({ isDefault: true }, { isDefault: false, updatedAt: input.appliedAt });
    }

    for (const desired of desiredTags) {
      const current = byKey.get(desired.key) || byName.get(desired.name.toLowerCase());
      const sourceHash = tagFingerprint(desired);
      if (!current) {
        await tagRepo.insert({
          id: generateId(),
          name: desired.name,
          color: desired.color,
          manualDeployAllowed: desired.manualDeployAllowed,
          sortOrder: desired.sortOrder,
          isDefault: desired.isDefault,
          configKey: desired.key,
          sourceRef: input.sourceRef,
          configScopeKey: scopeKey,
          ownershipMode: desired.ownershipMode,
          sourceHash,
          lastAppliedAt: input.appliedAt,
          driftStatus: 'in_sync',
          configGeneration: 1,
          createdAt: input.appliedAt,
          updatedAt: input.appliedAt,
        });
        continue;
      }
      const generation = Number(current.configGeneration || 0);
      const expected = input.expectedGenerations?.[desired.key];
      if (!expected || expected.generation !== generation || expected.updatedAt !== Number(current.updatedAt)) {
        throw Errors.conflict('Environment tags changed after preview; run diff again');
      }
      const updated = await tagRepo.update(
        { id: current.id, configGeneration: expected.generation, updatedAt: expected.updatedAt },
        {
          name: desired.name,
          color: desired.color,
          manualDeployAllowed: desired.manualDeployAllowed,
          sortOrder: desired.sortOrder,
          isDefault: desired.isDefault,
          configKey: desired.key,
          sourceRef: input.sourceRef,
          configScopeKey: scopeKey,
          ownershipMode: desired.ownershipMode,
          sourceHash,
          lastAppliedAt: input.appliedAt,
          driftStatus: 'in_sync',
          configGeneration: generation + 1,
          updatedAt: input.appliedAt,
        },
      );
      if (updated.affected !== 1) throw Errors.conflict('Environment tags changed after preview; run diff again');
    }

    if (input.mode !== 'authoritative') return;
    for (const current of existing.filter((tag) =>
      tag.sourceRef === input.sourceRef
      && tag.configScopeKey === scopeKey
      && tag.configKey
      && !desiredKeys.has(tag.configKey))) {
      const [engine, settings] = await Promise.all([
        engineRepo.findOne({ where: { environmentTagId: current.id }, select: ['id'] }),
        settingsRepo.findOne({ where: { defaultEnvironmentTagId: current.id }, select: ['id'] }),
      ]);
      if (engine || settings) {
        throw Errors.conflict(`Cannot remove environment tag ${current.configKey} while it is referenced`);
      }
      const generation = Number(current.configGeneration || 0);
      const expected = input.expectedGenerations?.[current.configKey!];
      if (!expected || expected.generation !== generation || expected.updatedAt !== Number(current.updatedAt)) {
        throw Errors.conflict('Environment tags changed after preview; run diff again');
      }
      const removed = await tagRepo.delete({ id: current.id, configGeneration: expected.generation, updatedAt: expected.updatedAt });
      if (removed.affected !== 1) throw Errors.conflict('Environment tags changed after preview; run diff again');
    }
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
          configKey: null,
          sourceRef: null,
          configScopeKey: null,
          ownershipMode: 'manual',
          sourceHash: null,
          lastAppliedAt: null,
          driftStatus: null,
          configGeneration: 0,
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
