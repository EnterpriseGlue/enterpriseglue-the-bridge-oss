import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { directLdapIdentityService, setLdapClientFactoryForTest } from '@enterpriseglue/shared/services/platform-admin/DirectLdapIdentityService.js';
import { MockLdapDirectory } from '../../../../test/identity-mocks/index.js';

const serviceBindPassword = randomBytes(24).toString('base64url');
const testUserPassword = randomBytes(24).toString('base64url');

const provider = {
  id: 'provider-1', protocol: 'ldap', isEnabled: true, authenticationMode: 'direct',
  configurationJson: JSON.stringify({ url: 'ldaps://directory.example.test:636', bindDn: 'cn=service,dc=example,dc=test', bindPasswordRef: 'LDAP_BIND_SECRET', userBaseDn: 'ou=users,dc=example,dc=test', userSearchFilter: '(mail={username})', groupBaseDn: 'ou=groups,dc=example,dc=test', groupIdAttribute: 'cn', membershipMode: 'memberOf' }),
} as any;

describe('direct LDAP identity service', () => {
  afterEach(() => { setLdapClientFactoryForTest(); delete process.env.LDAP_BIND_SECRET; });

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
    ['tls_failure', 'TLS certificate verification failed'],
    ['timeout', 'timed out'],
    ['search_failure', 'search failed'],
  ] as const)('fails closed for LDAP %s behavior', async (failureMode, message) => {
    const directory = new MockLdapDirectory();
    directory.setFailureMode(failureMode);
    process.env.LDAP_BIND_SECRET = directory.bindPassword;
    setLdapClientFactoryForTest((url) => directory.client(url));

    await expect(directLdapIdentityService.authenticate(provider, 'person@example.test', directory.defaultUserPassword))
      .rejects.toThrow(message);
  });

  it('rejects a malformed LDAP search entry without a DN', async () => {
    const directory = new MockLdapDirectory();
    directory.setFailureMode('malformed');
    process.env.LDAP_BIND_SECRET = directory.bindPassword;
    setLdapClientFactoryForTest((url) => directory.client(url));

    await expect(directLdapIdentityService.authenticate(provider, 'person@example.test', directory.defaultUserPassword))
      .rejects.toThrow('did not include a DN');
  });
});
