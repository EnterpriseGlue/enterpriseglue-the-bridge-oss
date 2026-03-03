#!/usr/bin/env npx tsx
/**
 * Cleanup Test Data Script
 * 
 * Removes leftover test data from the database that was created by integration tests
 * and not properly cleaned up (e.g., due to test failures or interruptions).
 * 
 * Usage: npx tsx scripts/cleanup-test-data.ts
 */

import 'reflect-metadata';
import { getDataSource } from '../../packages/shared/src/db/data-source.js';
import { Brackets } from 'typeorm';
import { Engine } from '../../packages/shared/src/db/entities/Engine.js';
import { User } from '../../packages/shared/src/db/entities/User.js';
import { Project } from '../../packages/shared/src/db/entities/Project.js';
import { EngineHealth } from '../../packages/shared/src/db/entities/EngineHealth.js';
import { EngineMember } from '../../packages/shared/src/db/entities/EngineMember.js';
import { RefreshToken } from '../../packages/shared/src/db/entities/RefreshToken.js';
import { AuditLog } from '../../packages/shared/src/db/entities/AuditLog.js';
import { ProjectMemberRole } from '../../packages/shared/src/db/entities/ProjectMemberRole.js';
import { ProjectMember } from '../../packages/shared/src/db/entities/ProjectMember.js';
import { File } from '../../packages/shared/src/db/entities/File.js';
import { Folder } from '../../packages/shared/src/db/entities/Folder.js';

