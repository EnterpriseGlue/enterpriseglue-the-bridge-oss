import { afterEach, describe, expect, it, vi } from 'vitest';
import { directLdapIdentityService, setLdapClientFactoryForTest } from '@enterpriseglue/shared/services/platform-admin/DirectLdapIdentityService.js';

const provider = {
  id: 'provider-1', protocol: 'ldap', isEnabled: true, authenticationMode: 'direct',
  configurationJson: JSON.stringify({ url: 'ldaps://directory.example.test:636', bindDn: 'cn=service,dc=example,dc=test', bindPasswordRef: 'LDAP_BIND_SECRET', userBaseDn: 'ou=users,dc=example,dc=test', userSearchFilter: '(mail={username})', groupBaseDn: 'ou=groups,dc=example,dc=test', groupIdAttribute: 'cn', membershipMode: 'memberOf' }),
} as any;

describe('direct LDAP identity service', () => {
  afterEach(() => { setLdapClientFactoryForTest(); delete process.env.LDAP_BIND_SECRET; });

  it('uses a service lookup then user bind and returns a stable user id with group DNs', async () => {
    process.env.LDAP_BIND_SECRET = 'service-password';
    const client = {
      bind: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue({ searchEntries: [{ dn: 'uid=person,ou=users,dc=example,dc=test', entryUUID: 'uuid-1', mail: 'person@example.test', cn: 'Person', givenName: 'Person', sn: 'Example', memberOf: ['cn=operations,ou=groups,dc=example,dc=test'] }] }),
      unbind: vi.fn().mockResolvedValue(undefined),
    };
    setLdapClientFactoryForTest(() => client);
    const identity = await directLdapIdentityService.authenticate(provider, 'person@example.test', 'user-password');
    expect(identity).toMatchObject({ subjectId: 'uuid-1', email: 'person@example.test', groups: ['cn=operations,ou=groups,dc=example,dc=test'] });
    expect(client.bind).toHaveBeenNthCalledWith(1, 'cn=service,dc=example,dc=test', 'service-password');
    expect(client.bind).toHaveBeenNthCalledWith(2, 'uid=person,ou=users,dc=example,dc=test', 'user-password');
    expect(client.search).toHaveBeenCalledWith('ou=users,dc=example,dc=test', expect.objectContaining({ filter: '(mail=person@example.test)', sizeLimit: 2 }));
    expect(client.unbind).toHaveBeenCalled();
  });

  it('returns configured immutable group ids from reverse group search', async () => {
    process.env.LDAP_BIND_SECRET = 'service-password';
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

    const identity = await directLdapIdentityService.authenticate(groupSearchProvider, 'person@example.test', 'user-password');

    expect(identity).toMatchObject({
      subjectId: 'user-uuid-1',
      groups: ['group-uuid-1', 'group-uuid-2'],
    });
    expect(client.search).toHaveBeenNthCalledWith(2, 'ou=groups,dc=example,dc=test', expect.objectContaining({
      filter: '(member=uid=person,ou=users,dc=example,dc=test)',
      attributes: ['entryUUID'],
    }));
  });

  it('rejects an unsafe user filter without a username placeholder', async () => {
    await expect(directLdapIdentityService.authenticate({ ...provider, configurationJson: JSON.stringify({ ...JSON.parse(provider.configurationJson), userSearchFilter: '(objectClass=person)' }) }, 'person@example.test', 'password')).rejects.toThrow('{username}');
  });
});
