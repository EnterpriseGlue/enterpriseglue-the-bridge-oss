import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import type { RuntimeResourceSetSelector } from './RuntimeResourceInventoryService.js';

export interface RuntimeResourceSetInput {
  tenantId?: string | null; key: string; name: string; description?: string | null; engineId: string; resourceKind: string;
  selector: RuntimeResourceSetSelector; runtimeTenantId?: string | null; source?: string; sourceRef?: string | null; ownershipMode?: string;
  sourceHash?: string | null; lastAppliedAt?: number | null; driftStatus?: string | null; createdById?: string | null;
}

export interface RuntimeResourceSetUpdateInput {
  name?: string;
  description?: string | null;
  engineId?: string;
  resourceKind?: string;
  selector?: RuntimeResourceSetSelector;
  runtimeTenantId?: string | null;
  ownershipMode?: string;
  sourceHash?: string | null;
  lastAppliedAt?: number | null;
  driftStatus?: string | null;
  isArchived?: boolean;
}

export function runtimeResourceSetKeyIdentity(tenantId: string | null | undefined, key: string): string { return `${tenantId || 'platform'}:${key.trim()}`; }
function stable(value: unknown): string { if (!value || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`; }
export class RuntimeResourceSetService {
  async create(input: RuntimeResourceSetInput, store?: DataSource | EntityManager): Promise<{ id: string }> {
    const key = input.key.trim(); if (!key || !input.name.trim()) throw new Error('Runtime Resource Set key and name are required');
    const repo = (store || await getDataSource()).getRepository(RuntimeResourceSet); const id = generateId(); const now = Date.now();
    const source = input.source || 'manual';
    await repo.insert({ id, tenantId: input.tenantId || null, key, runtimeResourceSetKeyIdentity: runtimeResourceSetKeyIdentity(input.tenantId, key), name: input.name.trim(), description: input.description || null, engineId: input.engineId, resourceKind: input.resourceKind, selectorJson: JSON.stringify(input.selector), selectorFingerprint: createHash('sha256').update(stable(input.selector)).digest('hex'), runtimeTenantId: input.runtimeTenantId || null, source, sourceRef: input.sourceRef || null, ownershipMode: input.ownershipMode || (source === 'config' ? 'config_locked' : 'manual'), sourceHash: input.sourceHash || null, lastAppliedAt: input.lastAppliedAt || null, driftStatus: input.driftStatus || null, isArchived: false, createdById: input.createdById || null, createdAt: now, updatedAt: now });
    return { id };
  }

  async update(id: string, input: RuntimeResourceSetUpdateInput, store?: DataSource | EntityManager): Promise<void> {
    if (input.name !== undefined && !input.name.trim()) throw new Error('Runtime Resource Set name is required');
    if (input.resourceKind !== undefined && !input.resourceKind.trim()) throw new Error('Runtime Resource Set resource kind is required');

    const repo = (store || await getDataSource()).getRepository(RuntimeResourceSet);
    const values: Record<string, unknown> = { updatedAt: Date.now() };
    if (input.name !== undefined) values.name = input.name.trim();
    if (input.description !== undefined) values.description = input.description || null;
    if (input.engineId !== undefined) values.engineId = input.engineId;
    if (input.resourceKind !== undefined) values.resourceKind = input.resourceKind;
    if (input.selector !== undefined) {
      values.selectorJson = JSON.stringify(input.selector);
      values.selectorFingerprint = createHash('sha256').update(stable(input.selector)).digest('hex');
    }
    if (input.runtimeTenantId !== undefined) values.runtimeTenantId = input.runtimeTenantId || null;
    if (input.ownershipMode !== undefined) values.ownershipMode = input.ownershipMode;
    if (input.sourceHash !== undefined) values.sourceHash = input.sourceHash;
    if (input.lastAppliedAt !== undefined) values.lastAppliedAt = input.lastAppliedAt;
    if (input.driftStatus !== undefined) values.driftStatus = input.driftStatus;
    if (input.isArchived !== undefined) values.isArchived = input.isArchived;
    await repo.update({ id }, values);
  }

  async archive(id: string, input: Pick<RuntimeResourceSetUpdateInput, 'ownershipMode' | 'sourceHash' | 'lastAppliedAt' | 'driftStatus'> = {}, store?: DataSource | EntityManager): Promise<void> {
    await this.update(id, { ...input, isArchived: true }, store);
  }
}
export const runtimeResourceSetService = new RuntimeResourceSetService();
