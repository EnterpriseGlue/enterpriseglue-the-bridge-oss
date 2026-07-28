import { describe, expect, it } from 'vitest';
import { identityProviderMembershipSourceRef, matchesIdentityEntitlement, identityEntitlementMappingService } from '@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js';
import {
  authorizationAttributeEntitlementId,
  getIdentityProviderAdapter,
} from '@enterpriseglue/shared/services/platform-admin/IdentityProviderAdapter.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup, AuthzGroupMembership, IdentityEntitlementMapping, IdentityProvider, PlatformSettings, SsoNormalizedIdentity } from '@enterpriseglue/shared/db/entities/index.js';
import { vi, type Mock } from 'vitest';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

const identity = { providerKey: 'entra', providerType: 'oidc' as const, subjectId: 'u1', observedAt: 1, entitlements: [{ type: 'authenticated' as const, externalId: 'authenticated' }, { type: 'group' as const, externalId: 'group-prod' }, { type: 'role' as const, externalId: 'operator' }] };
describe('identity entitlement mapping', () => {
  it('matches exact, contains, and exists mappings only within the declared entitlement type', () => {
    expect(matchesIdentityEntitlement({ entitlementType: 'group', externalId: 'group-prod', matchOperator: 'exact' }, identity)).toBe(true);
    expect(matchesIdentityEntitlement({ entitlementType: 'group', externalId: 'prod', matchOperator: 'contains' }, identity)).toBe(true);
    expect(matchesIdentityEntitlement({ entitlementType: 'scope', matchOperator: 'exists' }, identity)).toBe(false);
    expect(matchesIdentityEntitlement({ entitlementType: 'authenticated', externalId: 'authenticated', matchOperator: 'exact' }, identity)).toBe(true);
  });

  it('matches LDAP group access by immutable id rather than a mutable display name', () => {
    const mapping = { entitlementType: 'group' as const, externalId: 'group-uuid-1', matchOperator: 'exact' as const };
    const renamedGroup = {
      providerKey: 'ldap', providerType: 'ldap' as const, subjectId: 'subject-1', observedAt: 1,
      entitlements: [{ type: 'group' as const, externalId: 'group-uuid-1' }],
    };
    const reusedDisplayName = {
      ...renamedGroup,
      entitlements: [{ type: 'group' as const, externalId: 'group-uuid-2' }],
    };

    expect(matchesIdentityEntitlement(mapping, renamedGroup)).toBe(true);
    expect(matchesIdentityEntitlement(mapping, reusedDisplayName)).toBe(false);
  });

  it('matches duplicate normalized group, role, and allowlisted attribute entitlements without creating duplicate memberships', async () => {
    const attributeId = authorizationAttributeEntitlementId('clearance', 'release');
    const mappings = [
      { id: 'group-mapping', providerId: 'entra', entitlementType: 'group', externalId: 'group-prod', matchOperator: 'exact', targetGroupId: 'group-1', syncMode: 'authoritative', isActive: true },
      { id: 'role-mapping', providerId: 'entra', entitlementType: 'role', externalId: 'operator', matchOperator: 'exact', targetGroupId: 'group-2', syncMode: 'authoritative', isActive: true },
      { id: 'attribute-mapping', providerId: 'entra', entitlementType: 'attribute', externalId: attributeId, matchOperator: 'exact', targetGroupId: 'group-3', syncMode: 'authoritative', isActive: true },
      { id: 'no-match', providerId: 'entra', entitlementType: 'group', externalId: 'not-present', matchOperator: 'exact', targetGroupId: 'group-4', syncMode: 'authoritative', isActive: true },
    ];
    const membershipRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn().mockResolvedValue(undefined), delete: vi.fn() };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? { find: vi.fn().mockResolvedValue(mappings) }
        : entity === AuthzGroupMembership ? membershipRepo
          : {},
    });

    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', {
      providerKey: 'entra', providerType: 'oidc', subjectId: 'subject-1', observedAt: 1,
      entitlements: [
        { type: 'group', externalId: 'group-prod' }, { type: 'group', externalId: 'group-prod' },
        { type: 'role', externalId: 'operator' }, { type: 'attribute', externalId: attributeId },
      ],
    })).resolves.toEqual({ created: 3, removed: 0 });

    expect(membershipRepo.insert).toHaveBeenCalledTimes(3);
    expect(membershipRepo.insert).not.toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group-4' }));
  });

  it.each([
    ['oidc', { groups: ['group-operators'], roles: ['release-operator'], scp: 'engine.read', __enterpriseglue_authz_attributes: { clearance: 'release' } }],
    ['saml', { group: 'group-operators', role: 'release-operator', scope: 'engine.read', __enterpriseglue_authz_attributes: { clearance: 'release' } }],
    ['ldap', { memberOf: ['group-operators'], appRoles: ['release-operator'], scope: 'engine.read', __enterpriseglue_authz_attributes: { clearance: 'release' } }],
  ] as const)('maps normalized %s authenticated, group, role, and attribute entitlements into the same internal groups', async (providerType, claims) => {
    const attributeId = authorizationAttributeEntitlementId('clearance', 'release');
    const providerId = `provider-${providerType}`;
    const normalized = getIdentityProviderAdapter(providerType).normalizeIdentity({
      providerKey: providerId,
      subjectId: `${providerType}-subject-1`,
      observedAt: 1,
      claims,
    });
    const mappings = [
      { id: 'authenticated-mapping', providerId, entitlementType: 'authenticated', externalId: 'authenticated', matchOperator: 'exact', targetGroupId: 'group-authenticated', syncMode: 'authoritative', isActive: true },
      { id: 'group-mapping', providerId, entitlementType: 'group', externalId: 'group-operators', matchOperator: 'exact', targetGroupId: 'group-operators', syncMode: 'authoritative', isActive: true },
      { id: 'role-mapping', providerId, entitlementType: 'role', externalId: 'release-operator', matchOperator: 'exact', targetGroupId: 'group-operators-role', syncMode: 'authoritative', isActive: true },
      { id: 'attribute-mapping', providerId, entitlementType: 'attribute', externalId: attributeId, matchOperator: 'exact', targetGroupId: 'group-release', syncMode: 'authoritative', isActive: true },
    ];
    const membershipRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn().mockResolvedValue(undefined), delete: vi.fn() };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? { find: vi.fn().mockResolvedValue(mappings) }
        : entity === AuthzGroupMembership ? membershipRepo
          : {},
    });

    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', normalized))
      .resolves.toEqual({ created: 4, removed: 0 });
    expect(membershipRepo.insert).toHaveBeenCalledTimes(4);
    expect(normalized.entitlements).toContainEqual({ type: 'scope', externalId: 'engine.read' });
    expect(matchesIdentityEntitlement({ entitlementType: 'scope', externalId: 'engine.read', matchOperator: 'exact' }, normalized)).toBe(true);
  });

  it.each([
    ['oidc', { groups: ['group-old'], roles: ['role-old'] }, { groups: ['group-new'], roles: ['role-new'] }],
    ['saml', { group: 'group-old', role: 'role-old' }, { group: 'group-new', role: 'role-new' }],
    ['ldap', { memberOf: ['group-old'], appRoles: ['role-old'] }, { memberOf: ['group-new'], appRoles: ['role-new'] }],
  ] as const)('reconciles fresh %s group and role changes by replacing stale authoritative access', async (providerType, initialClaims, changedClaims) => {
    const providerId = `provider-${providerType}`;
    const mappings = [
      { id: 'group-old', providerId, entitlementType: 'group', externalId: 'group-old', matchOperator: 'exact', targetGroupId: 'local-group-old', syncMode: 'authoritative', isActive: true },
      { id: 'role-old', providerId, entitlementType: 'role', externalId: 'role-old', matchOperator: 'exact', targetGroupId: 'local-role-old', syncMode: 'authoritative', isActive: true },
      { id: 'group-new', providerId, entitlementType: 'group', externalId: 'group-new', matchOperator: 'exact', targetGroupId: 'local-group-new', syncMode: 'authoritative', isActive: true },
      { id: 'role-new', providerId, entitlementType: 'role', externalId: 'role-new', matchOperator: 'exact', targetGroupId: 'local-role-new', syncMode: 'authoritative', isActive: true },
    ];
    const memberships = new Map<string, Record<string, unknown>>();
    const membershipRepo = {
      findOne: vi.fn(async ({ where }: { where: Record<string, unknown> }) => Array.from(memberships.values()).find((membership) =>
        membership.userId === where.userId && membership.groupId === where.groupId && membership.source === where.source && membership.sourceRef === where.sourceRef,
      ) || null),
      insert: vi.fn(async (membership: Record<string, unknown>) => { memberships.set(String(membership.id), membership); }),
      delete: vi.fn(async ({ id }: { id: string }) => { memberships.delete(id); }),
      update: vi.fn(),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? { find: vi.fn().mockResolvedValue(mappings) }
        : entity === AuthzGroupMembership ? membershipRepo
          : {},
    });
    const adapter = getIdentityProviderAdapter(providerType);
    const initial = adapter.normalizeIdentity({ providerKey: providerId, subjectId: 'subject-1', observedAt: 1, claims: initialClaims });
    const changed = adapter.normalizeIdentity({ providerKey: providerId, subjectId: 'subject-1', observedAt: 2, claims: changedClaims });

    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', initial)).resolves.toEqual({ created: 2, removed: 0 });
    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', changed)).resolves.toEqual({ created: 2, removed: 2 });
    expect(Array.from(memberships.values()).map((membership) => membership.groupId).sort()).toEqual(['local-group-new', 'local-role-new']);
  });

  it.each([
    ['oidc', { groups: ['engine-view'], roles: [] }, { groups: ['engine-view'], roles: ['deployment-operate'] }, { groups: ['engine-view'], roles: [] }, { groups: [], roles: [] }],
    ['saml', { group: 'engine-view', role: [] }, { group: 'engine-view', role: 'deployment-operate' }, { group: 'engine-view', role: [] }, { group: [], role: [] }],
    ['ldap', { memberOf: ['engine-view'], appRoles: [] }, { memberOf: ['engine-view'], appRoles: ['deployment-operate'] }, { memberOf: ['engine-view'], appRoles: [] }, { memberOf: [], appRoles: [] }],
  ] as const)('reconciles %s rights through grant, elevation removal, and full revocation on successive sign-ins', async (providerType, viewClaims, elevatedClaims, viewOnlyClaims, noAccessClaims) => {
    const providerId = `provider-${providerType}`;
    const mappings = [
      { id: 'view-engine', providerId, entitlementType: 'group', externalId: 'engine-view', matchOperator: 'exact', targetGroupId: 'local-engine-viewers', syncMode: 'authoritative', isActive: true },
      { id: 'operate-deployment', providerId, entitlementType: 'role', externalId: 'deployment-operate', matchOperator: 'exact', targetGroupId: 'local-deployment-operators', syncMode: 'authoritative', isActive: true },
    ];
    const memberships = new Map<string, Record<string, unknown>>();
    const membershipRepo = {
      findOne: vi.fn(async ({ where }: { where: Record<string, unknown> }) => Array.from(memberships.values()).find((membership) =>
        membership.userId === where.userId && membership.groupId === where.groupId && membership.source === where.source && membership.sourceRef === where.sourceRef,
      ) || null),
      insert: vi.fn(async (membership: Record<string, unknown>) => { memberships.set(String(membership.id), membership); }),
      delete: vi.fn(async ({ id }: { id: string }) => { memberships.delete(id); }),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? { find: vi.fn().mockResolvedValue(mappings) }
        : entity === AuthzGroupMembership ? membershipRepo
          : {},
    });
    const normalize = (claims: Record<string, unknown>, observedAt: number) => getIdentityProviderAdapter(providerType).normalizeIdentity({
      providerKey: providerId, subjectId: 'subject-1', observedAt, claims,
    });
    const groupIds = () => Array.from(memberships.values()).map((membership) => membership.groupId).sort();

    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', normalize(viewClaims, 1))).resolves.toEqual({ created: 1, removed: 0 });
    expect(groupIds()).toEqual(['local-engine-viewers']);

    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', normalize(elevatedClaims, 2))).resolves.toEqual({ created: 1, removed: 0 });
    expect(groupIds()).toEqual(['local-deployment-operators', 'local-engine-viewers']);

    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', normalize(viewOnlyClaims, 3))).resolves.toEqual({ created: 0, removed: 1 });
    expect(groupIds()).toEqual(['local-engine-viewers']);

    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', normalize(noAccessClaims, 4))).resolves.toEqual({ created: 0, removed: 1 });
    expect(groupIds()).toEqual([]);
  });

  it('previews aggregate proposed mapping matches from stored snapshots only', async () => {
    const providerRepo = { findOne: vi.fn().mockResolvedValue({ id: 'provider-1', key: 'identity.oidc.main', protocol: 'oidc' }) };
    const snapshotRepo = { find: vi.fn().mockResolvedValue([
      { providerSubject: 'subject-1', email: 'user@example.test', providerTenantId: null, claimsJson: JSON.stringify({ groups: ['operators'] }), lastSeenAt: 100 },
      { providerSubject: 'subject-2', email: 'user2@example.test', providerTenantId: null, claimsJson: JSON.stringify({ groups: ['viewers'] }), lastSeenAt: 101 },
    ]) };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === IdentityProvider ? providerRepo : entity === SsoNormalizedIdentity ? snapshotRepo : {} });

    const result = await identityEntitlementMappingService.previewStoredSnapshots({ providerKey: 'identity.oidc.main', entitlementType: 'group', externalId: 'operators', matchOperator: 'exact' }, 'tenant-a');

    expect(result).toEqual({ scanned: 2, matches: 1, nonMatches: 1, failed: 0, truncated: false, latestSnapshotAt: 101, warnings: ['stored_snapshots_only'] });
    expect(result).not.toHaveProperty('identities');
  });

  it('keeps stored-snapshot previews and ad-hoc mapping tests side-effect free', async () => {
    const providerRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'provider-1', key: 'identity.oidc.main', protocol: 'oidc' }),
      insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const snapshotRepo = {
      find: vi.fn().mockResolvedValue([{ providerSubject: 'subject-1', email: 'user@example.test', providerTenantId: null, claimsJson: JSON.stringify({ groups: ['operators'] }), lastSeenAt: 100 }]),
      insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const transaction = vi.fn();
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === IdentityProvider ? providerRepo : entity === SsoNormalizedIdentity ? snapshotRepo : {},
      transaction,
    });

    await expect(identityEntitlementMappingService.previewStoredSnapshots({
      providerKey: 'identity.oidc.main', entitlementType: 'group', externalId: 'operators', matchOperator: 'exact',
    }, 'tenant-a')).resolves.toMatchObject({ scanned: 1, matches: 1 });
    await expect(identityEntitlementMappingService.test({
      providerKey: 'identity.oidc.main', entitlementType: 'group', externalId: 'operators', matchOperator: 'exact',
      claims: { sub: 'preview-subject', groups: ['operators'] },
    }, 'tenant-a')).resolves.toMatchObject({ matches: true });

    expect(transaction).not.toHaveBeenCalled();
    for (const repo of [providerRepo, snapshotRepo]) {
      expect(repo.insert).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.delete).not.toHaveBeenCalled();
    }
  });

  it('rejects OAuth scopes as a human identity-mapping source before inspecting snapshots', async () => {
    await expect(identityEntitlementMappingService.previewStoredSnapshots({
      providerKey: 'identity.oidc.main', entitlementType: 'scope', externalId: 'engines.read', matchOperator: 'exact',
    }, 'tenant-a')).rejects.toThrow('OAuth scopes cannot be used for human identity mappings');
  });

  it('rejects identity mappings that reference a provider or group outside the requested tenant', async () => {
    const mappingRepo = { insert: vi.fn() };
    const providerRepo = { findOne: vi.fn().mockResolvedValue(null) };
    const groupRepo = { findOne: vi.fn().mockResolvedValue(null) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === IdentityProvider ? providerRepo
        : entity === AuthzGroup ? groupRepo
          : entity === IdentityEntitlementMapping ? mappingRepo
            : {},
    });

    await expect(identityEntitlementMappingService.create({
      providerKey: 'foreign-provider', targetGroupKey: 'foreign-group', entitlementType: 'group', externalId: 'operators', matchOperator: 'exact',
    }, 'tenant-a')).rejects.toThrow('Identity provider not found');

    for (const repo of [providerRepo, groupRepo]) {
      expect(repo.findOne).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-a' }),
      }));
    }
    expect(mappingRepo.insert).not.toHaveBeenCalled();
  });

  it('requires an explicit platform setting before creating a broad entitlement mapping', async () => {
    const mappingRepo = { insert: vi.fn() };
    const providerRepo = { findOne: vi.fn().mockResolvedValue({ id: 'provider-1', key: 'identity.oidc.main' }) };
    const groupRepo = { findOne: vi.fn().mockResolvedValue({ id: 'group-1', key: 'group.operators' }) };
    const settingsRepo = { findOneBy: vi.fn().mockResolvedValue({ ssoBroadEntitlementMappingsEnabled: false }) };
    const repositories = (entity: unknown) => entity === IdentityProvider ? providerRepo
      : entity === AuthzGroup ? groupRepo
        : entity === IdentityEntitlementMapping ? mappingRepo
          : entity === PlatformSettings ? settingsRepo
            : {};
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: repositories });

    await expect(identityEntitlementMappingService.create({
      providerKey: 'identity.oidc.main', targetGroupKey: 'group.operators', entitlementType: 'group', externalId: 'operators', matchOperator: 'contains',
    }, 'tenant-a')).rejects.toThrow('Broad identity entitlement mappings are disabled');
    expect(mappingRepo.insert).not.toHaveBeenCalled();

    settingsRepo.findOneBy.mockResolvedValue({ ssoBroadEntitlementMappingsEnabled: true });
    await expect(identityEntitlementMappingService.create({
      providerKey: 'identity.oidc.main', targetGroupKey: 'group.operators', entitlementType: 'group', externalId: 'operators', matchOperator: 'contains',
    }, 'tenant-a')).resolves.toMatchObject({ matchOperator: 'contains' });
    expect(mappingRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ matchOperator: 'contains' }));
  });

  it('persists config provenance when a mapping is created through an injected transaction manager', async () => {
    const mappingRepo = { insert: vi.fn().mockResolvedValue(undefined) };
    const provider = { id: 'provider-1', key: 'identity.oidc.main' };
    const group = { id: 'group-1', key: 'group.operators' };
    const store = {
      getRepository: (entity: unknown) => entity === IdentityProvider ? { findOne: vi.fn().mockResolvedValue(provider) }
        : entity === AuthzGroup ? { findOne: vi.fn().mockResolvedValue(group) }
          : entity === IdentityEntitlementMapping ? mappingRepo
            : {},
    } as any;

    const result = await identityEntitlementMappingService.create({
      providerKey: provider.key,
      targetGroupKey: group.key,
      entitlementType: 'group',
      externalId: 'operators',
      matchOperator: 'exact',
      configKey: 'mapping.operators',
      configKeyIdentity: 'tenant-a:mapping.operators',
      sourceRef: 'config_bundle:acme.authz',
      ownershipMode: 'config_warn',
      sourceHash: 'bundle-hash',
      lastAppliedAt: 123,
      driftStatus: 'in_sync',
    }, 'tenant-a', store);

    expect(result).toMatchObject({ configKey: 'mapping.operators', sourceRef: 'config_bundle:acme.authz' });
    expect(mappingRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      configKey: 'mapping.operators',
      configKeyIdentity: 'tenant-a:mapping.operators',
      sourceRef: 'config_bundle:acme.authz',
      ownershipMode: 'config_warn',
      sourceHash: 'bundle-hash',
      lastAppliedAt: 123,
      driftStatus: 'in_sync',
    }));
  });

  it('reconciles and disables config mappings through the supplied store with source-scoped membership cleanup', async () => {
    const mappingRepo = { update: vi.fn().mockResolvedValue(undefined) };
    const membershipRepo = { delete: vi.fn().mockResolvedValue(undefined) };
    const store = {
      getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo
        : entity === AuthzGroupMembership ? membershipRepo
          : {},
    } as any;

    await identityEntitlementMappingService.reconcileConfiguredMapping('mapping-1', {
      providerId: 'provider-2', previousProviderId: 'provider-1', configKey: 'mapping.operators',
      configKeyIdentity: 'tenant-a:mapping.operators', sourceRef: 'config_bundle:acme.authz', sourceHash: 'hash-2',
      ownershipMode: 'config_locked', lastAppliedAt: 200, driftStatus: 'in_sync', entitlementType: 'group', externalId: 'operators',
      matchOperator: 'exact', targetGroupId: 'group-2', syncMode: 'authoritative', isActive: true,
    }, 'tenant-a', store);
    await identityEntitlementMappingService.disableConfiguredMapping('mapping-1', 'provider-2', 'tenant-a', store);

    expect(membershipRepo.delete).toHaveBeenNthCalledWith(1, expect.objectContaining({
      tenantId: 'tenant-a', source: 'identity_provider', sourceRef: expect.anything(),
    }));
    expect(mappingRepo.update).toHaveBeenNthCalledWith(1, { id: 'mapping-1' }, expect.objectContaining({
      providerId: 'provider-2', targetGroupId: 'group-2', configKey: 'mapping.operators', ownershipMode: 'config_locked', sourceHash: 'hash-2', isActive: true,
    }));
    expect(mappingRepo.update).toHaveBeenNthCalledWith(2, { id: 'mapping-1' }, expect.objectContaining({ isActive: false }));
  });

  it('removes legacy scope-derived memberships regardless of their prior sync mode', async () => {
    const mappingRepo = { find: vi.fn().mockResolvedValue([{ id: 'legacy-scope', providerId: 'entra', entitlementType: 'scope', externalId: 'engines.read', matchOperator: 'exact', targetGroupId: 'group-1', syncMode: 'additive', isActive: true }]) };
    const membershipRepo = { findOne: vi.fn().mockResolvedValue({ id: 'membership-1', userId: 'user-1', groupId: 'group-1', source: 'identity_provider', sourceRef: identityProviderMembershipSourceRef('entra', 'legacy-scope') }), insert: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo : entity === AuthzGroupMembership ? membershipRepo : {} });

    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', identity)).resolves.toEqual({ created: 0, removed: 1 });
    expect(membershipRepo.insert).not.toHaveBeenCalled();
    expect(membershipRepo.delete).toHaveBeenCalledWith({ id: 'membership-1' });
  });

  it('reconciles only provider-owned memberships for the matching mapping', async () => {
    const mappingRepo = { find: vi.fn().mockResolvedValue([{ id: 'mapping-1', providerId: 'entra', entitlementType: 'group', externalId: 'group-prod', matchOperator: 'exact', targetGroupId: 'group-1', syncMode: 'authoritative', isActive: true }]) };
    const membershipRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn().mockResolvedValue(undefined), delete: vi.fn() };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo : entity === AuthzGroupMembership ? membershipRepo : {} });
    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', identity)).resolves.toEqual({ created: 1, removed: 0 });
    expect(membershipRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', groupId: 'group-1', source: 'identity_provider', sourceRef: identityProviderMembershipSourceRef('entra', 'mapping-1') }));
  });

  it('preserves additive, cross-provider, and manual memberships while authoritative sync removes only its stale row', async () => {
    const mappings = [
      { id: 'mapping-a-additive', providerId: 'provider-a', entitlementType: 'group', externalId: 'additive-group', matchOperator: 'exact', targetGroupId: 'group-shared', syncMode: 'additive', isActive: true },
      { id: 'mapping-a-authoritative', providerId: 'provider-a', entitlementType: 'group', externalId: 'authoritative-group', matchOperator: 'exact', targetGroupId: 'group-shared', syncMode: 'authoritative', isActive: true },
      { id: 'mapping-b-authoritative', providerId: 'provider-b', entitlementType: 'group', externalId: 'other-provider-group', matchOperator: 'exact', targetGroupId: 'group-shared', syncMode: 'authoritative', isActive: true },
    ];
    const memberships = [
      { id: 'membership-a-additive', userId: 'user-1', groupId: 'group-shared', source: 'identity_provider', sourceRef: 'identity_mapping:mapping-a-additive' },
      { id: 'membership-a-authoritative', userId: 'user-1', groupId: 'group-shared', source: 'identity_provider', sourceRef: 'identity_mapping:mapping-a-authoritative' },
      { id: 'membership-b-authoritative', userId: 'user-1', groupId: 'group-shared', source: 'identity_provider', sourceRef: 'identity_mapping:mapping-b-authoritative' },
      { id: 'membership-manual', userId: 'user-1', groupId: 'group-shared', source: 'manual', sourceRef: null },
    ];
    const mappingRepo = { find: vi.fn().mockResolvedValue(mappings) };
    const membershipRepo = {
      findOne: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(memberships.find((membership) =>
        membership.userId === where.userId
        && membership.groupId === where.groupId
        && membership.source === where.source
        && membership.sourceRef === where.sourceRef
      ) || null)),
      insert: vi.fn(),
      delete: vi.fn().mockImplementation(({ id }: { id: string }) => {
        const index = memberships.findIndex((membership) => membership.id === id);
        if (index >= 0) memberships.splice(index, 1);
        return Promise.resolve(undefined);
      }),
    };
    const store = {
      getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo : entity === AuthzGroupMembership ? membershipRepo : {},
    } as any;
    const identityWithoutGroups = {
      providerKey: 'provider-a', providerType: 'oidc' as const, subjectId: 'subject-1', observedAt: 1,
      entitlements: [{ type: 'authenticated' as const, externalId: 'authenticated' }],
    };

    await expect(identityEntitlementMappingService.syncMembershipsInStore(store, 'user-1', 'tenant-a', identityWithoutGroups))
      .resolves.toEqual({ created: 0, removed: 1 });

    expect(membershipRepo.delete).toHaveBeenCalledOnce();
    expect(membershipRepo.delete).toHaveBeenCalledWith({ id: 'membership-a-authoritative' });
    expect(memberships.map((membership) => membership.id)).toEqual([
      'membership-a-additive',
      'membership-b-authoritative',
      'membership-manual',
    ]);
    expect(membershipRepo.findOne).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sourceRef: 'identity_mapping:mapping-b-authoritative' }),
    }));
  });

  it('removes only memberships created by a manually managed mapping', async () => {
    const mappingRepo = { findOne: vi.fn().mockResolvedValue({ id: 'mapping-1', providerId: 'provider-1', sourceRef: null }), delete: vi.fn().mockResolvedValue(undefined) };
    const membershipRepo = { delete: vi.fn().mockResolvedValue(undefined) };
    const repositories = (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo : entity === AuthzGroupMembership ? membershipRepo : {};
    (getDataSource as unknown as Mock).mockResolvedValue({ transaction: vi.fn(async (callback: any) => callback({ getRepository: repositories })) });
    await identityEntitlementMappingService.remove('mapping-1', 'tenant-a');
    expect(membershipRepo.delete).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', source: 'identity_provider' }));
    expect(membershipRepo.delete.mock.calls[0][0].sourceRef.value).toEqual([
      identityProviderMembershipSourceRef('provider-1', 'mapping-1'), 'identity_mapping:mapping-1',
    ]);
    expect(mappingRepo.delete).toHaveBeenCalledWith({ id: 'mapping-1' });
  });

  it('cleans only its derived memberships when a manual mapping is disabled', async () => {
    const existing = {
      id: 'mapping-1', tenantId: 'tenant-a', providerId: 'provider-1', targetGroupId: 'group-1', entitlementType: 'group',
      externalId: 'ops', matchOperator: 'exact', syncMode: 'authoritative', isActive: true, sourceRef: null,
    };
    const mappingRepo = {
      findOne: vi.fn().mockResolvedValue(existing),
      find: vi.fn().mockResolvedValue([existing]),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const providerRepo = {
      find: vi.fn().mockResolvedValue([{ id: 'provider-1', key: 'identity.oidc.main' }]),
      findOne: vi.fn().mockResolvedValue({ id: 'provider-1', key: 'identity.oidc.main' }),
    };
    const groupRepo = {
      find: vi.fn().mockResolvedValue([{ id: 'group-1', key: 'group.operators' }]),
      findOne: vi.fn().mockResolvedValue({ id: 'group-1', key: 'group.operators' }),
    };
    const membershipRepo = { delete: vi.fn().mockResolvedValue(undefined) };
    const repositories = (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo
      : entity === IdentityProvider ? providerRepo
        : entity === AuthzGroupMembership ? membershipRepo
          : entity === AuthzGroup ? groupRepo
            : {};
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: repositories,
      transaction: vi.fn(async (callback: any) => callback({ getRepository: repositories })),
    });

    await identityEntitlementMappingService.update('mapping-1', { isActive: false }, 'tenant-a');

    expect(membershipRepo.delete).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', source: 'identity_provider' }));
    expect(membershipRepo.delete.mock.calls[0][0].sourceRef.value).toEqual([
      identityProviderMembershipSourceRef('provider-1', 'mapping-1'), 'identity_mapping:mapping-1',
    ]);
    expect(mappingRepo.update).toHaveBeenCalledWith({ id: 'mapping-1' }, expect.objectContaining({ isActive: false }));
  });

  it('allows a config-warning mapping to be edited and marks the configuration as drifted', async () => {
    const existing = {
      id: 'mapping-1', tenantId: 'tenant-a', providerId: 'provider-1', targetGroupId: 'group-1', entitlementType: 'group',
      externalId: 'ops', matchOperator: 'exact', syncMode: 'authoritative', isActive: true,
      sourceRef: 'config_bundle:acme.authz', ownershipMode: 'config_warn', configKey: 'mapping.operators',
    };
    const mappingRepo = { findOne: vi.fn().mockResolvedValue(existing), find: vi.fn().mockResolvedValue([existing]), update: vi.fn().mockResolvedValue(undefined) };
    const providerRepo = { find: vi.fn().mockResolvedValue([{ id: 'provider-1', key: 'identity.oidc.main' }]), findOne: vi.fn().mockResolvedValue({ id: 'provider-1', key: 'identity.oidc.main' }) };
    const groupRepo = { find: vi.fn().mockResolvedValue([{ id: 'group-1', key: 'group.operators' }]), findOne: vi.fn().mockResolvedValue({ id: 'group-1', key: 'group.operators' }) };
    const membershipRepo = { delete: vi.fn().mockResolvedValue(undefined) };
    const repositories = (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo
      : entity === IdentityProvider ? providerRepo
        : entity === AuthzGroup ? groupRepo
          : entity === AuthzGroupMembership ? membershipRepo
            : {};
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: repositories, transaction: vi.fn(async (callback: any) => callback({ getRepository: repositories })) });

    const result = await identityEntitlementMappingService.update('mapping-1', { externalId: 'operations' }, 'tenant-a');

    expect(result).toMatchObject({ sourceRef: 'config_bundle:acme.authz', ownershipMode: 'config_warn' });
    expect(mappingRepo.update).toHaveBeenCalledWith({ id: 'mapping-1' }, expect.objectContaining({ externalId: 'operations', driftStatus: 'drifted' }));
  });

  it('normalizes a legacy mapping-only membership reference after the matching provider sync', async () => {
    const mappingRepo = { find: vi.fn().mockResolvedValue([{
      id: 'mapping-1', providerId: 'provider-1', entitlementType: 'group', externalId: 'group-prod', matchOperator: 'exact', targetGroupId: 'group-1', syncMode: 'authoritative', isActive: true,
    }]) };
    const legacyMembership = { id: 'membership-1', userId: 'user-1', groupId: 'group-1', source: 'identity_provider', sourceRef: 'identity_mapping:mapping-1' };
    const membershipRepo = {
      findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(legacyMembership),
      insert: vi.fn(), update: vi.fn().mockResolvedValue(undefined), delete: vi.fn(),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => entity === IdentityEntitlementMapping ? mappingRepo : entity === AuthzGroupMembership ? membershipRepo : {} });

    await expect(identityEntitlementMappingService.syncMemberships('user-1', 'tenant-a', {
      ...identity, providerKey: 'provider-1',
    })).resolves.toEqual({ created: 0, removed: 0 });

    expect(membershipRepo.insert).not.toHaveBeenCalled();
    expect(membershipRepo.update).toHaveBeenCalledWith({ id: 'membership-1' }, expect.objectContaining({
      sourceRef: identityProviderMembershipSourceRef('provider-1', 'mapping-1'),
    }));
  });
});
