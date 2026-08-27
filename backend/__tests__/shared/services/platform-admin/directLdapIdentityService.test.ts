import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { directLdapIdentityService, setLdapClientFactoryForTest } from '@enterpriseglue/shared/services/platform-admin/DirectLdapIdentityService.js';
import { secretResolver } from '@enterpriseglue/shared/services/platform-admin/SecretResolver.js';
import { MockLdapDirectory } from '../../../../test/identity-mocks/index.js';

const serviceBindPassword = randomBytes(24).toString('base64url');
const testUserPassword = randomBytes(24).toString('base64url');

const provider = {
  id: 'provider-1', protocol: 'ldap', isEnabled: true, authenticationMode: 'direct',
  configurationJson: JSON.stringify({ url: 'ldaps://directory.example.test:636', bindDn: 'cn=service,dc=example,dc=test', bindPasswordRef: 'LDAP_BIND_SECRET', userBaseDn: 'ou=users,dc=example,dc=test', userSearchFilter: '(mail={username})', groupBaseDn: 'ou=groups,dc=example,dc=test', groupIdAttribute: 'cn', membershipMode: 'memberOf' }),
} as any;

describe('direct LDAP identity service', () => {
  afterEach(() => { vi.restoreAllMocks(); setLdapClientFactoryForTest(); delete process.env.LDAP_BIND_SECRET; delete process.env.LDAP_CA_CERTIFICATE; delete process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY; delete process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS; delete process.env.EG_IDENTITY_PROVIDER_ALLOW_PRIVATE_HOSTS; delete process.env.EG_LDAP_RECONCILIATION_IDENTITY_LIMIT; delete process.env.EG_LDAP_RECONCILIATION_CONCURRENCY; delete process.env.EG_LDAP_RECONCILIATION_GROUP_QUERY_LIMIT; delete process.env.EG_LDAP_RECONCILIATION_GROUP_RESULT_LIMIT; delete process.env.EG_LDAP_GROUP_SEARCH_QUERY_LIMIT; delete process.env.EG_LDAP_GROUP_SEARCH_RESULT_LIMIT; });

  it('resolves the service bind password in the provider tenant scope', async () => {
    const resolve = vi.spyOn(secretResolver, 'resolveTenantStored').mockResolvedValue(serviceBindPassword);
    const client = {
      bind: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue({ searchEntries: [{ dn: 'uid=person,ou=users,dc=example,dc=test', entryUUID: 'uuid-1', mail: 'person@example.test' }] }),
      unbind: vi.fn().mockResolvedValue(undefined),
    };
    setLdapClientFactoryForTest(() => client);
    const reference = 'ref:tenant-secret://v1/tenant-alpha/ldap.bind_password/version-1';
    await expect(directLdapIdentityService.authenticate({
      ...provider,
      tenantId: 'tenant-alpha',
      configurationJson: JSON.stringify({ ...JSON.parse(provider.configurationJson), bindPasswordRef: reference }),
    }, 'person@example.test', testUserPassword)).resolves.toMatchObject({ subjectId: 'uuid-1' });
    expect(resolve).toHaveBeenCalledWith(reference, { tenantId: 'tenant-alpha', purpose: 'ldap.bind_password' });
  });

  it('blocks an unlisted directory before opening an LDAP client', async () => {
    process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY = 'true';
    process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS = 'approved.example.test';
    const factory = vi.fn();
    setLdapClientFactoryForTest(factory);
    await expect(directLdapIdentityService.authenticate(provider, 'person@example.test', testUserPassword)).rejects.toThrow('not permitted');
    expect(factory).not.toHaveBeenCalled();
  });

  it('uses a service lookup then user bind and returns a stable user id with group DNs', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    const client = {
      bind: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue({ searchEntries: [{ dn: 'uid=person,ou=users,dc=example,dc=test', entryUUID: 'uuid-1', mail: 'person@example.test', cn: 'Person', givenName: 'Person', sn: 'Example', memberOf: ['cn=operations,ou=groups,dc=example,dc=test'] }] }),
      unbind: vi.fn().mockResolvedValue(undefined),
    };
    setLdapClientFactoryForTest(() => client);
    const identity = await directLdapIdentityService.authenticate(provider, 'person@example.test', testUserPassword);
    expect(identity).toMatchObject({ subjectId: 'uuid-1', email: 'person@example.test', groups: ['cn=operations,ou=groups,dc=example,dc=test'] });
    expect(client.bind).toHaveBeenNthCalledWith(1, 'cn=service,dc=example,dc=test', serviceBindPassword);
    expect(client.bind).toHaveBeenNthCalledWith(2, 'uid=person,ou=users,dc=example,dc=test', testUserPassword);
    expect(client.search).toHaveBeenCalledWith('ou=users,dc=example,dc=test', expect.objectContaining({ filter: '(mail=person@example.test)', sizeLimit: 2 }));
    expect(client.unbind).toHaveBeenCalled();
  });

  it('resolves a provider-scoped TLS trust reference for the LDAP client', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    process.env.LDAP_CA_CERTIFICATE = '-----BEGIN CERTIFICATE-----\nprovider-ca\n-----END CERTIFICATE-----';
    const client = {
      bind: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue({ searchEntries: [{ dn: 'uid=person,ou=users,dc=example,dc=test', entryUUID: 'uuid-1', mail: 'person@example.test' }] }),
      unbind: vi.fn().mockResolvedValue(undefined),
    };
    const factory = vi.fn(() => client);
    setLdapClientFactoryForTest(factory);

    await directLdapIdentityService.authenticate({
      ...provider,
      configurationJson: JSON.stringify({ ...JSON.parse(provider.configurationJson), tlsTrustRef: 'LDAP_CA_CERTIFICATE' }),
    }, 'person@example.test', testUserPassword);

    expect(factory).toHaveBeenCalledWith('ldaps://directory.example.test:636', process.env.LDAP_CA_CERTIFICATE);
  });

  it('fails before opening a client when the configured TLS trust reference is unavailable', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    const factory = vi.fn();
    setLdapClientFactoryForTest(factory);

    await expect(directLdapIdentityService.authenticate({
      ...provider,
      configurationJson: JSON.stringify({ ...JSON.parse(provider.configurationJson), tlsTrustRef: 'MISSING_LDAP_CA_CERTIFICATE' }),
    }, 'person@example.test', testUserPassword)).rejects.toThrow('LDAP TLS trust reference is unavailable');
    expect(factory).not.toHaveBeenCalled();
  });

  it('returns configured immutable group ids from reverse group search', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    const groupSearchProvider = {
      ...provider,
      configurationJson: JSON.stringify({
        ...JSON.parse(provider.configurationJson),
        groupIdAttribute: 'entryUUID',
        membershipMode: 'group_search',
      }),
    };
    const client = {
      bind: vi.fn().mockResolvedValue(undefined),
      search: vi.fn()
        .mockResolvedValueOnce({ searchEntries: [{ dn: 'uid=person,ou=users,dc=example,dc=test', entryUUID: 'user-uuid-1', mail: 'person@example.test', cn: 'Person' }] })
        .mockResolvedValueOnce({ searchEntries: [
          { dn: 'cn=renamed-operations,ou=groups,dc=example,dc=test', entryUUID: 'group-uuid-1' },
          { dn: 'cn=duplicate-alias,ou=groups,dc=example,dc=test', entryUUID: 'group-uuid-1' },
          { dn: 'cn=payments,ou=groups,dc=example,dc=test', entryUUID: 'group-uuid-2' },
        ] }),
      unbind: vi.fn().mockResolvedValue(undefined),
    };
    setLdapClientFactoryForTest(() => client);

    const identity = await directLdapIdentityService.authenticate(groupSearchProvider, 'person@example.test', testUserPassword);

    expect(identity).toMatchObject({
      subjectId: 'user-uuid-1',
      groups: ['group-uuid-1', 'group-uuid-2'],
    });
    expect(client.search).toHaveBeenNthCalledWith(2, 'ou=groups,dc=example,dc=test', expect.objectContaining({
      filter: '(member=uid=person,ou=users,dc=example,dc=test)',
      attributes: ['entryUUID'],
    }));
  });

  it('resolves bounded parent groups when group_search enables nested groups', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    const nestedProvider = { ...provider, configurationJson: JSON.stringify({ ...JSON.parse(provider.configurationJson), groupIdAttribute: 'entryUUID', membershipMode: 'group_search', nestedGroups: true }) };
    const client = { bind: vi.fn().mockResolvedValue(undefined), search: vi.fn()
      .mockResolvedValueOnce({ searchEntries: [{ dn: 'uid=person,ou=users,dc=example,dc=test', entryUUID: 'user-1', mail: 'person@example.test' }] })
      .mockResolvedValueOnce({ searchEntries: [{ dn: 'cn=operators,ou=groups,dc=example,dc=test', entryUUID: 'group-operators' }] })
      .mockResolvedValueOnce({ searchEntries: [{ dn: 'cn=admins,ou=groups,dc=example,dc=test', entryUUID: 'group-admins' }] })
      .mockResolvedValueOnce({ searchEntries: [] }), unbind: vi.fn().mockResolvedValue(undefined) };
    setLdapClientFactoryForTest(() => client);
    await expect(directLdapIdentityService.authenticate(nestedProvider, 'person@example.test', testUserPassword)).resolves.toMatchObject({ groups: ['group-operators', 'group-admins'] });
  });

  it('deduplicates group cycles and fails closed when nested group fan-out exceeds its query budget', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    process.env.EG_LDAP_GROUP_SEARCH_QUERY_LIMIT = '1';
    const nestedProvider = { ...provider, configurationJson: JSON.stringify({ ...JSON.parse(provider.configurationJson), groupIdAttribute: 'entryUUID', membershipMode: 'group_search', nestedGroups: true }) };
    const client = { bind: vi.fn().mockResolvedValue(undefined), search: vi.fn()
      .mockResolvedValueOnce({ searchEntries: [{ dn: 'uid=person,ou=users,dc=example,dc=test', entryUUID: 'user-1', mail: 'person@example.test' }] })
      .mockResolvedValueOnce({ searchEntries: [
        { dn: 'cn=operators,ou=groups,dc=example,dc=test', entryUUID: 'group-operators' },
        { dn: 'cn=operators,ou=groups,dc=example,dc=test', entryUUID: 'group-operators' },
      ] }), unbind: vi.fn().mockResolvedValue(undefined) };
    setLdapClientFactoryForTest(() => client);

    await expect(directLdapIdentityService.authenticate(nestedProvider, 'person@example.test', testUserPassword)).rejects.toThrow('query safety limit');
    expect(client.unbind).toHaveBeenCalledOnce();
  });

  it('fails closed when one group-search response exceeds its result budget', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    process.env.EG_LDAP_GROUP_SEARCH_RESULT_LIMIT = '1';
    const groupSearchProvider = { ...provider, configurationJson: JSON.stringify({ ...JSON.parse(provider.configurationJson), groupIdAttribute: 'entryUUID', membershipMode: 'group_search' }) };
    const client = { bind: vi.fn().mockResolvedValue(undefined), search: vi.fn()
      .mockResolvedValueOnce({ searchEntries: [{ dn: 'uid=person,ou=users,dc=example,dc=test', entryUUID: 'user-1', mail: 'person@example.test' }] })
      .mockResolvedValueOnce({ searchEntries: [
        { dn: 'cn=operators,ou=groups,dc=example,dc=test', entryUUID: 'group-operators' },
        { dn: 'cn=admins,ou=groups,dc=example,dc=test', entryUUID: 'group-admins' },
      ] }), unbind: vi.fn().mockResolvedValue(undefined) };
    setLdapClientFactoryForTest(() => client);

    await expect(directLdapIdentityService.authenticate(groupSearchProvider, 'person@example.test', testUserPassword)).rejects.toThrow('result safety limit');
    expect(client.unbind).toHaveBeenCalledOnce();
  });

  it('fails closed when nested groups are requested with memberOf mode', async () => {
    await expect(directLdapIdentityService.authenticate({ ...provider, configurationJson: JSON.stringify({ ...JSON.parse(provider.configurationJson), nestedGroups: true }) }, 'person@example.test', testUserPassword))
      .rejects.toThrow('Nested LDAP groups require group_search membership mode');
  });

  it('rejects an unsafe user filter without a username placeholder', async () => {
    await expect(directLdapIdentityService.authenticate({ ...provider, configurationJson: JSON.stringify({ ...JSON.parse(provider.configurationJson), userSearchFilter: '(objectClass=person)' }) }, 'person@example.test', testUserPassword)).rejects.toThrow('{username}');
  });

  it('runs bind and search over the LDAPS protocol mock', async () => {
    const directory = new MockLdapDirectory();
    process.env.LDAP_BIND_SECRET = directory.bindPassword;
    setLdapClientFactoryForTest((url) => directory.client(url));

    await expect(directLdapIdentityService.authenticate(provider, 'person@example.test', directory.defaultUserPassword)).resolves.toMatchObject({
      subjectId: 'uuid-person@example.test',
      email: 'person@example.test',
      groups: ['cn=operations,ou=groups,dc=example,dc=test'],
    });
  });

  it('follows LDAP paged directory enumeration rather than truncating at the configured page size', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    const firstPage = { searchEntries: [{ dn: 'uid=first,ou=users,dc=example,dc=test', entryUUID: 'first-id', mail: 'first@example.test', cn: 'First' }] };
    const secondPage = { searchEntries: [{ dn: 'uid=second,ou=users,dc=example,dc=test', entryUUID: 'second-id', mail: 'second@example.test', cn: 'Second' }] };
    const client = {
      bind: vi.fn().mockResolvedValue(undefined),
      search: vi.fn(),
      searchPaginated: vi.fn(async function* () { yield firstPage; yield secondPage; }),
      unbind: vi.fn().mockResolvedValue(undefined),
    };
    setLdapClientFactoryForTest(() => client);

    const page = await directLdapIdentityService.listDirectoryPage({
      ...provider,
      configurationJson: JSON.stringify({ ...JSON.parse(provider.configurationJson), pageSize: 1 }),
    });

    expect(page.identities).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectId: 'first-id', email: 'first@example.test' }),
      expect.objectContaining({ subjectId: 'second-id', email: 'second@example.test' }),
    ]));
    expect(client.searchPaginated).toHaveBeenCalledWith('ou=users,dc=example,dc=test', expect.objectContaining({ paged: { pageSize: 1 } }));
    expect(client.search).not.toHaveBeenCalled();
  });

  it('stops and unbinds before an authoritative LDAP enumeration exceeds its safety budget', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    process.env.EG_LDAP_RECONCILIATION_IDENTITY_LIMIT = '1';
    const client = {
      bind: vi.fn().mockResolvedValue(undefined),
      search: vi.fn(),
      searchPaginated: vi.fn(async function* () {
        yield { searchEntries: [{ dn: 'uid=first,ou=users,dc=example,dc=test', entryUUID: 'first-id', mail: 'first@example.test' }] };
        yield { searchEntries: [{ dn: 'uid=second,ou=users,dc=example,dc=test', entryUUID: 'second-id', mail: 'second@example.test' }] };
      }),
      unbind: vi.fn().mockResolvedValue(undefined),
    };
    setLdapClientFactoryForTest(() => client);

    await expect(directLdapIdentityService.listDirectoryPage(provider)).rejects.toThrow('stopped without applying removals');
    expect(client.unbind).toHaveBeenCalledOnce();
  });

  it('rejects authoritative reconciliation when the directory client cannot prove paged enumeration completeness', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    const client = {
      bind: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue({ searchEntries: [] }),
      unbind: vi.fn().mockResolvedValue(undefined),
    };
    setLdapClientFactoryForTest(() => client);

    await expect(directLdapIdentityService.listDirectoryPage(provider)).rejects.toThrow('requires paged directory search support');
    expect(client.search).not.toHaveBeenCalled();
    expect(client.unbind).toHaveBeenCalledOnce();
  });

  it('bounds reverse-group lookups across the complete LDAP reconciliation run', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    process.env.EG_LDAP_RECONCILIATION_CONCURRENCY = '1';
    process.env.EG_LDAP_RECONCILIATION_GROUP_QUERY_LIMIT = '2';
    const groupSearchProvider = { ...provider, configurationJson: JSON.stringify({ ...JSON.parse(provider.configurationJson), membershipMode: 'group_search' }) };
    const entries = ['first', 'second', 'third'].map((name) => ({ dn: `uid=${name},ou=users,dc=example,dc=test`, entryUUID: `${name}-id`, mail: `${name}@example.test` }));
    const client = {
      bind: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue({ searchEntries: [] }),
      searchPaginated: vi.fn(async function* () { yield { searchEntries: entries }; }),
      unbind: vi.fn().mockResolvedValue(undefined),
    };
    setLdapClientFactoryForTest(() => client);

    await expect(directLdapIdentityService.listDirectoryPage(groupSearchProvider)).rejects.toThrow('LDAP reconciliation group search exceeded the configured 2-query safety limit');
    expect(client.search).toHaveBeenCalledTimes(2);
    expect(client.unbind).toHaveBeenCalledOnce();
  });

  it('uses a bounded worker pool for directory group resolution', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    process.env.EG_LDAP_RECONCILIATION_CONCURRENCY = '2';
    const groupSearchProvider = { ...provider, configurationJson: JSON.stringify({ ...JSON.parse(provider.configurationJson), membershipMode: 'group_search' }) };
    const entries = ['first', 'second', 'third', 'fourth'].map((name) => ({ dn: `uid=${name},ou=users,dc=example,dc=test`, entryUUID: `${name}-id`, mail: `${name}@example.test` }));
    let active = 0;
    let maximumActive = 0;
    const client = {
      bind: vi.fn().mockResolvedValue(undefined),
      search: vi.fn(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => setImmediate(resolve));
        active -= 1;
        return { searchEntries: [] };
      }),
      searchPaginated: vi.fn(async function* () { yield { searchEntries: entries }; }),
      unbind: vi.fn().mockResolvedValue(undefined),
    };
    setLdapClientFactoryForTest(() => client);

    await expect(directLdapIdentityService.listDirectoryPage(groupSearchProvider)).resolves.toMatchObject({ identities: expect.any(Array), nextCursor: null });
    expect(maximumActive).toBe(2);
    expect(client.search).toHaveBeenCalledTimes(4);
  });

  it('fails closed instead of accepting a truncated nested-group hierarchy', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    const nestedProvider = { ...provider, configurationJson: JSON.stringify({ ...JSON.parse(provider.configurationJson), groupIdAttribute: 'entryUUID', membershipMode: 'group_search', nestedGroups: true }) };
    const groupEntries = Array.from({ length: 10 }, (_entry, index) => ({
      dn: `cn=level-${index + 1},ou=groups,dc=example,dc=test`,
      entryUUID: `group-level-${index + 1}`,
    }));
    const client = {
      bind: vi.fn().mockResolvedValue(undefined),
      search: vi.fn()
        .mockResolvedValueOnce({ searchEntries: [{ dn: 'uid=person,ou=users,dc=example,dc=test', entryUUID: 'user-1', mail: 'person@example.test' }] })
        .mockImplementation(async () => ({ searchEntries: [groupEntries.shift()] })),
      unbind: vi.fn().mockResolvedValue(undefined),
    };
    setLdapClientFactoryForTest(() => client);

    await expect(directLdapIdentityService.authenticate(nestedProvider, 'person@example.test', testUserPassword)).rejects.toThrow('nested group search exceeded the configured depth safety limit');
    expect(client.unbind).toHaveBeenCalledOnce();
  });

  it('rejects an insecure LDAP URL before opening a directory client', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    const factory = vi.fn();
    setLdapClientFactoryForTest(factory);

    await expect(directLdapIdentityService.authenticate({
      ...provider,
      configurationJson: JSON.stringify({ ...JSON.parse(provider.configurationJson), url: 'ldap://directory.example.test:389' }),
    }, 'person@example.test', testUserPassword)).rejects.toThrow('must use LDAPS');
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    ['tls_failure', 'TLS certificate verification failed', 'provider_unavailable'],
    ['timeout', 'timed out', 'timeout'],
    ['search_failure', 'search failed', 'provider_unavailable'],
  ] as const)('fails closed for LDAP %s behavior', async (failureMode, message, code) => {
    const directory = new MockLdapDirectory();
    directory.setFailureMode(failureMode);
    process.env.LDAP_BIND_SECRET = directory.bindPassword;
    setLdapClientFactoryForTest((url) => directory.client(url));

    await expect(directLdapIdentityService.authenticate(provider, 'person@example.test', directory.defaultUserPassword))
      .rejects.toThrow(message);
    await expect(directLdapIdentityService.authenticate(provider, 'person@example.test', directory.defaultUserPassword))
      .rejects.toMatchObject({ code });
  });

  it('rejects a malformed LDAP search entry without a DN', async () => {
    const directory = new MockLdapDirectory();
    directory.setFailureMode('malformed');
    process.env.LDAP_BIND_SECRET = directory.bindPassword;
    setLdapClientFactoryForTest((url) => directory.client(url));

    await expect(directLdapIdentityService.authenticate(provider, 'person@example.test', directory.defaultUserPassword))
      .rejects.toThrow('did not include a DN');
  });

  it('fails closed when a directory returns an LDAP referral', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    const client = {
      bind: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockRejectedValue(new Error('LDAP referral received from directory')),
      unbind: vi.fn().mockResolvedValue(undefined),
    };
    setLdapClientFactoryForTest(() => client);

    await expect(directLdapIdentityService.authenticate(provider, 'person@example.test', testUserPassword))
      .rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(client.unbind).toHaveBeenCalledOnce();
  });

  it('classifies rejected service and user binds without exposing LDAP protocol details', async () => {
    process.env.LDAP_BIND_SECRET = serviceBindPassword;
    const rejectedServiceClient = {
      bind: vi.fn().mockRejectedValue({ code: 49, message: ' Code: 0x31' }),
      search: vi.fn(), unbind: vi.fn().mockResolvedValue(undefined),
    };
    setLdapClientFactoryForTest(() => rejectedServiceClient);
    await expect(directLdapIdentityService.authenticate(provider, 'person@example.test', testUserPassword))
      .rejects.toThrow('LDAP service credentials were rejected');
    await expect(directLdapIdentityService.authenticate(provider, 'person@example.test', testUserPassword))
      .rejects.toMatchObject({ code: 'invalid_credentials' });

    const rejectedUserClient = {
      bind: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce({ code: 49, message: ' Code: 0x31' }),
      search: vi.fn().mockResolvedValue({ searchEntries: [{ dn: 'uid=person,ou=users,dc=example,dc=test', entryUUID: 'uuid-1', mail: 'person@example.test' }] }),
      unbind: vi.fn().mockResolvedValue(undefined),
    };
    setLdapClientFactoryForTest(() => rejectedUserClient);
    await expect(directLdapIdentityService.authenticate(provider, 'person@example.test', testUserPassword))
      .rejects.toThrow('LDAP user credentials were rejected');
  });
});
