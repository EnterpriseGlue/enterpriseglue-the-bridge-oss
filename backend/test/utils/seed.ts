import { getDataSource } from '@shared/db/data-source.js';
import { User } from '@shared/db/entities/User.js';
import { Project } from '@shared/db/entities/Project.js';
import { Engine } from '@shared/db/entities/Engine.js';
import { EngineHealth } from '@shared/db/entities/EngineHealth.js';
import { EngineMember } from '@shared/db/entities/EngineMember.js';
import { ProjectMember } from '@shared/db/entities/ProjectMember.js';
import { ProjectMemberRole } from '@shared/db/entities/ProjectMemberRole.js';
import { RefreshToken } from '@shared/db/entities/RefreshToken.js';
import { AuditLog } from '@shared/db/entities/AuditLog.js';
import { File } from '@shared/db/entities/File.js';
import { Folder } from '@shared/db/entities/Folder.js';
import { generateAccessToken } from '@shared/utils/jwt.js';
import { generateId, unixTimestamp } from '@shared/utils/id.js';
import { Brackets } from 'typeorm';

type SeedUser = {
  id: string;
  email: string;
  token: string;
};

type SeedProject = {
  id: string;
  name: string;
};

type SeedFile = {
  id: string;
  name: string;
  type: string;
};

type SeedFolder = {
  id: string;
  name: string;
};

type SeedEngine = {
  id: string;
  baseUrl: string;
};

export async function seedUser(prefix: string): Promise<SeedUser> {
  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
  const id = generateId();
  const email = `${prefix}@example.com`;
  const now = Date.now();

  await userRepo.insert({
    id,
    email,
    authProvider: 'local',
    passwordHash: null,
    platformRole: 'user',
    isActive: true,
    mustResetPassword: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    isEmailVerified: true,
    emailVerificationToken: null,
    emailVerificationTokenExpiry: null,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    createdByUserId: null,
  });

  const token = generateAccessToken({ id, email, platformRole: 'user' });

  return { id, email, token };
}

export async function seedAdditionalUser(prefix: string, suffix: string): Promise<SeedUser> {
  return seedUser(`${prefix}-${suffix}`);
}

export async function seedProject(userId: string, name: string): Promise<SeedProject> {
  const dataSource = await getDataSource();
  const projectRepo = dataSource.getRepository(Project);
  const memberRepo = dataSource.getRepository(ProjectMember);
  const memberRoleRepo = dataSource.getRepository(ProjectMemberRole);
  const id = generateId();
  const now = unixTimestamp();
  const membershipNow = Date.now();

  await projectRepo.insert({
    id,
    name,
    ownerId: userId,
    tenantId: null,
    createdAt: now,
    updatedAt: now,
  });

  await memberRepo.insert({
    id: generateId(),
    projectId: id,
    userId,
    role: 'owner',
    invitedById: null,
    joinedAt: membershipNow,
    createdAt: membershipNow,
    updatedAt: membershipNow,
  });

  await memberRoleRepo.insert({
    projectId: id,
    userId,
    role: 'owner',
    createdAt: membershipNow,
  });

  return { id, name };
}

export async function seedEngine(ownerId: string, baseUrl: string, name: string): Promise<SeedEngine> {
  const dataSource = await getDataSource();
  const engineRepo = dataSource.getRepository(Engine);
  const id = generateId();
  const now = Date.now();

  await engineRepo.insert({
    id,
    name,
    baseUrl,
    type: 'camunda7',
    authType: null,
    username: null,
    passwordEnc: null,
    version: null,
    ownerId,
    delegateId: null,
    environmentTagId: null,
    environmentLocked: false,
    tenantId: null,
    createdAt: now,
    updatedAt: now,
  });

  return { id, baseUrl };
}

export async function seedFile(
  projectId: string,
  name: string,
  type = 'bpmn',
  xml = '<xml />',
  folderId: string | null = null
): Promise<SeedFile> {
  const dataSource = await getDataSource();
  const fileRepo = dataSource.getRepository(File);
  const id = generateId();
  const now = Date.now();

  await fileRepo.insert({
    id,
    projectId,
    folderId,
    name,
    type,
    xml,
    createdBy: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
  });

  return { id, name, type };
}

