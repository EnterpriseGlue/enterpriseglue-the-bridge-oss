import 'reflect-metadata';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';

const database = vi.hoisted(() => ({ current: null as DataSource | null }));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: async () => {
    if (!database.current) throw new Error('SCIM E2E database is not initialized');
    return database.current;
  },
}));

import scimRouter from '@enterpriseglue/backend-host/modules/scim/routes.js';
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

const entities = [
  AuditLog,
  AuthzGroup,
  AuthzGroupMembership,
  IdentityProvisioningCredential,
  IdentityProvisioningDiagnostic,
  IdentityProvisioningDirectory,
  RefreshToken,
  ScimGroupLink,
  ScimGroupMembership,
  ScimUserLink,
  User,
];

describe('SCIM HTTP-to-database protocol journey', () => {
  let dataSource: DataSource;
  let app: express.Express;
  let token: string;

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'sqljs', entities, synchronize: true, dropSchema: true });
    await dataSource.initialize();
    database.current = dataSource;
    const now = Date.now();
    await dataSource.getRepository(IdentityProvisioningDirectory).insert({
      id: 'directory-e2e', tenantId: null, key: 'entra-e2e', directoryKeyIdentity: 'directory-key-e2e',
      activeAuthoritativeIdentity: 'active-authority-e2e', displayName: 'Entra E2E', description: null,
      type: 'scim_v2', identityProviderKey: null, authoritative: true, status: 'active', ownershipMode: 'manual',
      sourceRef: null, sourceHash: null, credentialSecretRef: null, lastAppliedAt: null, driftStatus: null,
      createdAt: now, updatedAt: now, archivedAt: null,
    });
    await dataSource.getRepository(AuthzGroup).insert({
      id: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS, tenantId: null, key: 'authenticated-users',
      groupKeyIdentity: 'platform:authenticated-users', name: 'Authenticated Users', description: 'Baseline',
      source: 'system', sourceRef: 'default-platform-groups', ownershipMode: 'manual', sourceHash: null,
      lastAppliedAt: null, driftStatus: null, isSystem: true, isArchived: false, createdById: null,
      createdAt: now, updatedAt: now,
    });
    ({ token } = await identityProvisioningDirectoryService.issueCredential({
      directoryId: 'directory-e2e', name: 'HTTP E2E credential', actorUserId: 'admin-e2e',
    }));

    app = express();
    app.use(express.json({ type: ['application/json', 'application/scim+json'], limit: '256kb' }));
    app.use(express.urlencoded({ extended: false }));
    app.use(scimRouter);
  });

  afterEach(async () => {
    database.current = null;
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('uses OAuth, discovery, Bulk, sorting, write-only password, groups, and soft-deprovisioning over HTTP', async () => {
    const unauthenticated = await request(app).get('/scim/v2/entra-e2e/ServiceProviderConfig');
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers['content-type']).toMatch(/^application\/scim\+json/);
    expect(unauthenticated.body).not.toHaveProperty('directoryId');

    const discovery = await request(app)
      .get('/scim/v2/entra-e2e/ServiceProviderConfig')
      .set('Authorization', `Bearer ${token}`);
    expect(discovery.status).toBe(200);
    expect(discovery.body).toMatchObject({
      patch: { supported: true }, bulk: { supported: true, maxOperations: 50 }, sort: { supported: true }, etag: { supported: true },
    });

    const clientId = /^egscim_([^.]+)\./.exec(token)![1];
    const oauth = await request(app)
      .post('/scim/v2/entra-e2e/oauth/token')
      .type('form')
      .set('Authorization', `Basic ${Buffer.from(`${clientId}:${token}`).toString('base64')}`)
      .send({ grant_type: 'client_credentials', scope: 'scim' });
    expect(oauth.status).toBe(200);
    expect(oauth.body).toMatchObject({ token_type: 'Bearer', expires_in: 300, scope: 'scim' });
    const accessToken = oauth.body.access_token as string;

    // Microsoft Entra tests credentials by querying for a deliberately absent
    // matching value. A compatible endpoint must return 200 plus an empty
    // ListResponse, not 404.
    const connectionProbe = await request(app)
      .get('/scim/v2/entra-e2e/Users')
      .query({ filter: 'userName eq "00000000-0000-0000-0000-000000000000"' })
      .set('Authorization', `Bearer ${accessToken}`);
    expect(connectionProbe.status).toBe(200);
    expect(connectionProbe.body).toMatchObject({ totalResults: 0, itemsPerPage: 0, Resources: [] });

    const created = await request(app)
      .post('/scim/v2/entra-e2e/Users')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/scim+json')
      .send({
        schemas: [SCIM_USER_SCHEMA], externalId: 'entra-alice', userName: 'alice@example.test', password: 'discard-this-secret', active: true,
        name: { givenName: 'Alice', familyName: 'Example' },
        emails: [{ value: 'alice@example.test', primary: true }],
      });
    expect(created.status).toBe(201);
    expect(created.headers.etag).toBe('W/"1"');
    expect(created.headers.location).toMatch(/\/Users\//);
    expect(JSON.stringify(created.body)).not.toContain(token);
    expect(JSON.stringify(created.body)).not.toContain('discard-this-secret');

    const bulk = await request(app)
      .post('/scim/v2/entra-e2e/Bulk')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/scim+json')
      .send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
        Operations: [{ method: 'POST', bulkId: 'zulu', path: '/Users', data: {
          schemas: [SCIM_USER_SCHEMA], externalId: 'entra-zulu', userName: 'zulu@example.test', active: true,
        } }],
      });
    expect(bulk.status).toBe(200);
    expect(bulk.body.Operations).toEqual([expect.objectContaining({ bulkId: 'zulu', status: '201' })]);

    const sorted = await request(app)
      .get('/scim/v2/entra-e2e/Users')
      .query({ sortBy: 'userName', sortOrder: 'descending' })
      .set('Authorization', `Bearer ${accessToken}`);
    expect(sorted.status).toBe(200);
    expect(sorted.body.Resources.map((resource: { userName: string }) => resource.userName))
      .toEqual(['zulu@example.test', 'alice@example.test']);

    const filtered = await request(app)
      .get('/scim/v2/entra-e2e/Users')
      .query({ filter: 'externalId eq "entra-alice"', startIndex: 1, count: 10 })
      .set('Authorization', `Bearer ${accessToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body).toMatchObject({ totalResults: 1, itemsPerPage: 1 });

    const group = await request(app)
      .post('/scim/v2/entra-e2e/Groups')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/scim+json')
      .send({ schemas: [SCIM_GROUP_SCHEMA], externalId: 'entra-engineering', displayName: 'Engineering', members: [{ value: created.body.id }] });
    expect(group.status).toBe(201);
    expect(group.body.members).toEqual([expect.objectContaining({ value: created.body.id })]);

    const deactivated = await request(app)
      .patch(`/scim/v2/entra-e2e/Users/${created.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/scim+json')
      .set('If-Match', created.headers.etag)
      .send({ schemas: [SCIM_PATCH_OP_SCHEMA], Operations: [{ op: 'replace', path: 'active', value: false }] });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.active).toBe(false);
    expect(deactivated.headers.etag).toBe('W/"2"');

    const userLink = await dataSource.getRepository(ScimUserLink).findOneByOrFail({ id: created.body.id });
    expect(userLink.profileJson).not.toContain('password');
    expect(userLink.profileJson).not.toContain('discard-this-secret');
    expect(await dataSource.getRepository(User).findOneByOrFail({ id: userLink.userId })).toMatchObject({
      isActive: false, authSessionVersion: 1,
    });
    expect(await dataSource.getRepository(IdentityProvisioningDiagnostic).count()).toBeGreaterThanOrEqual(3);
    expect(await dataSource.getRepository(AuditLog).findOneBy({ action: 'identity.provisioning.user.deactivate' })).not.toBeNull();

    await identityProvisioningDirectoryService.revokeCredential('directory-e2e', clientId);
    const revoked = await request(app)
      .get('/scim/v2/entra-e2e/ServiceProviderConfig')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(revoked.status).toBe(401);
  });
});
