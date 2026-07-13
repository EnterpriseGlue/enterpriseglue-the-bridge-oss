import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { Folder } from '@enterpriseglue/shared/db/entities/Folder.js';
import { GitRepository } from '@enterpriseglue/shared/db/entities/GitRepository.js';
import { GitProvider } from '@enterpriseglue/shared/db/entities/GitProvider.js';
import { ProjectMember } from '@enterpriseglue/shared/db/entities/ProjectMember.js';
import { ProjectMemberRole } from '@enterpriseglue/shared/db/entities/ProjectMemberRole.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { Invitation } from '@enterpriseglue/shared/db/entities/Invitation.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { EngineHealth } from '@enterpriseglue/shared/db/entities/EngineHealth.js';
import { EngineProjectAccess } from '@enterpriseglue/shared/db/entities/EngineProjectAccess.js';
import { EngineAccessRequest } from '@enterpriseglue/shared/db/entities/EngineAccessRequest.js';
import { EnvironmentTag } from '@enterpriseglue/shared/db/entities/EnvironmentTag.js';
import { In, IsNull } from 'typeorm';
import { generateId, unixTimestamp } from '@enterpriseglue/shared/utils/id.js';
import { applyPreparedEngineImportToProject, type PreparedEngineImport } from '@enterpriseglue/shared/services/starbase/engine-import-service.js';
import { writeLegacyProjectMemberRoleAssignments } from '@enterpriseglue/shared/services/platform-admin/legacy-project-role-assignments.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { toQueryNumber, toQueryString } from './query-normalization.js';

interface ProjectRow {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
}

interface CountRow {
  projectId: string;
  count: number;
}

interface CountRawRow {
  projectId: string | number | null;
  count: string | number | null;
}

interface RepoRow {
  projectId: string;
  remoteUrl: string | null;
  providerId: string | null;
}

interface ProviderRow {
  id: string;
  type: string;
}

interface UserRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
}

interface MemberRawRow {
  p_id: string | number | null;
  p_name: string | null;
  p_owner_id?: string | null;
  p_ownerId?: string | null;
  p_created_at?: string | number | null;
  p_createdAt?: string | number | null;
}

function normalizeMemberProjectRow(row: MemberRawRow): ProjectRow {
  return {
    id: toQueryString(row.p_id),
    name: toQueryString(row.p_name),
    ownerId: toQueryString(row.p_owner_id ?? row.p_ownerId),
    createdAt: toQueryNumber(row.p_created_at ?? row.p_createdAt),
  };
}

function normalizeCountRow(row: CountRawRow): CountRow {
  return {
    projectId: toQueryString(row.projectId),
    count: toQueryNumber(row.count),
  };
}

