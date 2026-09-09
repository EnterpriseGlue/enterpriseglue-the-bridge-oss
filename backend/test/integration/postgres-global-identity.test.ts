import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { DataSource } from 'typeorm';
import express from 'express';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { MockOidcProvider } from '../identity-mocks/index.js';

// Only connection selection is injected. Repositories, transactions, TypeORM
// subscriber, RLS policies, JWT verification, callback and session services are real.
const database = vi.hoisted(() => ({current:null as DataSource|null}));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({getDataSource:async () => {
  if (!database.current) throw new Error('Fixture is not initialized');
  return database.current;
}}));
import { config } from '@enterpriseglue/shared/config/index.js';
import { PostgresAdapter } from '@enterpriseglue/shared/db/adapters/PostgresAdapter.js';
import { installPostgresContextBoundary, assertPostgresContextBoundary } from '@enterpriseglue/shared/infrastructure/persistence/subscribers/TenantRlsSubscriber.js';
import { applyPostgresTenantPolicies } from '@enterpriseglue/shared/db/postgres-tenant-policy.js';
import { identityProviderService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { SsoSyncRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoSyncRun.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { runWithPlatformDatabaseCapability } from '@enterpriseglue/shared/services/platform-database-context.js';
import { requireCloudAccountOrTenantAuth, requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import identityRoutes from '@enterpriseglue/backend-host/modules/auth/routes/identity-oidc.js';
import refreshRoutes from '@enterpriseglue/backend-host/modules/auth/routes/refresh.js';
import tenantRoutes from '@enterpriseglue/backend-host/modules/tenancy/routes/tenants.js';
import { tenantService } from '@enterpriseglue/shared/services/platform-admin/TenantService.js';
import { parseSignedOidcState } from '@enterpriseglue/backend-host/modules/auth/routes/sso-state.js';
import { runConfigBundleBootstrap } from '@enterpriseglue/backend-host/services/configBundleBootstrap.js';
import { ConfigBundleApplyRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/ConfigBundleApplyRun.js';
import { getActivePlatformAdministratorUserIds } from '@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js';
import { verifyPostgresTenantRls } from '@enterpriseglue/shared/db/postgres-tenant-rls.js';
import { userService } from '@enterpriseglue/shared/services/platform-admin/UserService.js';
import { claimActivePlatformAdministratorMembership, PLATFORM_ADMINISTRATORS_GROUP_ID } from '@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js';
import loginRoutes from '@enterpriseglue/backend-host/modules/auth/routes/login.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { GitProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitProvider.js';
import { getTenantDatabaseContext, runWithTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { seedGitProviders } from '@enterpriseglue/shared/db/seed/gitProviders.js';
import { setupStatusService } from '@enterpriseglue/shared/services/admin/SetupStatusService.js';

const suffix=randomUUID().replace(/-/g,'').slice(0,10);
const schema=`global_${suffix}`, ownerName=`owner_${suffix}`, runtimeName=`runtime_${suffix}`, password=`fixture_${suffix}`;
const env=(name:string,fallback:string) => process.env[`MIGRATION_TEST_${name}`] || process.env[name] || fallback;
const connection={type:'postgres' as const, host:env('POSTGRES_HOST','127.0.0.1'),port:Number(env('POSTGRES_PORT','5432')),database:env('POSTGRES_DATABASE','postgres')};
const admin=new DataSource({...connection,username:env('POSTGRES_USER','postgres'),password:env('POSTGRES_PASSWORD','postgres')});
const protocol=new MockOidcProvider({callbackUrl:'http://localhost:5173/api/auth/identity/callback'});
const original={tenancyMode:config.tenancyMode,tenancyCloudRequired:config.tenancyCloudRequired,cloudAccountIdentityEnabled:config.cloudAccountIdentityEnabled,postgresSchema:config.postgresSchema};
let owner:DataSource, runtime:DataSource, app:express.Express, providerId:string;
let server:Server;

describe('verified global OIDC callback and renewable sessions under forced PostgreSQL RLS', () => {
  beforeAll(async () => {
    Object.assign(config,{tenancyMode:'pooled',tenancyCloudRequired:true,cloudAccountIdentityEnabled:true,postgresSchema:schema});
    await admin.initialize();
    await admin.query(`CREATE ROLE ${ownerName} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
    await admin.query(`CREATE ROLE ${runtimeName} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
    await admin.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${ownerName}`);
    const options=new PostgresAdapter().getDataSourceOptions();
    if(options.type!=='postgres') throw new Error('Expected PostgreSQL');
    const build=(username:string) => {const source=new DataSource({...options,...connection,url:undefined,username,password,schema,migrations:[],logging:false,extra:{max:2}}); installPostgresContextBoundary(source);return source;};
    owner=build(ownerName); await owner.initialize(); await owner.synchronize();
    database.current=owner;
    await permissionService.seedRbacFoundation(owner);
    await authzGroupService.seedDefaultPlatformGroups(owner);
    const provider=await identityProviderService.upsert({tenantId:null,key:'identity.oidc.global-fixture',displayName:'Verified fixture',protocol:'oidc',isEnabled:true,authenticationMode:'direct',configuration:protocol.configuration()});
    providerId=provider.id;
    const runner=owner.createQueryRunner();try{await applyPostgresTenantPolicies(runner);}finally{await runner.release();}
    await owner.query(`GRANT USAGE ON SCHEMA ${schema} TO ${runtimeName}`);
    await owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${runtimeName}`);
    runtime=build(runtimeName);await runtime.initialize();assertPostgresContextBoundary(runtime);database.current=runtime;
    vi.stubGlobal('fetch',protocol.fetch.bind(protocol));
    app=express();app.use(express.json());app.use(express.urlencoded({extended:false}));app.use(cookieParser());
    app.use(identityRoutes);app.use(refreshRoutes);app.use(tenantRoutes);
    app.use(rateLimit({ windowMs: 60_000, limit: 50, standardHeaders: true, legacyHeaders: false }));
    app.get('/cloud-probe',requireCloudAccountOrTenantAuth,(req,res)=>res.json({userId:req.user!.userId,sessionClass:req.user!.sessionClass,tenantId:req.user!.tenantId}));
    app.get('/tenant-only-probe',requireAuth,(_req,res)=>res.json({ok:true}));
    app.get('/tenant-permissions-probe',requireAuth,(req,res,next)=>{
      permissionService.getCurrentUserPermissions(req.user!.userId,req.tenant!.tenantId)
        .then(permissions=>res.json({tenantId:req.tenant!.tenantId,platform:permissions.platform})).catch(next);
    });
    app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error.statusCode || 500).json({error:error.message}));
    // Supertest's implicit server is otherwise reopened on an ephemeral port
    // for every request. Keep one listener for these multi-request cookie flows.
    server=await new Promise<Server>((resolve,reject)=>{
      const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));
      listener.once('error',reject);
    });
    vi.spyOn(logger,'error');vi.spyOn(logger,'warn');
  },30_000);
  afterAll(async()=>{
    if(server?.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    vi.unstubAllGlobals();vi.restoreAllMocks();database.current=null;
    if(runtime?.isInitialized)await runtime.destroy();if(owner?.isInitialized)await owner.destroy();
    if(admin.isInitialized){await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.query(`DROP ROLE IF EXISTS ${runtimeName}`);await admin.query(`DROP ROLE IF EXISTS ${ownerName}`);await admin.destroy();}
    Object.assign(config,original);
  });
  async function signIn(subject:string,email:string) {
    const browser=request.agent(server);
    const start=await browser.get(`/api/auth/cloud-signup/providers/${providerId}/start?returnTo=%2Fcloud%2Fonboarding`);
    expect(start.status,start.body.error).toBe(302);
    const location=new URL(start.headers.location);
    const state=location.searchParams.get('state')!;
    const parsed=parseSignedOidcState(state)!;
    protocol.setTokenClaims({sub:subject,email,email_verified:true,nonce:parsed.nonce});
    const callback=await browser.get('/api/auth/identity/callback').query({state,code:'verified-code'});
    return {browser,callback};
  }
  it('lists only public global choices, exchanges a real signed token, persists identity and renews a tenant-neutral session', async()=>{
    const listed=await request(server).get('/api/auth/cloud-signup/providers');expect(listed.status).toBe(200);
    expect(listed.body).toEqual([{id:providerId,displayName:'Verified fixture',protocol:'oidc'}]);
    const {browser,callback}=await signIn('verified-a','verified-a@example.test');
    expect(callback.status,JSON.stringify(callback.body)).toBe(302);
    expect(callback.headers.location).toContain('/cloud/onboarding');
    const probe=await browser.get('/cloud-probe');expect(probe.status,JSON.stringify(probe.body)).toBe(200);
    expect(probe.body.sessionClass).toBe('cloud_account');expect(probe.body.tenantId).toBeUndefined();
    expect((await browser.get('/tenant-only-probe')).status).toBe(401);
    expect((await browser.post('/api/auth/refresh').send({})).status).toBe(200);
    const users=await runtime.getRepository(User).findBy({email:'verified-a@example.test'});expect(users).toHaveLength(1);
    const bound=users[0].id;
    expect(await runtime.getRepository(ExternalIdentity).find()).toEqual([]);
    const identities=await runWithPlatformDatabaseCapability({kind:'provider-account',providerId,subjectId:'verified-a',userId:bound},()=>runtime.getRepository(ExternalIdentity).find());expect(identities).toHaveLength(1);
    const memberships=await runWithPlatformDatabaseCapability({kind:'authenticated-account',userId:bound},()=>runtime.getRepository(AuthzGroupMembership).find());expect(memberships.map(row=>row.groupId)).toContain('system.group.authenticated_users');
    const permissions=await permissionService.getCurrentUserPermissions(bound,null);expect(permissions.platform.length).toBeGreaterThan(0);
    expect(await runtime.getRepository(SsoSyncRun).find()).toEqual([]);
    const sessions=await runtime.getRepository(RefreshToken).findBy({userId:bound});expect(sessions).toHaveLength(1);
    expect(logger.error).not.toHaveBeenCalled();expect(logger.warn).not.toHaveBeenCalled();
  });
  it('keeps two verified subjects separate and denies another account scope',async()=>{
    const {browser,callback}=await signIn('verified-b','verified-b@example.test');expect(callback.status,JSON.stringify(callback.body)).toBe(302);
    const probe=await browser.get('/cloud-probe');expect(probe.status).toBe(200);
    const identity=await runWithPlatformDatabaseCapability({kind:'provider-account',providerId,subjectId:'verified-a',userId:probe.body.userId},()=>runtime.getRepository(ExternalIdentity).find());
    expect(identity).toEqual([]);
    const own=await runWithPlatformDatabaseCapability({kind:'authenticated-account',userId:probe.body.userId},()=>runtime.getRepository(AuthzGroupMembership).find());expect(own.every(row=>row.userId===probe.body.userId)).toBe(true);
  });
  it('rejects a bad token before creating user or identity records',async()=>{
    protocol.setFailureMode('invalid_token');
    try{const {callback}=await signIn('rejected','rejected@example.test');expect(callback.status).not.toBe(302);expect(await runtime.getRepository(User).countBy({email:'rejected@example.test'})).toBe(0);}
    finally{protocol.setFailureMode('none');}
  });
  it('preserves manual administrator read authority without exposing other account memberships',async()=>{
    const user=(await runtime.getRepository(User).findBy({email:'verified-a@example.test'}))[0];
    await admin.query(`INSERT INTO ${schema}.authz_group_memberships (id,tenant_id,group_id,user_id,source,source_ref,created_at,updated_at) VALUES ($1,NULL,'system.group.platform_administrators',$2,'manual','manual-platform-administrator',1,1)`,[randomUUID(),user.id]);
    expect((await getActivePlatformAdministratorUserIds([user.id],runtime)).has(user.id)).toBe(true);
    const other=(await runtime.getRepository(User).findBy({email:'verified-b@example.test'}))[0];
    expect((await getActivePlatformAdministratorUserIds([other.id],runtime)).size).toBe(0);
    const rows=await runWithPlatformDatabaseCapability({kind:'authenticated-account',userId:other.id},()=>runtime.getRepository(AuthzGroupMembership).find());
    expect(rows.every(row=>row.userId===other.id)).toBe(true);
    await authzGroupService.seedDefaultPlatformGroups(runtime);
    expect(await authzGroupService.backfillAuthenticatedUserMemberships(runtime)).toEqual({scanned:2,created:0});
  });
  it('requires four command policies and rejects a legacy or extra broad policy during runtime verification',async()=>{
    const verify=async()=>{const runner=runtime.createQueryRunner();try{return await verifyPostgresTenantRls(runner);}finally{await runner.release();}};
    const ready=await verify();expect(ready.expected).toBeGreaterThan(0);expect(ready.enforced).toBe(ready.expected);
    await owner.query(`CREATE POLICY eg_tenant_isolation ON ${schema}.projects USING (true)`);
    expect((await verify()).enforced).toBe(ready.expected-1);
    for(const command of ['select','insert','update','delete'])await owner.query(`DROP POLICY eg_tenant_isolation_${command} ON ${schema}.projects`);
    expect((await verify()).enforced).toBe(ready.expected-1);
    const runner=owner.createQueryRunner();try{await applyPostgresTenantPolicies(runner);}finally{await runner.release();}
    expect((await verify()).enforced).toBe(ready.expected);
  }, 30_000); // This case rewrites every protected table policy, not one query.
  it('applies and replays provider-only startup configuration with a persisted scoped receipt',async()=>{
    const saved={configBootstrapMode:config.configBootstrapMode,configBundlePath:config.configBundlePath,configExpectedSha256:config.configExpectedSha256,configExpectedTenantScope:config.configExpectedTenantScope,configRequireSecretPreflight:config.configRequireSecretPreflight};
    const directory=await mkdtemp(join(tmpdir(),'eg-bootstrap-rls-'));
    const payload={bundle:{apiVersion:'enterpriseglue.ai/v1beta1',kind:'EnterpriseGlueConfigBundle',metadata:{key:'platform.signup-fixture',owner:'platform-team'},tenantKey:'platform',mode:'additive',imports:['./identity-providers.json']},files:{'./identity-providers.json':{identityProviders:[{key:'bootstrap-oidc',type:'oidc',authenticationMode:'direct',enabled:true,oidc:{...protocol.configuration(),clientSecretRef:'env://EG_CONFIG_BUNDLE_SECRET',clientAuthentication:'client_secret_post'},sync:{triggers:['login'],requiredForLogin:true,incompleteEntitlements:'fail_closed',connectorCapability:'claim_only',scheduled:false}}]}}};
    const bytes=JSON.stringify(payload),file=join(directory,'bundle.json');await writeFile(file,bytes);
    Object.assign(config,{configBootstrapMode:'apply',configBundlePath:file,configExpectedSha256:createHash('sha256').update(bytes).digest('hex'),configExpectedTenantScope:'platform',configRequireSecretPreflight:true});
    vi.stubEnv('EG_CONFIG_BUNDLE_SECRET','disposable-protocol-client-secret');
    try{
      expect((await runConfigBundleBootstrap()).status).toBe('applied');
      expect((await runConfigBundleBootstrap()).status).toBe('applied');
      expect(await runtime.getRepository(ConfigBundleApplyRun).find()).toEqual([]);
      const receipts=await runWithPlatformDatabaseCapability({kind:'config-bootstrap',bundleKey:'platform.signup-fixture',providerKeys:['bootstrap-oidc']},()=>runtime.getRepository(ConfigBundleApplyRun).find());
      expect(receipts).toHaveLength(1);expect(receipts[0].status).toBe('succeeded');
      expect(JSON.parse(receipts[0].resultJson!).bootstrap.status).toBe('applied');
    }finally{Object.assign(config,saved);vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});}
  });
  it('bounds login diagnostics to one provider/run and revokes deferred diagnostic work',async()=>{
    const runId=randomUUID();
    const insert=(id:string,provider:string)=>runtime.query(`INSERT INTO ${schema}.sso_sync_runs (id,tenant_id,provider_id,trigger,status,started_at) VALUES ($1,NULL,$2,'login','running',1)`,[id,provider]);
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let deferred!:Promise<unknown>;
    await runWithPlatformDatabaseCapability({kind:'provider-login',providerId,subjectId:'verified-a',runId},async()=>{
      await insert(runId,providerId);
      await expect(insert(randomUUID(),providerId)).rejects.toThrow('row-level security');
      await expect(insert(randomUUID(),'other-provider')).rejects.toThrow('row-level security');
      const rows=await runtime.getRepository(SsoSyncRun).find();expect(rows.map(row=>row.id)).toEqual([runId]);
      deferred=(async()=>{await gate;return runtime.getRepository(SsoSyncRun).find();})();
    });
    release();expect(await deferred).toEqual([]);
  });
  it('seeds Git defaults only for the canonical active tenant, without global rows',async()=>{
    await expect(seedGitProviders()).rejects.toThrow('canonical active default tenant');
    await runtime.getRepository(Tenant).insert({id:'tenant-default',name:'Default',slug:'default',status:'active',placementKey:'fixture',placementEpoch:1,createdByUserId:null,createdAt:1,updatedAt:1});
    await seedGitProviders();await seedGitProviders();
    expect(await runtime.getRepository(GitProvider).find()).toEqual([]);
    const providers=await runWithTenantDatabaseContext({tenantId:'tenant-default',tenantSlug:'default'},()=>runtime.getRepository(GitProvider).find());
    expect(providers).toHaveLength(4);expect(providers.every(provider=>provider.tenantId==='tenant-default')).toBe(true);
    await runtime.getRepository(Tenant).update({id:'tenant-default'},{status:'suspended'});
    await expect(seedGitProviders()).rejects.toThrow('canonical active default tenant');
  });

  const adminMemberships = (userId: string) => runWithPlatformDatabaseCapability({ kind: 'authenticated-account', userId }, () =>
    runtime.getRepository(AuthzGroupMembership).findBy({ userId, groupId: PLATFORM_ADMINISTRATORS_GROUP_ID }));

  it('grants and revokes manual administration through the existing user command without removing source-managed administration', async () => {
    const target = await userService.createPendingUser({ email: 'manual-command@example.test', platformRole: 'admin', createdByUserId: 'fixture-operator' });
    expect(target.platformRole).toBe('admin');
    expect((await adminMemberships(target.id)).map(row => row.source)).toEqual(['manual']);
    await runtime.transaction(manager => authzGroupService.ensureLegacyPlatformAdministratorMembershipWithManager(manager, target.id));
    const demoted = await userService.updateUser(target.id, { platformRole: 'user' });
    expect(demoted.platformRole).toBe('admin'); // Legacy source remains authoritative.
    expect((await adminMemberships(target.id)).map(row => row.source)).toEqual(['system']);
    await userService.updateUser(target.id, { platformRole: 'admin' });
    expect((await adminMemberships(target.id)).map(row => row.source).sort()).toEqual(['manual', 'system']);
  });

  it('denies unscoped, wrong-target and source-changing administrator mutations under the restricted role', async () => {
    const target = await userService.createPendingUser({ email: 'manual-denial@example.test', createdByUserId: 'fixture-operator' });
    const repo = runtime.getRepository(AuthzGroupMembership);
    const row = { id: randomUUID(), tenantId: null, groupId: PLATFORM_ADMINISTRATORS_GROUP_ID, userId: target.id, source: 'manual', sourceRef: 'manual-platform-administrator', expiresAt: null, createdById: null, createdAt: 1, updatedAt: 1 };
    await expect(repo.insert(row)).rejects.toThrow('row-level security');
    await expect(runtime.transaction(manager => authzGroupService.ensureManualPlatformAdministratorMembershipWithManager(manager, target.id))).rejects.toThrow('Explicit manual administrator grant');
    await expect(runWithPlatformDatabaseCapability({ kind: 'manual-administrator-grant', userId: 'different-user' }, () => repo.insert(row))).rejects.toThrow('row-level security');
    await expect(runWithPlatformDatabaseCapability({ kind: 'manual-administrator-grant', userId: target.id }, () => repo.insert({ ...row, source: 'system' }))).rejects.toThrow('row-level security');
    await expect(runWithPlatformDatabaseCapability({ kind: 'manual-administrator-grant', userId: target.id }, () => repo.insert({ ...row, sourceRef: 'another-source' }))).rejects.toThrow('row-level security');
    expect(await adminMemberships(target.id)).toEqual([]);
    await userService.updateUser(target.id, { platformRole: 'admin' });
    expect((await runWithPlatformDatabaseCapability({ kind: 'manual-administrator-revoke', userId: 'different-user' }, () => repo.delete({ userId: target.id }))).affected).toBe(0);
    expect((await adminMemberships(target.id))).toHaveLength(1);
  });

  it('allows only an exact active recovery no-op snapshot, denying every persisted-field change', async () => {
    const target = await userService.createPendingUser({ email: 'recovery-claim@example.test', platformRole: 'admin', createdByUserId: 'fixture-operator' });
    const row = (await adminMemberships(target.id))[0];
    const capability = { kind: 'administrator-recovery-claim' as const, userId: row.userId, membershipId: row.id, source: row.source,
      sourceRef: row.sourceRef, expiresAt: row.expiresAt === null ? null : String(row.expiresAt), createdById: row.createdById,
      createdAt: String(row.createdAt), updatedAt: String(row.updatedAt) };
    await expect(runtime.transaction(manager => claimActivePlatformAdministratorMembership(target.id, manager))).resolves.toBe(true);
    const mutations = [{ id: randomUUID() }, { tenantId: 'foreign-tenant' }, { groupId: 'system.group.authenticated_users' },
      { userId: 'other-user' }, { source: 'system' }, { sourceRef: 'other-source' }, { expiresAt: Date.now() + 60_000 },
      { createdById: 'other-actor' }, { createdAt: Number(row.createdAt) + 1 }, { updatedAt: Number(row.updatedAt) + 1 }];
    for (const mutation of mutations) {
      await expect(runWithPlatformDatabaseCapability(capability, () => runtime.getRepository(AuthzGroupMembership).update({ id: row.id }, mutation))).rejects.toThrow('row-level security');
    }
    expect(await adminMemberships(target.id)).toEqual([row]);
    await admin.query(`UPDATE ${schema}.authz_group_memberships SET expires_at=1 WHERE id=$1`, [row.id]);
    // Even a stale caller clock cannot override PostgreSQL's actual expiry check.
    await expect(runtime.transaction(manager => claimActivePlatformAdministratorMembership(target.id, manager, 0))).resolves.toBe(false);
  });

  it('rolls back user creation and manual grants when their audit insert fails', async () => {
    await admin.query(`CREATE FUNCTION ${schema}.reject_manual_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.details::jsonb->>'sourceRef'='manual-platform-administrator' THEN RAISE EXCEPTION 'fixture manual audit failure'; END IF; RETURN NEW; END $$`);
    await admin.query(`CREATE TRIGGER reject_manual_audit BEFORE INSERT ON ${schema}.audit_logs FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_manual_audit()`);
    try {
      // Audit logging catches its own error; the query boundary still refuses
      // any further work/commit in the now-aborted transaction.
      await expect(userService.createPendingUser({ email: 'manual-rollback@example.test', platformRole: 'admin', createdByUserId: 'fixture-operator' })).rejects.toThrow('Failed transaction requires rollback');
      expect(await runtime.getRepository(User).countBy({ email: 'manual-rollback@example.test' })).toBe(0);
    } finally {
      await admin.query(`DROP TRIGGER reject_manual_audit ON ${schema}.audit_logs`);
      await admin.query(`DROP FUNCTION ${schema}.reject_manual_audit()`);
    }
  });

  it('rolls back failed demotion and atomically revokes existing sessions when demotion succeeds', async () => {
    const target = await userService.createPendingUser({ email: 'demote-rollback@example.test', platformRole: 'admin', createdByUserId: 'fixture-operator' });
    const before = (await runtime.getRepository(User).findOneBy({ id: target.id }))!;
    const tokenId = randomUUID();
    await runtime.getRepository(RefreshToken).insert({ id: tokenId, userId: target.id, tenantId: null, tokenHash: randomUUID(), expiresAt: Date.now() + 60_000, createdAt: Date.now(), revokedAt: null });
    await admin.query(`CREATE FUNCTION ${schema}.reject_manual_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.details::jsonb->>'sourceRef'='manual-platform-administrator' THEN RAISE EXCEPTION 'fixture manual audit failure'; END IF; RETURN NEW; END $$`);
    await admin.query(`CREATE TRIGGER reject_manual_audit BEFORE INSERT ON ${schema}.audit_logs FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_manual_audit()`);
    try {
      await expect(userService.updateUser(target.id, { platformRole: 'user', lastName: 'must roll back' })).rejects.toThrow('Failed transaction requires rollback');
      expect((await runtime.getRepository(User).findOneBy({ id: target.id }))!.lastName).toBe(before.lastName);
      expect((await adminMemberships(target.id))).toHaveLength(1);
      expect((await runtime.getRepository(RefreshToken).findOneBy({ id: tokenId }))!.revokedAt).toBeNull();
    } finally {
      await admin.query(`DROP TRIGGER reject_manual_audit ON ${schema}.audit_logs`);
      await admin.query(`DROP FUNCTION ${schema}.reject_manual_audit()`);
    }
    expect((await userService.updateUser(target.id, { platformRole: 'user' })).platformRole).toBe('user');
    expect((await adminMemberships(target.id))).toHaveLength(0);
    expect((await runtime.getRepository(User).findOneBy({ id: target.id }))!.authSessionVersion).toBe(Number(before.authSessionVersion || 0) + 1);
    expect((await runtime.getRepository(RefreshToken).findOneBy({ id: tokenId }))!.revokedAt).not.toBeNull();
  });

  it('verifies the actual password before recovery claims and stops recovery after manual demotion', async () => {
    const result = await userService.createUser({ email: 'real-recovery@example.test', platformRole: 'admin', createdByUserId: 'fixture-operator' });
    const recoveryApp = express(); recoveryApp.use(express.json()); recoveryApp.use(loginRoutes);
    recoveryApp.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.statusCode || 500).json({ error: error.message }));
    const login = (password: string) => request(recoveryApp).post('/api/auth/recovery/login').send({ email: result.user.email, password });
    expect((await login('incorrect-password')).status).toBe(401);
    expect(await runtime.getRepository(RefreshToken).countBy({ userId: result.user.id })).toBe(0);
    const success = await login(result.temporaryPassword);
    expect(success.status, JSON.stringify(success.body)).toBe(200);
    expect(await runtime.getRepository(RefreshToken).countBy({ userId: result.user.id })).toBe(1);
    await userService.updateUser(result.user.id, { platformRole: 'user' });
    const denied = await login(result.temporaryPassword);
    expect(denied.status, JSON.stringify(denied.body)).toBe(401);
    expect(denied.body.error).toBe('Invalid email or password');
    const sessions = await runtime.getRepository(RefreshToken).findBy({ userId: result.user.id });
    expect(sessions).toHaveLength(1); expect(sessions[0].revokedAt).not.toBeNull();
  });

  it.each(['updateUser', 'deactivateUser'] as const)('removes only the canonical inactive user baseline through %s', async method => {
    const target = await userService.createPendingUser({ email: `baseline-${method}@example.test`, createdByUserId: 'fixture-operator' });
    const baseline = () => runWithPlatformDatabaseCapability({ kind: 'authenticated-account', userId: target.id }, () =>
      runtime.getRepository(AuthzGroupMembership).findBy({ userId: target.id, groupId: 'system.group.authenticated_users' }));
    expect(await baseline()).toHaveLength(1);
    await expect(runtime.transaction(manager => authzGroupService.removeAuthenticatedUserMembershipWithManager(manager, target.id))).rejects.toThrow('persisted inactive user');
    await expect(runtime.transaction(manager => authzGroupService.removeAuthenticatedUserMembershipWithManager(manager, 'unknown-user'))).rejects.toThrow('persisted inactive user');
    if (method === 'updateUser') await userService.updateUser(target.id, { isActive: false });
    else await userService.deactivateUser(target.id);
    expect(await baseline()).toHaveLength(0);
    expect((await runtime.getRepository(User).findOneBy({ id: target.id }))!.isActive).toBe(false);
    await userService.updateUser(target.id, { isActive: true });
    expect(await baseline()).toHaveLength(1);
  });

  it('creates a tenant and its audited owner assignment from the platform context without leaking tenant scope', async () => {
    const target = await userService.createPendingUser({ email: 'tenant-creator@example.test', createdByUserId: 'fixture-operator' });
    vi.mocked(logger.error).mockClear();
    const created = await tenantService.create({ name: 'Created tenant', slug: ' Created-Tenant ', ownerUserId: target.id });
    expect(created.slug).toBe('created-tenant');
    expect(getTenantDatabaseContext()).toBeUndefined();
    const assignments = await runtime.getRepository(RbacRoleAssignment).findBy({ tenantId: created.id, principalId: target.id });
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ scopeType: 'tenant', scopeId: created.id });
    const audits = await runWithTenantDatabaseContext({ tenantId: created.id, tenantSlug: created.slug }, () =>
      runtime.getRepository(AuditLog).findBy({ tenantId: created.id, action: 'authz.role_assignment.create' }));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: target.id, resourceId: assignments[0].id });
    expect(await runtime.getRepository(AuditLog).findBy({ tenantId: created.id })).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('rolls back tenant creation and owner assignment together when the tenant audit fails', async () => {
    const target = await userService.createPendingUser({ email: 'tenant-rollback@example.test', createdByUserId: 'fixture-operator' });
    await admin.query(`CREATE FUNCTION ${schema}.reject_tenant_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='authz.role_assignment.create' THEN RAISE EXCEPTION 'fixture tenant audit failure'; END IF; RETURN NEW; END $$`);
    await admin.query(`CREATE TRIGGER reject_tenant_audit BEFORE INSERT ON ${schema}.audit_logs FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_tenant_audit()`);
    try {
      await expect(tenantService.create({ name: 'Rollback tenant', slug: 'rollback-tenant', ownerUserId: target.id })).rejects.toThrow('fixture tenant audit failure');
      expect(await runtime.getRepository(Tenant).countBy({ slug: 'rollback-tenant' })).toBe(0);
      expect(await runtime.getRepository(RbacRoleAssignment).countBy({ principalId: target.id, scopeType: 'tenant' })).toBe(0);
      expect(getTenantDatabaseContext()).toBeUndefined();
    } finally {
      await admin.query(`DROP TRIGGER reject_tenant_audit ON ${schema}.audit_logs`);
      await admin.query(`DROP FUNCTION ${schema}.reject_tenant_audit()`);
    }
  });

  it('resolves real pooled setup status with a fast caller witness and one delegated boolean query', async () => {
    const administrator = await userService.createPendingUser({ email: 'setup-admin@example.test', platformRole: 'admin', createdByUserId: 'fixture-operator' });
    const delegate = await userService.createPendingUser({ email: 'setup-delegate@example.test', createdByUserId: 'fixture-operator' });
    const membership = runtime.getRepository(AuthzGroupMembership);
    const find = vi.spyOn(membership, 'find');
    const createQueryBuilder = vi.spyOn(membership, 'createQueryBuilder');
    const userFind = vi.spyOn(runtime.getRepository(User), 'find');
    try {
      expect((await setupStatusService.getSetupStatus(administrator.id)).isConfigured).toBe(true);
      expect(find).toHaveBeenCalledTimes(1); expect(createQueryBuilder).not.toHaveBeenCalled();
      find.mockClear(); createQueryBuilder.mockClear();
      expect((await setupStatusService.getSetupStatus(delegate.id)).isConfigured).toBe(true);
      expect(find).toHaveBeenCalledTimes(1); expect(createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(userFind).not.toHaveBeenCalled();
    } finally { find.mockRestore(); createQueryBuilder.mockRestore(); userFind.mockRestore(); }
  });

  it('reports no administrator when only expired, inactive-user, or tenant-scoped lookalike grants remain', async () => {
    const lookalike = await userService.createPendingUser({ email: 'setup-lookalike@example.test', createdByUserId: 'fixture-operator' });
    const inactive = await userService.createPendingUser({ email: 'setup-inactive@example.test', createdByUserId: 'fixture-operator' });
    const before = await admin.query(`SELECT id, expires_at FROM ${schema}.authz_group_memberships WHERE tenant_id IS NULL AND group_id=$1`, [PLATFORM_ADMINISTRATORS_GROUP_ID]);
    const tenant = await tenantService.create({ name: 'Setup lookalike', slug: 'setup-lookalike' });
    const membershipId = randomUUID();
    const inactiveMembershipId = randomUUID();
    try {
      await admin.query(`UPDATE ${schema}.authz_group_memberships SET expires_at=1 WHERE tenant_id IS NULL AND group_id=$1`, [PLATFORM_ADMINISTRATORS_GROUP_ID]);
      await admin.query(`UPDATE ${schema}.users SET is_active=false WHERE id=$1`, [inactive.id]);
      await admin.query(`INSERT INTO ${schema}.authz_group_memberships (id,tenant_id,group_id,user_id,source,source_ref,expires_at,created_at,updated_at)
        VALUES ($1,NULL,$2,$3,'manual','fixture-inactive-administrator',NULL,1,1)`, [inactiveMembershipId, PLATFORM_ADMINISTRATORS_GROUP_ID, inactive.id]);
      expect((await setupStatusService.getSetupStatus(lookalike.id)).isConfigured).toBe(false);
      await runWithTenantDatabaseContext({ tenantId: tenant.id, tenantSlug: tenant.slug }, () => runtime.getRepository(AuthzGroupMembership).insert({
        id: membershipId, tenantId: tenant.id, groupId: PLATFORM_ADMINISTRATORS_GROUP_ID, userId: lookalike.id,
        source: 'manual', sourceRef: 'fixture-lookalike', expiresAt: null, createdById: null, createdAt: Date.now(), updatedAt: Date.now(),
      }));
      const result = await runWithTenantDatabaseContext({ tenantId: tenant.id, tenantSlug: tenant.slug }, () => setupStatusService.getSetupStatus(lookalike.id));
      expect(result).toMatchObject({ isConfigured: false, checks: { hasAdminUser: false }, requiredActions: ['Configure admin user'] });
      expect(getTenantDatabaseContext()).toBeUndefined();
    } finally {
      await admin.query(`DELETE FROM ${schema}.authz_group_memberships WHERE id IN ($1,$2)`, [membershipId, inactiveMembershipId]);
      for (const row of before) await admin.query(`UPDATE ${schema}.authz_group_memberships SET expires_at=$1 WHERE id=$2`, [row.expires_at, row.id]);
    }
  });

  it('derives a real tenant session from verified global identity and retains only its own global baseline on refresh', async()=>{
    const {browser,callback}=await signIn('verified-tenant','verified-tenant@example.test');
    expect(callback.status,JSON.stringify(callback.body)).toBe(302);
    const user=await runtime.getRepository(User).findOneByOrFail({email:'verified-tenant@example.test'});
    const target={id:'tenant-session-a',slug:'tenant-session-a',name:'Session tenant',status:'active' as const,
      placementKey:'fixture',placementEpoch:1,createdByUserId:null,createdAt:1,updatedAt:1};
    await runtime.getRepository(Tenant).insert(target);
    await runtime.getRepository(Tenant).insert({...target,id:'tenant-session-b',slug:'tenant-session-b'});
    await runWithTenantDatabaseContext({tenantId:target.id,tenantSlug:target.slug},()=>tenantService.addMember(target.id,user.id,'member','fixture-operator'));
    vi.mocked(logger.error).mockClear();vi.mocked(logger.warn).mockClear();
    const refused=await browser.post('/api/auth/switch-tenant').send({tenantSlug:'tenant-session-b'});
    expect(refused.status,JSON.stringify(refused.body)).toBe(403);
    const switched=await browser.post('/api/auth/switch-tenant').send({tenantSlug:target.slug});
    expect(switched.status,JSON.stringify(switched.body)).toBe(200);
    expect(switched.body).toEqual({tenantId:target.id,tenantSlug:target.slug});
    const probe=await browser.get('/tenant-permissions-probe');
    expect(probe.status,JSON.stringify(probe.body)).toBe(200);
    expect(probe.body.tenantId).toBe(target.id);expect(probe.body.platform.length).toBeGreaterThan(0);
    const refreshed=await browser.post('/api/auth/refresh').send({});
    expect(refreshed.status,JSON.stringify(refreshed.body)).toBe(200);
    expect((await browser.get('/tenant-permissions-probe')).status).toBe(200);
    const memberships=await runWithTenantDatabaseContext({tenantId:target.id,tenantSlug:target.slug},()=>
      runWithPlatformDatabaseCapability({kind:'authenticated-account',userId:user.id},()=>runtime.getRepository(AuthzGroupMembership).find()));
    expect(memberships).not.toHaveLength(0);
    expect(memberships.every(row=>row.userId===user.id)).toBe(true);
    const sessions=await runtime.getRepository(RefreshToken).findBy({userId:user.id,tenantId:target.id});
    expect(sessions).not.toHaveLength(0);expect(sessions.every(row=>row.identityProviderId===providerId)).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();expect(logger.warn).not.toHaveBeenCalled();
  });
});
