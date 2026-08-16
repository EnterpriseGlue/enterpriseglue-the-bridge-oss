import { In, IsNull, type DataSource, type EntityManager } from 'typeorm';
import { v5 as uuidv5 } from 'uuid';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityProvisioningDiagnostic } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvisioningDiagnostic.js';
import { IdentityProvisioningDirectory } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvisioningDirectory.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { ScimGroupLink } from '@enterpriseglue/shared/infrastructure/persistence/entities/ScimGroupLink.js';
import { ScimGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/ScimGroupMembership.js';
import { ScimUserLink } from '@enterpriseglue/shared/infrastructure/persistence/entities/ScimUserLink.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import {
  SCIM_GROUP_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_USER_SCHEMA,
  ScimEmailSchema,
  ScimGroupCreateSchema,
  ScimUserCreateSchema,
  type ScimGroupCreate,
  type ScimGroupResponse,
  type ScimPatchRequest,
  type ScimUserCreate,
  type ScimUserResponse,
} from '@enterpriseglue/shared/schemas/scim.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import {
  getActivePlatformAdministratorUserIds,
  PLATFORM_ADMINISTRATORS_GROUP_ID,
} from '@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';

type ScimType = 'invalidFilter' | 'tooMany' | 'uniqueness' | 'mutability' | 'invalidSyntax'
  | 'invalidPath' | 'noTarget' | 'invalidValue' | 'invalidVers' | 'sensitive';

export class ScimProtocolError extends Error {
  constructor(
    public readonly status: number,
    public readonly scimType: ScimType | undefined,
    detail: string,
  ) {
    super(detail);
    this.name = 'ScimProtocolError';
  }
}

export interface ScimRequestContext {
  directory: IdentityProvisioningDirectory;
  baseUrl: string;
  requestId: string;
}

export interface ScimListInput {
  filter?: string;
  startIndex: number;
  count: number;
  sortBy?: string;
  sortOrder?: 'ascending' | 'descending';
}

const SCIM_IDENTITY_NAMESPACE = uuidv5('https://enterpriseglue.com/namespaces/scim-identity-v1', uuidv5.URL);

function scopedIdentity(domain: string, ...values: string[]): string {
  // UUID v5 provides a stable, domain-separated identifier for non-secret SCIM data; credentials never enter this path.
  return uuidv5([domain, ...values].join('\u0000'), SCIM_IDENTITY_NAMESPACE);
}

export function scimUserNameIdentity(directoryId: string, userName: string): string {
  return scopedIdentity('scim-user-name-v1', directoryId, userName.trim().toLowerCase());
}

export function scimExternalIdIdentity(directoryId: string, resourceType: 'User' | 'Group', externalId: string): string {
  return scopedIdentity(`scim-${resourceType.toLowerCase()}-external-id-v1`, directoryId, externalId);
}

function idScopedExternalIdentity(directoryId: string, resourceType: 'User' | 'Group', id: string): string {
  return scopedIdentity(`scim-${resourceType.toLowerCase()}-no-external-id-v1`, directoryId, id);
}

function membershipIdentity(directoryId: string, groupLinkId: string, userLinkId: string): string {
  return scopedIdentity('scim-group-membership-v1', directoryId, groupLinkId, userLinkId);
}

function baseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function etag(version: number): string {
  return `W/"${version}"`;
}

function iso(value: number): string {
  return new Date(Number(value)).toISOString();
}

function parseProfile(link: ScimUserLink): ScimUserCreate {
  try {
    const parsed = ScimUserCreateSchema.parse(JSON.parse(link.profileJson));
    const { password: _password, ...safe } = parsed;
    return safe;
  } catch {
    throw new ScimProtocolError(500, undefined, 'The provisioned user profile could not be read');
  }
}

function selectEmail(input: ScimUserCreate): string {
  const primary = input.emails?.find((email) => email.primary) ?? input.emails?.[0];
  const candidate = (primary?.value ?? input.userName).trim().toLowerCase();
  if (!ScimEmailSchema.shape.value.safeParse(candidate).success) {
    throw new ScimProtocolError(400, 'invalidValue', 'A valid primary email address is required');
  }
  return candidate;
}

function withoutPassword(input: ScimUserCreate): ScimUserCreate {
  const { password: _password, ...safe } = input;
  return safe;
}

function compareScimValues(left: string | number | boolean | null | undefined, right: string | number | boolean | null | undefined): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  return String(left).localeCompare(String(right), 'en', { sensitivity: 'base', numeric: true });
}

function userResponse(link: ScimUserLink, context: ScimRequestContext): ScimUserResponse {
  const profile = parseProfile(link);
  return {
    ...profile,
    schemas: [SCIM_USER_SCHEMA],
    externalId: link.externalId ?? undefined,
    userName: link.userName,
    active: link.active,
    id: link.id,
    meta: {
      resourceType: 'User',
      created: iso(link.createdAt),
      lastModified: iso(link.updatedAt),
      location: `${baseUrl(context.baseUrl)}/Users/${encodeURIComponent(link.id)}`,
      version: etag(link.version),
    },
  };
}

