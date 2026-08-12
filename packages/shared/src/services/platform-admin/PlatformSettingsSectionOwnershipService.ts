import { In, type DataSource, type EntityManager } from 'typeorm';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import {
  PlatformSettingsSectionOwnership,
  type PlatformSettingsSection,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettingsSectionOwnership.js';

type Store = DataSource | EntityManager;

export interface PlatformSettingsSectionOwnershipState {
  section: PlatformSettingsSection;
  scopeKey: string;
  sourceRef: string | null;
  ownershipMode: 'manual' | 'config_locked' | 'config_warn';
  sourceHash: string | null;
  lastAppliedAt: number | null;
  driftStatus: 'in_sync' | 'drifted' | null;
  generation: number;
}

const SETTINGS_ID = 'default';

function ownershipId(section: PlatformSettingsSection): string {
  return `${SETTINGS_ID}:${section}`;
}

function numericGeneration(value: unknown): number {
  const generation = Number(value || 0);
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;
}

export class PlatformSettingsSectionOwnershipService {
  async list(store: Store): Promise<PlatformSettingsSectionOwnershipState[]> {
    const rows = await store.getRepository(PlatformSettingsSectionOwnership).find({
      where: { settingsId: SETTINGS_ID },
      order: { section: 'ASC' },
    });
    return rows.map((row) => ({
      section: row.section,
      scopeKey: row.scopeKey || 'platform',
      sourceRef: row.sourceRef || null,
      ownershipMode: row.ownershipMode || 'manual',
      sourceHash: row.sourceHash || null,
      lastAppliedAt: row.lastAppliedAt === null || row.lastAppliedAt === undefined ? null : Number(row.lastAppliedAt),
      driftStatus: row.driftStatus || null,
      generation: numericGeneration(row.generation),
    }));
  }

  /**
   * Claims the exact current section generation before a portal/API mutation.
   * Locked sections fail closed; warning-owned sections retain ownership and
   * record drift in the same transaction as the settings write.
   */
  async claimManualMutation(store: Store, sections: PlatformSettingsSection[]): Promise<void> {
    const uniqueSections = [...new Set(sections)];
    if (uniqueSections.length === 0) return;
    const repo = store.getRepository(PlatformSettingsSectionOwnership);
    const rows = await repo.find({ where: { settingsId: SETTINGS_ID, section: In(uniqueSections) } });
    const locked = rows.find((row) => row.ownershipMode === 'config_locked' && Boolean(row.sourceRef));
    if (locked) {
      throw Errors.forbidden(`Platform ${locked.section} settings are managed by configuration`);
    }
    const now = Date.now();
    for (const row of rows) {
      const generation = numericGeneration(row.generation);
      const result = await repo.update(
        { id: row.id, generation },
        {
          generation: generation + 1,
          driftStatus: row.ownershipMode === 'config_warn' && row.sourceRef ? 'drifted' : row.driftStatus,
          updatedAt: now,
        },
      );
      if (result.affected !== 1) throw Errors.conflict('Platform settings ownership changed; reload and retry');
    }
  }

  /** Claims and advances all supplied sections for a hash-bound config apply. */
  async claimConfiguration(
    store: Store,
    input: {
      sections: PlatformSettingsSection[];
      scopeKey: string;
      sourceRef: string;
      ownershipMode: 'manual' | 'config_locked' | 'config_warn';
      sourceHash: string;
      appliedAt: number;
      expectedGeneration?: number;
    },
  ): Promise<void> {
    const sections = [...new Set(input.sections)];
    if (sections.length === 0) return;
    const repo = store.getRepository(PlatformSettingsSectionOwnership);
    const existing = await repo.find({ where: { settingsId: SETTINGS_ID, section: In(sections) } });
    const existingBySection = new Map(existing.map((row) => [row.section, row]));
    for (const section of sections) {
      const row = existingBySection.get(section);
      if (row?.sourceRef && (row.sourceRef !== input.sourceRef || (row.scopeKey || 'platform') !== input.scopeKey)) {
        throw Errors.conflict(`Platform ${section} settings are owned by another configuration bundle`);
      }
      if (!row) {
        await repo.insert({
          id: ownershipId(section),
          settingsId: SETTINGS_ID,
          section,
          scopeKey: input.scopeKey,
          sourceRef: input.sourceRef,
          ownershipMode: input.ownershipMode,
          sourceHash: input.sourceHash,
          lastAppliedAt: input.appliedAt,
          driftStatus: 'in_sync',
          generation: 1,
          updatedAt: input.appliedAt,
        });
        continue;
      }
      const generation = numericGeneration(row.generation);
      if (input.expectedGeneration !== undefined && input.expectedGeneration !== generation) {
        throw Errors.conflict('Platform settings changed after preview; run diff again');
      }
      const result = await repo.update(
        { id: row.id, generation },
        {
          scopeKey: input.scopeKey,
          sourceRef: input.sourceRef,
          ownershipMode: input.ownershipMode,
          sourceHash: input.sourceHash,
          lastAppliedAt: input.appliedAt,
          driftStatus: 'in_sync',
          generation: generation + 1,
          updatedAt: input.appliedAt,
        },
      );
      if (result.affected !== 1) throw Errors.conflict('Platform settings changed after preview; run diff again');
    }
  }
}

export const platformSettingsSectionOwnershipService = new PlatformSettingsSectionOwnershipService();