export async function seedFolder(projectId: string, name: string): Promise<SeedFolder> {
  const dataSource = await getDataSource();
  const folderRepo = dataSource.getRepository(Folder);
  const id = generateId();
  const now = Date.now();

  await folderRepo.insert({
    id,
    projectId,
    parentFolderId: null,
    name,
    createdBy: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
  });

  return { id, name };
}

export async function cleanupSeededData(
  prefix: string,
  projectIds: string[],
  userIds: string[],
  fileIds: string[] = [],
  folderIds: string[] = []
) {
  const dataSource = await getDataSource();
  const projectRepo = dataSource.getRepository(Project);
  const memberRepo = dataSource.getRepository(ProjectMember);
  const memberRoleRepo = dataSource.getRepository(ProjectMemberRole);
  const userRepo = dataSource.getRepository(User);
  const refreshTokenRepo = dataSource.getRepository(RefreshToken);
  const auditLogRepo = dataSource.getRepository(AuditLog);
  const fileRepo = dataSource.getRepository(File);
  const folderRepo = dataSource.getRepository(Folder);

  if (userIds.length > 0) {
    await refreshTokenRepo.delete({ userId: userIds as any });
    await auditLogRepo.createQueryBuilder()
      .delete()
      .where('userId IN (:...userIds)', { userIds })
      .execute();
  }

  const resourceIds = [...projectIds, ...fileIds, ...folderIds].filter(Boolean);
  if (resourceIds.length > 0) {
    await auditLogRepo.createQueryBuilder()
      .delete()
      .where('resourceId IN (:...resourceIds)', { resourceIds })
      .execute();
  }

  if (fileIds.length > 0) {
    await fileRepo.delete({ id: fileIds as any });
  }

  if (folderIds.length > 0) {
    await folderRepo.delete({ id: folderIds as any });
  }

  if (projectIds.length > 0) {
    await memberRoleRepo.delete({ projectId: projectIds as any });
    await memberRepo.delete({ projectId: projectIds as any });
    await projectRepo.delete({ id: projectIds as any });
  }

  if (userIds.length > 0) {
    await userRepo.delete({ id: userIds as any });
  }

  await dataSource.getRepository(Engine).delete({ name: `${prefix}-engine` } as any);

  // Clean up any leftover users/projects with prefix just in case
  await projectRepo.createQueryBuilder()
    .delete()
    .where('name LIKE :prefix', { prefix: `${prefix}%` })
    .execute();

  await userRepo.createQueryBuilder()
    .delete()
    .where('email LIKE :prefix', { prefix: `${prefix}%` })
    .execute();

  await fileRepo.createQueryBuilder()
    .delete()
    .where('name LIKE :prefix', { prefix: `${prefix}%` })
    .execute();

  await folderRepo.createQueryBuilder()
    .delete()
    .where('name LIKE :prefix', { prefix: `${prefix}%` })
    .execute();
}

export async function cleanupEngines(engineIds: string[]) {
  const dataSource = await getDataSource();
  const engineRepo = dataSource.getRepository(Engine);
  if (engineIds.length > 0) {
    await engineRepo.delete({ id: engineIds as any });
  }
}

/**
 * Clean up all stale test data from previous test runs.
 * Call this in beforeAll to ensure clean state even if previous tests failed.
 */
