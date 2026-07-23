import type { DataSource, EntityManager } from 'typeorm';
import { getDataSource } from '../../db/data-source.js';
import { Engine } from '../../infrastructure/persistence/entities/Engine.js';
import { EngineTenantMapping } from '../../infrastructure/persistence/entities/EngineTenantMapping.js';
import { RuntimeResource } from '../../infrastructure/persistence/entities/RuntimeResource.js';
import { Errors } from '../../middleware/errorHandler.js';
import type {
  EngineTenancyDiagnostics,
  EngineTenantMappingSource,
  EngineTenantMappingOwnershipMode,
  ExternalEngineTenantMappingsUpsertRequest,
  ExternalEngineTenantMappingsUpsertResponse,
} from '../../schemas/mission-control/engine.js';
import { ExternalEngineTenantMappingsUpsertRequestSchema } from '../../schemas/mission-control/engine.js';
import { generateId } from '../../utils/id.js';
import {
  engineTenancyProvisioningService,
  type EngineTenancyPrincipalType,
  type EngineTenantReferenceResolver,
} from './EngineTenancyProvisioningService.js';

type MappingSource = EngineTenantMappingSource;
type MappingOwnership = EngineTenantMappingOwnershipMode;

interface MappingWriteContext {
  engineId: string;
  request: ExternalEngineTenantMappingsUpsertRequest;
  requestTenantId?: string | null;
  principalType: EngineTenancyPrincipalType;
  principalId?: string | null;
  source: MappingSource;
  ownershipMode: MappingOwnership;
  resolver?: EngineTenantReferenceResolver | null;
}

type MappingRow = Omit<EngineTenantMapping, 'generateId'>;

interface ProspectiveMapping {
  row: MappingRow;
  status: 'created' | 'updated' | 'deactivated' | 'noop';
  index: number;
}

function mappingError(
  code:
    | 'ENGINE_TENANCY_CONFLICT'
    | 'ENGINE_TENANT_MAPPING_NOT_FOUND'
    | 'ENGINE_TENANT_MAPPING_VERSION_CONFLICT',
  message: string,
  status = 409,
) {
  return Errors.withCode(code, message, status, 'mappings');
}

function mappingIdentity(strategy: string, externalTenantId: string): string {
  return `${strategy}\u0000${externalTenantId}`;
}

function sourceIdentity(source: string, sourceRef: string): string {
  return `${source}\u0000${sourceRef}`;
}

function runtimeMappingKey(engine: Engine, resource: RuntimeResource): string {
  if (engine.tenantMappingStrategy === 'deployment_target') {
    return resource.projectId || '';
  }
  return resource.runtimeTenantId || '';
}

function matchingMappings(
  engine: Engine,
  resource: RuntimeResource,
  mappings: MappingRow[],
): MappingRow[] {
  const key = runtimeMappingKey(engine, resource);
  return mappings.filter((mapping) =>
    mapping.isActive
    && mapping.strategy === engine.tenantMappingStrategy
    && mapping.externalTenantId === key);
}

function diagnostics(
  engine: Pick<Engine, 'tenancyMode' | 'tenantId' | 'tenantMappingStrategy' | 'tenantResolutionStatus'>,
  resources: RuntimeResource[],
  mappingVersion: number,
  lastReconciledAt: number | string | null,
): EngineTenancyDiagnostics {
  return {
    mode: engine.tenancyMode as 'dedicated' | 'shared',
    tenantId: engine.tenantId || null,
    mappingStrategy: engine.tenantMappingStrategy as EngineTenancyDiagnostics['mappingStrategy'],
    mappingVersion,
    resolutionStatus: engine.tenantResolutionStatus as EngineTenancyDiagnostics['resolutionStatus'],
    lastReconciledAt: lastReconciledAt == null ? null : Number(lastReconciledAt),
    mappedResourceCount: resources.filter((resource) => resource.tenantResolutionStatus === 'resolved').length,
    unmappedResourceCount: resources.filter((resource) => resource.tenantResolutionStatus === 'unmapped').length,
    conflictingResourceCount: resources.filter((resource) => resource.tenantResolutionStatus === 'conflict').length,
  };
}

