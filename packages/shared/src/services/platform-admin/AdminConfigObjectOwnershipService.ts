import type { DataSource, EntityManager } from 'typeorm';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import {
  AdminConfigObjectOwnership,
  type AdminConfigObjectType,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/AdminConfigObjectOwnership.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';

type Store = DataSource | EntityManager;
export type AdminConfigOwnershipMode = 'config_locked' | 'config_warn' | 'manual';

export interface AdminConfigOwnershipFields {
  configKey: string | null;
  sourceRef: string | null;
  ownershipMode: AdminConfigOwnershipMode;
  driftStatus: 'in_sync' | 'drifted' | null;
}

export function adminConfigOwnershipFields(
  ownership?: AdminConfigObjectOwnership | null,
): AdminConfigOwnershipFields {
  return ownership?.active
    ? {
        configKey: ownership.configKey,
        sourceRef: ownership.sourceRef,
        ownershipMode: ownership.ownershipMode,
        driftStatus: ownership.driftStatus,
      }
    : {
        configKey: null,
        sourceRef: null,
        ownershipMode: 'manual',
        driftStatus: null,
      };
}

export function adminConfigScopeKey(tenantId?: string | null): string {
  return tenantId?.trim() || 'platform';
}

export function adminConfigKeyIdentity(
  objectType: AdminConfigObjectType,
  tenantId: string | null | undefined,
  configKey: string,
): string {
  return `${objectType}:${adminConfigScopeKey(tenantId)}:${configKey}`;
}

export function adminConfigObjectLabel(objectType: AdminConfigObjectType): string {
  return objectType.replace(/_/g, ' ');
}

function secretReferencesJson(references?: Record<string, string | null> | null): string | null {
  if (!references) return null;
  const present = Object.fromEntries(
    Object.entries(references)
      .filter(([, value]) => typeof value === 'string' && value.length > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return Object.keys(present).length ? JSON.stringify(present) : null;
}

export function parseAdminConfigSecretReferences(value: string | null | undefined): Record<string, string> {
  try {
    const parsed = value ? JSON.parse(value) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

export class AdminConfigObjectOwnershipService {
  async findForObject(
    store: Store,
    objectType: AdminConfigObjectType,
    objectId: string,
  ): Promise<AdminConfigObjectOwnership | null> {
    return store.getRepository(AdminConfigObjectOwnership).findOneBy({ objectType, objectId });
  }

  async findForConfigKey(
    store: Store,
    objectType: AdminConfigObjectType,
    tenantId: string | null | undefined,
    configKey: string,
  ): Promise<AdminConfigObjectOwnership | null> {
    return store.getRepository(AdminConfigObjectOwnership).findOneBy({
      keyIdentity: adminConfigKeyIdentity(objectType, tenantId, configKey),
      active: true,
    });
  }

  async listForSource(
    store: Store,
    sourceRef: string,
    tenantId: string | null | undefined,
    objectType?: AdminConfigObjectType,
    includeInactive = false,
  ): Promise<AdminConfigObjectOwnership[]> {
    return store.getRepository(AdminConfigObjectOwnership).find({
      where: {
        sourceRef,
        scopeKey: adminConfigScopeKey(tenantId),
        ...(includeInactive ? {} : { active: true }),
        ...(objectType ? { objectType } : {}),
      },
      order: { objectType: 'ASC', configKey: 'ASC' },
    });
  }

  async listForObjectType(
    store: Store,
    objectType: AdminConfigObjectType,
  ): Promise<AdminConfigObjectOwnership[]> {
    return store.getRepository(AdminConfigObjectOwnership).find({
      where: { objectType, active: true },
      order: { configKey: 'ASC' },
    });
  }

  async claimManualMutation(
    store: Store,
    objectType: AdminConfigObjectType,
    objectId: string,
  ): Promise<AdminConfigObjectOwnership | null> {
    const repo = store.getRepository(AdminConfigObjectOwnership);
    const current = await repo.findOneBy({ objectType, objectId, active: true });
    if (!current) return null;
    if (current.ownershipMode === 'config_locked') {
      throw Errors.forbidden(`${adminConfigObjectLabel(objectType)} ${current.configKey} is managed by configuration`);
    }
    const generation = Number(current.generation || 0);
    const updated = await repo.update(
      { id: current.id, generation, active: true },
      {
        generation: generation + 1,
        driftStatus: current.ownershipMode === 'config_warn' ? 'drifted' : current.driftStatus,
        updatedAt: Date.now(),
      },
    );
    if (updated.affected !== 1) throw Errors.conflict('Administrative configuration changed; reload and retry');
    return { ...current, generation: generation + 1, driftStatus: current.ownershipMode === 'config_warn' ? 'drifted' : current.driftStatus };
  }

  async claimConfiguration(
    store: Store,
    input: {
      objectType: AdminConfigObjectType;
      objectId: string;
      tenantId?: string | null;
      configKey: string;
      sourceRef: string;
      ownershipMode: AdminConfigOwnershipMode;
      sourceHash: string;
      secretReferences?: Record<string, string | null> | null;
      appliedAt: number;
      expectedGeneration?: number;
    },
  ): Promise<AdminConfigObjectOwnership> {
    const repo = store.getRepository(AdminConfigObjectOwnership);
    const keyIdentity = adminConfigKeyIdentity(input.objectType, input.tenantId, input.configKey);
    const matches = await repo.find({
      where: [
        { objectType: input.objectType, objectId: input.objectId },
        { keyIdentity },
      ],
    });
    const current = matches[0] || null;
    if (matches.some((candidate) => candidate.id !== current?.id)) {
      throw Errors.conflict(`Configuration key ${input.configKey} and target object resolve to different ownership records`);
    }
    if (current?.sourceRef && current.sourceRef !== input.sourceRef) {
      throw Errors.conflict(`${adminConfigObjectLabel(input.objectType)} ${input.configKey} is owned by another configuration bundle`);
    }
    if (current && (current.objectId !== input.objectId || current.keyIdentity !== keyIdentity)) {
      throw Errors.conflict(`Configuration key ${input.configKey} is already bound to another object`);
    }
    const referencesJson = secretReferencesJson(input.secretReferences);
    if (!current) {
      const created = {
        id: generateId(),
        objectType: input.objectType,
        objectId: input.objectId,
        scopeKey: adminConfigScopeKey(input.tenantId),
        configKey: input.configKey,
        keyIdentity,
        sourceRef: input.sourceRef,
        ownershipMode: input.ownershipMode,
        sourceHash: input.sourceHash,
        secretReferencesJson: referencesJson,
        lastAppliedAt: input.appliedAt,
        driftStatus: 'in_sync' as const,
        active: true,
        generation: 1,
        updatedAt: input.appliedAt,
      };
      await repo.insert(created);
      return created as AdminConfigObjectOwnership;
    }
    const generation = Number(current.generation || 0);
    if (input.expectedGeneration !== undefined && generation !== input.expectedGeneration) {
      throw Errors.conflict('Administrative configuration changed after preview; run diff again');
    }
    const updated = await repo.update(
      { id: current.id, generation },
      {
        objectId: input.objectId,
        scopeKey: adminConfigScopeKey(input.tenantId),
        configKey: input.configKey,
        keyIdentity,
        sourceRef: input.sourceRef,
        ownershipMode: input.ownershipMode,
        sourceHash: input.sourceHash,
        secretReferencesJson: referencesJson,
        lastAppliedAt: input.appliedAt,
        driftStatus: 'in_sync',
        active: true,
        generation: generation + 1,
        updatedAt: input.appliedAt,
      },
    );
    if (updated.affected !== 1) throw Errors.conflict('Administrative configuration changed after preview; run diff again');
    return {
      ...current,
      ...input,
      scopeKey: adminConfigScopeKey(input.tenantId),
      keyIdentity,
      secretReferencesJson: referencesJson,
      lastAppliedAt: input.appliedAt,
      driftStatus: 'in_sync',
      active: true,
      generation: generation + 1,
      updatedAt: input.appliedAt,
    } as AdminConfigObjectOwnership;
  }

  async deactivateConfiguration(
    store: Store,
    ownership: AdminConfigObjectOwnership,
    appliedAt: number,
  ): Promise<void> {
    const repo = store.getRepository(AdminConfigObjectOwnership);
    const generation = Number(ownership.generation || 0);
    const updated = await repo.update(
      { id: ownership.id, generation, active: true },
      { active: false, generation: generation + 1, updatedAt: appliedAt },
    );
    if (updated.affected !== 1) throw Errors.conflict('Administrative configuration changed after preview; run diff again');
  }
}

export const adminConfigObjectOwnershipService = new AdminConfigObjectOwnershipService();
