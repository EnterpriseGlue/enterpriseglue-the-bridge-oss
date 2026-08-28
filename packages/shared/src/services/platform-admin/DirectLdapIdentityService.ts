import { Client } from 'ldapts';
import type { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { secretResolver } from './SecretResolver.js';
import { IdentityProviderFailure, classifyIdentityProviderFailure } from './IdentityProviderFailure.js';
import { validateIdentityProviderEndpointUrl } from './IdentityProviderEndpointPolicy.js';

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
  tlsTrustRef?: string;
}

export interface DirectLdapIdentity {
  subjectId: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  groups: string[];
}

export interface LdapDirectoryPage { identities: DirectLdapIdentity[]; nextCursor: null; }

const DEFAULT_LDAP_RECONCILIATION_IDENTITY_LIMIT = 10_000;
const MAX_LDAP_RECONCILIATION_IDENTITY_LIMIT = 50_000;
const DEFAULT_LDAP_GROUP_SEARCH_QUERY_LIMIT = 100;
const MAX_LDAP_GROUP_SEARCH_QUERY_LIMIT = 1_000;
const DEFAULT_LDAP_GROUP_SEARCH_RESULT_LIMIT = 5_000;
const MAX_LDAP_GROUP_SEARCH_RESULT_LIMIT = 10_000;
const DEFAULT_LDAP_RECONCILIATION_GROUP_QUERY_LIMIT = 10_000;
const MAX_LDAP_RECONCILIATION_GROUP_QUERY_LIMIT = 100_000;
const DEFAULT_LDAP_RECONCILIATION_GROUP_RESULT_LIMIT = 100_000;
const MAX_LDAP_RECONCILIATION_GROUP_RESULT_LIMIT = 500_000;
const DEFAULT_LDAP_RECONCILIATION_CONCURRENCY = 4;
const MAX_LDAP_RECONCILIATION_CONCURRENCY = 16;

function boundedPositiveEnvironment(name: string, defaultValue: number, maximum: number): number {
  const configured = Number(process.env[name]);
  if (!Number.isInteger(configured) || configured <= 0) return defaultValue;
  return Math.min(configured, maximum);
}

function reconciliationIdentityLimit(): number {
  return boundedPositiveEnvironment('EG_LDAP_RECONCILIATION_IDENTITY_LIMIT', DEFAULT_LDAP_RECONCILIATION_IDENTITY_LIMIT, MAX_LDAP_RECONCILIATION_IDENTITY_LIMIT);
}

interface LdapGroupSearchBudget {
  label: string;
  queryLimit: number;
  resultLimit: number;
  queries: number;
  results: number;
}

function groupSearchBudget(label: string, queryLimit: number, resultLimit: number): LdapGroupSearchBudget {
  return { label, queryLimit, resultLimit, queries: 0, results: 0 };
}

function perIdentityGroupSearchBudget(): LdapGroupSearchBudget {
  return groupSearchBudget(
    'LDAP group search',
    boundedPositiveEnvironment('EG_LDAP_GROUP_SEARCH_QUERY_LIMIT', DEFAULT_LDAP_GROUP_SEARCH_QUERY_LIMIT, MAX_LDAP_GROUP_SEARCH_QUERY_LIMIT),
    boundedPositiveEnvironment('EG_LDAP_GROUP_SEARCH_RESULT_LIMIT', DEFAULT_LDAP_GROUP_SEARCH_RESULT_LIMIT, MAX_LDAP_GROUP_SEARCH_RESULT_LIMIT),
  );
}

function reconciliationGroupSearchBudget(): LdapGroupSearchBudget {
  return groupSearchBudget(
    'LDAP reconciliation group search',
    boundedPositiveEnvironment('EG_LDAP_RECONCILIATION_GROUP_QUERY_LIMIT', DEFAULT_LDAP_RECONCILIATION_GROUP_QUERY_LIMIT, MAX_LDAP_RECONCILIATION_GROUP_QUERY_LIMIT),
    boundedPositiveEnvironment('EG_LDAP_RECONCILIATION_GROUP_RESULT_LIMIT', DEFAULT_LDAP_RECONCILIATION_GROUP_RESULT_LIMIT, MAX_LDAP_RECONCILIATION_GROUP_RESULT_LIMIT),
  );
}

