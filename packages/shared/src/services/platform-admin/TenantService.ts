import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { In, IsNull, MoreThan, type EntityManager } from 'typeorm';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { OSS_DEFAULT_TENANT_ID, OSS_DEFAULT_TENANT_SLUG } from '@enterpriseglue/shared/authz/tenant-scope.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { TenantDiscoveryDomain } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantDiscoveryDomain.js';
import { TenantDomain } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantDomain.js';
import { TenantRoutingAlias } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantRoutingAlias.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { permissionService } from './permissions.js';
import { NATIVE_TENANT_ROLE_IDS } from '@enterpriseglue/shared/authz/native-tenant-roles.js';
import {
  tenantPlacementAssertionService,
  type TenantPlacementClaimV2,
  type TenantPlacementClaimV3,
} from './TenantPlacementAssertionService.js';

const TENANT_ROLE_IDS = [
  NATIVE_TENANT_ROLE_IDS.ADMIN,
  NATIVE_TENANT_ROLE_IDS.ENGINE_OPERATOR,
  NATIVE_TENANT_ROLE_IDS.VIEWER,
] as const;

const BLOCKED_TENANT_DISCOVERY_DOMAINS = new Set([
  'aol.com', 'gmail.com', 'googlemail.com', 'gmx.com', 'hotmail.com', 'icloud.com',
  'live.com', 'mac.com', 'mail.com', 'me.com', 'msn.com', 'outlook.com',
  'proton.me', 'protonmail.com', 'yahoo.com', 'ymail.com',
]);

export interface TenantPlacementClaim {
  tenantId: string;
  tenantSlug: string;
  placementKey: string;
  epoch: number;
  expiresAt: number;
}

export interface TenantMembershipView {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantStatus: Tenant['status'];
  role: 'admin' | 'member';
}

function normalizeSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
    throw Errors.validation('Tenant slug must be 1-63 lowercase letters, numbers, or hyphens');
  }
  return slug;
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

function normalizeDiscoveryDomain(value: string): string {
  const domain = normalizeHostname(value);
  if (!/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw Errors.validation('A valid work-email DNS domain is required');
  }
  if (BLOCKED_TENANT_DISCOVERY_DOMAINS.has(domain)) {
    throw Errors.validation('Public consumer-email domains cannot be used for organization discovery');
  }
  return domain;
}

function assignmentRole(roleId: string): 'admin' | 'member' {
  return roleId === NATIVE_TENANT_ROLE_IDS.ADMIN ? 'admin' : 'member';
}

export class TenantService {
  constructor(private readonly resolveTxtRecords: typeof resolveTxt = resolveTxt) {}

