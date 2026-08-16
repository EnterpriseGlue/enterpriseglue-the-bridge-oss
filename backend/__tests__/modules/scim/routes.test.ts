import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { IdentityProvisioningCredential } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvisioningCredential.js';
import { IdentityProvisioningDiagnostic } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvisioningDiagnostic.js';
import { IdentityProvisioningDirectory } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvisioningDirectory.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { ScimGroupLink } from '@enterpriseglue/shared/infrastructure/persistence/entities/ScimGroupLink.js';
import { ScimGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/ScimGroupMembership.js';
import { ScimUserLink } from '@enterpriseglue/shared/infrastructure/persistence/entities/ScimUserLink.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { SCIM_GROUP_SCHEMA, SCIM_PATCH_OP_SCHEMA, SCIM_USER_SCHEMA } from '@enterpriseglue/shared/schemas/scim.js';
import { DEFAULT_PLATFORM_GROUP_IDS } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { identityProvisioningDirectoryService } from '@enterpriseglue/shared/services/platform-admin/IdentityProvisioningDirectoryService.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { createApp } from '@enterpriseglue/backend-host/app.js';
import scimRoute from '@enterpriseglue/backend-host/modules/scim/routes.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

const entities = [
  AuditLog, AuthzGroup, AuthzGroupMembership, IdentityProvisioningCredential,
  IdentityProvisioningDiagnostic, IdentityProvisioningDirectory, RefreshToken,
  ScimGroupLink, ScimGroupMembership, ScimUserLink, User,
];

describe('SCIM 2.0 routes', () => {
  let dataSource: DataSource;
  let token: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'sqljs', entities, synchronize: true, dropSchema: true });
    await dataSource.initialize();
    vi.mocked(getDataSource).mockResolvedValue(dataSource as any);
    const now = Date.now();
    await dataSource.getRepository(IdentityProvisioningDirectory).insert({
      id: 'directory-1', tenantId: null, key: 'workday', directoryKeyIdentity: 'directory-key',
      activeAuthoritativeIdentity: 'active-authority', displayName: 'Workday', description: null,
      type: 'scim_v2', identityProviderKey: null, authoritative: true, status: 'active', ownershipMode: 'manual',
      sourceRef: null, sourceHash: null, credentialSecretRef: null, lastAppliedAt: null, driftStatus: null, createdAt: now, updatedAt: now, archivedAt: null,
    });
    await dataSource.getRepository(AuthzGroup).insert({
      id: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS,
      tenantId: null, key: 'authenticated-users', groupKeyIdentity: 'platform:authenticated-users',
      name: 'Authenticated Users', description: 'Baseline', source: 'system', sourceRef: 'default-platform-groups',
      ownershipMode: 'manual', sourceHash: null, lastAppliedAt: null, driftStatus: null,
      isSystem: true, isArchived: false, createdById: null, createdAt: now, updatedAt: now,
    });
    token = (await identityProvisioningDirectoryService.issueCredential({
      directoryId: 'directory-1', name: 'Entra provisioning',
    })).token;
    app = createApp({ registerRoutes: false, includeRateLimiting: false, includeDocs: false, registerFinalMiddleware: false });
    app.use(scimRoute);
    app.use(errorHandler);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('requires a directory-bound bearer credential and never trusts a tenant header', async () => {
    const missing = await request(app).get('/scim/v2/workday/ServiceProviderConfig');
    expect(missing.status).toBe(401);
    expect(missing.type).toBe('application/scim+json');
    expect(missing.body).toMatchObject({ status: '401', schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'] });

    const malformed = await request(app)
      .get('/scim/v2/workday/ServiceProviderConfig')
      .set('Authorization', 'Bearer not a bearer token');
    expect(malformed.status).toBe(401);

    const oversized = await request(app)
      .get('/scim/v2/workday/ServiceProviderConfig')
      .set('Authorization', `Bearer ${'a'.repeat(8_200)}`);
    expect(oversized.status).toBe(401);

    const wrongDirectory = await request(app)
      .get('/scim/v2/other/ServiceProviderConfig')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Id', 'attacker-controlled');
    expect(wrongDirectory.status).toBe(401);

    const valid = await request(app)
      .get('/scim/v2/workday/ServiceProviderConfig')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Id', 'attacker-controlled');
    expect(valid.status).toBe(200);
    expect(valid.body).toMatchObject({
      patch: { supported: true }, bulk: { supported: true, maxOperations: 50 }, filter: { supported: true, maxResults: 200 },
      sort: { supported: true }, etag: { supported: true },
    });
    expect(valid.body.authenticationSchemes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'oauth2', primary: true }),
      expect.objectContaining({ type: 'oauthbearertoken', primary: false }),
    ]));
  });

  it('exchanges client credentials for a short-lived, revocation-aware SCIM access token', async () => {
    const clientId = /^egscim_([^.]+)\./.exec(token)![1];
    const oauth = await request(app)
      .post('/scim/v2/workday/oauth/token')
      .type('form')
      .set('Authorization', `Basic ${Buffer.from(`${clientId}:${token}`).toString('base64')}`)
      .send({ grant_type: 'client_credentials', scope: 'scim' });

    expect(oauth.status).toBe(200);
    expect(oauth.body).toMatchObject({ token_type: 'Bearer', expires_in: 300, scope: 'scim' });
    expect(oauth.body.access_token).not.toBe(token);

    const discovery = await request(app)
      .get('/scim/v2/workday/ServiceProviderConfig')
      .set('Authorization', `Bearer ${oauth.body.access_token}`);
    expect(discovery.status).toBe(200);

    await identityProvisioningDirectoryService.revokeCredential('directory-1', clientId);
    const revoked = await request(app)
      .get('/scim/v2/workday/ServiceProviderConfig')
      .set('Authorization', `Bearer ${oauth.body.access_token}`);
    expect(revoked.status).toBe(401);
  });

  it('serves discovery metadata and canonical User lifecycle responses as application/scim+json', async () => {
    for (const path of ['/Schemas', '/ResourceTypes', '/Schemas/urn%3Aietf%3Aparams%3Ascim%3Aschemas%3Acore%3A2.0%3AUser']) {
      const response = await request(app).get(`/scim/v2/workday${path}`).set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(200);
      expect(response.type).toBe('application/scim+json');
    }

    const created = await request(app)
      .post('/scim/v2/workday/Users')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/scim+json')
      .send({
        schemas: [SCIM_USER_SCHEMA], externalId: 'wd-100', userName: 'alice@example.test',
        name: { givenName: 'Alice', familyName: 'Ng' }, active: true,
      });
    expect(created.status).toBe(201);
    expect(created.headers.location).toContain(`/Users/${created.body.id}`);
    expect(created.headers.etag).toBe('W/"1"');
    expect(created.body).toMatchObject({ userName: 'alice@example.test', active: true, meta: { version: 'W/"1"' } });

    const filtered = await request(app)
      .get('/scim/v2/workday/Users')
      .query({ filter: 'userName eq "alice@example.test"', startIndex: 1, count: 50 })
      .set('Authorization', `Bearer ${token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body).toMatchObject({ totalResults: 1, startIndex: 1, itemsPerPage: 1 });

    const deleted = await request(app)
      .delete(`/scim/v2/workday/Users/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', created.headers.etag);
    expect(deleted.status).toBe(204);
    const stored = await dataSource.getRepository(ScimUserLink).findOneByOrFail({ id: created.body.id });
    expect(stored).toMatchObject({ active: false, status: 'inactive', version: 2 });
  });

  it('returns sanitized SCIM errors for stale versions, invalid patches, filters, and oversized requests', async () => {
    const created = await request(app)
      .post('/scim/v2/workday/Users')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/scim+json')
      .send({ schemas: [SCIM_USER_SCHEMA], externalId: 'wd-100', userName: 'alice@example.test', active: true });

    const stale = await request(app)
      .patch(`/scim/v2/workday/Users/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/scim+json')
      .set('If-Match', 'W/"99"')
      .send({ schemas: [SCIM_PATCH_OP_SCHEMA], Operations: [{ op: 'replace', path: 'active', value: false }] });
    expect(stale.status).toBe(412);
    expect(stale.body).toMatchObject({ status: '412', scimType: 'invalidVers' });

    const invalid = await request(app)
      .patch(`/scim/v2/workday/Users/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/scim+json')
      .send({ schemas: [SCIM_PATCH_OP_SCHEMA], Operations: [{ op: 'replace', path: 'passwordHash', value: 'secret-do-not-echo' }] });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ status: '400', scimType: 'invalidPath' });
    expect(JSON.stringify(invalid.body)).not.toContain('secret-do-not-echo');
    const failedDiagnostic = await dataSource.getRepository(IdentityProvisioningDiagnostic).findOne({
      where: { directoryId: 'directory-1', status: 'failed', code: 'invalidPath' },
      order: { occurredAt: 'DESC' },
    });
    expect(failedDiagnostic).toMatchObject({ resourceType: 'User', resourceId: created.body.id, message: expect.any(String) });
    expect(JSON.stringify(failedDiagnostic)).not.toContain('secret-do-not-echo');

    const invalidFilter = await request(app)
      .get('/scim/v2/workday/Users')
      .query({ filter: 'emails.value co "example"' })
      .set('Authorization', `Bearer ${token}`);
    expect(invalidFilter.status).toBe(400);
    expect(invalidFilter.body.scimType).toBe('invalidFilter');

    const oversized = await request(app)
      .post('/scim/v2/workday/Users')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/scim+json')
      .send({ schemas: [SCIM_USER_SCHEMA], userName: 'large@example.test', displayName: 'x'.repeat(300_000), active: true });
    expect(oversized.status).toBe(413);
    expect(oversized.body).toMatchObject({ status: '413', scimType: 'tooMany' });
  });

  it('supports bounded Bulk references, sorting, and write-only password interoperability', async () => {
    const bulk = await request(app)
      .post('/scim/v2/workday/Bulk')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/scim+json')
      .send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
        failOnErrors: 1,
        Operations: [
          { method: 'POST', bulkId: 'user-b', path: '/Users', data: { schemas: [SCIM_USER_SCHEMA], userName: 'bravo@example.test', password: 'never-store-me', active: true } },
          { method: 'POST', bulkId: 'user-a', path: '/Users', data: { schemas: [SCIM_USER_SCHEMA], userName: 'alpha@example.test', active: true } },
          { method: 'POST', bulkId: 'group-1', path: '/Groups', data: { schemas: [SCIM_GROUP_SCHEMA], displayName: 'Bulk group', members: [{ value: 'bulkId:user-a' }, { value: 'bulkId:user-b' }] } },
        ],
      });
    expect(bulk.status).toBe(200);
    expect(bulk.body.Operations).toHaveLength(3);
    expect(bulk.body.Operations.map((operation: any) => operation.status)).toEqual(['201', '201', '201']);
    expect(JSON.stringify(bulk.body)).not.toContain('never-store-me');

    const sorted = await request(app)
      .get('/scim/v2/workday/Users')
      .query({ sortBy: 'userName', sortOrder: 'descending' })
      .set('Authorization', `Bearer ${token}`);
    expect(sorted.status).toBe(200);
    expect(sorted.body.Resources.map((user: any) => user.userName)).toEqual(['bravo@example.test', 'alpha@example.test']);
    expect(JSON.stringify(sorted.body)).not.toContain('never-store-me');

    const storedProfiles = await dataSource.getRepository(ScimUserLink).find();
    expect(storedProfiles.every((link) => !link.profileJson.includes('never-store-me') && !link.profileJson.includes('password'))).toBe(true);
    const groupId = bulk.body.Operations[2].location.split('/').pop();
    const group = await request(app)
      .get(`/scim/v2/workday/Groups/${groupId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(group.body.members).toHaveLength(2);
  });

  it('supports bounded attributes and excludedAttributes projections for common enterprise IdPs', async () => {
    const createdUser = await request(app)
      .post('/scim/v2/workday/Users')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/scim+json')
      .send({
        schemas: [SCIM_USER_SCHEMA], externalId: 'wd-200', userName: 'projection@example.test',
        name: { givenName: 'Pro', familyName: 'Jection', formatted: 'Pro Jection' }, active: true,
      });

    const included = await request(app)
      .get(`/scim/v2/workday/Users/${createdUser.body.id}`)
      .query({ attributes: 'userName,name.givenName' })
      .set('Authorization', `Bearer ${token}`);
    expect(included.status).toBe(200);
    expect(included.body).toMatchObject({
      schemas: [SCIM_USER_SCHEMA], id: createdUser.body.id, userName: 'projection@example.test',
      name: { givenName: 'Pro' }, meta: expect.any(Object),
    });
    expect(included.body).not.toHaveProperty('active');
    expect(included.body).not.toHaveProperty('externalId');
    expect(included.body.name).not.toHaveProperty('familyName');

    const createdGroup = await request(app)
      .post('/scim/v2/workday/Groups')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/scim+json')
      .send({
        schemas: [SCIM_GROUP_SCHEMA], externalId: 'wd-group-200', displayName: 'Projection group',
        members: [{ value: createdUser.body.id }],
      });
    expect(createdGroup.status).toBe(201);

    const excluded = await request(app)
      .get('/scim/v2/workday/Groups')
      .query({ excludedAttributes: 'members' })
      .set('Authorization', `Bearer ${token}`);
    expect(excluded.status).toBe(200);
    expect(excluded.body.Resources[0]).toMatchObject({ id: createdGroup.body.id, displayName: 'Projection group' });
    expect(excluded.body.Resources[0]).not.toHaveProperty('members');

    const ambiguous = await request(app)
      .get('/scim/v2/workday/Users')
      .query({ attributes: 'userName', excludedAttributes: 'active' })
      .set('Authorization', `Bearer ${token}`);
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body).toMatchObject({ status: '400', scimType: 'invalidSyntax' });
  });
});
