import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ApiClient } from '@enterpriseglue/shared/infrastructure/persistence/entities/ApiClient.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { ServiceAccount } from '@enterpriseglue/shared/infrastructure/persistence/entities/ServiceAccount.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { ProjectPermissions, SYSTEM_ROLE_IDS, permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { apiClientService, ApiClientScopes } from '@enterpriseglue/shared/services/platform-admin/ApiClientService.js';
import { serviceAccountService, ServiceAccountScopes } from '@enterpriseglue/shared/services/platform-admin/ServiceAccountService.js';
import { cleanupSeededData, seedProject, seedUser } from '../utils/seed.js';

const prefix = `machine_authz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let skip = false;
let userId = '';
let apiClientId = '';
let serviceAccountId = '';
let apiClientToken = '';
let serviceAccountToken = '';
let assignedProjectId = '';
let sameTenantUnassignedProjectId = '';
let crossTenantProjectId = '';

describe('machine-principal authorization parity (database)', () => {
  beforeAll(async () => {
    const dataSource = await getDataSource();
    const queryRunner = dataSource.createQueryRunner();
    try {
      skip = !await queryRunner.hasTable('api_clients') ||
        !await queryRunner.hasTable('service_accounts') ||
        !await queryRunner.hasTable('role_assignments');
    } finally {
      await queryRunner.release();
    }
    if (skip) return;

    await permissionService.seedRbacFoundation(dataSource);
    const user = await seedUser(prefix);
    userId = user.id;
    const [assigned, sameTenantUnassigned, crossTenant] = await Promise.all([
      seedProject(userId, `${prefix}-assigned`),
      seedProject(userId, `${prefix}-same-tenant-unassigned`),
      seedProject(userId, `${prefix}-cross-tenant`),
    ]);
    assignedProjectId = assigned.id;
    sameTenantUnassignedProjectId = sameTenantUnassigned.id;
    crossTenantProjectId = crossTenant.id;
    await dataSource.getRepository(Project).update(
      { id: assignedProjectId }, { tenantId: 'tenant-machine-a' },
    );
    await dataSource.getRepository(Project).update(
      { id: sameTenantUnassignedProjectId }, { tenantId: 'tenant-machine-a' },
    );
    await dataSource.getRepository(Project).update(
      { id: crossTenantProjectId }, { tenantId: 'tenant-machine-b' },
    );

    const apiClient = await apiClientService.createClient({
      name: `${prefix}-api-client`,
      scopes: [ApiClientScopes.DEPLOYMENT_EXECUTE],
      createdById: userId,
    });
    apiClientId = apiClient.client.id;
    apiClientToken = apiClient.token;
    const serviceAccount = await serviceAccountService.createServiceAccount({
      name: `${prefix}-service-account`,
      scopes: [ServiceAccountScopes.DEPLOYMENT_EXECUTE],
      createdById: userId,
    });
    serviceAccountId = serviceAccount.account.id;
    serviceAccountToken = serviceAccount.token;

    for (const principal of [
      { principalType: 'api_client' as const, principalId: apiClientId },
      { principalType: 'service_account' as const, principalId: serviceAccountId },
    ]) {
      await permissionService.assignRole({
        tenantId: 'tenant-machine-a',
        ...principal,
        roleId: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
        scopeType: 'project',
        scopeId: assignedProjectId,
        createdById: userId,
      });
    }
  });

  afterAll(async () => {
    if (skip) return;
    const dataSource = await getDataSource();
    try {
      await dataSource.getRepository(RbacRoleAssignment).delete({ principalId: [apiClientId, serviceAccountId] as any });
      await dataSource.getRepository(ApiClient).delete({ id: apiClientId });
      await dataSource.getRepository(ServiceAccount).delete({ id: serviceAccountId });
    } finally {
      await cleanupSeededData(prefix, [assignedProjectId, sameTenantUnassignedProjectId, crossTenantProjectId], [userId]);
    }
  });

  it('gives API clients and service accounts the same bounded project decision', async () => {
    if (skip) return;
    for (const principal of [
      { principalType: 'api_client' as const, principalId: apiClientId },
      { principalType: 'service_account' as const, principalId: serviceAccountId },
    ]) {
      await expect(permissionService.hasPermission(ProjectPermissions.DEPLOY, {
        ...principal,
        tenantId: 'tenant-machine-a', resourceType: 'project', resourceId: assignedProjectId,
      })).resolves.toBe(true);
      await expect(permissionService.hasPermission(ProjectPermissions.DEPLOY, {
        ...principal,
        tenantId: 'tenant-machine-a', resourceType: 'project', resourceId: sameTenantUnassignedProjectId,
      })).resolves.toBe(false);
      await expect(permissionService.hasPermission(ProjectPermissions.DEPLOY, {
        ...principal,
        tenantId: 'tenant-machine-b', resourceType: 'project', resourceId: crossTenantProjectId,
      })).resolves.toBe(false);
    }
  });

  it('fails closed for expired machine-principal assignments', async () => {
    if (skip) return;
    const dataSource = await getDataSource();
    const principals = [
      { principalType: 'api_client' as const, principalId: apiClientId },
      { principalType: 'service_account' as const, principalId: serviceAccountId },
    ];
    try {
      for (const principal of principals) {
        await permissionService.assignRole({
          tenantId: 'tenant-machine-a',
          ...principal,
          roleId: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
          scopeType: 'project',
          scopeId: sameTenantUnassignedProjectId,
          expiresAt: Date.now() - 1,
          createdById: userId,
        });
        await expect(permissionService.hasPermission(ProjectPermissions.DEPLOY, {
          ...principal,
          tenantId: 'tenant-machine-a', resourceType: 'project', resourceId: sameTenantUnassignedProjectId,
        })).resolves.toBe(false);
      }
    } finally {
      for (const principal of principals) {
        await dataSource.getRepository(RbacRoleAssignment).delete({
          principalId: principal.principalId,
          scopeId: sameTenantUnassignedProjectId,
        });
      }
    }
  });

  it('enforces rotation and revocation for both machine credentials', async () => {
    if (skip) return;
    await expect(apiClientService.authenticateToken(apiClientToken, ApiClientScopes.DEPLOYMENT_EXECUTE)).resolves.toMatchObject({ id: apiClientId });
    const rotatedApiClient = await apiClientService.rotateClient(apiClientId);
    await expect(apiClientService.authenticateToken(apiClientToken, ApiClientScopes.DEPLOYMENT_EXECUTE)).rejects.toMatchObject({ statusCode: 401 });
    await expect(apiClientService.authenticateToken(rotatedApiClient.token, ApiClientScopes.DEPLOYMENT_EXECUTE)).resolves.toMatchObject({ id: apiClientId });

    await expect(serviceAccountService.authenticateToken(serviceAccountToken, ServiceAccountScopes.DEPLOYMENT_EXECUTE)).resolves.toMatchObject({ id: serviceAccountId });
    await serviceAccountService.revokeServiceAccount(serviceAccountId);
    await expect(serviceAccountService.authenticateToken(serviceAccountToken, ServiceAccountScopes.DEPLOYMENT_EXECUTE)).rejects.toMatchObject({ statusCode: 401 });
  });
});
