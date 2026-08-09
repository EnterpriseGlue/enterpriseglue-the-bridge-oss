import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { ProjectMember } from '@enterpriseglue/shared/db/entities/ProjectMember.js';
import { ProjectMemberRole } from '@enterpriseglue/shared/db/entities/ProjectMemberRole.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { EngineHealth } from '@enterpriseglue/shared/db/entities/EngineHealth.js';
import { EngineProjectAccess } from '@enterpriseglue/shared/db/entities/EngineProjectAccess.js';
import { EngineAccessRequest } from '@enterpriseglue/shared/db/entities/EngineAccessRequest.js';
import { EnvironmentTag } from '@enterpriseglue/shared/db/entities/EnvironmentTag.js';
import { In } from 'typeorm';
import { engineTenancyVisibilityWhere } from '@enterpriseglue/shared/engine-tenancy/visibility.js';
import { generateId, unixTimestamp } from '@enterpriseglue/shared/utils/id.js';
import { applyPreparedEngineImportToProject, type PreparedEngineImport } from '@enterpriseglue/shared/services/starbase/engine-import-service.js';
import { writeProjectMemberRoleAssignments } from '@enterpriseglue/shared/services/platform-admin/project-member-role-assignments.js';
import { OSS_DEFAULT_TENANT_ID, normalizeTenantIdForPersistence } from '@enterpriseglue/shared/authz/tenant-scope.js';

export interface AccessedEngineResponse {
  engineId: string;
  engineName: string;
  baseUrl: string;
  environment: { name: string; color: string } | null;
  manualDeployAllowed?: boolean;
  health: { status: string; latencyMs: number | null } | null;
  grantedAt: number;
  isLegacy?: boolean;
}

export interface PendingRequestWithDetails {
  requestId: string;
  engineId: string;
  engineName: string;
  requestedAt: number;
}

export interface RenamedProjectResponse {
  id: string;
  name: string;
}

