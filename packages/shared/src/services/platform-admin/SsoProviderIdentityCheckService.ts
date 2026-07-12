import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { SsoProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoProvider.js';
import { SsoNormalizedIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoNormalizedIdentity.js';
import type { SsoClaims } from './SsoClaimsMappingService.js';

export type SsoProviderIdentityStatus = 'active' | 'inactive' | 'deleted' | 'unsupported' | 'unknown';

export interface SsoProviderIdentityCheckResult {
  status: SsoProviderIdentityStatus;
  reason: string;
  checkedAt: number;
  details?: Record<string, unknown>;
  profile?: {
    email?: string | null;
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  };
}

export type SsoProviderGroupStatus = 'active' | 'deleted' | 'unsupported' | 'unknown';

export interface SsoProviderGroupCheckInput {
  providerId?: string | null;
  providerType?: string | null;
  providerTenantId?: string | null;
  groupClaimValue: string;
}

export interface SsoProviderGroupCheckResult {
  status: SsoProviderGroupStatus;
  reason: string;
  checkedAt: number;
  details?: Record<string, unknown>;
  group?: {
    id?: string | null;
    displayName?: string | null;
  };
}

export type SsoProviderClaimsRefreshStatus = 'refreshed' | 'unsupported' | 'unknown';

export interface SsoProviderClaimsRefreshResult {
  status: SsoProviderClaimsRefreshStatus;
  reason: string;
  checkedAt: number;
  claims?: SsoClaims;
  details?: Record<string, unknown>;
}

interface MicrosoftProviderConfig {
  clientId: string | null;
  clientSecret: string | null;
  tenantId: string | null;
  providerType: string;
}

function decryptSecret(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  if (!encrypted.startsWith('enc:')) return encrypted;
  return Buffer.from(encrypted.slice(4), 'base64').toString('utf-8');
}

function normalizeProviderType(providerType: string | null | undefined, providerId: string): string {
  return (providerType || providerId || '').trim().toLowerCase();
}

function isMicrosoftProvider(providerType: string, providerId: string): boolean {
  return providerType === 'microsoft' || providerId === 'microsoft';
}

function isSnapshotRefreshProvider(providerType: string, providerId: string): boolean {
  return ['saml', 'oidc', 'google'].includes(providerType) || ['saml', 'oidc', 'google'].includes(providerId);
}

function providerLabel(providerType: string, providerId: string): string {
  if (providerType === 'saml' || providerId === 'saml') return 'SAML';
  if (providerType === 'oidc' || providerId === 'oidc') return 'OIDC';
  if (providerType === 'google' || providerId === 'google') return 'Google';
  return providerType || providerId || 'SSO';
}

function graphUserUrl(subject: string): string {
  const encoded = encodeURIComponent(subject);
  return `https://graph.microsoft.com/v1.0/users/${encoded}?$select=id,accountEnabled,mail,userPrincipalName,displayName,givenName,surname`;
}

function graphGroupUrl(groupId: string): string {
  const encoded = encodeURIComponent(groupId);
  return `https://graph.microsoft.com/v1.0/groups/${encoded}?$select=id,displayName,securityEnabled,mailEnabled`;
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

function graphGroupDisplayNameSearchUrl(displayName: string): string {
  const params = new URLSearchParams({
    '$filter': `displayName eq '${escapeODataString(displayName)}'`,
    '$select': 'id,displayName,securityEnabled,mailEnabled',
    '$top': '2',
  });
  return `https://graph.microsoft.com/v1.0/groups?${params.toString()}`;
}

function graphUserMemberGroupsUrl(subject: string): string {
  const encoded = encodeURIComponent(subject);
  return `https://graph.microsoft.com/v1.0/users/${encoded}/getMemberGroups`;
}

function graphServicePrincipalsByAppIdUrl(appId: string): string {
  const params = new URLSearchParams({
    '$filter': `appId eq '${escapeODataString(appId)}'`,
    '$select': 'id,appId,appRoles',
    '$top': '2',
  });
  return `https://graph.microsoft.com/v1.0/servicePrincipals?${params.toString()}`;
}

function graphUserAppRoleAssignmentsUrl(subject: string): string {
  const encoded = encodeURIComponent(subject);
  const params = new URLSearchParams({
    '$select': 'appRoleId,resourceId',
    '$top': '999',
  });
  return `https://graph.microsoft.com/v1.0/users/${encoded}/appRoleAssignments?${params.toString()}`;
}

function looksLikeMicrosoftObjectId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
}

class SsoProviderIdentityCheckServiceClass {
  async checkIdentity(identity: SsoNormalizedIdentity): Promise<SsoProviderIdentityCheckResult> {
    const providerType = normalizeProviderType(identity.providerType, identity.providerId);
    if (isMicrosoftProvider(providerType, identity.providerId)) {
      return this.checkMicrosoftIdentity(identity);
    }

    return {
      status: 'unsupported',
      reason: `Provider type ${providerType || 'unknown'} does not support live identity checks yet`,
      checkedAt: Date.now(),
      details: {
        providerId: identity.providerId,
        providerType,
      },
    };
  }

  async checkGroup(input: SsoProviderGroupCheckInput): Promise<SsoProviderGroupCheckResult> {
    const providerId = input.providerId?.trim() || '';
    const providerType = normalizeProviderType(input.providerType, providerId);
    if (providerId || isMicrosoftProvider(providerType, providerId)) {
      return this.checkMicrosoftGroup(input);
    }

    return {
      status: 'unsupported',
      reason: `Provider type ${providerType || 'unknown'} does not support live group checks yet`,
      checkedAt: Date.now(),
      details: {
        providerId: input.providerId || null,
        providerType,
      },
    };
  }

  async refreshClaims(identity: SsoNormalizedIdentity, currentClaims: SsoClaims): Promise<SsoProviderClaimsRefreshResult> {
    const providerType = normalizeProviderType(identity.providerType, identity.providerId);
    if (isMicrosoftProvider(providerType, identity.providerId)) {
      return this.refreshMicrosoftClaims(identity, currentClaims);
    }
    if (isSnapshotRefreshProvider(providerType, identity.providerId)) {
      return this.refreshSnapshotClaims(identity, currentClaims, providerType);
    }

    return {
      status: 'unsupported',
      reason: `Provider type ${providerType || 'unknown'} does not support live claim refresh yet`,
      checkedAt: Date.now(),
      details: {
        providerId: identity.providerId,
        providerType,
      },
    };
  }

  private async refreshSnapshotClaims(
    identity: SsoNormalizedIdentity,
    currentClaims: SsoClaims,
    providerType: string
  ): Promise<SsoProviderClaimsRefreshResult> {
    const groups = normalizeStringArray(currentClaims.groups);
    const roles = normalizeStringArray(currentClaims.roles);
    const claims: SsoClaims = {
      ...currentClaims,
      groups,
      roles,
    };
    if (!claims.email && identity.email) {
      claims.email = identity.email;
    }

    return {
      status: 'refreshed',
      reason: `${providerLabel(providerType, identity.providerId)} claims refreshed from the latest normalized login snapshot`,
      checkedAt: Date.now(),
      claims,
      details: {
        providerId: identity.providerId,
        providerType,
        refreshMode: 'normalized_identity_snapshot',
        liveRefreshSupported: false,
        groupsCount: groups.length,
        rolesCount: roles.length,
        lastSeenAt: Number(identity.lastSeenAt),
      },
    };
  }

  private async checkMicrosoftIdentity(identity: SsoNormalizedIdentity): Promise<SsoProviderIdentityCheckResult> {
    const { clientId, clientSecret, tenantId } = await this.resolveMicrosoftProviderConfig(
      identity.providerId,
      identity.providerTenantId
    );

    if (!clientId || !clientSecret || !tenantId) {
      return {
        status: 'unsupported',
        reason: 'Microsoft identity check requires client id, client secret, and tenant id',
        checkedAt: Date.now(),
        details: {
          providerId: identity.providerId,
          hasClientId: Boolean(clientId),
          hasClientSecret: Boolean(clientSecret),
          hasTenantId: Boolean(tenantId),
        },
      };
    }

    try {
      const tokenResult = await this.requestMicrosoftGraphToken(clientId, clientSecret, tenantId);
      if (!tokenResult.accessToken) {
        return {
          status: 'unknown',
          reason: tokenResult.reason,
          checkedAt: Date.now(),
          details: tokenResult.details,
        };
      }

      const userResponse = await fetch(graphUserUrl(identity.providerSubject), {
        method: 'GET',
        headers: {
          authorization: `Bearer ${tokenResult.accessToken}`,
          accept: 'application/json',
        },
      });
      if (userResponse.status === 404) {
        return {
          status: 'deleted',
          reason: 'Microsoft Graph user lookup returned 404',
          checkedAt: Date.now(),
        };
      }
      if (!userResponse.ok) {
        return {
          status: 'unknown',
          reason: `Microsoft Graph user lookup failed with HTTP ${userResponse.status}`,
          checkedAt: Date.now(),
          details: { status: userResponse.status },
        };
      }
      const user = await userResponse.json() as {
        id?: string;
        accountEnabled?: boolean;
        mail?: string | null;
        userPrincipalName?: string | null;
        displayName?: string | null;
        givenName?: string | null;
        surname?: string | null;
      };
      const email = user.mail || user.userPrincipalName || null;
      return {
        status: user.accountEnabled === false ? 'inactive' : 'active',
        reason: user.accountEnabled === false
          ? 'Microsoft Graph user is disabled'
          : 'Microsoft Graph user is active',
        checkedAt: Date.now(),
        details: {
          id: user.id,
          email,
          displayName: user.displayName || null,
        },
        profile: {
          email,
          displayName: user.displayName || null,
          firstName: user.givenName || null,
          lastName: user.surname || null,
        },
      };
    } catch (error) {
      return {
        status: 'unknown',
        reason: error instanceof Error ? error.message : 'Microsoft identity check failed',
        checkedAt: Date.now(),
      };
    }
  }

  private async checkMicrosoftGroup(input: SsoProviderGroupCheckInput): Promise<SsoProviderGroupCheckResult> {
    const claimValue = input.groupClaimValue.trim();
    if (!claimValue) {
      return {
        status: 'unsupported',
        reason: 'Microsoft group check requires a non-empty group claim value',
        checkedAt: Date.now(),
        details: {
          providerId: input.providerId || null,
          claimValue: input.groupClaimValue,
        },
      };
    }

    const { clientId, clientSecret, tenantId, providerType } = await this.resolveMicrosoftProviderConfig(
      input.providerId || 'microsoft',
      input.providerTenantId
    );

    if (!isMicrosoftProvider(providerType, input.providerId || '')) {
      return {
        status: 'unsupported',
        reason: `Provider type ${providerType || 'unknown'} does not support live group checks yet`,
        checkedAt: Date.now(),
        details: {
          providerId: input.providerId || null,
          providerType,
        },
      };
    }

    if (!clientId || !clientSecret || !tenantId) {
      return {
        status: 'unsupported',
        reason: 'Microsoft group check requires client id, client secret, and tenant id',
        checkedAt: Date.now(),
        details: {
          providerId: input.providerId || null,
          hasClientId: Boolean(clientId),
          hasClientSecret: Boolean(clientSecret),
          hasTenantId: Boolean(tenantId),
        },
      };
    }

    try {
      const tokenResult = await this.requestMicrosoftGraphToken(clientId, clientSecret, tenantId);
      if (!tokenResult.accessToken) {
        return {
          status: 'unknown',
          reason: tokenResult.reason,
          checkedAt: Date.now(),
          details: tokenResult.details,
        };
      }

      if (!looksLikeMicrosoftObjectId(claimValue)) {
        const groupSearchResponse = await fetch(graphGroupDisplayNameSearchUrl(claimValue), {
          method: 'GET',
          headers: {
            authorization: `Bearer ${tokenResult.accessToken}`,
            accept: 'application/json',
          },
        });
        if (!groupSearchResponse.ok) {
          return {
            status: 'unknown',
            reason: `Microsoft Graph group displayName lookup failed with HTTP ${groupSearchResponse.status}`,
            checkedAt: Date.now(),
            details: {
              status: groupSearchResponse.status,
              lookupMode: 'displayName',
              displayName: claimValue,
            },
          };
        }
        const search = await groupSearchResponse.json() as {
          value?: Array<{ id?: string; displayName?: string | null }>;
        };
        const matches = Array.isArray(search.value) ? search.value : [];
        if (matches.length === 0) {
          return {
            status: 'deleted',
            reason: 'Microsoft Graph group displayName lookup returned no exact matches',
            checkedAt: Date.now(),
            details: {
              lookupMode: 'displayName',
              displayName: claimValue,
              matchesCount: 0,
            },
          };
        }
        if (matches.length > 1) {
          return {
            status: 'unknown',
            reason: 'Microsoft Graph group displayName lookup returned multiple matches',
            checkedAt: Date.now(),
            details: {
              lookupMode: 'displayName',
              displayName: claimValue,
              matchesCount: matches.length,
            },
          };
        }
        const [group] = matches;
        return {
          status: 'active',
          reason: 'Microsoft Graph group displayName lookup matched one group',
          checkedAt: Date.now(),
          details: {
            lookupMode: 'displayName',
            id: group.id,
            displayName: group.displayName || null,
            matchesCount: 1,
          },
          group: {
            id: group.id || null,
            displayName: group.displayName || null,
          },
        };
      }

      const groupResponse = await fetch(graphGroupUrl(claimValue), {
        method: 'GET',
        headers: {
          authorization: `Bearer ${tokenResult.accessToken}`,
          accept: 'application/json',
        },
      });
      if (groupResponse.status === 404) {
        return {
          status: 'deleted',
          reason: 'Microsoft Graph group lookup returned 404',
          checkedAt: Date.now(),
        };
      }
      if (!groupResponse.ok) {
        return {
          status: 'unknown',
          reason: `Microsoft Graph group lookup failed with HTTP ${groupResponse.status}`,
          checkedAt: Date.now(),
          details: { status: groupResponse.status },
        };
      }
      const group = await groupResponse.json() as {
        id?: string;
        displayName?: string | null;
      };
      return {
        status: 'active',
        reason: 'Microsoft Graph group exists',
        checkedAt: Date.now(),
        details: {
          id: group.id,
          displayName: group.displayName || null,
        },
        group: {
          id: group.id || null,
          displayName: group.displayName || null,
        },
      };
    } catch (error) {
      return {
        status: 'unknown',
        reason: error instanceof Error ? error.message : 'Microsoft group check failed',
        checkedAt: Date.now(),
      };
    }
  }

  private async refreshMicrosoftClaims(
    identity: SsoNormalizedIdentity,
    currentClaims: SsoClaims
  ): Promise<SsoProviderClaimsRefreshResult> {
    const { clientId, clientSecret, tenantId } = await this.resolveMicrosoftProviderConfig(
      identity.providerId,
      identity.providerTenantId
    );

    if (!clientId || !clientSecret || !tenantId) {
      return {
        status: 'unsupported',
        reason: 'Microsoft claim refresh requires client id, client secret, and tenant id',
        checkedAt: Date.now(),
        details: {
          providerId: identity.providerId,
          hasClientId: Boolean(clientId),
          hasClientSecret: Boolean(clientSecret),
          hasTenantId: Boolean(tenantId),
        },
      };
    }

    try {
      const tokenResult = await this.requestMicrosoftGraphToken(clientId, clientSecret, tenantId);
      if (!tokenResult.accessToken) {
        return {
          status: 'unknown',
          reason: tokenResult.reason,
          checkedAt: Date.now(),
          details: tokenResult.details,
        };
      }

      const groupsResponse = await fetch(graphUserMemberGroupsUrl(identity.providerSubject), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenResult.accessToken}`,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ securityEnabledOnly: false }),
      });
      if (!groupsResponse.ok) {
        return {
          status: 'unknown',
          reason: `Microsoft Graph member groups refresh failed with HTTP ${groupsResponse.status}`,
          checkedAt: Date.now(),
          details: { status: groupsResponse.status },
        };
      }
      const body = await groupsResponse.json() as { value?: unknown };
      const groups = normalizeStringArray(body.value);
      const currentRoles = normalizeStringArray(currentClaims.roles);
      const rolesRefresh = await this.refreshMicrosoftAppRoles(
        identity.providerSubject,
        clientId,
        tokenResult.accessToken,
        currentRoles
      );
      return {
        status: 'refreshed',
        reason: rolesRefresh.status === 'refreshed'
          ? 'Microsoft Graph member groups and app roles refreshed'
          : 'Microsoft Graph member groups refreshed',
        checkedAt: Date.now(),
        claims: {
          ...currentClaims,
          groups,
          roles: rolesRefresh.roles,
        },
        details: {
          groupsCount: groups.length,
          rolesCount: rolesRefresh.roles.length,
          rolesRefreshStatus: rolesRefresh.status,
          rolesRefreshReason: rolesRefresh.reason,
          preservedRolesCount: rolesRefresh.status === 'refreshed' ? 0 : currentRoles.length,
          ...(rolesRefresh.details || {}),
        },
      };
    } catch (error) {
      return {
        status: 'unknown',
        reason: error instanceof Error ? error.message : 'Microsoft claim refresh failed',
        checkedAt: Date.now(),
      };
    }
  }

  private async refreshMicrosoftAppRoles(
    userSubject: string,
    clientId: string,
    accessToken: string,
    currentRoles: string[]
  ): Promise<{
    status: 'refreshed' | 'unknown';
    reason: string;
    roles: string[];
    details?: Record<string, unknown>;
  }> {
    try {
      const servicePrincipalsResponse = await fetch(graphServicePrincipalsByAppIdUrl(clientId), {
        method: 'GET',
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
        },
      });
      if (!servicePrincipalsResponse.ok) {
        return {
          status: 'unknown',
          reason: `Microsoft Graph app-role service principal lookup failed with HTTP ${servicePrincipalsResponse.status}`,
          roles: currentRoles,
          details: {
            rolesLookupStatus: servicePrincipalsResponse.status,
          },
        };
      }

      const servicePrincipalsBody = await servicePrincipalsResponse.json() as {
        value?: Array<{
          id?: string | null;
          appRoles?: Array<{ id?: string | null; value?: string | null }>;
        }>;
      };
      const servicePrincipals = Array.isArray(servicePrincipalsBody.value) ? servicePrincipalsBody.value : [];
      if (servicePrincipals.length === 0) {
        return {
          status: 'unknown',
          reason: 'Microsoft Graph app-role service principal lookup returned no matches',
          roles: currentRoles,
          details: {
            servicePrincipalsCount: 0,
          },
        };
      }
      if (servicePrincipals.length > 1) {
        return {
          status: 'unknown',
          reason: 'Microsoft Graph app-role service principal lookup returned multiple matches',
          roles: currentRoles,
          details: {
            servicePrincipalsCount: servicePrincipals.length,
          },
        };
      }

      const servicePrincipal = servicePrincipals[0];
      if (!servicePrincipal?.id) {
        return {
          status: 'unknown',
          reason: 'Microsoft Graph app-role service principal lookup did not include an id',
          roles: currentRoles,
        };
      }
      const appRoleById = new Map<string, string>();
      for (const appRole of servicePrincipal.appRoles || []) {
        const id = String(appRole.id || '').trim();
        const value = String(appRole.value || '').trim();
        if (id && value) {
          appRoleById.set(id, value);
        }
      }

      const assignmentsResponse = await fetch(graphUserAppRoleAssignmentsUrl(userSubject), {
        method: 'GET',
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
        },
      });
      if (!assignmentsResponse.ok) {
        return {
          status: 'unknown',
          reason: `Microsoft Graph user app-role assignments lookup failed with HTTP ${assignmentsResponse.status}`,
          roles: currentRoles,
          details: {
            rolesLookupStatus: assignmentsResponse.status,
            servicePrincipalId: servicePrincipal.id,
          },
        };
      }

      const assignmentsBody = await assignmentsResponse.json() as {
        value?: Array<{ appRoleId?: string | null; resourceId?: string | null }>;
      };
      const assignments = Array.isArray(assignmentsBody.value) ? assignmentsBody.value : [];
      const roles = normalizeStringArray(assignments
        .filter((assignment) => assignment.resourceId === servicePrincipal.id)
        .map((assignment) => appRoleById.get(String(assignment.appRoleId || '').trim())));

      return {
        status: 'refreshed',
        reason: 'Microsoft Graph user app-role assignments refreshed',
        roles,
        details: {
          servicePrincipalId: servicePrincipal.id,
          appRoleAssignmentsCount: assignments.length,
          matchedAppRoleAssignmentsCount: roles.length,
        },
      };
    } catch (error) {
      return {
        status: 'unknown',
        reason: error instanceof Error ? error.message : 'Microsoft app-role refresh failed',
        roles: currentRoles,
      };
    }
  }

  private async resolveMicrosoftProviderConfig(providerId: string, providerTenantId?: string | null): Promise<MicrosoftProviderConfig> {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(SsoProvider);
    const providerById = providerId
      ? await providerRepo.findOne({
        where: { id: providerId },
        select: ['id', 'type', 'clientId', 'clientSecretEnc', 'tenantId'],
      })
      : null;
    const provider = providerById || (providerId === 'microsoft'
      ? await providerRepo.findOne({
        where: { type: 'microsoft' },
        select: ['id', 'type', 'clientId', 'clientSecretEnc', 'tenantId'],
      })
      : null);
    const providerType = normalizeProviderType(provider?.type, providerId);

    return {
      clientId: provider?.clientId || config.microsoftClientId || null,
      clientSecret: decryptSecret(provider?.clientSecretEnc) || config.microsoftClientSecret || null,
      tenantId: provider?.tenantId || providerTenantId || config.microsoftTenantId || null,
      providerType,
    };
  }

  private async requestMicrosoftGraphToken(
    clientId: string,
    clientSecret: string,
    tenantId: string
  ): Promise<{ accessToken: string | null; reason: string; details?: Record<string, unknown> }> {
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }),
    });
    if (!tokenResponse.ok) {
      return {
        accessToken: null,
        reason: `Microsoft token request failed with HTTP ${tokenResponse.status}`,
        details: { status: tokenResponse.status },
      };
    }
    const tokenBody = await tokenResponse.json() as { access_token?: string };
    if (!tokenBody.access_token) {
      return {
        accessToken: null,
        reason: 'Microsoft token response did not include an access token',
      };
    }
    return {
      accessToken: tokenBody.access_token,
      reason: 'Microsoft token request succeeded',
    };
  }
}

export const ssoProviderIdentityCheckService = new SsoProviderIdentityCheckServiceClass();
