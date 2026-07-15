import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import type { RuntimeResourceSetSelector } from './RuntimeResourceInventoryService.js';

export interface RuntimeResourceSetInput {
  tenantId?: string | null; key: string; name: string; description?: string | null; engineId: string; resourceKind: string;
  selector: RuntimeResourceSetSelector; runtimeTenantId?: string | null; source?: string; sourceRef?: string | null;
  sourceHash?: string | null; lastAppliedAt?: number | null; driftStatus?: string | null; createdById?: string | null;
}
export function runtimeResourceSetKeyIdentity(tenantId: string | null | undefined, key: string): string { return `${tenantId || 'platform'}:${key.trim()}`; }
function stable(value: unknown): string { if (!value || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`; }
export class RuntimeResourceSetService {
  async create(input: RuntimeResourceSetInput, store?: DataSource | EntityManager): Promise<{ id: string }> {
    const key = input.key.trim(); if (!key || !input.name.trim()) throw new Error('Runtime Resource Set key and name are required');
    const repo = (store || await getDataSource()).getRepository(RuntimeResourceSet); const id = generateId(); const now = Date.now();
    await repo.insert({ id, tenantId: input.tenantId || null, key, runtimeResourceSetKeyIdentity: runtimeResourceSetKeyIdentity(input.tenantId, key), name: input.name.trim(), description: input.description || null, engineId: input.engineId, resourceKind: input.resourceKind, selectorJson: JSON.stringify(input.selector), selectorFingerprint: createHash('sha256').update(stable(input.selector)).digest('hex'), runtimeTenantId: input.runtimeTenantId || null, source: input.source || 'manual', sourceRef: input.sourceRef || null, sourceHash: input.sourceHash || null, lastAppliedAt: input.lastAppliedAt || null, driftStatus: input.driftStatus || null, isArchived: false, createdById: input.createdById || null, createdAt: now, updatedAt: now });
    return { id };
  }
}
export const runtimeResourceSetService = new RuntimeResourceSetService();