function groupResponse(
  link: ScimGroupLink,
  members: ScimUserLink[],
  context: ScimRequestContext,
): ScimGroupResponse {
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    externalId: link.externalId ?? undefined,
    displayName: link.displayName,
    members: members.map((member) => ({
      value: member.id,
      display: member.userName,
      $ref: `${baseUrl(context.baseUrl)}/Users/${encodeURIComponent(member.id)}`,
      type: 'User' as const,
    })),
    id: link.id,
    meta: {
      resourceType: 'Group',
      created: iso(link.createdAt),
      lastModified: iso(link.updatedAt),
      location: `${baseUrl(context.baseUrl)}/Groups/${encodeURIComponent(link.id)}`,
      version: etag(link.version),
    },
  };
}

function assertIfMatch(ifMatch: string | undefined, version: number): void {
  if (!ifMatch || ifMatch === '*') return;
  if (ifMatch !== etag(version)) {
    throw new ScimProtocolError(412, 'invalidVers', 'The resource changed after it was read');
  }
}

function parseEqualityFilter(filter: string | undefined, allowed: string[]): { attribute: string; value: string } | null {
  if (!filter) return null;
  const match = /^([A-Za-z][A-Za-z0-9.]*)\s+eq\s+"((?:[^"\\]|\\.)*)"$/i.exec(filter.trim());
  if (!match || !allowed.map((value) => value.toLowerCase()).includes(match[1].toLowerCase())) {
    throw new ScimProtocolError(400, 'invalidFilter', `Supported filters are equality filters for ${allowed.join(', ')}`);
  }
  let value: string;
  try {
    value = JSON.parse(`"${match[2]}"`) as string;
  } catch {
    throw new ScimProtocolError(400, 'invalidFilter', 'The filter contains an invalid quoted value');
  }
  if (value.length > 512) throw new ScimProtocolError(400, 'tooMany', 'The filter value is too large');
  return { attribute: match[1].toLowerCase(), value };
}

function uniqueError(detail: string): ScimProtocolError {
  return new ScimProtocolError(409, 'uniqueness', detail);
}

function normalizePersistenceConflict(error: unknown, detail: string): never {
  if (error instanceof ScimProtocolError) throw error;
  if (error instanceof Error && /unique|duplicate|constraint/i.test(error.message)) throw uniqueError(detail);
  throw error;
}

