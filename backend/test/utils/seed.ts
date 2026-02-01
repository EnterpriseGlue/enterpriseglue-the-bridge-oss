import { getDataSource } from '@shared/db/data-source.js';
import { User } from '@shared/db/entities/User.js';
import { Project } from '@shared/db/entities/Project.js';
import { Engine } from '@shared/db/entities/Engine.js';
import { ProjectMember } from '@shared/db/entities/ProjectMember.js';
import { ProjectMemberRole } from '@shared/db/entities/ProjectMemberRole.js';
import { RefreshToken } from '@shared/db/entities/RefreshToken.js';
import { AuditLog } from '@shared/db/entities/AuditLog.js';
import { generateAccessToken } from '@shared/utils/jwt.js';
import { generateId, unixTimestamp } from '@shared/utils/id.js';
import { getAdapter } from '@shared/db/adapters/index.js';

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
  const id = generateId();
  const now = Date.now();

  const schema = getAdapter().getSchemaName() || 'public';
  const columns = await dataSource.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'files'`,
    [schema]
  );
  const columnSet = new Set(columns.map((c: any) => String(c.column_name)));

  const entries: Array<{ name: string; value: any }> = [
    { name: 'id', value: id },
    { name: 'project_id', value: projectId },
    { name: 'folder_id', value: folderId },
    { name: 'name', value: name },
    { name: 'type', value: type },
    { name: 'xml', value: xml },
    { name: 'created_by', value: null },
    { name: 'updated_by', value: null },
    { name: 'created_at', value: now },
    { name: 'updated_at', value: now },
  ].filter((entry) => columnSet.has(entry.name));

  const columnNames = entries.map((entry) => `"${entry.name}"`).join(', ');
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(', ');
  const values = entries.map((entry) => entry.value);

  await dataSource.query(
    `INSERT INTO "${schema}"."files" (${columnNames}) VALUES (${placeholders})`,
    values
  );

  return { id, name, type };
}

export async function seedFolder(projectId: string, name: string): Promise<SeedFolder> {
  const dataSource = await getDataSource();
  const id = generateId();
  const now = Date.now();

  const schema = getAdapter().getSchemaName() || 'public';
  const columns = await dataSource.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'folders'`,
    [schema]
  );
  const columnSet = new Set(columns.map((c: any) => String(c.column_name)));

  const entries: Array<{ name: string; value: any }> = [
    { name: 'id', value: id },
    { name: 'project_id', value: projectId },
    { name: 'parent_folder_id', value: null },
    { name: 'name', value: name },
    { name: 'created_by', value: null },
    { name: 'updated_by', value: null },
    { name: 'created_at', value: now },
    { name: 'updated_at', value: now },
  ].filter((entry) => columnSet.has(entry.name));

  const columnNames = entries.map((entry) => `"${entry.name}"`).join(', ');
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(', ');
  const values = entries.map((entry) => entry.value);

  await dataSource.query(
    `INSERT INTO "${schema}"."folders" (${columnNames}) VALUES (${placeholders})`,
    values
  );

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
  const fileRepo = dataSource.getRepository((await import('@shared/db/entities/File.js')).File);
  const folderRepo = dataSource.getRepository((await import('@shared/db/entities/Folder.js')).Folder);

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
  
  // Clean old test engines created by test users or test name prefixes
  await dataSource.query(`
    DELETE FROM main.engine_members 
    WHERE engine_id IN (
      SELECT id FROM main.engines 
      WHERE name LIKE 'test_%'
         OR name LIKE 'test_camunda_%'
         OR name LIKE 'e2e-%'
         OR owner_id IN (
           SELECT id FROM main.users
           WHERE email LIKE 'e2e-%@example.com'
              OR email LIKE 'test_%@example.com'
         )
    )
  `);
  await dataSource.query(`
    DELETE FROM main.engine_health 
    WHERE engine_id IN (
      SELECT id FROM main.engines 
      WHERE name LIKE 'test_%'
         OR name LIKE 'test_camunda_%'
         OR name LIKE 'e2e-%'
         OR owner_id IN (
           SELECT id FROM main.users
           WHERE email LIKE 'e2e-%@example.com'
              OR email LIKE 'test_%@example.com'
         )
    )
  `);
  await dataSource.query(`
    DELETE FROM main.engines 
    WHERE name LIKE 'test_%'
       OR name LIKE 'test_camunda_%'
       OR name LIKE 'e2e-%'
       OR owner_id IN (
         SELECT id FROM main.users
         WHERE email LIKE 'e2e-%@example.com'
            OR email LIKE 'test_%@example.com'
       )
  `);
  
  await dataSource.query(`
    DELETE FROM main.refresh_tokens
    WHERE user_id IN (
      SELECT id FROM main.users
      WHERE email LIKE 'e2e-%@example.com'
         OR email LIKE 'test_%@example.com'
    )
  `);

  await dataSource.query(`
    DELETE FROM main.audit_logs
    WHERE user_id IN (
      SELECT id FROM main.users
      WHERE email LIKE 'e2e-%@example.com'
         OR email LIKE 'test_%@example.com'
    )
       OR resource_id IN (
      SELECT id FROM main.projects
      WHERE name LIKE 'test_%' OR name LIKE 'e2e-%'
    )
       OR resource_id IN (
      SELECT id FROM main.engines
      WHERE name LIKE 'test_%' OR name LIKE 'test_camunda_%'
    )
       OR details LIKE '%e2e-%@example.com%'
       OR details LIKE '%test_%@example.com%'
  `);

  // Clean old test users
  await dataSource.query(`
    DELETE FROM main.users 
    WHERE email LIKE 'e2e-%@example.com' 
       OR email LIKE 'test_%@example.com'
  `);
  
  // Clean old test projects
  await dataSource.query(`
    DELETE FROM main.project_member_roles 
    WHERE project_id IN (
      SELECT id FROM main.projects 
      WHERE name LIKE 'test_%' OR name LIKE 'e2e-%'
    )
  `);
  await dataSource.query(`
    DELETE FROM main.project_members 
    WHERE project_id IN (
      SELECT id FROM main.projects 
      WHERE name LIKE 'test_%' OR name LIKE 'e2e-%'
    )
  `);
  await dataSource.query(`
    DELETE FROM main.projects 
    WHERE name LIKE 'test_%' OR name LIKE 'e2e-%'
  `);
}