export class EngineTenantMappingService {
  async list(engineId: string): Promise<EngineTenantMapping[]> {
    const dataSource = await getDataSource();
    const engine = await dataSource.getRepository(Engine).findOne({ where: { id: engineId } });
    if (!engine) throw Errors.notFound('Engine', engineId);
    if (engine.tenancyMode !== 'shared') {
      throw mappingError('ENGINE_TENANCY_CONFLICT', 'Tenant mappings are available only for shared engines', 400);
    }
    return dataSource.getRepository(EngineTenantMapping).find({
      where: { engineId },
      order: { strategy: 'ASC', externalTenantId: 'ASC', source: 'ASC', sourceRef: 'ASC' },
    });
  }

  async getDiagnostics(engineId: string): Promise<EngineTenancyDiagnostics> {
    const dataSource = await getDataSource();
    const engine = await dataSource.getRepository(Engine).findOne({ where: { id: engineId } });
    if (!engine) throw Errors.notFound('Engine', engineId);
    const resources = await dataSource.getRepository(RuntimeResource).find({ where: { engineId, isActive: true } });
    return diagnostics(
      engine,
      resources,
      Number(engine.tenantMappingVersion || 0),
      engine.lastTenantReconciledAt == null ? null : Number(engine.lastTenantReconciledAt),
    );
  }

