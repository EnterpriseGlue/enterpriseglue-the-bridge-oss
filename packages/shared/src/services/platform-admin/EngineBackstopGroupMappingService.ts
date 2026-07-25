import { getDataSource } from '../../db/data-source.js';
import { Engine } from '../../infrastructure/persistence/entities/Engine.js';
import { EngineBackstopGroupMapping } from '../../infrastructure/persistence/entities/EngineBackstopGroupMapping.js';
import { AuthzGroup } from '../../infrastructure/persistence/entities/AuthzGroup.js';
import { Errors } from '../../middleware/errorHandler.js';
import {
  EngineBackstopGroupMappingInputSchema,
  EngineBackstopGroupMappingSummarySchema,
  EngineBackstopGroupMappingWriteRequestSchema,
  EngineBackstopGroupMappingWriteResponseSchema,
  type EngineBackstopGroupMappingInput,
  type EngineBackstopGroupMappingSummary,
  type EngineBackstopGroupMappingWriteRequest,
  type EngineBackstopGroupMappingWriteResponse,
} from '../../schemas/platform-admin/engine-backstop.js';
import { decrypt, encrypt, hash } from '../encryption.js';
import { generateId } from '../../utils/id.js';

export interface WriteEngineBackstopGroupMappingsInput {
  engineId: string;
  request: EngineBackstopGroupMappingWriteRequest;
  actorId?: string | null;
  source?: 'manual' | 'config';
  ownershipMode?: 'manual' | 'config_locked' | 'config_warn';
}

function mappingError(
  code: 'ENGINE_BACKSTOP_ENGINE_NOT_SUPPORTED' | 'ENGINE_BACKSTOP_ENGINE_INACTIVE' | 'ENGINE_BACKSTOP_GROUP_NOT_USABLE' | 'ENGINE_BACKSTOP_MAPPING_CONFLICT',
  message: string,
  status = 400,
) {
  return Errors.withCode(code, message, status, 'backstop');
}

function nativeGroupReference(nativeGroupId: string): string {
  return `camunda-group-${hash(nativeGroupId).slice(0, 24)}`;
}

function mappingSourceHash(input: { engineId: string; authzGroupId: string; nativeGroupId: string; isActive: boolean }): string {
  return hash([input.engineId, input.authzGroupId, input.nativeGroupId, String(input.isActive)].join('\u0000'));
}

function summaryFor(mapping: EngineBackstopGroupMapping): EngineBackstopGroupMappingSummary {
  return EngineBackstopGroupMappingSummarySchema.parse({
    id: mapping.id,
    tenantId: mapping.tenantId || null,
    engineId: mapping.engineId,
    authzGroupId: mapping.authzGroupId,
    nativeGroupReference: mapping.nativeGroupReference,
    source: mapping.source === 'config' ? 'config' : 'manual',
    ownershipMode: mapping.ownershipMode === 'config_locked' || mapping.ownershipMode === 'config_warn' ? mapping.ownershipMode : 'manual',
    isActive: mapping.isActive,
    createdById: mapping.createdById || null,
    createdAt: Number(mapping.createdAt),
    updatedAt: Number(mapping.updatedAt),
  });
}

function normalized(value: string): string {
  return value.trim();
}

/**
 * Owns only the encrypted native-group mapping. It never returns a decrypted
 * native ID to list callers; projection obtains it internally immediately
 * before the native operation.
 */
export class EngineBackstopGroupMappingService {
  async list(engineId: string): Promise<EngineBackstopGroupMappingSummary[]> {
    const dataSource = await getDataSource();
    await this.engineFor(dataSource, engineId);
    const rows = await dataSource.getRepository(EngineBackstopGroupMapping).find({
      where: { engineId: normalized(engineId) },
      order: { tenantId: 'ASC', authzGroupId: 'ASC', createdAt: 'ASC' },
    });
    return rows.map(summaryFor);
  }

