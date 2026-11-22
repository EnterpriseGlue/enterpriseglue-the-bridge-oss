import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdvancedConsoleLogger, DataSource } from 'typeorm';
import express from 'express';
import request from 'supertest';
import { databaseConfig } from '@enterpriseglue/shared/config/database.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { applyPostgresTenantPolicies } from '@enterpriseglue/shared/db/postgres-tenant-policy.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { PermissionGrant } from '@enterpriseglue/shared/infrastructure/persistence/entities/PermissionGrant.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { installPostgresContextBoundary, TenantRlsSubscriber } from '@enterpriseglue/shared/infrastructure/persistence/subscribers/TenantRlsSubscriber.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { runWithTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';
import stats from '../../../packages/backend-host/src/modules/dashboard/routes/stats.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const userId = req.get('x-fixture-actor') === 'owner' ? 'owner' : 'member';
    req.user = { userId, type: 'access', platformRole: 'user' };
    req.tenant = { tenantId: 'alpha', tenantSlug: 'alpha' };
    runWithTenantDatabaseContext({ tenantId: 'alpha', tenantSlug: 'alpha' }, next);
  },
}));
// The endpoint's dashboard action gate is covered by the route unit tests.
vi.mock('@enterpriseglue/shared/middleware/requireAction.js', () => ({
  requireAction: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const disposable = process.env.SESSION_RACE_DISPOSABLE_POSTGRES === 'true' && Boolean(process.env.MIGRATION_TEST_POSTGRES_CONTAINER);
const env = (name: string) => process.env[`MIGRATION_TEST_POSTGRES_${name}`] || process.env[`POSTGRES_${name}`];
const connection = { type: 'postgres' as const, host: env('HOST'), port: Number(env('PORT')) };
const credentials = { username: env('USER'), password: env('PASSWORD') };
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const database = `dashboard_${suffix}`;
const role = `runtime_${suffix}`;
const entities = [AuthzGroup, AuthzGroupMembership, File, PermissionGrant, Project, RbacRoleAssignment, User];
const admin = new DataSource({ ...connection, ...credentials, database: env('DATABASE') });
let owner: DataSource | undefined;
let runtime: DataSource | undefined;
const originalMode = databaseConfig.tenancyMode;
const queries: string[] = [];
const logger = new class extends AdvancedConsoleLogger {
  override logQuery(query: string) { queries.push(query); }
}(['query']);
const app = express().use(stats).use(errorHandler);

describe.skipIf(!disposable)('dashboard aggregates on pooled PostgreSQL', () => {
  beforeAll(async () => {
    databaseConfig.tenancyMode = 'pooled';
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${database}"`);
    await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${suffix}' NOSUPERUSER NOBYPASSRLS`);
    owner = await new DataSource({ ...connection, ...credentials, database, schema: 'main', entities }).initialize();
    await owner.query('CREATE SCHEMA main');
    await owner.synchronize();
    await owner.query(`INSERT INTO main.projects (id, name, owner_id, tenant_id, created_at, updated_at)
      SELECT tenant || '-' || n, 'Project ' || n, 'owner', tenant, 1, 1
      FROM unnest(ARRAY['alpha','beta']) AS tenants(tenant), generate_series(1,250) n`);
    await owner.query(`INSERT INTO main.files (id, project_id, name, type, xml, created_at, updated_at)
      SELECT p.id || '-' || n, p.id, 'Workflow ' || n, CASE WHEN n <= 30 THEN 'BPMN' ELSE 'dmn' END, '', 1, 1
      FROM main.projects p, generate_series(1,40) n`);
    await owner.getRepository(AuthzGroup).insert({
      id: 'alpha-viewers', tenantId: 'alpha', key: 'viewers', groupKeyIdentity: 'alpha:viewers',
      name: 'Viewers', createdAt: 1, updatedAt: 1,
    });
    await owner.getRepository(AuthzGroupMembership).insert({
      id: 'member-viewers', tenantId: 'alpha', groupId: 'alpha-viewers', userId: 'member', createdAt: 1, updatedAt: 1,
    });
    await owner.getRepository(RbacRoleAssignment).insert([
      { id: 'ownership', assignmentKey: 'ownership', roleId: 'tenant-admin', tenantId: 'alpha', principalType: 'user', principalId: 'owner', scopeType: 'tenant', scopeId: 'alpha', source: 'manual', createdAt: 1, updatedAt: 1 },
      { id: 'member-project', assignmentKey: 'member-project', roleId: 'project-viewer', tenantId: 'alpha', principalType: 'group', principalId: 'alpha-viewers', scopeType: 'project', scopeId: 'alpha-1', source: 'manual', createdAt: 1, updatedAt: 1 },
      { id: 'foreign-project', assignmentKey: 'foreign-project', roleId: 'project-viewer', tenantId: 'alpha', principalType: 'user', principalId: 'member', scopeType: 'project', scopeId: 'beta-1', source: 'manual', createdAt: 1, updatedAt: 1 },
    ]);
    const runner = owner.createQueryRunner();
    try { await applyPostgresTenantPolicies(runner); } finally { await runner.release(); }
    await owner.query(`GRANT USAGE ON SCHEMA main TO "${role}"`);
    await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA main TO "${role}"`);
    await owner.query('ANALYZE');
    runtime = new DataSource({ ...connection, username: role, password: suffix, database, schema: 'main', entities,
      subscribers: [TenantRlsSubscriber], logging: ['query'], logger });
    installPostgresContextBoundary(runtime);
    await runtime.initialize();
    vi.mocked(getDataSource).mockResolvedValue(runtime);
  }, 30_000);

  afterAll(async () => {
    databaseConfig.tenancyMode = originalMode;
    if (runtime?.isInitialized) await runtime.destroy();
    if (owner?.isInitialized) await owner.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });

  it.each([{ actor: 'owner', projects: 250 }, { actor: 'member', projects: 1 }])(
    'counts only the projects and files visible to the $actor',
    async ({ actor, projects }) => {
      const samples: Array<{ ms: number; statements: number; businessReads: number }> = [];
      for (let sample = 0; sample < 11; sample++) {
        queries.length = 0;
        const started = performance.now();
        const response = await request(app).get('/api/dashboard/stats').set('x-fixture-actor', actor);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.body).toEqual({
          totalProjects: projects, totalFiles: projects * 40, fileTypes: { bpmn: projects * 30, dmn: projects * 10, form: 0 },
        });
        expect(queries.filter(sql => !sql.includes("set_config('enterpriseglue.")).length).toBe(4);
        if (sample > 0) samples.push({ ms: Math.round((performance.now() - started) * 10) / 10,
          statements: queries.length, businessReads: queries.filter(sql => !sql.includes("set_config('enterpriseglue.")).length });
      }
      if (process.env.EG_PROFILE_DASHBOARD_STATS === 'true') console.log(JSON.stringify({ actor, samples }));
    },
  );

  it('re-evaluates project grants on the next request and ignores expired and sibling grants', async () => {
    const fetchStats = () => request(app).get('/api/dashboard/stats');
    const grants = owner!.getRepository(PermissionGrant);
    await grants.insert([
      { id: 'active', tenantId: 'alpha', userId: 'member', resourceType: 'project', resourceId: 'alpha-2', permission: 'project:read', createdAt: 1 },
      { id: 'expired', tenantId: 'alpha', userId: 'member', resourceType: 'project', resourceId: 'alpha-3', permission: 'project:read', expiresAt: 1, createdAt: 1 },
      { id: 'sibling', tenantId: 'beta', userId: 'member', resourceType: 'project', resourceId: 'beta-2', permission: 'project:read', createdAt: 1 },
    ]);
    expect((await fetchStats()).body.totalProjects).toBe(2);
    await grants.delete('active');
    expect((await fetchStats()).body.totalProjects).toBe(1);
    await grants.insert({ id: 'all', tenantId: 'alpha', userId: 'member', resourceType: 'project', resourceId: null, permission: 'project:read', createdAt: 1 });
    expect((await fetchStats()).body.totalProjects).toBe(250);
  });
});