  async ensureDefaultTenant(): Promise<Tenant> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(Tenant);
    const existing = await repo.findOneBy({ id: OSS_DEFAULT_TENANT_ID });
    if (existing) return existing;
    const now = Date.now();
    await repo.insert({
      id: OSS_DEFAULT_TENANT_ID,
      name: 'Default',
      slug: OSS_DEFAULT_TENANT_SLUG,
      status: 'active',
      placementKey: 'local',
      placementEpoch: 1,
      createdByUserId: null,
      createdAt: now,
      updatedAt: now,
    });
    return repo.findOneByOrFail({ id: OSS_DEFAULT_TENANT_ID });
  }

  async getById(id: string): Promise<Tenant | null> {
    return (await getDataSource()).getRepository(Tenant).findOneBy({ id });
  }

  async getBySlug(slugValue: string): Promise<Tenant | null> {
    const slug = normalizeSlug(slugValue);
    if (config.tenancyMode !== 'pooled') {
      if (slug !== OSS_DEFAULT_TENANT_SLUG) return null;
      return this.ensureDefaultTenant();
    }
    return (await getDataSource()).getRepository(Tenant).findOneBy({ slug });
  }

  async getByHostname(hostValue: string): Promise<Tenant | null> {
    const hostname = normalizeHostname(hostValue);
    if (!hostname) return null;
    if (config.tenantBaseDomain && hostname.endsWith(`.${config.tenantBaseDomain}`)) {
      const slug = hostname.slice(0, -(config.tenantBaseDomain.length + 1));
      if (slug && !slug.includes('.')) return this.getBySlug(slug);
    }
    const dataSource = await getDataSource();
    const domain = await dataSource.getRepository(TenantDomain).findOneBy({ hostname, status: 'verified' });
    if (domain) return dataSource.getRepository(Tenant).findOneBy({ id: domain.tenantId });
    const alias = await dataSource.getRepository(TenantRoutingAlias).findOneBy({ hostname, status: 'active' });
    return alias ? dataSource.getRepository(Tenant).findOneBy({ id: alias.tenantId }) : null;
  }

  async list(): Promise<Tenant[]> {
    return (await getDataSource()).getRepository(Tenant).find({ order: { name: 'ASC', id: 'ASC' } });
  }

  async create(input: {
    name: string;
    slug: string;
    ownerUserId?: string | null;
    placementKey?: string | null;
  }, entityManager?: EntityManager): Promise<Tenant> {
    if (config.tenancyMode !== 'pooled') {
      throw Errors.conflict('Single-tenant mode permits only the default tenant');
    }
    const name = input.name.trim();
    if (!name) throw Errors.validation('Tenant name is required');
    const slug = normalizeSlug(input.slug);
    const dataSource = await getDataSource();
    const store = entityManager || dataSource.manager;
    const ownerUserId = input.ownerUserId || null;
    if (ownerUserId) {
      const owner = await store.getRepository(User).findOneBy({ id: ownerUserId, isActive: true });
      if (!owner) throw Errors.notFound('Tenant owner account');
    }
    const tenantId = generateId();
    const now = Date.now();
    try {
      const createWithManager = async (manager: EntityManager) => {
        await manager.getRepository(Tenant).insert({
          id: tenantId,
          name,
          slug,
          status: 'active',
          placementKey: input.placementKey?.trim() || 'local',
          placementEpoch: 1,
          createdByUserId: ownerUserId,
          createdAt: now,
          updatedAt: now,
        });
        if (ownerUserId) {
          await permissionService.assignRole({
            tenantId,
            principalType: 'user',
            principalId: ownerUserId,
            roleId: NATIVE_TENANT_ROLE_IDS.ADMIN,
            scopeType: 'tenant',
            scopeId: tenantId,
            source: 'manual',
            sourceRef: null,
            createdById: ownerUserId,
          }, manager);
        }
      };
      if (entityManager) await createWithManager(entityManager);
      else await dataSource.transaction(createWithManager);
    } catch (error) {
      if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
        throw Errors.conflict('Tenant slug already exists');
      }
      throw error;
    }
    return store.getRepository(Tenant).findOneByOrFail({ id: tenantId });
  }

  async update(tenantId: string, input: {
    name?: string;
    status?: Tenant['status'];
    placementKey?: string;
    expectedPlacementEpoch?: number;
  }, entityManager?: EntityManager): Promise<Tenant> {
    const repo = entityManager
      ? entityManager.getRepository(Tenant)
      : (await getDataSource()).getRepository(Tenant);
    const tenant = await repo.findOneBy({ id: tenantId });
    if (!tenant) throw Errors.notFound('Tenant');
    if (tenant.id === OSS_DEFAULT_TENANT_ID && input.status && input.status !== 'active') {
      throw Errors.conflict('The default tenant cannot be suspended or deleted');
    }
    if (input.expectedPlacementEpoch !== undefined && Number(tenant.placementEpoch) !== input.expectedPlacementEpoch) {
      throw Errors.conflict('Tenant placement changed; reload before retrying');
    }
    const placementChanged = (input.placementKey !== undefined && input.placementKey.trim() !== tenant.placementKey)
      || (input.status !== undefined && input.status !== tenant.status);
    const update = await repo.update(
      input.expectedPlacementEpoch !== undefined
        ? { id: tenantId, placementEpoch: input.expectedPlacementEpoch }
        : { id: tenantId },
      {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.placementKey !== undefined ? { placementKey: input.placementKey.trim() } : {}),
      ...(placementChanged ? { placementEpoch: Number(tenant.placementEpoch) + 1 } : {}),
      updatedAt: Date.now(),
      },
    );
    if (input.expectedPlacementEpoch !== undefined && update.affected !== 1) {
      throw Errors.conflict('Tenant placement changed; reload before retrying');
    }
    return repo.findOneByOrFail({ id: tenantId });
  }

  async reconcileRoutingAliases(
    tenantId: string,
    aliases: string[],
    expectedPlacementEpoch: number,
    entityManager?: EntityManager,
  ): Promise<{ tenant: Tenant; aliases: TenantRoutingAlias[] }> {
    if (config.tenancyMode !== 'pooled') throw Errors.conflict('Tenant routing aliases require pooled mode');
    const normalizedAliases = Array.from(new Set(aliases.map((alias) => normalizeHostname(alias)))).sort();
    if (normalizedAliases.length > 100) throw Errors.validation('At most 100 tenant routing aliases are allowed');
    for (const alias of normalizedAliases) {
      if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(alias)) {
        throw Errors.validation('Every tenant routing alias must be a valid fully-qualified domain name');
      }
    }

    const dataSource = await getDataSource();
    const reconcileWithManager = async (manager: EntityManager) => {
      const tenantRepo = manager.getRepository(Tenant);
      const aliasRepo = manager.getRepository(TenantRoutingAlias);
      const domainRepo = manager.getRepository(TenantDomain);
      const tenant = await tenantRepo.findOneBy({ id: tenantId });
      if (!tenant) throw Errors.notFound('Tenant');
      if (Number(tenant.placementEpoch) !== expectedPlacementEpoch) {
        throw Errors.conflict('Tenant placement changed; reload before retrying');
      }

      const existing = await aliasRepo.find({ where: { tenantId } });
      if (normalizedAliases.length) {
        const [foreignAliases, foreignDomains] = await Promise.all([
          aliasRepo.find({ where: { hostname: In(normalizedAliases) } }),
          domainRepo.find({ where: { hostname: In(normalizedAliases) } }),
        ]);
        if (foreignAliases.some((row) => row.tenantId !== tenantId)
          || foreignDomains.some((row) => row.tenantId !== tenantId)) {
          throw Errors.conflict('A tenant routing alias is already assigned to another tenant');
        }
      }

      const desired = new Set(normalizedAliases);
      const now = Date.now();
      const currentActive = new Set(existing.filter((row) => row.status === 'active').map((row) => row.hostname));
      const changed = currentActive.size !== desired.size || Array.from(desired).some((hostname) => !currentActive.has(hostname));

      for (const row of existing) {
        const status = desired.has(row.hostname) ? 'active' : 'disabled';
        if (row.status !== status) await aliasRepo.update({ id: row.id, tenantId }, { status, updatedAt: now });
      }
      const existingByHostname = new Map(existing.map((row) => [row.hostname, row]));
      for (const hostname of normalizedAliases) {
        if (existingByHostname.has(hostname)) continue;
        await aliasRepo.insert({
          id: generateId(), tenantId, hostname, status: 'active', source: 'cloud_workload', createdAt: now, updatedAt: now,
        });
      }

      if (changed) {
        const update = await tenantRepo.update(
          { id: tenantId, placementEpoch: expectedPlacementEpoch },
          { placementEpoch: expectedPlacementEpoch + 1, updatedAt: now },
        );
        if (update.affected !== 1) throw Errors.conflict('Tenant placement changed; reload before retrying');
      }
      return {
        tenant: await tenantRepo.findOneByOrFail({ id: tenantId }),
        aliases: await aliasRepo.find({ where: { tenantId, status: 'active' }, order: { hostname: 'ASC' } }),
      };
    };
    return entityManager ? reconcileWithManager(entityManager) : dataSource.transaction(reconcileWithManager);
  }

  async listForUser(userId: string): Promise<TenantMembershipView[]> {
    const dataSource = await getDataSource();
    const assignments = await dataSource.getRepository(RbacRoleAssignment).find({
      where: [
        {
          principalType: 'user',
          principalId: userId,
          roleId: In([...TENANT_ROLE_IDS]),
          scopeType: 'tenant',
          expiresAt: IsNull(),
        },
        {
          principalType: 'user',
          principalId: userId,
          roleId: In([...TENANT_ROLE_IDS]),
          scopeType: 'tenant',
          expiresAt: MoreThan(Date.now()),
        },
      ],
    });
    const tenantIds = Array.from(new Set(assignments.map((row) => row.tenantId || row.scopeId).filter(Boolean))) as string[];
    if (tenantIds.length === 0) {
      if (config.tenancyMode !== 'pooled') {
        const tenant = await this.ensureDefaultTenant();
        return [{ tenantId: tenant.id, tenantSlug: tenant.slug, tenantName: tenant.name, tenantStatus: tenant.status, role: 'admin' }];
      }
      return [];
    }
    const tenants = await dataSource.getRepository(Tenant).findBy({ id: In(tenantIds) });
    const roleByTenant = new Map<string, 'admin' | 'member'>();
    for (const assignment of assignments) {
      const id = assignment.tenantId || assignment.scopeId;
      if (!id) continue;
      const role = assignmentRole(assignment.roleId);
      if (role === 'admin' || !roleByTenant.has(id)) roleByTenant.set(id, role);
    }
    return tenants
      .map((tenant) => ({
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        tenantStatus: tenant.status,
        role: roleByTenant.get(tenant.id) || 'member',
      }))
      .sort((left, right) => left.tenantName.localeCompare(right.tenantName));
  }

  async hasMembership(userId: string, tenantId: string): Promise<boolean> {
    if (config.tenancyMode !== 'pooled' && tenantId === OSS_DEFAULT_TENANT_ID) return true;
    return (await this.listForUser(userId)).some((membership) => membership.tenantId === tenantId && membership.tenantStatus === 'active');
  }

  async listMembers(tenantId: string): Promise<Array<{ userId: string; email: string; role: 'admin' | 'member' }>> {
    const dataSource = await getDataSource();
    const assignments = await dataSource.getRepository(RbacRoleAssignment).find({
      where: { tenantId, principalType: 'user', scopeType: 'tenant', scopeId: tenantId, roleId: In([...TENANT_ROLE_IDS]) },
    });
    const userIds = Array.from(new Set(assignments.map((row) => row.principalId)));
    const users = userIds.length ? await dataSource.getRepository(User).findBy({ id: In(userIds) }) : [];
    const emailById = new Map(users.map((user) => [user.id, user.email]));
    const roleByUser = new Map<string, 'admin' | 'member'>();
    for (const assignment of assignments) {
      const role = assignmentRole(assignment.roleId);
      if (role === 'admin' || !roleByUser.has(assignment.principalId)) roleByUser.set(assignment.principalId, role);
    }
    return Array.from(roleByUser, ([userId, role]) => ({ userId, role, email: emailById.get(userId) || userId }))
      .sort((left, right) => left.email.localeCompare(right.email));
  }

  async addMember(tenantId: string, userId: string, role: 'admin' | 'member', actorId: string): Promise<void> {
    const tenant = await this.getById(tenantId);
    if (!tenant || tenant.status !== 'active') throw Errors.notFound('Tenant');
    const dataSource = await getDataSource();
    const user = await dataSource.getRepository(User).findOneBy({ id: userId, isActive: true });
    if (!user) throw Errors.notFound('Tenant member account');
    const existingManualAssignments = await dataSource.getRepository(RbacRoleAssignment).find({
      where: {
        tenantId,
        principalType: 'user',
        principalId: userId,
        scopeType: 'tenant',
        scopeId: tenantId,
        roleId: In([...TENANT_ROLE_IDS]),
        source: 'manual',
      },
    });
    const targetRoleId = role === 'admin' ? NATIVE_TENANT_ROLE_IDS.ADMIN : NATIVE_TENANT_ROLE_IDS.VIEWER;
    if (role === 'member' && existingManualAssignments.some((assignment) => assignment.roleId === NATIVE_TENANT_ROLE_IDS.ADMIN)) {
      const administratorCount = await dataSource.getRepository(RbacRoleAssignment).count({
        where: [
          { tenantId, principalType: 'user', scopeType: 'tenant', scopeId: tenantId, roleId: NATIVE_TENANT_ROLE_IDS.ADMIN, expiresAt: IsNull() },
          { tenantId, principalType: 'user', scopeType: 'tenant', scopeId: tenantId, roleId: NATIVE_TENANT_ROLE_IDS.ADMIN, expiresAt: MoreThan(Date.now()) },
        ],
      });
      if (administratorCount <= 1) throw Errors.conflict('A tenant must retain at least one administrator');
    }
    await permissionService.assignRole({
      tenantId,
      principalType: 'user',
      principalId: userId,
      roleId: targetRoleId,
      scopeType: 'tenant',
      scopeId: tenantId,
      source: 'manual',
      sourceRef: null,
      createdById: actorId,
    });
    for (const assignment of existingManualAssignments) {
      if (assignment.roleId !== targetRoleId) {
        await permissionService.removeRoleAssignment(assignment.id, actorId);
      }
    }
  }

  async ensureSsoMember(tenantId: string, userId: string, providerId: string): Promise<void> {
    const tenant = await this.getById(tenantId);
    if (!tenant || tenant.status !== 'active') throw Errors.notFound('Tenant');
    // Pooled sessions require an explicit native tenant membership. Single
    // mode already treats the default tenant as the compatibility boundary;
    // assigning tenant.viewer there would silently broaden an existing SSO
    // user's fine-grained project and engine grants to the whole tenant.
    if (config.tenancyMode !== 'pooled') return;
    await permissionService.assignRole({
      tenantId,
      principalType: 'user',
      principalId: userId,
      roleId: NATIVE_TENANT_ROLE_IDS.VIEWER,
      scopeType: 'tenant',
      scopeId: tenantId,
      source: 'sso',
      sourceRef: providerId,
      createdById: userId,
    });
  }

  async listDomains(tenantId: string): Promise<TenantDomain[]> {
    return (await getDataSource()).getRepository(TenantDomain).find({ where: { tenantId }, order: { hostname: 'ASC' } });
  }

  async createDomain(tenantId: string, hostnameValue: string): Promise<{ domain: TenantDomain; verificationToken: string }> {
    if (config.tenancyMode !== 'pooled') throw Errors.conflict('Custom tenant domains require pooled mode');
    const hostname = normalizeHostname(hostnameValue);
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) {
      throw Errors.validation('A valid fully-qualified domain name is required');
    }
    if (config.tenantBaseDomain && (hostname === config.tenantBaseDomain || hostname.endsWith(`.${config.tenantBaseDomain}`))) {
      throw Errors.conflict('Managed base-domain hostnames are assigned by tenant slug');
    }
    const verificationToken = randomBytes(32).toString('base64url');
    const verificationTokenHash = createHash('sha256').update(verificationToken).digest('hex');
    const repo = (await getDataSource()).getRepository(TenantDomain);
    const now = Date.now();
    const existing = await repo.findOneBy({ hostname });
    if (existing && existing.tenantId !== tenantId) throw Errors.conflict('Domain is already assigned to another tenant');
    const id = existing?.id || generateId();
    await repo.upsert({
      id, tenantId, hostname, status: 'pending', verificationTokenHash,
      verifiedAt: null, createdAt: existing?.createdAt || now, updatedAt: now,
    }, { conflictPaths: ['hostname'] });
    return { domain: await repo.findOneByOrFail({ id }), verificationToken };
  }

  async verifyDomain(tenantId: string, domainId: string, verificationToken: string): Promise<TenantDomain> {
    const repo = (await getDataSource()).getRepository(TenantDomain);
    const domain = await repo.findOneBy({ id: domainId, tenantId });
    if (!domain || domain.status === 'disabled') throw Errors.notFound('Tenant domain');
    const actualHash = createHash('sha256').update(verificationToken).digest('hex');
    if (!domain.verificationTokenHash || actualHash.length !== domain.verificationTokenHash.length
      || !timingSafeEqual(Buffer.from(actualHash), Buffer.from(domain.verificationTokenHash))) {
      throw Errors.unauthorized('Invalid domain verification token');
    }
    let records: string[][];
    try { records = await resolveTxt(`_enterpriseglue.${domain.hostname}`); }
    catch { throw Errors.conflict('Domain verification TXT record was not found'); }
    if (!records.map((parts) => parts.join('')).includes(`enterpriseglue-verification=${verificationToken}`)) {
      throw Errors.conflict('Domain verification TXT record does not match');
    }
    await repo.update({ id: domain.id, tenantId }, {
      status: 'verified', verifiedAt: Date.now(), verificationTokenHash: null, updatedAt: Date.now(),
    });
    return repo.findOneByOrFail({ id: domain.id });
  }

  async listDiscoveryDomains(tenantId: string): Promise<TenantDiscoveryDomain[]> {
    return (await getDataSource()).getRepository(TenantDiscoveryDomain).find({
      where: { tenantId },
      order: { domain: 'ASC' },
    });
  }

  async createDiscoveryDomain(tenantId: string, domainValue: string): Promise<{
    domain: TenantDiscoveryDomain;
    verificationToken: string;
  }> {
    if (config.tenancyMode !== 'pooled') throw Errors.conflict('Organization discovery domains require pooled mode');
    const tenant = await this.getById(tenantId);
    if (!tenant || tenant.status !== 'active') throw Errors.notFound('Tenant');
    const domain = normalizeDiscoveryDomain(domainValue);
    const verificationToken = randomBytes(32).toString('base64url');
    const verificationTokenHash = createHash('sha256').update(verificationToken).digest('hex');
    const repo = (await getDataSource()).getRepository(TenantDiscoveryDomain);
    const now = Date.now();
    const existing = await repo.findOneBy({ tenantId, domain });
    const id = existing?.id || generateId();
    await repo.upsert({
      id,
      tenantId,
      domain,
      status: 'pending',
      verificationTokenHash,
      verifiedAt: null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }, { conflictPaths: ['tenantId', 'domain'] });
    return { domain: await repo.findOneByOrFail({ id }), verificationToken };
  }

  async verifyDiscoveryDomain(tenantId: string, domainId: string, verificationToken: string): Promise<TenantDiscoveryDomain> {
    const repo = (await getDataSource()).getRepository(TenantDiscoveryDomain);
    const domain = await repo.findOneBy({ id: domainId, tenantId });
    if (!domain || domain.status === 'disabled') throw Errors.notFound('Organization discovery domain');
    const actualHash = createHash('sha256').update(verificationToken).digest('hex');
    if (!domain.verificationTokenHash || actualHash.length !== domain.verificationTokenHash.length
      || !timingSafeEqual(Buffer.from(actualHash), Buffer.from(domain.verificationTokenHash))) {
      throw Errors.unauthorized('Invalid organization discovery verification token');
    }
    let records: string[][];
    try { records = await this.resolveTxtRecords(`_enterpriseglue-discovery.${domain.domain}`); }
    catch { throw Errors.conflict('Organization discovery DNS verification record was not found'); }
    if (!records.map((parts) => parts.join('')).includes(`enterpriseglue-discovery-verification=${verificationToken}`)) {
      throw Errors.conflict('Organization discovery DNS verification record does not match');
    }
    await repo.update({ id: domain.id, tenantId }, {
      status: 'verified', verifiedAt: Date.now(), verificationTokenHash: null, updatedAt: Date.now(),
    });
    return repo.findOneByOrFail({ id: domain.id });
  }

  async disableDiscoveryDomain(tenantId: string, domainId: string): Promise<void> {
    const repo = (await getDataSource()).getRepository(TenantDiscoveryDomain);
    const result = await repo.update({ id: domainId, tenantId }, {
      status: 'disabled', verificationTokenHash: null, updatedAt: Date.now(),
    });
    if (result.affected !== 1) throw Errors.notFound('Organization discovery domain');
  }

  async findByDiscoveryDomain(domainValue: string): Promise<Tenant[]> {
    let domain: string;
    try { domain = normalizeDiscoveryDomain(domainValue); }
    catch { return []; }
    const dataSource = await getDataSource();
    const mappings = await dataSource.getRepository(TenantDiscoveryDomain).find({
      where: { domain, status: 'verified' },
    });
    const tenantIds = Array.from(new Set(mappings.map((mapping) => mapping.tenantId)));
    if (tenantIds.length === 0) return [];
    return (await dataSource.getRepository(Tenant).findBy({ id: In(tenantIds) }))
      .filter((tenant) => tenant.status === 'active')
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async removeMember(tenantId: string, userId: string, actorId: string): Promise<void> {
    const dataSource = await getDataSource();
    const assignments = await dataSource.getRepository(RbacRoleAssignment).find({
      where: { tenantId, principalType: 'user', principalId: userId, scopeType: 'tenant', scopeId: tenantId, roleId: In([...TENANT_ROLE_IDS]) },
    });
    if (assignments.length === 0) throw Errors.notFound('Tenant member');
    if (assignments.some((row) => row.source !== 'manual' && row.source !== 'sso')) {
      throw Errors.conflict('Tenant membership is managed by an authoritative configuration source');
    }
    if (assignments.some((row) => row.roleId === NATIVE_TENANT_ROLE_IDS.ADMIN)) {
      const administratorCount = await dataSource.getRepository(RbacRoleAssignment).count({
        where: [
          { tenantId, principalType: 'user', scopeType: 'tenant', scopeId: tenantId, roleId: NATIVE_TENANT_ROLE_IDS.ADMIN, expiresAt: IsNull() },
          { tenantId, principalType: 'user', scopeType: 'tenant', scopeId: tenantId, roleId: NATIVE_TENANT_ROLE_IDS.ADMIN, expiresAt: MoreThan(Date.now()) },
        ],
      });
      if (administratorCount <= 1) throw Errors.conflict('A tenant must retain at least one administrator');
    }
    for (const assignment of assignments) {
      await permissionService.removeRoleAssignment(assignment.id, actorId, { allowSso: true });
    }
  }

  verifyPlacementClaim(payloadValue: string, signatureValue: string): TenantPlacementClaim {
    if (!config.tenantPlacementKey) throw Errors.unauthorized('Tenant placement assertions are not configured');
    const expected = createHmac('sha256', config.tenantPlacementKey).update(payloadValue).digest();
    let actual: Buffer;
    try { actual = Buffer.from(signatureValue, 'base64url'); } catch { throw Errors.unauthorized('Invalid tenant placement signature'); }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw Errors.unauthorized('Invalid tenant placement signature');
    }
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(Buffer.from(payloadValue, 'base64url').toString('utf8')); } catch { throw Errors.unauthorized('Invalid tenant placement assertion'); }
    const claim: TenantPlacementClaim = {
      tenantId: String(raw.tenantId || ''),
      tenantSlug: normalizeSlug(String(raw.tenantSlug || '')),
      placementKey: String(raw.placementKey || ''),
      epoch: Number(raw.epoch),
      expiresAt: Number(raw.expiresAt),
    };
    const now = Date.now();
    if (!claim.tenantId || !claim.placementKey || !Number.isSafeInteger(claim.epoch) || !Number.isSafeInteger(claim.expiresAt)) {
      throw Errors.unauthorized('Invalid tenant placement assertion');
    }
    if (claim.expiresAt < now || claim.expiresAt > now + config.tenantPlacementMaxAgeSeconds * 1000) {
      throw Errors.unauthorized('Expired tenant placement assertion');
    }
    return claim;
  }

  verifyPlacementClaimV2(compactJws: string, hostname: string, requestPath: string): TenantPlacementClaimV2 {
    return tenantPlacementAssertionService.verifyV2({ compactJws, hostname, requestPath });
  }

  verifyPlacementClaimV3(compactJws: string, hostname: string, requestPath: string): TenantPlacementClaimV3 {
    return tenantPlacementAssertionService.verifyV3({ compactJws, hostname, requestPath });
  }
}

export const tenantService = new TenantService();