  async write(input: WriteEngineBackstopGroupMappingsInput): Promise<EngineBackstopGroupMappingWriteResponse> {
    const request = EngineBackstopGroupMappingWriteRequestSchema.parse(input.request);
    const engineId = normalized(input.engineId);
    const source = input.source || 'manual';
    const ownershipMode = input.ownershipMode || 'manual';
    const dataSource = await getDataSource();
    const engine = await this.engineFor(dataSource, engineId);
    const seenGroups = new Set<string>();
    const seenNativeReferences = new Set<string>();
    const resolved: Array<{ item: (typeof request.mappings)[number]; group: AuthzGroup; reference: string }> = [];
    for (const item of request.mappings) {
      const authzGroupId = normalized(item.authzGroupId);
      const nativeGroupId = normalized(item.nativeGroupId);
      const reference = nativeGroupReference(nativeGroupId);
      if (seenGroups.has(authzGroupId) || seenNativeReferences.has(reference)) {
        throw mappingError('ENGINE_BACKSTOP_MAPPING_CONFLICT', 'The mapping request contains duplicate authorization or native groups');
      }
      seenGroups.add(authzGroupId);
      seenNativeReferences.add(reference);
      const group = await dataSource.getRepository(AuthzGroup).findOne({ where: { id: authzGroupId } });
      this.assertGroupUsable(engine, group, authzGroupId);
      resolved.push({ item: { ...item, authzGroupId, nativeGroupId }, group: group!, reference });
    }

    return dataSource.transaction(async (store) => {
      const repo = store.getRepository(EngineBackstopGroupMapping);
      const existing = await repo.find({ where: { engineId } });
      const byGroup = new Map(existing.map((row) => [row.authzGroupId, row]));
      const byNativeReference = new Map(existing.map((row) => [row.nativeGroupReference, row]));
      const output: EngineBackstopGroupMapping[] = [];
      const now = Date.now();
      for (const { item, group, reference } of resolved) {
        const current = byGroup.get(item.authzGroupId);
        const conflictingNative = byNativeReference.get(reference);
        if (conflictingNative && conflictingNative.authzGroupId !== item.authzGroupId) {
          throw mappingError('ENGINE_BACKSTOP_MAPPING_CONFLICT', 'A native Camunda group may map to only one EnterpriseGlue group per engine', 409);
        }
        if (current && current.source !== source && current.ownershipMode === 'config_locked') {
          throw mappingError('ENGINE_BACKSTOP_MAPPING_CONFLICT', 'The mapping is locked by its configuration source', 409);
        }
        const values = {
          tenantId: group.tenantId || null,
          authzGroupId: item.authzGroupId,
          encryptedNativeGroupId: encrypt(item.nativeGroupId),
          nativeGroupReference: reference,
          source,
          sourceRef: `authz-group:${item.authzGroupId}`,
          ownershipMode,
          sourceHash: mappingSourceHash({ engineId, authzGroupId: item.authzGroupId, nativeGroupId: item.nativeGroupId, isActive: item.isActive }),
          lastAppliedAt: now,
          isActive: item.isActive,
          createdById: input.actorId || null,
          updatedAt: now,
        };
        if (current) {
          await repo.update({ id: current.id }, values);
          const row = { ...current, ...values } as EngineBackstopGroupMapping;
          output.push(row);
          byNativeReference.delete(current.nativeGroupReference);
          byNativeReference.set(reference, row);
        } else {
          const row = { id: generateId(), engineId, ...values, createdAt: now } as EngineBackstopGroupMapping;
          await repo.insert(row);
          output.push(row);
          byGroup.set(row.authzGroupId, row);
          byNativeReference.set(reference, row);
        }
      }
      return EngineBackstopGroupMappingWriteResponseSchema.parse({
        mappings: output.map(summaryFor).sort((left, right) => left.authzGroupId.localeCompare(right.authzGroupId)),
      });
    });
  }

  async activeProjectionMappings(engineId: string, tenantId?: string | null): Promise<EngineBackstopGroupMappingInput[]> {
    const dataSource = await getDataSource();
    await this.engineFor(dataSource, engineId);
    const rows = await dataSource.getRepository(EngineBackstopGroupMapping).find({
      where: { engineId: normalized(engineId), isActive: true },
      order: { authzGroupId: 'ASC' },
    });
    const expectedTenantId = tenantId?.trim() || null;
    return rows
      .filter((row) => (row.tenantId || null) === expectedTenantId)
      .map((row) => {
        try {
          return EngineBackstopGroupMappingInputSchema.parse({
            authzGroupId: row.authzGroupId,
            nativeGroupId: decrypt(row.encryptedNativeGroupId),
            isActive: row.isActive,
          });
        } catch {
          throw mappingError('ENGINE_BACKSTOP_GROUP_NOT_USABLE', 'A native group mapping cannot be decrypted; replace it before synchronizing', 409);
        }
      });
  }

  private async engineFor(dataSource: Awaited<ReturnType<typeof getDataSource>>, engineId: string): Promise<Engine> {
    const engine = await dataSource.getRepository(Engine).findOne({ where: { id: normalized(engineId) } });
    if (!engine) throw Errors.notFound('Engine', engineId);
    if (engine.type !== 'camunda7') {
      throw mappingError('ENGINE_BACKSTOP_ENGINE_NOT_SUPPORTED', 'Mirrored authorization backstop is supported only for Camunda 7 engines');
    }
    if (engine.lifecycleStatus !== 'active') {
      throw mappingError('ENGINE_BACKSTOP_ENGINE_INACTIVE', 'Mirrored authorization backstop requires an active engine');
    }
    return engine;
  }

  private assertGroupUsable(engine: Engine, group: AuthzGroup | null, groupId: string): void {
    if (!group || group.isArchived) {
      throw mappingError('ENGINE_BACKSTOP_GROUP_NOT_USABLE', 'The EnterpriseGlue authorization group does not exist or is archived', 404);
    }
    if (engine.tenancyMode === 'dedicated' && (group.tenantId || null) !== (engine.tenantId || null)) {
      throw mappingError('ENGINE_BACKSTOP_GROUP_NOT_USABLE', 'A dedicated engine requires a group from its own tenant', 409);
    }
    if (!groupId) {
      throw mappingError('ENGINE_BACKSTOP_GROUP_NOT_USABLE', 'An EnterpriseGlue authorization group is required');
    }
  }
}

export const engineBackstopGroupMappingService = new EngineBackstopGroupMappingService();
