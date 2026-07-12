import { Client } from 'ldapts';
import type { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { secretResolver } from './SecretResolver.js';

interface LdapConfiguration {
  url: string;
  bindDn: string;
  bindPasswordRef: string;
  userBaseDn: string;
  userSearchFilter: string;
  userEnumerationFilter: string;
  pageSize: number;
  subjectAttribute: string;
  emailAttribute: string;
  groupBaseDn: string;
  groupIdAttribute: string;
  membershipMode: 'memberOf' | 'group_search';
  nestedGroups?: boolean;
}

export interface DirectLdapIdentity {
  subjectId: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  groups: string[];
}

export interface LdapClientLike {
  bind(dn: string, password: string): Promise<void>;
  search(baseDn: string, options: { scope: 'sub'; filter: string; attributes: string[]; sizeLimit: number; timeLimit: number }): Promise<{ searchEntries: Array<Record<string, unknown> & { dn?: string }> }>;
  unbind(): Promise<void>;
}

type LdapClientFactory = (url: string) => LdapClientLike;
const defaultClientFactory: LdapClientFactory = (url) => new Client({ url, timeout: 10_000, connectTimeout: 10_000, tlsOptions: { rejectUnauthorized: true } });
let clientFactory: LdapClientFactory = defaultClientFactory;

export function setLdapClientFactoryForTest(factory?: LdapClientFactory): void {
  clientFactory = factory || defaultClientFactory;
}

function values(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(raw.map((item) => String(item).trim()).filter(Boolean))];
}

function required(value: unknown, field: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw new Error(`LDAP ${field} is required`);
  return result;
}

function escapeFilter(value: string): string {
  return value.replace(/\\/g, '\\5c').replace(/\*/g, '\\2a').replace(/\(/g, '\\28').replace(/\)/g, '\\29').replace(/\0/g, '\\00');
}

function configuration(provider: IdentityProvider): LdapConfiguration {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(provider.configurationJson) as Record<string, unknown>; } catch { throw new Error('LDAP provider configuration is invalid'); }
  const url = required(raw.url, 'url');
  if (!url.startsWith('ldaps://')) throw new Error('LDAP URL must use LDAPS');
  const membershipMode = raw.membershipMode === 'group_search' ? 'group_search' : raw.membershipMode === 'memberOf' ? 'memberOf' : null;
  if (!membershipMode) throw new Error('LDAP membershipMode must be memberOf or group_search');
  return { url, bindDn: required(raw.bindDn, 'bindDn'), bindPasswordRef: required(raw.bindPasswordRef, 'bindPasswordRef'), userBaseDn: required(raw.userBaseDn, 'userBaseDn'), userSearchFilter: required(raw.userSearchFilter, 'userSearchFilter'), userEnumerationFilter: typeof raw.userEnumerationFilter === 'string' && raw.userEnumerationFilter.trim() ? raw.userEnumerationFilter.trim() : '(objectClass=person)', pageSize: Number.isInteger(raw.pageSize) && Number(raw.pageSize) > 0 ? Math.min(Number(raw.pageSize), 1000) : 200, subjectAttribute: typeof raw.subjectAttribute === 'string' && raw.subjectAttribute.trim() ? raw.subjectAttribute.trim() : 'entryUUID', emailAttribute: typeof raw.emailAttribute === 'string' && raw.emailAttribute.trim() ? raw.emailAttribute.trim() : 'mail', groupBaseDn: required(raw.groupBaseDn, 'groupBaseDn'), groupIdAttribute: required(raw.groupIdAttribute, 'groupIdAttribute'), membershipMode, nestedGroups: raw.nestedGroups === true };
}

function userFilter(template: string, username: string): string {
  if (!template.includes('{username}')) throw new Error('LDAP userSearchFilter must contain {username}');
  return template.split('{username}').join(escapeFilter(username));
}

function first(entry: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = values(entry[key])[0];
    if (value) return value;
  }
  return null;
}

class DirectLdapIdentityService {
  async authenticate(provider: IdentityProvider, username: string, password: string): Promise<DirectLdapIdentity> {
    if (provider.protocol !== 'ldap' || provider.authenticationMode !== 'direct' || !provider.isEnabled) throw new Error('LDAP direct authentication is not available for this provider');
    const config = configuration(provider);
    if (config.nestedGroups) throw new Error('Nested LDAP groups are not supported by direct LDAP authentication yet');
    if (!username.trim() || !password) throw new Error('LDAP username and password are required');
    const filter = userFilter(config.userSearchFilter, username.trim());
    const client = clientFactory(config.url);
    try {
      const bindPassword = secretResolver.resolveStored(config.bindPasswordRef.startsWith('ref:') ? config.bindPasswordRef : `ref:${config.bindPasswordRef}`);
      if (!bindPassword) throw new Error('LDAP bind password reference is unavailable');
      await client.bind(config.bindDn, bindPassword);
      const result = await client.search(config.userBaseDn, { scope: 'sub', filter, attributes: ['entryUUID', 'objectGUID', 'uid', 'mail', 'cn', 'givenName', 'sn', 'memberOf'], sizeLimit: 2, timeLimit: 5 });
      if (result.searchEntries.length !== 1) throw new Error('LDAP user lookup did not return exactly one entry');
      const entry = result.searchEntries[0];
      const userDn = first(entry, 'dn') || entry.dn || null;
      if (!userDn) throw new Error('LDAP user entry did not include a DN');
      await client.bind(userDn, password);
      await client.bind(config.bindDn, bindPassword);
      const groups = config.membershipMode === 'memberOf'
        ? values(entry.memberOf)
        : await this.groupsForEntry(client, config, userDn);
      const subjectId = first(entry, 'entryUUID', 'objectGUID', 'uid') || userDn;
      const email = first(entry, 'mail') || username.trim().toLowerCase();
      return { subjectId, email, displayName: first(entry, 'cn'), firstName: first(entry, 'givenName'), lastName: first(entry, 'sn'), groups };
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  private async groupsForEntry(client: LdapClientLike, config: LdapConfiguration, userDn: string): Promise<string[]> {
    const result = await client.search(config.groupBaseDn, { scope: 'sub', filter: `(member=${escapeFilter(userDn)})`, attributes: [config.groupIdAttribute], sizeLimit: 1_000, timeLimit: 5 });
    return [...new Set(result.searchEntries.flatMap((entry) => values(entry[config.groupIdAttribute])))];
  }
}

export const directLdapIdentityService = new DirectLdapIdentityService();