function consumeGroupQuery(budgets: LdapGroupSearchBudget[]): void {
  for (const budget of budgets) {
    budget.queries += 1;
    if (budget.queries > budget.queryLimit) throw new Error(`${budget.label} exceeded the configured ${budget.queryLimit}-query safety limit`);
  }
}

function consumeGroupResults(budgets: LdapGroupSearchBudget[], count: number): void {
  for (const budget of budgets) {
    budget.results += count;
    if (budget.results > budget.resultLimit) throw new Error(`${budget.label} exceeded the configured ${budget.resultLimit}-result safety limit`);
  }
}

async function mapWithBoundedConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failure: unknown;
  const worker = async () => {
    while (failure === undefined) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try { results[index] = await mapper(items[index]); } catch (error) { failure ??= error; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, worker));
  if (failure !== undefined) throw failure;
  return results;
}

export interface LdapClientLike {
  bind(dn: string, password: string): Promise<void>;
  search(baseDn: string, options: { scope: 'sub'; filter: string; attributes: string[]; sizeLimit: number; timeLimit: number }): Promise<{ searchEntries: Array<Record<string, unknown> & { dn?: string }> }>;
  searchPaginated?(baseDn: string, options: { scope: 'sub'; filter: string; attributes: string[]; paged: { pageSize: number }; timeLimit: number }): AsyncGenerator<{ searchEntries: Array<Record<string, unknown> & { dn?: string }> }>;
  unbind(): Promise<void>;
}

type LdapClientFactory = (url: string, tlsCa?: string) => LdapClientLike;
const defaultClientFactory: LdapClientFactory = (url, tlsCa) => new Client({
  url,
  timeout: 10_000,
  connectTimeout: 10_000,
  tlsOptions: { rejectUnauthorized: true, ...(tlsCa ? { ca: tlsCa } : {}) },
});
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

function ldapBindError(error: unknown, subject: 'service' | 'user'): Error {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = Number(candidate?.code);
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  if (code === 49 || /(?:invalid credentials|code:\s*0x31)/i.test(message)) {
    return new IdentityProviderFailure('invalid_credentials', `LDAP ${subject} credentials were rejected`, { cause: error });
  }
  return error instanceof Error ? error : new Error(`LDAP ${subject} bind failed`);
}

function configuration(provider: IdentityProvider): LdapConfiguration {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(provider.configurationJson) as Record<string, unknown>; } catch { throw new Error('LDAP provider configuration is invalid'); }
  const url = validateIdentityProviderEndpointUrl(required(raw.url, 'url'), 'LDAP URL', ['ldaps:']).toString();
  const membershipMode = raw.membershipMode === 'group_search' ? 'group_search' : raw.membershipMode === 'memberOf' ? 'memberOf' : null;
  if (!membershipMode) throw new Error('LDAP membershipMode must be memberOf or group_search');
  const tlsTrustRef = typeof raw.tlsTrustRef === 'string' && raw.tlsTrustRef.trim() ? raw.tlsTrustRef.trim() : undefined;
  return { url, bindDn: required(raw.bindDn, 'bindDn'), bindPasswordRef: required(raw.bindPasswordRef, 'bindPasswordRef'), userBaseDn: required(raw.userBaseDn, 'userBaseDn'), userSearchFilter: required(raw.userSearchFilter, 'userSearchFilter'), userEnumerationFilter: typeof raw.userEnumerationFilter === 'string' && raw.userEnumerationFilter.trim() ? raw.userEnumerationFilter.trim() : '(objectClass=person)', pageSize: Number.isInteger(raw.pageSize) && Number(raw.pageSize) > 0 ? Math.min(Number(raw.pageSize), 1000) : 200, subjectAttribute: typeof raw.subjectAttribute === 'string' && raw.subjectAttribute.trim() ? raw.subjectAttribute.trim() : 'entryUUID', emailAttribute: typeof raw.emailAttribute === 'string' && raw.emailAttribute.trim() ? raw.emailAttribute.trim() : 'mail', groupBaseDn: required(raw.groupBaseDn, 'groupBaseDn'), groupIdAttribute: required(raw.groupIdAttribute, 'groupIdAttribute'), membershipMode, nestedGroups: raw.nestedGroups === true, tlsTrustRef };
}

