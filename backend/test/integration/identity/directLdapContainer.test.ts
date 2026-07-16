import { describe, expect, it } from 'vitest';
import { directLdapIdentityService } from '@enterpriseglue/shared/services/platform-admin/DirectLdapIdentityService.js';

const requiredEnvironment = [
  'EG_LDAP_TEST_URL',
  'EG_LDAP_TEST_BIND_DN',
  'EG_LDAP_TEST_ADMIN_PASSWORD',
  'EG_LDAP_TEST_USER_PASSWORD',
  'EG_LDAP_TEST_DISABLED_USER_PASSWORD',
  'EG_LDAP_TEST_CA_CERTIFICATE',
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
      userSearchFilter: '(&(mail={username})(employeeType=active))',
      userEnumerationFilter: '(&(objectClass=inetOrgPerson)(employeeType=active))',
      pageSize: 1,
      groupBaseDn: 'ou=groups,dc=identity-mock,dc=test',
      groupIdAttribute: 'businessCategory',
      membershipMode: 'group_search',
      nestedGroups: true,
      tlsTrustRef: 'EG_LDAP_TEST_CA_CERTIFICATE',
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
      groups: expect.arrayContaining(['group-id-operations', 'group-id-platform-operators']),
    });
    expect(identity.subjectId).toBeTruthy();

    const page = await directLdapIdentityService.listDirectoryPage(provider);
    expect(page.nextCursor).toBeNull();
    expect(page.identities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        email: 'alice@identity-mock.test',
        groups: expect.arrayContaining(['group-id-operations', 'group-id-platform-operators']),
      }),
      expect.objectContaining({
        email: 'bob@identity-mock.test',
      }),
    ]));
    expect(page.identities).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ email: 'disabled@identity-mock.test' }),
    ]));
  });

  it('fails closed for a rejected user bind and a missing directory user', async () => {
    await expect(directLdapIdentityService.authenticate(
      provider,
      'alice@identity-mock.test',
      'incorrect-test-password',
    )).rejects.toThrow('LDAP user credentials were rejected');

    await expect(directLdapIdentityService.authenticate(
      provider,
      'deleted-or-missing@identity-mock.test',
      process.env.EG_LDAP_TEST_USER_PASSWORD!,
    )).rejects.toThrow('did not return exactly one entry');

    await expect(directLdapIdentityService.authenticate(
      provider,
      'disabled@identity-mock.test',
      process.env.EG_LDAP_TEST_DISABLED_USER_PASSWORD!,
    )).rejects.toThrow('did not return exactly one entry');
  });
});