export interface ProjectListItem {
  id: string;
  name: string;
  createdAt: number;
  foldersCount: number;
  filesCount: number;
  gitUrl: string | null;
  gitProviderType: string | null;
  gitSyncStatus: null;
  members: Array<{
    userId: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
  }>;
}

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
  async listForUser(userId: string): Promise<ProjectListItem[]> {
    const dataSource = await getDataSource();
    const projectRepo = dataSource.getRepository(Project);
    const fileRepo = dataSource.getRepository(File);
    const folderRepo = dataSource.getRepository(Folder);
    const gitRepoRepo = dataSource.getRepository(GitRepository);
    const gitProviderRepo = dataSource.getRepository(GitProvider);
    const projectMemberRepo = dataSource.getRepository(ProjectMember);
    const userRepo = dataSource.getRepository(User);
    const invitationRepo = dataSource.getRepository(Invitation);

    const ownerRows = await projectRepo.find({
      where: { ownerId: userId },
      select: ['id', 'name', 'ownerId', 'createdAt']
    }) as ProjectRow[];

    const memberRows = await projectRepo.createQueryBuilder('p')
      .innerJoin(ProjectMember, 'pm', 'pm.projectId = p.id')
      .where('pm.userId = :userId', { userId })
      .select(['p.id', 'p.name', 'p.ownerId', 'p.createdAt'])
      .getRawMany<MemberRawRow>();

    const memberRowsMapped = memberRows.map(normalizeMemberProjectRow);

    const byId = new Map<string, ProjectRow>();
    for (const row of ownerRows) byId.set(toQueryString(row.id), row);
    for (const row of memberRowsMapped) byId.set(toQueryString(row.id), row);
    const rows = Array.from(byId.values());
    const projectIds = rows.map((row) => toQueryString(row.id));

    if (projectIds.length === 0) {
      return [];
    }

    const filesCountMap = new Map<string, number>();
    try {
      const countRows = (await fileRepo.createQueryBuilder('f')
        .select('f.projectId', 'projectId')
        .addSelect('COUNT(*)', 'count')
        .where('f.projectId IN (:...projectIds)', { projectIds })
        .groupBy('f.projectId')
        .getRawMany<CountRawRow>()).map(normalizeCountRow);
      for (const row of countRows) {
        filesCountMap.set(row.projectId, row.count);
      }
    } catch (error) {
      logger.debug('Failed to get file counts', { error });
    }

    const foldersCountMap = new Map<string, number>();
    try {
      const countRows = (await folderRepo.createQueryBuilder('f')
        .select('f.projectId', 'projectId')
        .addSelect('COUNT(*)', 'count')
        .where('f.projectId IN (:...projectIds)', { projectIds })
        .groupBy('f.projectId')
        .getRawMany<CountRawRow>()).map(normalizeCountRow);
      for (const row of countRows) {
        foldersCountMap.set(row.projectId, row.count);
      }
    } catch (error) {
      logger.debug('Failed to get folder counts', { error });
    }

    const repoByProjectId = new Map<string, { remoteUrl: string | null; providerId: string | null }>();
    try {
      const repoRows = await gitRepoRepo.find({
        where: { projectId: In(projectIds) },
        select: ['projectId', 'remoteUrl', 'providerId']
      }) as RepoRow[];
      for (const row of repoRows) {
        const projectId = toQueryString(row.projectId);
        if (!repoByProjectId.has(projectId)) {
          repoByProjectId.set(projectId, {
            remoteUrl: row.remoteUrl ?? null,
            providerId: row.providerId ?? null,
          });
        }
      }
    } catch (error) {
      logger.debug('Failed to get git repositories', { error });
    }

    const providerIds = Array.from(new Set(
      Array.from(repoByProjectId.values())
        .map((row) => row.providerId)
        .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    ));

    const providerTypeById = new Map<string, string>();
    if (providerIds.length > 0) {
      try {
        const providerRows = await gitProviderRepo.find({
          where: { id: In(providerIds) },
          select: ['id', 'type']
        }) as ProviderRow[];
        for (const row of providerRows) {
          providerTypeById.set(toQueryString(row.id), toQueryString(row.type));
        }
      } catch (error) {
        logger.debug('Failed to get provider types', { error });
      }
    }

    const membersByProjectId = new Map<string, Array<{ userId: string; firstName: string | null; lastName: string | null; role: string }>>();
    try {
      const memberRowsData = await projectMemberRepo.find({
        where: { projectId: In(projectIds) },
        select: ['projectId', 'userId', 'role']
      });

      const pendingProjectInvites = await invitationRepo.find({
        where: {
          resourceType: 'project',
          resourceId: In(projectIds),
          revokedAt: IsNull(),
          completedAt: IsNull(),
        },
        select: ['resourceId', 'userId'],
      });

      const pendingMemberKeys = new Set(
        pendingProjectInvites.map((invite) => `${toQueryString(invite.resourceId)}:${toQueryString(invite.userId)}`)
      );

      const memberUserIds = [...new Set(memberRowsData.map((member) => toQueryString(member.userId)))];
      const userDetailsMap = new Map<string, { firstName: string | null; lastName: string | null }>();

      if (memberUserIds.length > 0) {
        const userRows = await userRepo.find({
          where: { id: In(memberUserIds) },
          select: ['id', 'firstName', 'lastName']
        }) as UserRow[];

        for (const row of userRows) {
          userDetailsMap.set(toQueryString(row.id), { firstName: row.firstName, lastName: row.lastName });
        }
      }

      for (const member of memberRowsData) {
        const projectId = toQueryString(member.projectId);
        const userId = toQueryString(member.userId);
        if (pendingMemberKeys.has(`${projectId}:${userId}`)) {
          continue;
        }
        const userDetails = userDetailsMap.get(userId) || { firstName: null, lastName: null };
        if (!membersByProjectId.has(projectId)) {
          membersByProjectId.set(projectId, []);
        }
        membersByProjectId.get(projectId)!.push({
          userId,
          firstName: userDetails.firstName,
          lastName: userDetails.lastName,
          role: member.role,
        });
      }
    } catch (error) {
      logger.debug('Failed to get project members', { error });
    }

    return rows.map((row) => {
      const projectId = toQueryString(row.id);
      const repo = repoByProjectId.get(projectId);
      const providerId = repo?.providerId ?? null;
      const members = membersByProjectId.get(projectId) || [];
      return {
        id: row.id,
        name: row.name,
        createdAt: toQueryNumber(row.createdAt),
        foldersCount: foldersCountMap.get(projectId) ?? 0,
        filesCount: filesCountMap.get(projectId) ?? 0,
        gitUrl: repo?.remoteUrl ?? null,
        gitProviderType: providerId ? (providerTypeById.get(providerId) ?? null) : null,
        gitSyncStatus: null,
        members: members.map((member) => ({
          userId: member.userId,
          firstName: member.firstName,
          lastName: member.lastName,
          role: member.role,
        })),
      };
    });
  }

  async createProject(input: { name: string; ownerId: string; preparedImport?: PreparedEngineImport | null }): Promise<{ id: string; name: string; ownerId: string; createdAt: number; updatedAt: number }> {
    const id = generateId();
    const now = unixTimestamp();
    const dataSource = await getDataSource();

    await dataSource.transaction(async (manager) => {
      await manager.getRepository(Project).insert({
        id,
        name: input.name,
        ownerId: input.ownerId,
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

      await writeLegacyProjectMemberRoleAssignments(manager, {
        projectId: id,
        tenantId: null,
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

  async getEngineAccessOverview(projectId: string): Promise<{ accessedEngines: AccessedEngineResponse[]; pendingRequests: PendingRequestWithDetails[]; availableEngines: Array<{ id: string; name: string }> }> {
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
        where: { id: In(engineIds) },
        select: ['id', 'name', 'baseUrl', 'environmentTagId']
      });

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
        where: { engineId: In(engineIds) },
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
        where: { id: In(pendingEngineIds) },
        select: ['id', 'name', 'baseUrl']
      });

      pendingWithDetails = pendingRequests.map((row) => {
        const engine = pendingEngineRows.find((pendingEngine) => pendingEngine.id === row.engineId);
        return {
          requestId: row.id,
          engineId: row.engineId,
          engineName: engine?.name || engine?.baseUrl || 'Unknown',
          requestedAt: row.createdAt,
        };
      });
    }

    const allEngines = await engineRepo.find({
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