async function resolveLdapSecret(
  provider: IdentityProvider,
  reference: string,
  purpose: 'ldap.bind_password' | 'ldap.tls_trust_certificate',
): Promise<string | null> {
  const stored = reference.startsWith('ref:') ? reference : `ref:${reference}`;
  if (!stored.includes('tenant-secret://')) return secretResolver.resolveStored(stored);
  if (!provider.tenantId) throw new Error('LDAP tenant secret context is unavailable');
  return secretResolver.resolveTenantStored(stored, { tenantId: provider.tenantId, purpose });
}

async function tlsTrust(provider: IdentityProvider, config: LdapConfiguration): Promise<string | undefined> {
  if (!config.tlsTrustRef) return undefined;
  let certificate: string | null;
  try {
    certificate = await resolveLdapSecret(provider, config.tlsTrustRef, 'ldap.tls_trust_certificate');
  } catch {
    throw new Error('LDAP TLS trust reference is unavailable');
  }
  if (!certificate) throw new Error('LDAP TLS trust reference is unavailable');
  return certificate;
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
  async listDirectoryPage(provider: IdentityProvider): Promise<LdapDirectoryPage> {
    if (provider.protocol !== 'ldap' || !provider.isEnabled) throw new Error('LDAP directory reconciliation is not available for this provider');
    const config = configuration(provider);
    let client: LdapClientLike | null = null;
    try {
      const connectedClient = clientFactory(config.url, await tlsTrust(provider, config));
      client = connectedClient;
      const password = await resolveLdapSecret(provider, config.bindPasswordRef, 'ldap.bind_password');
      if (!password) throw new Error('LDAP bind password reference is unavailable');
      try { await connectedClient.bind(config.bindDn, password); } catch (error) { throw ldapBindError(error, 'service'); }
      const entries = await this.enumerateUsers(connectedClient, config);
      const sharedGroupBudget = reconciliationGroupSearchBudget();
      const concurrency = boundedPositiveEnvironment('EG_LDAP_RECONCILIATION_CONCURRENCY', DEFAULT_LDAP_RECONCILIATION_CONCURRENCY, MAX_LDAP_RECONCILIATION_CONCURRENCY);
      const identities = await mapWithBoundedConcurrency(entries, concurrency, async (entry) => {
        const dn = first(entry, 'dn') || entry.dn || '';
        const groups = config.membershipMode === 'memberOf'
          ? values(entry.memberOf)
          : await this.groupsForEntry(connectedClient, config, dn, [sharedGroupBudget]);
        return { subjectId: first(entry, config.subjectAttribute, 'entryUUID', 'objectGUID', 'uid') || dn, email: first(entry, config.emailAttribute, 'mail') || '', displayName: first(entry, 'cn'), firstName: first(entry, 'givenName'), lastName: first(entry, 'sn'), groups };
      });
      return { identities: identities.filter((identity) => identity.subjectId && identity.email.includes('@')), nextCursor: null };
    } catch (error) {
      throw classifyIdentityProviderFailure(error);
    } finally { await client?.unbind().catch(() => undefined); }
  }

  private async enumerateUsers(client: LdapClientLike, config: LdapConfiguration): Promise<Array<Record<string, unknown> & { dn?: string }>> {
    const attributes = [config.subjectAttribute, config.emailAttribute, 'cn', 'givenName', 'sn', 'memberOf'];
    const identityLimit = reconciliationIdentityLimit();
    if (!client.searchPaginated) throw new Error('LDAP authoritative reconciliation requires paged directory search support; reconciliation stopped without applying removals');
    const entries: Array<Record<string, unknown> & { dn?: string }> = [];
    for await (const page of client.searchPaginated(config.userBaseDn, {
      scope: 'sub', filter: config.userEnumerationFilter, attributes, paged: { pageSize: config.pageSize }, timeLimit: 10,
    })) {
      if (entries.length + page.searchEntries.length > identityLimit) {
        throw new Error(`LDAP directory enumeration exceeded the configured ${identityLimit}-identity safety limit; reconciliation stopped without applying removals`);
      }
      entries.push(...page.searchEntries);
    }
    return entries;
  }

  async authenticate(provider: IdentityProvider, username: string, password: string): Promise<DirectLdapIdentity> {
    if (provider.protocol !== 'ldap' || provider.authenticationMode !== 'direct' || !provider.isEnabled) throw new Error('LDAP direct authentication is not available for this provider');
    const config = configuration(provider);
    if (config.nestedGroups && config.membershipMode !== 'group_search') throw new Error('Nested LDAP groups require group_search membership mode');
    if (!username.trim() || !password) throw new Error('LDAP username and password are required');
    const filter = userFilter(config.userSearchFilter, username.trim());
    let client: LdapClientLike | null = null;
    try {
      const connectedClient = clientFactory(config.url, await tlsTrust(provider, config));
      client = connectedClient;
      const bindPassword = await resolveLdapSecret(provider, config.bindPasswordRef, 'ldap.bind_password');
      if (!bindPassword) throw new Error('LDAP bind password reference is unavailable');
      try { await connectedClient.bind(config.bindDn, bindPassword); } catch (error) { throw ldapBindError(error, 'service'); }
      const result = await connectedClient.search(config.userBaseDn, { scope: 'sub', filter, attributes: ['entryUUID', 'objectGUID', 'uid', 'mail', 'cn', 'givenName', 'sn', 'memberOf'], sizeLimit: 2, timeLimit: 5 });
      if (result.searchEntries.length !== 1) throw new Error('LDAP user lookup did not return exactly one entry');
      const entry = result.searchEntries[0];
      const userDn = first(entry, 'dn') || entry.dn || null;
      if (!userDn) throw new Error('LDAP user entry did not include a DN');
      try { await connectedClient.bind(userDn, password); } catch (error) { throw ldapBindError(error, 'user'); }
      try { await connectedClient.bind(config.bindDn, bindPassword); } catch (error) { throw ldapBindError(error, 'service'); }
      const groups = config.membershipMode === 'memberOf'
        ? values(entry.memberOf)
        : await this.groupsForEntry(connectedClient, config, userDn);
      const subjectId = first(entry, 'entryUUID', 'objectGUID', 'uid') || userDn;
      const email = first(entry, 'mail') || username.trim().toLowerCase();
      return { subjectId, email, displayName: first(entry, 'cn'), firstName: first(entry, 'givenName'), lastName: first(entry, 'sn'), groups };
    } catch (error) {
      throw classifyIdentityProviderFailure(error);
    } finally {
      await client?.unbind().catch(() => undefined);
    }
  }

  private async groupsForEntry(client: LdapClientLike, config: LdapConfiguration, userDn: string, sharedBudgets: LdapGroupSearchBudget[] = []): Promise<string[]> {
    const identityBudget = perIdentityGroupSearchBudget();
    const budgets = [identityBudget, ...sharedBudgets];
    const ids = new Set<string>(); const seenDns = new Set<string>(); const searchedDns = new Set<string>(); let frontier = [userDn];
    for (let depth = 0; frontier.length && depth < (config.nestedGroups ? 10 : 1); depth += 1) {
      const next: string[] = [];
      for (const memberDn of frontier) {
        if (searchedDns.has(memberDn)) continue;
        searchedDns.add(memberDn);
        consumeGroupQuery(budgets);
        const remainingResults = Math.min(...budgets.map((budget) => budget.resultLimit - budget.results));
        const result = await client.search(config.groupBaseDn, { scope: 'sub', filter: `(member=${escapeFilter(memberDn)})`, attributes: [config.groupIdAttribute], sizeLimit: Math.min(1_000, Math.max(1, remainingResults + 1)), timeLimit: 5 });
        consumeGroupResults(budgets, result.searchEntries.length);
        for (const entry of result.searchEntries) {
          values(entry[config.groupIdAttribute]).forEach((id) => ids.add(id));
          if (ids.size > identityBudget.resultLimit) throw new Error(`LDAP group search exceeded the configured ${identityBudget.resultLimit}-group safety limit`);
          const dn = first(entry, 'dn') || entry.dn;
          if (dn && !seenDns.has(dn)) { seenDns.add(dn); next.push(dn); }
        }
      }
      frontier = [...new Set(next)];
    }
    if (config.nestedGroups && frontier.some((dn) => !searchedDns.has(dn))) {
      throw new Error('LDAP nested group search exceeded the configured depth safety limit');
    }
    return [...ids];
  }
}

export const directLdapIdentityService = new DirectLdapIdentityService();