async function cleanupTestData() {
  console.log('🧹 Starting test data cleanup...\n');
  
  const dataSource = await getDataSource();
  const engineRepo = dataSource.getRepository(Engine);
  const userRepo = dataSource.getRepository(User);
  const projectRepo = dataSource.getRepository(Project);
  const engineHealthRepo = dataSource.getRepository(EngineHealth);
  const engineMemberRepo = dataSource.getRepository(EngineMember);
  const refreshTokenRepo = dataSource.getRepository(RefreshToken);
  const auditLogRepo = dataSource.getRepository(AuditLog);
  const projectMemberRoleRepo = dataSource.getRepository(ProjectMemberRole);
  const projectMemberRepo = dataSource.getRepository(ProjectMember);
  const fileRepo = dataSource.getRepository(File);
  const folderRepo = dataSource.getRepository(Folder);

  const engineNamePatterns = ['test_camunda_%', 'test_%engine%', 'test_%', 'e2e-%'];
  const userEmailPatterns = ['e2e-%@example.com', 'test_%@example.com', 'test_%'];
  const projectNamePatterns = ['test_%', 'e2e-%', 'Smoke %', 'New Project to test Git%'];

  let totalDeleted = 0;

  // First, show counts and collect IDs
  const testEngines = await engineRepo
    .createQueryBuilder('e')
    .select(['e.id', 'e.name'])
    .where(new Brackets((qb) => {
      engineNamePatterns.forEach((pattern, index) => {
        const paramName = `enginePattern${index}`;
        if (index === 0) qb.where(`e.name LIKE :${paramName}`, { [paramName]: pattern });
        else qb.orWhere(`e.name LIKE :${paramName}`, { [paramName]: pattern });
      });
    }))
    .getMany();

  const testUsers = await userRepo
    .createQueryBuilder('u')
    .select(['u.id', 'u.email'])
    .where(new Brackets((qb) => {
      userEmailPatterns.forEach((pattern, index) => {
        const paramName = `userPattern${index}`;
        if (index === 0) qb.where(`u.email LIKE :${paramName}`, { [paramName]: pattern });
        else qb.orWhere(`u.email LIKE :${paramName}`, { [paramName]: pattern });
      });
    }))
    .getMany();

  const testProjects = await projectRepo
    .createQueryBuilder('p')
    .select(['p.id', 'p.name'])
    .where(new Brackets((qb) => {
      projectNamePatterns.forEach((pattern, index) => {
        const paramName = `projectPattern${index}`;
        if (index === 0) qb.where(`p.name LIKE :${paramName}`, { [paramName]: pattern });
        else qb.orWhere(`p.name LIKE :${paramName}`, { [paramName]: pattern });
      });
    }))
    .getMany();

  const engineIds = testEngines.map((e) => e.id);
  const userIds = testUsers.map((u) => u.id);
  const projectIds = testProjects.map((p) => p.id);

  console.log(`Found: ${engineIds.length} test engines, ${userIds.length} test users\n`);

  // Clean up refresh tokens and audit logs BEFORE deleting users/projects/engines
  console.log('Cleaning up test refresh tokens and audit logs...');
  if (userIds.length > 0) {
    await refreshTokenRepo
      .createQueryBuilder()
      .delete()
      .where('userId IN (:...userIds)', { userIds })
      .execute();
  }

  await auditLogRepo
    .createQueryBuilder()
    .delete()
    .where(new Brackets((qb) => {
      if (userIds.length > 0) {
        qb.where('userId IN (:...userIds)', { userIds });
      }
      if (projectIds.length > 0) {
        qb.orWhere('resourceId IN (:...projectIds)', { projectIds });
      }
      if (engineIds.length > 0) {
        qb.orWhere('resourceId IN (:...engineIds)', { engineIds });
      }
      qb.orWhere('details LIKE :detailPattern0', { detailPattern0: '%e2e-%@example.com%' });
      qb.orWhere('details LIKE :detailPattern1', { detailPattern1: '%test_%@example.com%' });
    }))
    .execute();

  // Clean up test projects (before users, since projects reference owner_id)
  console.log('Cleaning up test projects...');
  if (projectIds.length > 0) {
    await projectMemberRoleRepo
      .createQueryBuilder()
      .delete()
      .where('projectId IN (:...projectIds)', { projectIds })
      .execute();

    await projectMemberRepo
      .createQueryBuilder()
      .delete()
      .where('projectId IN (:...projectIds)', { projectIds })
      .execute();

    await fileRepo
      .createQueryBuilder()
      .delete()
      .where('projectId IN (:...projectIds)', { projectIds })
      .execute();

    await folderRepo
      .createQueryBuilder()
      .delete()
      .where('projectId IN (:...projectIds)', { projectIds })
      .execute();

    const projectDeleteResult = await projectRepo
      .createQueryBuilder()
      .delete()
      .where('id IN (:...projectIds)', { projectIds })
      .execute();

    const projectCount = Number(projectDeleteResult.affected || 0);
    if (projectCount > 0) {
      console.log(`  - Deleted ${projectCount} test projects`);
      totalDeleted += projectCount;
    }
  }

  // Clean up test engines
  console.log('Cleaning up test engines...');
  if (engineIds.length > 0) {
    await engineHealthRepo
      .createQueryBuilder()
      .delete()
      .where('engineId IN (:...engineIds)', { engineIds })
      .execute();

    await engineMemberRepo
      .createQueryBuilder()
      .delete()
      .where('engineId IN (:...engineIds)', { engineIds })
      .execute();

    const engineDeleteResult = await engineRepo
      .createQueryBuilder()
      .delete()
      .where('id IN (:...engineIds)', { engineIds })
      .execute();

    const engineCount = Number(engineDeleteResult.affected || 0);
    if (engineCount > 0) {
      console.log(`  - Deleted ${engineCount} test engines`);
      totalDeleted += engineCount;
    }
  }

  // Clean up test users (after projects and tokens are removed)
  console.log('Cleaning up test users...');
  if (userIds.length > 0) {
    const userDeleteResult = await userRepo
      .createQueryBuilder()
      .delete()
      .where('id IN (:...userIds)', { userIds })
      .execute();

    const userCount = Number(userDeleteResult.affected || 0);
    if (userCount > 0) {
      console.log(`  - Deleted ${userCount} test users`);
      totalDeleted += userCount;
    }
  }
  
  console.log(`\n✅ Cleanup complete! Removed ${totalDeleted} test records.`);
  
  await dataSource.destroy();
}

cleanupTestData().catch((err) => {
  console.error('❌ Cleanup failed:', err);
  const maybeProcess = (globalThis as any).process;
  if (maybeProcess && typeof maybeProcess.exit === 'function') {
    maybeProcess.exit(1);
  }
});
