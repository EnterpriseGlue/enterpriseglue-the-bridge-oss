import { describe, expect, it } from 'vitest';
import { directLdapIdentityService } from '@enterpriseglue/shared/services/platform-admin/DirectLdapIdentityService.js';

const requiredEnvironment = [
  'EG_LDAP_TEST_URL',
  'EG_LDAP_TEST_BIND_DN',
  'EG_LDAP_TEST_ADMIN_PASSWORD',
  'EG_LDAP_TEST_USER_PASSWORD',
] as const;

const hasContainerInputs = requiredEnvironment.every((name) => Boolean(process.env[name]));
const describeContainer = hasContainerInputs ? describe : describe.skip;

describeContainer('direct LDAP container integration', () => {
  const provider = {
    id: 'ldap-container-provider',
    protocol: 'ldap',
    isEnabled: true,
    authenticationMode: 'direct',
    configurationJson: JSON.stringify({
      url: process.env.EG_LDAP_TEST_URL,
      bindDn: process.env.EG_LDAP_TEST_BIND_DN,
      bindPasswordRef: 'EG_LDAP_TEST_ADMIN_PASSWORD',
      userBaseDn: 'ou=people,dc=identity-mock,dc=test',
      userSearchFilter: '(mail={username})',
      userEnumerationFilter: '(objectClass=inetOrgPerson)',
      groupBaseDn: 'ou=groups,dc=identity-mock,dc=test',
      groupIdAttribute: 'cn',
      membershipMode: 'group_search',
      nestedGroups: true,
    }),
  } as any;

  it('uses the production LDAPS client for service bind, user bind, group search, and directory enumeration', async () => {
    const identity = await directLdapIdentityService.authenticate(
      provider,
      'alice@identity-mock.test',
      process.env.EG_LDAP_TEST_USER_PASSWORD!,
    );

    expect(identity).toMatchObject({
      email: 'alice@identity-mock.test',
      groups: expect.arrayContaining(['operations', 'platform-operators']),
    });
    expect(identity.subjectId).toBeTruthy();

    const page = await directLdapIdentityService.listDirectoryPage(provider);
    expect(page.nextCursor).toBeNull();
    expect(page.identities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        email: 'alice@identity-mock.test',
        groups: expect.arrayContaining(['operations', 'platform-operators']),
      }),
    ]));
  });
});