async function recordDiagnostic(
  store: DataSource | EntityManager,
  context: ScimRequestContext,
  input: {
    eventType: string;
    resourceType: 'Directory' | 'User' | 'Group' | 'Credential' | 'Session' | null;
    resourceId?: string | null;
    userId?: string | null;
    status?: 'accepted' | 'success' | 'partial' | 'failed';
    code?: string | null;
    message?: string | null;
    details?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await store.getRepository(IdentityProvisioningDiagnostic).insert({
    id: generateId(),
    tenantId: context.directory.tenantId,
    directoryId: context.directory.id,
    requestId: context.requestId,
    eventType: input.eventType,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    userId: input.userId ?? null,
    status: input.status ?? 'success',
    code: input.code ?? null,
    message: input.message ?? null,
    detailsJson: JSON.stringify(input.details ?? {}),
    occurredAt: Date.now(),
  });
}

async function recordLifecycleAudit(
  store: DataSource | EntityManager,
  context: ScimRequestContext,
  action: string,
  resourceType: 'scim_user' | 'scim_group',
  resourceId: string,
  details: Record<string, string | number | boolean | null>,
): Promise<void> {
  await store.getRepository(AuditLog).insert({
    id: generateId(),
    tenantId: context.directory.tenantId,
    userId: null,
    action,
    resourceType,
    resourceId,
    ipAddress: null,
    userAgent: null,
    details: JSON.stringify({ directoryId: context.directory.id, requestId: context.requestId, ...details }),
    createdAt: Date.now(),
  });
}

export class ScimService {
  private readonly userCreateLocks = new Map<string, Promise<void>>();

  constructor(private readonly dataSourceProvider: () => Promise<DataSource> = getDataSource) {}

  private async withUserCreateLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.userCreateLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => gate);
    this.userCreateLocks.set(key, queued);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.userCreateLocks.get(key) === queued) this.userCreateLocks.delete(key);
    }
  }

  private async withUserCreateLocks<T>(keys: string[], work: () => Promise<T>, index = 0): Promise<T> {
    if (index >= keys.length) return work();
    return this.withUserCreateLock(keys[index], () => this.withUserCreateLocks(keys, work, index + 1));
  }

  async recordFailure(context: ScimRequestContext, input: {
    eventType: string;
    resourceType: 'Directory' | 'User' | 'Group' | null;
    resourceId?: string | null;
    statusCode: number;
    scimType?: string | null;
    message: string;
  }): Promise<void> {
    const dataSource = await this.dataSourceProvider();
    await recordDiagnostic(dataSource, context, {
      eventType: input.eventType,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      status: 'failed',
      code: input.scimType || `HTTP_${input.statusCode}`,
      message: input.message,
      details: { statusCode: input.statusCode },
    });
  }

  async listUsers(context: ScimRequestContext, input: ScimListInput) {
    const dataSource = await this.dataSourceProvider();
    const filter = parseEqualityFilter(input.filter, ['userName', 'externalId']);
    let links = await dataSource.getRepository(ScimUserLink).find({
      where: { directoryId: context.directory.id },
      order: { createdAt: 'ASC' },
    });
    if (filter?.attribute === 'username') {
      const identity = scimUserNameIdentity(context.directory.id, filter.value);
      links = links.filter((link) => link.directoryUsernameIdentity === identity);
    } else if (filter?.attribute === 'externalid') {
      const identity = scimExternalIdIdentity(context.directory.id, 'User', filter.value);
      links = links.filter((link) => link.externalIdIdentity === identity && link.externalId != null);
    }
    if (input.sortBy) {
      const sortKey = input.sortBy.toLowerCase();
      const allowed = new Set(['username', 'externalid', 'displayname', 'active', 'meta.created', 'meta.lastmodified']);
      if (!allowed.has(sortKey)) throw new ScimProtocolError(400, 'invalidPath', `Unsupported User sortBy '${input.sortBy}'`);
      const value = (link: ScimUserLink): string | number | boolean | null => {
        if (sortKey === 'username') return link.userName;
        if (sortKey === 'externalid') return link.externalId;
        if (sortKey === 'active') return link.active;
        if (sortKey === 'meta.created') return Number(link.createdAt);
        if (sortKey === 'meta.lastmodified') return Number(link.updatedAt);
        return parseProfile(link).displayName ?? null;
      };
      const direction = input.sortOrder === 'descending' ? -1 : 1;
      links.sort((left, right) => direction * (compareScimValues(value(left), value(right)) || left.id.localeCompare(right.id)));
    }
    const totalResults = links.length;
    const page = input.count === 0 ? [] : links.slice(input.startIndex - 1, input.startIndex - 1 + input.count);
    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA] as [typeof SCIM_LIST_RESPONSE_SCHEMA],
      totalResults,
      startIndex: input.startIndex,
      itemsPerPage: page.length,
      Resources: page.map((link) => userResponse(link, context)),
    };
  }

  async getUser(context: ScimRequestContext, id: string): Promise<ScimUserResponse> {
    const dataSource = await this.dataSourceProvider();
    const link = await dataSource.getRepository(ScimUserLink).findOneBy({ id, directoryId: context.directory.id });
    if (!link) throw new ScimProtocolError(404, undefined, 'User not found');
    return userResponse(link, context);
  }

  async createUser(context: ScimRequestContext, rawInput: ScimUserCreate): Promise<ScimUserResponse> {
    const input = withoutPassword(ScimUserCreateSchema.parse(rawInput));
    const dataSource = await this.dataSourceProvider();
    const createLocks = [...new Set([
      `email:${selectEmail(input).toLowerCase()}`,
      `username:${scimUserNameIdentity(context.directory.id, input.userName)}`,
      ...(input.externalId ? [`external:${scimExternalIdIdentity(context.directory.id, 'User', input.externalId)}`] : []),
    ])].sort();
    return this.withUserCreateLocks(createLocks, async () => {
      try {
        return await dataSource.transaction('SERIALIZABLE', async (manager) => {
        const linkRepo = manager.getRepository(ScimUserLink);
        const userRepo = manager.getRepository(User);
        const usernameIdentity = scimUserNameIdentity(context.directory.id, input.userName);
        if (await linkRepo.findOneBy({ directoryUsernameIdentity: usernameIdentity })) {
          throw uniqueError('A user with this userName already exists in the directory');
        }
        if (input.externalId && await linkRepo.findOneBy({
          externalIdIdentity: scimExternalIdIdentity(context.directory.id, 'User', input.externalId),
        })) {
          throw uniqueError('A user with this externalId already exists in the directory');
        }
        const email = selectEmail(input);
        const existingUser = await userRepo.findOneBy({ email });
        const linkedExisting = existingUser
          ? await this.isTrustedExistingAccountLink(manager, context, existingUser)
          : false;
        if (existingUser && !linkedExisting) {
          throw uniqueError('An EnterpriseGlue account already uses this email; associate the directory with its verified sign-in provider or resolve the identity conflict before provisioning');
        }

        const now = Date.now();
        const userId = existingUser?.id ?? generateId();
        const user = existingUser ?? userRepo.create({
          id: userId, email, authProvider: 'scim', passwordHash: null,
          firstName: input.name?.givenName ?? null, lastName: input.name?.familyName ?? null,
          platformRole: 'user', isActive: input.active, mustResetPassword: false,
          failedLoginAttempts: 0, lockedUntil: null, isEmailVerified: true,
          emailVerificationToken: null, emailVerificationTokenExpiry: null,
          createdAt: now, updatedAt: now, lastLoginAt: null,
          authSessionVersion: 0, createdByUserId: null,
        });
        if (existingUser) {
          const wasActive = existingUser.isActive;
          existingUser.firstName = input.name?.givenName ?? existingUser.firstName;
          existingUser.lastName = input.name?.familyName ?? existingUser.lastName;
          existingUser.isActive = input.active;
          existingUser.updatedAt = now;
          if (wasActive && !input.active) {
            existingUser.authSessionVersion = Number(existingUser.authSessionVersion || 0) + 1;
            await manager.getRepository(RefreshToken).update({ userId, revokedAt: IsNull() }, { revokedAt: now });
            await authzGroupService.removeAuthenticatedUserMembershipWithManager(manager, userId);
          }
          await userRepo.save(existingUser);
        } else {
          await userRepo.insert(user);
        }

        const id = generateId();
        const link = linkRepo.create({
          id,
          tenantId: context.directory.tenantId,
          directoryId: context.directory.id,
          userId,
          directoryUserIdentity: scopedIdentity('scim-directory-user-v1', context.directory.id, userId),
          directoryUsernameIdentity: usernameIdentity,
          externalId: input.externalId ?? null,
          externalIdIdentity: input.externalId
            ? scimExternalIdIdentity(context.directory.id, 'User', input.externalId)
            : idScopedExternalIdentity(context.directory.id, 'User', id),
          userName: input.userName,
          profileJson: JSON.stringify(input),
          active: input.active,
          status: input.active ? 'active' : 'inactive',
          version: 1,
          lastProvisionedAt: now,
          createdAt: now,
          updatedAt: now,
          deactivatedAt: input.active ? null : now,
        });
        await linkRepo.insert(link);
        if (input.active) await authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager, userId);
        await recordDiagnostic(manager, context, {
          eventType: linkedExisting ? 'scim.user.link' : 'scim.user.create', resourceType: 'User', resourceId: id, userId,
          details: { active: input.active, linkedExisting },
        });
        await recordLifecycleAudit(manager, context, linkedExisting ? 'identity.provisioning.user.link' : 'identity.provisioning.user.create', 'scim_user', id, {
          userId, active: input.active, linkedExisting,
        });
        return userResponse(link, context);
        });
      } catch (error) {
        return normalizePersistenceConflict(error, 'The user conflicts with an existing directory identity');
      }
    });
  }

  private async isTrustedExistingAccountLink(
    manager: EntityManager,
    context: ScimRequestContext,
    user: User,
  ): Promise<boolean> {
    const providerKey = context.directory.identityProviderKey?.trim();
    if (!providerKey) return false;
    const provider = await manager.getRepository(IdentityProvider).findOneBy(
      context.directory.tenantId
        ? { tenantId: context.directory.tenantId, key: providerKey }
        : { tenantId: IsNull(), key: providerKey },
    );
    if (!provider) return false;
    const externalIdentity = await manager.getRepository(ExternalIdentity).findOneBy(
      context.directory.tenantId
        ? { tenantId: context.directory.tenantId, providerId: provider.id, userId: user.id, status: 'active' }
        : { tenantId: IsNull(), providerId: provider.id, userId: user.id, status: 'active' },
    );
    if (!externalIdentity) return false;
    return !(await this.isRecoveryAdministrator(manager, user));
  }

  private async isRecoveryAdministrator(manager: EntityManager, user: User): Promise<boolean> {
    const administrators = await getActivePlatformAdministratorUserIds([user.id], manager);
    return (user.authProvider || 'local') === 'local'
      && Boolean(user.passwordHash)
      && administrators.has(user.id);
  }

  async replaceUser(
    context: ScimRequestContext,
    id: string,
    rawInput: ScimUserCreate,
    ifMatch?: string,
  ): Promise<ScimUserResponse> {
    const input = withoutPassword(ScimUserCreateSchema.parse(rawInput));
    const dataSource = await this.dataSourceProvider();
    try {
      return await dataSource.transaction('SERIALIZABLE', (manager) => (
        this.replaceUserWithManager(manager, context, id, input, ifMatch)
      ));
    } catch (error) {
      return normalizePersistenceConflict(error, 'The user conflicts with an existing directory identity');
    }
  }

  private async replaceUserWithManager(
    manager: EntityManager,
    context: ScimRequestContext,
    id: string,
    input: ScimUserCreate,
    ifMatch?: string,
  ): Promise<ScimUserResponse> {
    const linkRepo = manager.getRepository(ScimUserLink);
    const link = await linkRepo.findOneBy({ id, directoryId: context.directory.id });
    if (!link) throw new ScimProtocolError(404, undefined, 'User not found');
    assertIfMatch(ifMatch, link.version);

    const usernameIdentity = scimUserNameIdentity(context.directory.id, input.userName);
    const usernameOwner = await linkRepo.findOneBy({ directoryUsernameIdentity: usernameIdentity });
    if (usernameOwner && usernameOwner.id !== link.id) throw uniqueError('A user with this userName already exists');
    if (input.externalId) {
      const externalOwner = await linkRepo.findOneBy({
        externalIdIdentity: scimExternalIdIdentity(context.directory.id, 'User', input.externalId),
      });
      if (externalOwner && externalOwner.id !== link.id) throw uniqueError('A user with this externalId already exists');
    }

    const userRepo = manager.getRepository(User);
    const user = await userRepo.findOneBy({ id: link.userId });
    if (!user) throw new ScimProtocolError(500, undefined, 'The linked EnterpriseGlue user is unavailable');
    if (await this.isRecoveryAdministrator(manager, user)) {
      throw new ScimProtocolError(409, 'mutability', 'Recovery administrators cannot be modified or deactivated by SCIM');
    }
    // Authentication and provisioning are independent authorities. A user
    // created by SCIM may later authenticate through OIDC or SAML; the durable
    // directory link, not User.authProvider, owns synchronized fields.
    const email = selectEmail(input);
    const emailOwner = await userRepo.findOneBy({ email });
    if (emailOwner && emailOwner.id !== user.id) throw uniqueError('Another EnterpriseGlue account already uses this email');

    const now = Date.now();
    const wasActive = link.active;
    user.email = email;
    user.firstName = input.name?.givenName ?? null;
    user.lastName = input.name?.familyName ?? null;
    user.updatedAt = now;
    link.externalId = input.externalId ?? null;
    link.externalIdIdentity = input.externalId
      ? scimExternalIdIdentity(context.directory.id, 'User', input.externalId)
      : idScopedExternalIdentity(context.directory.id, 'User', link.id);
    link.userName = input.userName;
    link.directoryUsernameIdentity = usernameIdentity;
    link.profileJson = JSON.stringify(input);
    link.active = input.active;
    link.status = input.active ? 'active' : 'inactive';
    link.version += 1;
    link.lastProvisionedAt = now;
    link.updatedAt = now;
    link.deactivatedAt = input.active ? null : (link.deactivatedAt ?? now);

    if (wasActive !== input.active) {
      if (input.active) {
        user.isActive = true;
        await authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager, user.id);
        await this.restoreMappedGroupAccess(manager, context, link);
      } else {
        user.isActive = false;
        user.authSessionVersion = Number(user.authSessionVersion || 0) + 1;
        await manager.getRepository(RefreshToken).update({ userId: user.id, revokedAt: IsNull() }, { revokedAt: now });
        await authzGroupService.removeAuthenticatedUserMembershipWithManager(manager, user.id);
        await manager.getRepository(AuthzGroupMembership).delete({ userId: user.id, source: 'scim' });
      }
    }
    await userRepo.save(user);
    await linkRepo.save(link);
    await recordDiagnostic(manager, context, {
      eventType: wasActive !== input.active
        ? (input.active ? 'scim.user.reactivate' : 'scim.user.deactivate')
        : 'scim.user.replace',
      resourceType: 'User', resourceId: link.id, userId: user.id,
      details: { active: input.active, version: link.version },
    });
    await recordLifecycleAudit(manager, context,
      input.active ? 'identity.provisioning.user.update' : 'identity.provisioning.user.deactivate',
      'scim_user', link.id, { userId: user.id, active: input.active, version: link.version });
    return userResponse(link, context);
  }

  async patchUser(
    context: ScimRequestContext,
    id: string,
    patch: ScimPatchRequest,
    ifMatch?: string,
  ): Promise<ScimUserResponse> {
    const dataSource = await this.dataSourceProvider();
    return dataSource.transaction('SERIALIZABLE', async (manager) => {
      const link = await manager.getRepository(ScimUserLink).findOneBy({ id, directoryId: context.directory.id });
      if (!link) throw new ScimProtocolError(404, undefined, 'User not found');
      assertIfMatch(ifMatch, link.version);
      const draft = structuredClone(parseProfile(link)) as Record<string, any>;
      for (const operation of patch.Operations) this.applyUserPatch(draft, operation);
      let parsed: ScimUserCreate;
      try {
        parsed = withoutPassword(ScimUserCreateSchema.parse(draft));
      } catch {
        throw new ScimProtocolError(400, 'invalidValue', 'The patched user does not satisfy the SCIM User schema');
      }
      return this.replaceUserWithManager(manager, context, id, parsed, ifMatch);
    });
  }

  private applyUserPatch(draft: Record<string, any>, operation: ScimPatchRequest['Operations'][number]): void {
    if (!operation.path) {
      if (!operation.value || typeof operation.value !== 'object' || Array.isArray(operation.value)) {
        throw new ScimProtocolError(400, 'invalidValue', 'A pathless operation requires an object value');
      }
      if (operation.op === 'remove') throw new ScimProtocolError(400, 'invalidPath', 'Remove requires a user attribute path');
      Object.assign(draft, operation.value);
      return;
    }
    const key = operation.path.toLowerCase();
    const supported: Record<string, string> = {
      active: 'active', username: 'userName', externalid: 'externalId', displayname: 'displayName',
      name: 'name', emails: 'emails', title: 'title', locale: 'locale', timezone: 'timezone',
      preferredlanguage: 'preferredLanguage', nickname: 'nickName', profileurl: 'profileUrl', usertype: 'userType',
    };
    if (key === 'password') {
      delete draft.password;
      return;
    }
    const property = supported[key];
    if (!property) throw new ScimProtocolError(400, 'invalidPath', `Unsupported User PATCH path '${operation.path}'`);
    if (operation.op === 'remove') delete draft[property];
    else draft[property] = operation.value;
  }

  async deleteUser(context: ScimRequestContext, id: string, ifMatch?: string): Promise<void> {
    const existing = await this.getUser(context, id);
    const { id: _id, meta: _meta, ...writeFields } = existing;
    await this.replaceUser(context, id, { ...writeFields, schemas: [SCIM_USER_SCHEMA], active: false }, ifMatch);
  }

  async listGroups(context: ScimRequestContext, input: ScimListInput) {
    const dataSource = await this.dataSourceProvider();
    const filter = parseEqualityFilter(input.filter, ['displayName', 'externalId']);
    let links = await dataSource.getRepository(ScimGroupLink).find({
      where: { directoryId: context.directory.id, status: 'active' },
      order: { createdAt: 'ASC' },
    });
    if (filter?.attribute === 'displayname') {
      links = links.filter((link) => link.displayName.toLowerCase() === filter.value.toLowerCase());
    } else if (filter?.attribute === 'externalid') {
      const identity = scimExternalIdIdentity(context.directory.id, 'Group', filter.value);
      links = links.filter((link) => link.externalIdIdentity === identity && link.externalId != null);
    }
    if (input.sortBy) {
      const sortKey = input.sortBy.toLowerCase();
      const allowed = new Set(['displayname', 'externalid', 'meta.created', 'meta.lastmodified']);
      if (!allowed.has(sortKey)) throw new ScimProtocolError(400, 'invalidPath', `Unsupported Group sortBy '${input.sortBy}'`);
      const value = (link: ScimGroupLink): string | number | null => {
        if (sortKey === 'displayname') return link.displayName;
        if (sortKey === 'externalid') return link.externalId;
        if (sortKey === 'meta.created') return Number(link.createdAt);
        return Number(link.updatedAt);
      };
      const direction = input.sortOrder === 'descending' ? -1 : 1;
      links.sort((left, right) => direction * (compareScimValues(value(left), value(right)) || left.id.localeCompare(right.id)));
    }
    const totalResults = links.length;
    const page = input.count === 0 ? [] : links.slice(input.startIndex - 1, input.startIndex - 1 + input.count);
    const Resources = [];
    for (const link of page) Resources.push(await this.hydrateGroup(dataSource, context, link));
    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA] as [typeof SCIM_LIST_RESPONSE_SCHEMA],
      totalResults,
      startIndex: input.startIndex,
      itemsPerPage: Resources.length,
      Resources,
    };
  }

  async getGroup(context: ScimRequestContext, id: string): Promise<ScimGroupResponse> {
    const dataSource = await this.dataSourceProvider();
    const link = await dataSource.getRepository(ScimGroupLink).findOneBy({
      id, directoryId: context.directory.id, status: 'active',
    });
    if (!link) throw new ScimProtocolError(404, undefined, 'Group not found');
    return this.hydrateGroup(dataSource, context, link);
  }

  async createGroup(context: ScimRequestContext, rawInput: ScimGroupCreate): Promise<ScimGroupResponse> {
    const input = ScimGroupCreateSchema.parse(rawInput);
    const dataSource = await this.dataSourceProvider();
    try {
      return await dataSource.transaction('SERIALIZABLE', async (manager) => {
        const repo = manager.getRepository(ScimGroupLink);
        if (input.externalId && await repo.findOneBy({
          externalIdIdentity: scimExternalIdIdentity(context.directory.id, 'Group', input.externalId),
        })) throw uniqueError('A group with this externalId already exists');
        const now = Date.now();
        const id = generateId();
        const internalGroupId = await this.resolveMappedInternalGroupId(manager, context, input);
        const link = repo.create({
          id,
          tenantId: context.directory.tenantId,
          directoryId: context.directory.id,
          externalId: input.externalId ?? null,
          externalIdIdentity: input.externalId
            ? scimExternalIdIdentity(context.directory.id, 'Group', input.externalId)
            : idScopedExternalIdentity(context.directory.id, 'Group', id),
          displayName: input.displayName,
          internalGroupId,
          status: 'active',
          version: 1,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        });
        await repo.insert(link);
        const members = await this.replaceGroupMemberships(manager, context, link, input.members.map((member) => member.value));
        await recordDiagnostic(manager, context, {
          eventType: 'scim.group.create', resourceType: 'Group', resourceId: id,
          details: { memberCount: members.length },
        });
        await recordLifecycleAudit(manager, context, 'identity.provisioning.group.create', 'scim_group', id, {
          memberCount: members.length,
        });
        return groupResponse(link, members, context);
      });
    } catch (error) {
      return normalizePersistenceConflict(error, 'The group conflicts with an existing directory identity');
    }
  }

  async replaceGroup(
    context: ScimRequestContext,
    id: string,
    rawInput: ScimGroupCreate,
    ifMatch?: string,
  ): Promise<ScimGroupResponse> {
    const input = ScimGroupCreateSchema.parse(rawInput);
    const dataSource = await this.dataSourceProvider();
    try {
      return await dataSource.transaction('SERIALIZABLE', (manager) => (
        this.replaceGroupWithManager(manager, context, id, input, ifMatch)
      ));
    } catch (error) {
      return normalizePersistenceConflict(error, 'The group conflicts with an existing directory identity');
    }
  }

  private async replaceGroupWithManager(
    manager: EntityManager,
    context: ScimRequestContext,
    id: string,
    input: ScimGroupCreate,
    ifMatch?: string,
  ): Promise<ScimGroupResponse> {
    const repo = manager.getRepository(ScimGroupLink);
    const link = await repo.findOneBy({ id, directoryId: context.directory.id, status: 'active' });
    if (!link) throw new ScimProtocolError(404, undefined, 'Group not found');
    assertIfMatch(ifMatch, link.version);
    if (input.externalId) {
      const owner = await repo.findOneBy({
        externalIdIdentity: scimExternalIdIdentity(context.directory.id, 'Group', input.externalId),
      });
      if (owner && owner.id !== link.id) throw uniqueError('A group with this externalId already exists');
    }
    link.externalId = input.externalId ?? null;
    link.externalIdIdentity = input.externalId
      ? scimExternalIdIdentity(context.directory.id, 'Group', input.externalId)
      : idScopedExternalIdentity(context.directory.id, 'Group', link.id);
    link.displayName = input.displayName;
    link.internalGroupId = await this.resolveMappedInternalGroupId(manager, context, input);
    link.version += 1;
    link.updatedAt = Date.now();
    const members = await this.replaceGroupMemberships(manager, context, link, input.members.map((member) => member.value));
    await repo.save(link);
    await recordDiagnostic(manager, context, {
      eventType: 'scim.group.replace', resourceType: 'Group', resourceId: id,
      details: { memberCount: members.length, version: link.version },
    });
    await recordLifecycleAudit(manager, context, 'identity.provisioning.group.update', 'scim_group', id, {
      memberCount: members.length, version: link.version,
    });
    return groupResponse(link, members, context);
  }

  async patchGroup(
    context: ScimRequestContext,
    id: string,
    patch: ScimPatchRequest,
    ifMatch?: string,
  ): Promise<ScimGroupResponse> {
    const dataSource = await this.dataSourceProvider();
    return dataSource.transaction('SERIALIZABLE', async (manager) => {
      const link = await manager.getRepository(ScimGroupLink).findOneBy({ id, directoryId: context.directory.id, status: 'active' });
      if (!link) throw new ScimProtocolError(404, undefined, 'Group not found');
      assertIfMatch(ifMatch, link.version);
      const current = await this.hydrateGroup(manager, context, link);
      const draft: Record<string, any> = {
        schemas: [SCIM_GROUP_SCHEMA],
        externalId: current.externalId,
        displayName: current.displayName,
        members: current.members.map((member) => ({ value: member.value })),
      };
      for (const operation of patch.Operations) this.applyGroupPatch(draft, operation);
      let parsed: ScimGroupCreate;
      try {
        parsed = ScimGroupCreateSchema.parse(draft);
      } catch {
        throw new ScimProtocolError(400, 'invalidValue', 'The patched group does not satisfy the SCIM Group schema');
      }
      return this.replaceGroupWithManager(manager, context, id, parsed, ifMatch);
    });
  }

  private applyGroupPatch(draft: Record<string, any>, operation: ScimPatchRequest['Operations'][number]): void {
    if (!operation.path) {
      if (!operation.value || typeof operation.value !== 'object' || Array.isArray(operation.value)) {
        throw new ScimProtocolError(400, 'invalidValue', 'A pathless operation requires an object value');
      }
      if (operation.op === 'remove') throw new ScimProtocolError(400, 'invalidPath', 'Remove requires a group attribute path');
      Object.assign(draft, operation.value);
      return;
    }
    const key = operation.path.toLowerCase();
    const filteredMember = /^members\[value\s+eq\s+"([^"\\]+)"\]$/i.exec(operation.path);
    if (filteredMember) {
      if (operation.op !== 'remove') throw new ScimProtocolError(400, 'invalidPath', 'Filtered member paths support remove only');
      draft.members = (draft.members ?? []).filter((member: { value: string }) => member.value !== filteredMember[1]);
      return;
    }
    if (key === 'members') {
      if (operation.op === 'remove') draft.members = [];
      else if (operation.op === 'add') {
        const values = Array.isArray(operation.value) ? operation.value : [operation.value];
        const combined = [...(draft.members ?? []), ...values];
        draft.members = [...new Map(combined.map((member: any) => [member.value, member])).values()];
      } else draft.members = operation.value;
      return;
    }
    const property = key === 'displayname' ? 'displayName' : key === 'externalid' ? 'externalId' : null;
    if (!property) throw new ScimProtocolError(400, 'invalidPath', `Unsupported Group PATCH path '${operation.path}'`);
    if (operation.op === 'remove') delete draft[property];
    else draft[property] = operation.value;
  }

  async deleteGroup(context: ScimRequestContext, id: string, ifMatch?: string): Promise<void> {
    const dataSource = await this.dataSourceProvider();
    await dataSource.transaction('SERIALIZABLE', async (manager) => {
      const repo = manager.getRepository(ScimGroupLink);
      const link = await repo.findOneBy({ id, directoryId: context.directory.id, status: 'active' });
      if (!link) throw new ScimProtocolError(404, undefined, 'Group not found');
      assertIfMatch(ifMatch, link.version);
      await manager.getRepository(ScimGroupMembership).delete({ groupLinkId: link.id });
      await manager.getRepository(AuthzGroupMembership).delete({ source: 'scim', sourceRef: link.id });
      link.status = 'archived';
      link.version += 1;
      link.updatedAt = Date.now();
      link.archivedAt = link.updatedAt;
      await repo.save(link);
      await recordDiagnostic(manager, context, {
        eventType: 'scim.group.delete', resourceType: 'Group', resourceId: id,
        details: { version: link.version },
      });
      await recordLifecycleAudit(manager, context, 'identity.provisioning.group.archive', 'scim_group', id, {
        version: link.version,
      });
    });
  }

  private async replaceGroupMemberships(
    manager: EntityManager,
    context: ScimRequestContext,
    group: ScimGroupLink,
    memberIds: string[],
  ): Promise<ScimUserLink[]> {
    const uniqueIds = [...new Set(memberIds)];
    if (uniqueIds.length > 10_000) throw new ScimProtocolError(413, 'tooMany', 'A group may contain at most 10,000 members');
    const userRepo = manager.getRepository(ScimUserLink);
    const members = uniqueIds.length === 0 ? [] : await userRepo.find({
      where: { id: In(uniqueIds), directoryId: context.directory.id },
    });
    if (members.length !== uniqueIds.length) throw new ScimProtocolError(400, 'invalidValue', 'Every group member must reference a User in this directory');
    const byId = new Map(members.map((member) => [member.id, member]));
    const ordered = uniqueIds.map((id) => byId.get(id)!);

    const membershipRepo = manager.getRepository(ScimGroupMembership);
    await membershipRepo.delete({ groupLinkId: group.id });
    if (ordered.length > 0) {
      const now = Date.now();
      await membershipRepo.insert(ordered.map((member) => ({
        id: generateId(),
        tenantId: context.directory.tenantId,
        directoryId: context.directory.id,
        groupLinkId: group.id,
        userLinkId: member.id,
        membershipIdentity: membershipIdentity(context.directory.id, group.id, member.id),
        createdAt: now,
        updatedAt: now,
      })));
    }
    await manager.getRepository(AuthzGroupMembership).delete({ source: 'scim', sourceRef: group.id });
    if (group.internalGroupId) {
      const activeMembers = ordered.filter((member) => member.active);
      if (activeMembers.length > 0) {
        const now = Date.now();
        await manager.getRepository(AuthzGroupMembership).insert(activeMembers.map((member) => ({
          id: generateId(),
          tenantId: context.directory.tenantId,
          groupId: group.internalGroupId!,
          userId: member.userId,
          source: 'scim',
          sourceRef: group.id,
          expiresAt: null,
          createdById: null,
          createdAt: now,
          updatedAt: now,
        })));
      }
    }
    return ordered;
  }

  /**
   * Reuses the existing provider-neutral identity-mapping contract. A SCIM
   * group can project access only when the directory is associated with an
   * identity provider and exactly one active exact group mapping matches its
   * externalId or displayName. No implicit group-name-to-role grant exists.
   */
  private async resolveMappedInternalGroupId(
    manager: EntityManager,
    context: ScimRequestContext,
    group: Pick<ScimGroupCreate, 'externalId' | 'displayName'>,
  ): Promise<string | null> {
    const providerKey = context.directory.identityProviderKey?.trim();
    if (!providerKey) return null;
    const provider = await manager.getRepository(IdentityProvider).findOneBy(
      context.directory.tenantId
        ? { tenantId: context.directory.tenantId, key: providerKey }
        : { tenantId: IsNull(), key: providerKey },
    );
    if (!provider) return null;
    const mappings = await manager.getRepository(IdentityEntitlementMapping).find({
      where: {
        providerId: provider.id,
        entitlementType: 'group',
        matchOperator: 'exact',
        isActive: true,
        ...(context.directory.tenantId ? { tenantId: context.directory.tenantId } : { tenantId: IsNull() }),
      },
    });
    const directoryIdentifiers = new Set([group.externalId, group.displayName].filter((value): value is string => Boolean(value)));
    const targetGroupIds = [...new Set(mappings
      .filter((mapping) => mapping.externalId != null && directoryIdentifiers.has(mapping.externalId))
      .map((mapping) => mapping.targetGroupId))];
    if (targetGroupIds.length > 1) {
      throw new ScimProtocolError(409, 'uniqueness', 'The SCIM group matches multiple identity mappings; resolve the mapping conflict before provisioning');
    }
    if (targetGroupIds[0] === PLATFORM_ADMINISTRATORS_GROUP_ID) {
      throw new ScimProtocolError(409, 'mutability', 'SCIM groups cannot grant Platform Administrator access');
    }
    return targetGroupIds[0] ?? null;
  }

  private async restoreMappedGroupAccess(
    manager: EntityManager,
    context: ScimRequestContext,
    userLink: ScimUserLink,
  ): Promise<void> {
    const memberships = await manager.getRepository(ScimGroupMembership).find({
      where: { directoryId: context.directory.id, userLinkId: userLink.id },
    });
    if (memberships.length === 0) return;
    const groups = await manager.getRepository(ScimGroupLink).find({
      where: { id: In(memberships.map((membership) => membership.groupLinkId)), status: 'active' },
    });
    const mapped = groups.filter((group) => group.internalGroupId);
    if (mapped.length === 0) return;
    const now = Date.now();
    await manager.getRepository(AuthzGroupMembership).insert(mapped.map((group) => ({
      id: generateId(),
      tenantId: context.directory.tenantId,
      groupId: group.internalGroupId!,
      userId: userLink.userId,
      source: 'scim',
      sourceRef: group.id,
      expiresAt: null,
      createdById: null,
      createdAt: now,
      updatedAt: now,
    })));
  }

  private async hydrateGroup(
    store: DataSource | EntityManager,
    context: ScimRequestContext,
    link: ScimGroupLink,
  ): Promise<ScimGroupResponse> {
    const memberships = await store.getRepository(ScimGroupMembership).find({ where: { groupLinkId: link.id } });
    const members = memberships.length === 0 ? [] : await store.getRepository(ScimUserLink).find({
      where: { id: In(memberships.map((membership) => membership.userLinkId)), directoryId: context.directory.id },
    });
    const byId = new Map(members.map((member) => [member.id, member]));
    const ordered = memberships.map((membership) => byId.get(membership.userLinkId)).filter(Boolean) as ScimUserLink[];
    return groupResponse(link, ordered, context);
  }
}

export const scimService = new ScimService();