  async upsert(context: MappingWriteContext): Promise<ExternalEngineTenantMappingsUpsertResponse> {
    const requestPayload = ExternalEngineTenantMappingsUpsertRequestSchema.parse(context.request);
    const dataSource = await getDataSource();
    const engine = await dataSource.getRepository(Engine).findOne({ where: { id: context.engineId } });
    if (!engine) throw Errors.notFound('Engine', context.engineId);
    if (engine.tenancyMode !== 'shared' || !engine.tenantMappingStrategy) {
      throw mappingError('ENGINE_TENANCY_CONFLICT', 'Tenant mappings require a shared engine with a mapping strategy', 400);
    }
    if (
      requestPayload.expectedMappingVersion !== undefined
      && requestPayload.expectedMappingVersion !== Number(engine.tenantMappingVersion || 0)
    ) {
      throw mappingError(
        'ENGINE_TENANT_MAPPING_VERSION_CONFLICT',
        'The engine tenant mapping version has changed; refresh and retry',
      );
    }

    const seenIdentities = new Set<string>();
    const seenSources = new Set<string>();
    const resolved: Array<{
      index: number;
      request: (typeof requestPayload.mappings)[number];
      enterpriseTenantId: string;
    }> = [];
    for (const [index, request] of requestPayload.mappings.entries()) {
      if (request.strategy !== engine.tenantMappingStrategy) {
        throw mappingError(
          'ENGINE_TENANCY_CONFLICT',
          'Every mapping strategy must match the engine mapping strategy',
          400,
        );
      }
      const identity = mappingIdentity(request.strategy, request.externalTenantId);
      const source = sourceIdentity(context.source, request.sourceRef);
      if (seenIdentities.has(identity) || seenSources.has(source)) {
        throw mappingError('ENGINE_TENANCY_CONFLICT', 'The mapping batch contains duplicate identities', 400);
      }
      seenIdentities.add(identity);
      seenSources.add(source);
      const tenant = await engineTenancyProvisioningService.resolveForCreate({
        tenancy: { mode: 'dedicated', tenantRef: request.tenantRef },
        requestTenantId: context.requestTenantId,
        principalType: context.principalType,
        principalId: context.principalId,
        resolver: context.resolver,
      });
      resolved.push({ index, request, enterpriseTenantId: tenant.tenantId! });
    }

    const calculate = async (
      store: DataSource | EntityManager,
      lockedEngine: Engine,
      write: boolean,
    ): Promise<ExternalEngineTenantMappingsUpsertResponse> => {
      const mappingRepo = store.getRepository(EngineTenantMapping);
      const resourceRepo = store.getRepository(RuntimeResource);
      const engineRepo = store.getRepository(Engine);
      const currentMappings: MappingRow[] = await mappingRepo.find({ where: { engineId: context.engineId } });
      const byIdentity = new Map(currentMappings.map((mapping) => [
        mappingIdentity(mapping.strategy, mapping.externalTenantId),
        mapping,
      ]));
      const bySource = new Map(currentMappings.map((mapping) => [
        sourceIdentity(mapping.source, mapping.sourceRef),
        mapping,
      ]));
      const prospective: ProspectiveMapping[] = [];
      const now = Date.now();

      for (const item of resolved) {
        const identity = mappingIdentity(item.request.strategy, item.request.externalTenantId);
        const source = sourceIdentity(context.source, item.request.sourceRef);
        const identityRow = byIdentity.get(identity);
        const sourceRow = bySource.get(source);
        if (identityRow && sourceRow && identityRow.id !== sourceRow.id) {
          throw mappingError('ENGINE_TENANCY_CONFLICT', 'Mapping identity and source are owned by different rows');
        }
        const existing = identityRow || sourceRow;
        if (existing && (existing.source !== context.source || existing.sourceRef !== item.request.sourceRef)) {
          throw mappingError('ENGINE_TENANCY_CONFLICT', 'The mapping identity is owned by another source');
        }
        if (!existing && !item.request.active) {
          prospective.push({
            index: item.index,
            status: 'noop',
            row: {
              id: '',
              engineId: context.engineId,
              externalTenantId: item.request.externalTenantId,
              enterpriseTenantId: item.enterpriseTenantId,
              strategy: item.request.strategy,
              source: context.source,
              sourceRef: item.request.sourceRef,
              ownershipMode: context.ownershipMode,
              sourceHash: null,
              lastAppliedAt: null,
              isActive: false,
              createdAt: now,
              updatedAt: now,
            },
          });
          continue;
        }
        if (!existing) {
          const row = {
            id: generateId(),
            engineId: context.engineId,
            externalTenantId: item.request.externalTenantId,
            enterpriseTenantId: item.enterpriseTenantId,
            strategy: item.request.strategy,
            source: context.source,
            sourceRef: item.request.sourceRef,
            ownershipMode: context.ownershipMode,
            sourceHash: null,
            lastAppliedAt: null,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          } as MappingRow;
          prospective.push({ index: item.index, status: 'created', row });
          currentMappings.push(row);
          byIdentity.set(identity, row);
          bySource.set(source, row);
          continue;
        }
        const changed = (
          existing.enterpriseTenantId !== item.enterpriseTenantId
          || existing.externalTenantId !== item.request.externalTenantId
          || existing.strategy !== item.request.strategy
          || existing.ownershipMode !== context.ownershipMode
          || existing.isActive !== item.request.active
        );
        const row = {
          ...existing,
          enterpriseTenantId: item.enterpriseTenantId,
          externalTenantId: item.request.externalTenantId,
          strategy: item.request.strategy,
          ownershipMode: context.ownershipMode,
          isActive: item.request.active,
          updatedAt: changed ? now : existing.updatedAt,
        } as MappingRow;
        prospective.push({
          index: item.index,
          status: !changed ? 'noop' : item.request.active ? 'updated' : 'deactivated',
          row,
        });
        const rowIndex = currentMappings.findIndex((mapping) => mapping.id === existing.id);
        currentMappings[rowIndex] = row;
      }

      const changed = prospective.some((item) => item.status !== 'noop');
      const currentVersion = Number(lockedEngine.tenantMappingVersion || 0);
      const nextVersion = changed ? currentVersion + 1 : currentVersion;
      const resources = await resourceRepo.find({ where: { engineId: context.engineId, isActive: true } });
      const activeMappings = currentMappings.filter((mapping) => mapping.isActive);
      let mapped = 0;
      let unmapped = 0;
      let conflicts = 0;
      const resolvedResources = resources.map((resource) => {
        const matches = matchingMappings(lockedEngine, resource, activeMappings);
        if (matches.length === 1) {
          mapped += 1;
          return {
            resource,
            values: {
              tenantId: matches[0].enterpriseTenantId,
              tenantResolutionStatus: 'resolved',
              tenantMappingId: matches[0].id,
              tenantMappingVersion: nextVersion,
              tenantResolutionDetailsJson: JSON.stringify({ code: 'shared_engine_mapping' }),
              updatedAt: now,
            },
          };
        }
        if (matches.length > 1) {
          conflicts += 1;
          return {
            resource,
            values: {
              tenantId: null,
              tenantResolutionStatus: 'conflict',
              tenantMappingId: null,
              tenantMappingVersion: nextVersion,
              tenantResolutionDetailsJson: JSON.stringify({ code: 'multiple_active_mappings' }),
              updatedAt: now,
            },
          };
        }
        unmapped += 1;
        return {
          resource,
          values: {
            tenantId: null,
            tenantResolutionStatus: 'unmapped',
            tenantMappingId: null,
            tenantMappingVersion: nextVersion,
            tenantResolutionDetailsJson: JSON.stringify({ code: 'tenant_mapping_not_found' }),
            updatedAt: now,
          },
        };
      });
      const resolutionStatus = conflicts > 0
        ? 'conflict'
        : activeMappings.length > 0 && unmapped === 0
          ? 'ready'
          : 'incomplete';

      if (write && changed) {
        for (const item of prospective) {
          if (item.status === 'created') await mappingRepo.insert(item.row);
          else if (item.status !== 'noop') {
            const { id, ...values } = item.row;
            await mappingRepo.update({ id }, values);
          }
        }
        for (const item of resolvedResources) {
          await resourceRepo.update({ id: item.resource.id }, item.values);
        }
        await engineRepo.update({ id: context.engineId }, {
          tenantMappingVersion: nextVersion,
          tenantResolutionStatus: resolutionStatus,
          lastTenantReconciledAt: now,
          updatedAt: now,
        });
      }

      const responseEngine = {
        ...lockedEngine,
        tenantMappingVersion: nextVersion,
        tenantResolutionStatus: resolutionStatus,
      };
      return {
        engineId: context.engineId,
        externalId: lockedEngine.externalId || '',
        dryRun: requestPayload.dryRun,
        mappingVersion: nextVersion,
        created: prospective.filter((item) => item.status === 'created').length,
        updated: prospective.filter((item) => item.status === 'updated').length,
        deactivated: prospective.filter((item) => item.status === 'deactivated').length,
        unchanged: prospective.filter((item) => item.status === 'noop').length,
        results: prospective.map((item) => ({
          index: item.index,
          status: item.status,
          mappingId: item.row.id || null,
          code: null,
        })),
        diagnostics: {
          ...diagnostics(responseEngine, [], nextVersion, changed ? now : lockedEngine.lastTenantReconciledAt),
          mappedResourceCount: mapped,
          unmappedResourceCount: unmapped,
          conflictingResourceCount: conflicts,
        },
      };
    };

    if (requestPayload.dryRun) return calculate(dataSource, engine, false);
    return dataSource.transaction(async (manager) => {
      const lockedEngine = await manager.getRepository(Engine).findOne({ where: { id: context.engineId } });
      if (!lockedEngine) throw Errors.notFound('Engine', context.engineId);
      if (Number(lockedEngine.tenantMappingVersion || 0) !== Number(engine.tenantMappingVersion || 0)) {
        throw mappingError(
          'ENGINE_TENANT_MAPPING_VERSION_CONFLICT',
          'The engine tenant mapping version has changed; refresh and retry',
        );
      }
      return calculate(manager, lockedEngine, true);
    });
  }
}

export const engineTenantMappingService = new EngineTenantMappingService();