export async function cleanupStaleTestData() {
  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
  const engineRepo = dataSource.getRepository(Engine);
  const engineMemberRepo = dataSource.getRepository(EngineMember);
  const engineHealthRepo = dataSource.getRepository(EngineHealth);
  const refreshTokenRepo = dataSource.getRepository(RefreshToken);
  const auditLogRepo = dataSource.getRepository(AuditLog);
  const projectRepo = dataSource.getRepository(Project);
  const projectMemberRoleRepo = dataSource.getRepository(ProjectMemberRole);
  const projectMemberRepo = dataSource.getRepository(ProjectMember);
  const fileRepo = dataSource.getRepository(File);
  const folderRepo = dataSource.getRepository(Folder);

  const userEmailPatterns = ['e2e-%@example.com', 'test_%@example.com'];
  const projectNamePatterns = ['test_%', 'e2e-%', 'Smoke %'];
  const engineNamePatterns = ['test_%', 'test_camunda_%', 'e2e-%'];

  const staleUsers = await userRepo
    .createQueryBuilder('u')
    .select(['u.id'])
    .where(new Brackets((qb) => {
      userEmailPatterns.forEach((pattern, index) => {
        const paramName = `staleUserPattern${index}`;
        if (index === 0) qb.where(`u.email LIKE :${paramName}`, { [paramName]: pattern });
        else qb.orWhere(`u.email LIKE :${paramName}`, { [paramName]: pattern });
      });
    }))
    .getMany();
  const staleUserIds = staleUsers.map((u) => u.id);

  const staleEnginesQb = engineRepo
    .createQueryBuilder('e')
    .select(['e.id'])
    .where(new Brackets((qb) => {
      engineNamePatterns.forEach((pattern, index) => {
        const paramName = `staleEnginePattern${index}`;
        if (index === 0) qb.where(`e.name LIKE :${paramName}`, { [paramName]: pattern });
        else qb.orWhere(`e.name LIKE :${paramName}`, { [paramName]: pattern });
      });
      if (staleUserIds.length > 0) {
        qb.orWhere('e.ownerId IN (:...staleUserIds)', { staleUserIds });
      }
    }));
  const staleEngineIds = (await staleEnginesQb.getMany()).map((e) => e.id);

  const staleProjects = await projectRepo
    .createQueryBuilder('p')
    .select(['p.id'])
    .where(new Brackets((qb) => {
      projectNamePatterns.forEach((pattern, index) => {
        const paramName = `staleProjectPattern${index}`;
        if (index === 0) qb.where(`p.name LIKE :${paramName}`, { [paramName]: pattern });
        else qb.orWhere(`p.name LIKE :${paramName}`, { [paramName]: pattern });
      });
    }))
    .getMany();
  const staleProjectIds = staleProjects.map((p) => p.id);

  if (staleEngineIds.length > 0) {
    await engineMemberRepo.createQueryBuilder().delete().where('engineId IN (:...staleEngineIds)', { staleEngineIds }).execute();
    await engineHealthRepo.createQueryBuilder().delete().where('engineId IN (:...staleEngineIds)', { staleEngineIds }).execute();
    await engineRepo.createQueryBuilder().delete().where('id IN (:...staleEngineIds)', { staleEngineIds }).execute();
  }

  if (staleUserIds.length > 0) {
    await refreshTokenRepo.createQueryBuilder().delete().where('userId IN (:...staleUserIds)', { staleUserIds }).execute();
  }

  await auditLogRepo
    .createQueryBuilder()
    .delete()
    .where(new Brackets((qb) => {
      if (staleUserIds.length > 0) {
        qb.where('userId IN (:...staleUserIds)', { staleUserIds });
      }
      if (staleProjectIds.length > 0) {
        qb.orWhere('resourceId IN (:...staleProjectIds)', { staleProjectIds });
      }
      if (staleEngineIds.length > 0) {
        qb.orWhere('resourceId IN (:...staleEngineIds)', { staleEngineIds });
      }
      qb.orWhere('details LIKE :auditDetailPattern0', { auditDetailPattern0: '%e2e-%@example.com%' });
      qb.orWhere('details LIKE :auditDetailPattern1', { auditDetailPattern1: '%test_%@example.com%' });
    }))
    .execute();

  if (staleProjectIds.length > 0) {
    await projectMemberRoleRepo.createQueryBuilder().delete().where('projectId IN (:...staleProjectIds)', { staleProjectIds }).execute();
    await projectMemberRepo.createQueryBuilder().delete().where('projectId IN (:...staleProjectIds)', { staleProjectIds }).execute();
    await fileRepo.createQueryBuilder().delete().where('projectId IN (:...staleProjectIds)', { staleProjectIds }).execute();
    await folderRepo.createQueryBuilder().delete().where('projectId IN (:...staleProjectIds)', { staleProjectIds }).execute();
    await projectRepo.createQueryBuilder().delete().where('id IN (:...staleProjectIds)', { staleProjectIds }).execute();
  }

  if (staleUserIds.length > 0) {
    await userRepo.createQueryBuilder().delete().where('id IN (:...staleUserIds)', { staleUserIds }).execute();
  }
}