class ProjectQueryServiceImpl {
  async createProject(input: { name: string; ownerId: string; tenantId: string; preparedImport?: PreparedEngineImport | null }): Promise<{ id: string; name: string; ownerId: string; createdAt: number; updatedAt: number }> {
    const id = generateId();
    const now = unixTimestamp();
    const dataSource = await getDataSource();
    const tenantId = normalizeTenantIdForPersistence(input.tenantId) || OSS_DEFAULT_TENANT_ID;

    await dataSource.transaction(async (manager) => {
      await manager.getRepository(Project).insert({
        id,
        name: input.name,
        ownerId: input.ownerId,
        tenantId,
        createdAt: now,
        updatedAt: now,
      });

      await manager.getRepository(ProjectMember).createQueryBuilder()
        .insert()
        .values({
          id: generateId(),
          projectId: id,
          userId: input.ownerId,
          role: 'owner',
          invitedById: null,
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .orIgnore()
        .execute();

      await manager.getRepository(ProjectMemberRole).createQueryBuilder()
        .insert()
        .values({
          projectId: id,
          userId: input.ownerId,
          role: 'owner',
          createdAt: now,
        })
        .orIgnore()
        .execute();

      await writeProjectMemberRoleAssignments(manager, {
        projectId: id,
        tenantId,
        userId: input.ownerId,
        roles: ['owner'],
        createdById: null,
        createdAt: now,
      });

      if (input.preparedImport) {
        await applyPreparedEngineImportToProject({
          manager,
          projectId: id,
          userId: input.ownerId,
          tenantId,
          importData: input.preparedImport,
        });
      }
    });

    return { id, name: input.name, ownerId: input.ownerId, createdAt: now, updatedAt: now };
  }

  async renameProject(projectId: string, name: string): Promise<RenamedProjectResponse> {
    const dataSource = await getDataSource();
    const trimmed = name.trim();
    await dataSource.getRepository(Project).update({ id: projectId }, { name: trimmed });
    return { id: projectId, name: trimmed };
  }

  async getEngineAccessOverview(
    projectId: string,
    tenantId?: string | null
  ): Promise<{ accessedEngines: AccessedEngineResponse[]; pendingRequests: PendingRequestWithDetails[]; availableEngines: Array<{ id: string; name: string }> }> {
    const dataSource = await getDataSource();
    const engineProjectAccessRepo = dataSource.getRepository(EngineProjectAccess);
    const engineRepo = dataSource.getRepository(Engine);
    const envTagRepo = dataSource.getRepository(EnvironmentTag);
    const engineHealthRepo = dataSource.getRepository(EngineHealth);
    const engineAccessRequestRepo = dataSource.getRepository(EngineAccessRequest);

    const accessRows = await engineProjectAccessRepo.find({
      where: { projectId },
      select: ['engineId', 'createdAt', 'autoApproved']
    });

    const engineIds = accessRows
      .map((row) => row.engineId)
      .filter((engineId) => engineId !== '__env__');

    const accessedEngines: AccessedEngineResponse[] = [];
    const envEngineAccess = accessRows.find((row) => row.engineId === '__env__');
    if (envEngineAccess) {
      const envBaseUrl = process.env.CAMUNDA_BASE_URL || process.env.ENGINE_BASE_URL;
      accessedEngines.push({
        engineId: '__env__',
        engineName: 'Environment Engine (Legacy)',
        baseUrl: envBaseUrl || '(not configured)',
        environment: null,
        health: null,
        grantedAt: envEngineAccess.createdAt,
        isLegacy: true,
      });
    }

    if (engineIds.length > 0) {
      const engineRows = await engineRepo.find({
        where: engineTenancyVisibilityWhere({ id: In(engineIds) }, tenantId),
        select: ['id', 'name', 'baseUrl', 'environmentTagId']
      });
      const visibleEngineIds = engineRows.map((engine) => engine.id);

      const envTagIds = engineRows
        .map((engine) => engine.environmentTagId)
        .filter(Boolean) as string[];
      const envTagMap = new Map<string, { name: string; color: string; manualDeployAllowed: boolean }>();
      if (envTagIds.length > 0) {
        const envTags = await envTagRepo.find({
          where: { id: In(envTagIds) },
          select: ['id', 'name', 'color', 'manualDeployAllowed']
        });
        for (const tag of envTags) {
          envTagMap.set(tag.id, { name: tag.name, color: tag.color, manualDeployAllowed: tag.manualDeployAllowed });
        }
      }

      const healthRows = await engineHealthRepo.find({
        where: { engineId: In(visibleEngineIds) },
        order: { checkedAt: 'DESC' },
        select: ['engineId', 'status', 'latencyMs', 'checkedAt']
      });

      const healthMap = new Map<string, { status: string; latencyMs: number | null; checkedAt: number }>();
      for (const health of healthRows) {
        if (!healthMap.has(health.engineId)) {
          healthMap.set(health.engineId, { status: health.status, latencyMs: health.latencyMs, checkedAt: health.checkedAt });
        }
      }

      for (const access of accessRows.filter((row) => row.engineId !== '__env__')) {
        const engine = engineRows.find((row) => row.id === access.engineId);
        if (!engine) continue;
        const envTag = engine?.environmentTagId ? envTagMap.get(engine.environmentTagId) : null;
        const health = healthMap.get(access.engineId) || null;
        accessedEngines.push({
          engineId: access.engineId,
          engineName: engine?.name || 'Unnamed Engine',
          baseUrl: engine?.baseUrl || '',
          environment: envTag ? { name: envTag.name, color: envTag.color } : null,
          manualDeployAllowed: envTag ? envTag.manualDeployAllowed : true,
          health: health ? { status: health.status, latencyMs: health.latencyMs } : null,
          grantedAt: access.createdAt,
        });
      }
    }

    const pendingRequests = await engineAccessRequestRepo.find({
      where: { projectId, status: 'pending' },
      select: ['id', 'engineId', 'createdAt']
    });

    const pendingEngineIds = pendingRequests.map((row) => row.engineId);
    let pendingWithDetails: PendingRequestWithDetails[] = [];
    if (pendingEngineIds.length > 0) {
      const pendingEngineRows = await engineRepo.find({
        where: engineTenancyVisibilityWhere({ id: In(pendingEngineIds) }, tenantId),
        select: ['id', 'name', 'baseUrl']
      });

      pendingWithDetails = pendingRequests.flatMap((row) => {
        const engine = pendingEngineRows.find((pendingEngine) => pendingEngine.id === row.engineId);
        return engine ? [{
          requestId: row.id,
          engineId: row.engineId,
          engineName: engine.name || engine.baseUrl || 'Unknown',
          requestedAt: row.createdAt,
        }] : [];
      });
    }

    const allEngines = await engineRepo.find({
      where: engineTenancyVisibilityWhere({}, tenantId),
      select: ['id', 'name', 'baseUrl']
    });

    const usedEngineIds = new Set([...engineIds, ...pendingEngineIds]);
    const availableEngines = allEngines
      .filter((engine) => !usedEngineIds.has(engine.id))
      .map((engine) => ({ id: engine.id, name: engine.name || engine.baseUrl || 'Unknown' }));

    return {
      accessedEngines,
      pendingRequests: pendingWithDetails,
      availableEngines,
    };
  }
}

export const projectQueryService = new ProjectQueryServiceImpl();
