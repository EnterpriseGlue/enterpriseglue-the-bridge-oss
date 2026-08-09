import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { externalIdentityKey, externalIdentityService } from './ExternalIdentityService.js';
import { authzGroupService } from './AuthzGroupService.js';
import { ssoNormalizedIdentityService } from './SsoNormalizedIdentityService.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityReconciliationCheckpoint } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityReconciliationCheckpoint.js';
import type { OidcIdentityClaims } from './GenericOidcService.js';
import type { IdentityProviderType } from './IdentityProviderAdapter.js';
import { hasIncompleteOidcGroupClaims } from './IdentityProviderAdapter.js';
import { ssoSyncDiagnosticsService } from './SsoSyncDiagnosticsService.js';
import { IsNull, MoreThan } from 'typeorm';

/** The canonical user snapshot returned after external identity reconciliation. */
export interface ProvisionedIdentityUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  /** Must be carried into the freshly issued browser session. */
  authSessionVersion: number;
}
export interface ProvisionIdentityInput {
  providerType: IdentityProviderType; subjectId: string; email: string; emailVerified: boolean; displayName?: string | null;
  firstName?: string | null; lastName?: string | null; directoryTenantId?: string | null; claims: Record<string, unknown>;
}
interface ProvisioningResult {
  user: ProvisionedIdentityUser;
  groupMembershipsCreated: number;
  groupMembershipsRemoved: number;
}
interface ReconciliationLeaseFence {
  providerId: string;
  leaseId: string;
}

function requiredEmail(claims: OidcIdentityClaims): string {
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : typeof claims.preferred_username === 'string' ? claims.preferred_username.trim().toLowerCase() : '';
  if (!email.includes('@')) throw new Error('OIDC ID token must contain an email address');
  return email;
}

function allowsVerifiedEmailLinking(provider: IdentityProvider): boolean {
  try {
    const configuration = JSON.parse(provider.configurationJson) as Record<string, unknown>;
    return configuration.allowVerifiedEmailLinking === true;
  } catch {
    return false;
  }
}

function authorizationAttributeKeys(provider: IdentityProvider): string[] {
  try {
    const keys = JSON.parse(provider.configurationJson).authorizationAttributeKeys;
    return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function oidcClaimsWithConfiguredGroups(provider: IdentityProvider, claims: OidcIdentityClaims): Record<string, unknown> {
  try {
    const groupClaim = JSON.parse(provider.configurationJson).groupClaim;
    if (typeof groupClaim !== 'string' || !groupClaim.trim() || groupClaim === 'groups') return claims as Record<string, unknown>;
    return { ...claims, groups: (claims as Record<string, unknown>)[groupClaim] };
  } catch {
    return claims as Record<string, unknown>;
  }
}

function configuredOidcDirectoryTenant(provider: IdentityProvider, claims: OidcIdentityClaims): string | null {
  const configuredTenant = typeof provider.directoryTenantId === 'string' ? provider.directoryTenantId.trim() : '';
  const claimedTenant = typeof claims.tid === 'string' ? claims.tid.trim() : '';
  // A tenant-specific issuer is the primary Entra boundary. This additional
  // comparison makes the configured directory tenant explicit and prevents a
  // future broad issuer configuration from silently accepting another tenant.
  if (configuredTenant && claimedTenant && configuredTenant !== claimedTenant) {
    throw new Error('OIDC ID token directory tenant does not match the configured identity provider');
  }
  return claimedTenant || configuredTenant || null;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  return ['23505', 'ER_DUP_ENTRY', 'SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_UNIQUE'].includes(code)
    || /duplicate (key|entry)|unique constraint/i.test(message);
}

class IdentityProviderProvisioningService {
  async provisionOidcUser(provider: IdentityProvider, claims: OidcIdentityClaims): Promise<ProvisionedIdentityUser> {
    return (await this.provision(provider, this.oidcInput(provider, claims))).user;
  }

  async reconcileOidcLogin(provider: IdentityProvider, claims: OidcIdentityClaims): Promise<ProvisionedIdentityUser> {
    return this.reconcileLogin(provider, this.oidcInput(provider, claims));
  }

  async provisionLdapUser(provider: IdentityProvider, input: Omit<ProvisionIdentityInput, 'providerType' | 'emailVerified'>): Promise<ProvisionedIdentityUser> {
    return (await this.provisionLdapUserForReconciliation(provider, input)).user;
  }

  async provisionLdapUserForReconciliation(
    provider: IdentityProvider,
    input: Omit<ProvisionIdentityInput, 'providerType' | 'emailVerified'>,
    leaseFence?: ReconciliationLeaseFence,
  ): Promise<ProvisioningResult> {
    return this.provision(provider, { ...input, providerType: 'ldap', emailVerified: true }, leaseFence);
  }

  async reconcileLdapLogin(provider: IdentityProvider, input: Omit<ProvisionIdentityInput, 'providerType' | 'emailVerified'>): Promise<ProvisionedIdentityUser> {
    return this.reconcileLogin(provider, { ...input, providerType: 'ldap', emailVerified: true });
  }

  async provisionSamlUser(provider: IdentityProvider, input: Omit<ProvisionIdentityInput, 'providerType' | 'emailVerified'>): Promise<ProvisionedIdentityUser> {
    return (await this.provision(provider, { ...input, providerType: 'saml', emailVerified: true })).user;
  }

  async reconcileSamlLogin(provider: IdentityProvider, input: Omit<ProvisionIdentityInput, 'providerType' | 'emailVerified'>): Promise<ProvisionedIdentityUser> {
    return this.reconcileLogin(provider, { ...input, providerType: 'saml', emailVerified: true });
  }

  private oidcInput(provider: IdentityProvider, claims: OidcIdentityClaims): ProvisionIdentityInput {
    const email = requiredEmail(claims);
    return { providerType: 'oidc', subjectId: claims.sub, email, emailVerified: claims.email_verified === true, displayName: typeof claims.name === 'string' ? claims.name : null, firstName: typeof claims.given_name === 'string' ? claims.given_name : null, lastName: typeof claims.family_name === 'string' ? claims.family_name : null, directoryTenantId: configuredOidcDirectoryTenant(provider, claims), claims: oidcClaimsWithConfiguredGroups(provider, claims) };
  }

  private async reconcileLogin(provider: IdentityProvider, input: ProvisionIdentityInput): Promise<ProvisionedIdentityUser> {
    const details = { source: 'identity_provider_reconciliation', protocol: input.providerType, mode: 'login' };
    const runId = await ssoSyncDiagnosticsService.startRun({ tenantId: provider.tenantId, providerId: provider.id, trigger: 'login', details });
    try {
      const reconciliation = await this.provision(provider, input);
      await ssoSyncDiagnosticsService.completeRun(runId, {
        tenantId: provider.tenantId, providerId: provider.id, userId: reconciliation.user.id,
        groupMembershipsCreated: reconciliation.groupMembershipsCreated,
        groupMembershipsRemoved: reconciliation.groupMembershipsRemoved,
        details,
      });
      return reconciliation.user;
    } catch (error) {
      await ssoSyncDiagnosticsService.failRun(runId, error, { tenantId: provider.tenantId, providerId: provider.id, details });
      throw error;
    }
  }

  private async provision(provider: IdentityProvider, input: ProvisionIdentityInput, leaseFence?: ReconciliationLeaseFence): Promise<ProvisioningResult> {
    // A new subject can arrive through a direct login while a scheduled directory
    // page is creating the same link. Retry the full transaction once after the
    // database's unique constraint resolves that first-writer race.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.provisionOnce(provider, input, leaseFence);
      } catch (error) {
        if (attempt === 0 && isUniqueConstraintError(error)) continue;
        throw error;
      }
    }
    throw new Error('Identity provisioning retry exhausted');
  }

  private async provisionOnce(provider: IdentityProvider, input: ProvisionIdentityInput, leaseFence?: ReconciliationLeaseFence): Promise<ProvisioningResult> {
    // A group-overage marker means the provider did not supply a complete group
    // result. Reject it before creating or updating any local identity state so
    // an authoritative mapping can never interpret it as an empty entitlement set.
    if (input.providerType === 'oidc' && hasIncompleteOidcGroupClaims(input.claims)) {
      throw new Error('OIDC group claims are incomplete; resolve group overage before synchronizing authorization');
    }
    const email = input.email.trim().toLowerCase();
    if (!email.includes('@')) throw new Error('Identity provider must return an email address');
    const emailVerified = input.emailVerified;
    const now = Date.now();
    const dataSource = await getDataSource();
    return dataSource.transaction(async (manager) => {
      const providerWhere = {
        id: provider.id,
        isEnabled: true,
        protocol: provider.protocol,
        authenticationMode: provider.authenticationMode,
        directoryTenantId: provider.directoryTenantId ?? IsNull(),
        configurationJson: provider.configurationJson,
        ...(Number.isFinite(Number(provider.updatedAt)) ? { updatedAt: provider.updatedAt } : {}),
      };
      // A conditional no-op update acquires the provider row for this
      // transaction. Disable/trust edits either happen first (and this fails)
      // or happen afterward and clean up everything this transaction wrote.
      const providerClaim = await manager.getRepository(IdentityProvider).update(providerWhere, { isEnabled: true });
      if (providerClaim.affected !== 1) {
        throw new Error('Identity provider changed or was disabled while sign-in was in progress');
      }
      if (leaseFence) {
        if (leaseFence.providerId !== provider.id) throw new Error('LDAP reconciliation lease does not match the identity provider');
        const leaseClaim = await manager.getRepository(IdentityReconciliationCheckpoint).update({
          providerId: provider.id,
          leaseId: leaseFence.leaseId,
          leaseExpiresAt: MoreThan(now),
        }, { updatedAt: now });
        if (leaseClaim.affected !== 1) {
          throw new Error('LDAP reconciliation lease was lost before identity provisioning');
        }
      }
      const userRepo = manager.getRepository(User);
      const externalIdentityRepo = manager.getRepository(ExternalIdentity);
      const identityKey = externalIdentityKey({ tenantId: provider.tenantId, providerId: provider.id, subjectId: input.subjectId });
      const externalIdentity = await externalIdentityRepo.findOne({ where: { identityKey } });
      let recoveredUnlinkedIdentity = false;
      if (externalIdentity?.status === 'unlinked') {
        // An administrator must first explicitly unlink the conflict. Recovery
        // then requires new provider evidence for the exact recorded email and
        // the provider's opt-in verified-email-linking policy; no admin request
        // can move the external subject between accounts.
        if (!emailVerified || !allowsVerifiedEmailLinking(provider) || !externalIdentity.emailHint || externalIdentity.emailHint.toLowerCase() !== email) {
          throw new Error('External identity has been unlinked and requires an administrator-approved verified sign-in recovery');
        }
        recoveredUnlinkedIdentity = true;
      }
      let user = externalIdentity && !recoveredUnlinkedIdentity ? await userRepo.findOneBy({ id: externalIdentity.userId }) : null;
      if (externalIdentity && !recoveredUnlinkedIdentity && !user) throw new Error('External identity references a missing user account');
      if (!externalIdentity || recoveredUnlinkedIdentity) {
        if (!emailVerified) throw new Error('Identity provider email must be verified before a new identity can be linked');
        const matchingEmailUser = await userRepo.findOneBy({ email });
        if (matchingEmailUser && !allowsVerifiedEmailLinking(provider)) {
          throw new Error('Verified email account linking is disabled for this identity provider');
        }
        if (recoveredUnlinkedIdentity && (!matchingEmailUser || !matchingEmailUser.isActive)) {
          throw new Error('External identity recovery requires an active local account with the verified provider email');
        }
        user = matchingEmailUser;
      }
      if (!user) {
        const id = generateId();
        await userRepo.insert({ id, email, authProvider: input.providerType, passwordHash: null, firstName: input.firstName || null, lastName: input.lastName || null, isActive: true, mustResetPassword: false, failedLoginAttempts: 0, lockedUntil: null, isEmailVerified: emailVerified, emailVerificationToken: null, emailVerificationTokenExpiry: null, createdAt: now, updatedAt: now, lastLoginAt: now, createdByUserId: null });
        user = {
          id,
          email,
          firstName: input.firstName || null,
          lastName: input.lastName || null,
          isActive: true,
          authSessionVersion: 0,
        } as User;
      } else {
        if (emailVerified && user.email !== email) {
          const matchingEmailUser = await userRepo.findOneBy({ email });
          if (matchingEmailUser && matchingEmailUser.id !== user.id) throw new Error('Identity provider email is already linked to another user account');
        }
        const authProvider = user.authProvider === 'local' && user.passwordHash ? 'local' : input.providerType;
        await userRepo.update({ id: user.id }, { email: emailVerified ? email : user.email, authProvider, firstName: input.firstName || user.firstName, lastName: input.lastName || user.lastName, isEmailVerified: Boolean(user.isEmailVerified || emailVerified), lastLoginAt: now, updatedAt: now });
        user = { ...user, email: emailVerified ? email : user.email } as User;
      }
      if (recoveredUnlinkedIdentity) {
        await externalIdentityService.restoreUnlinkedWithManager(manager, {
          tenantId: provider.tenantId,
          providerId: provider.id,
          subjectId: input.subjectId,
          userId: user.id,
          email,
          now,
        });
      }
      await externalIdentityService.upsertWithManager(manager, {
        tenantId: provider.tenantId,
        providerId: provider.id,
        providerType: input.providerType,
        subjectId: input.subjectId,
        directoryTenantId: input.directoryTenantId || provider.directoryTenantId || null,
        userId: user.id,
        emailHint: email,
        now,
      });
      const normalizedIdentity = await ssoNormalizedIdentityService.upsertIdentityWithManager(manager, {
        tenantId: provider.tenantId, providerId: provider.id, providerType: input.providerType, providerSubject: input.subjectId, subjectClaim: input.providerType === 'ldap' ? 'directory_id' : 'sub', providerTenantId: input.directoryTenantId || provider.directoryTenantId, userId: user.id, email, displayName: input.displayName || null, firstName: input.firstName || null, lastName: input.lastName || null, claims: input.claims, authorizationAttributeKeys: authorizationAttributeKeys(provider), now,
      });
      await authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager, user.id);
      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isActive: user.isActive,
          authSessionVersion: user.authSessionVersion || 0,
        },
        groupMembershipsCreated: normalizedIdentity.groupMembershipsCreated || 0,
        groupMembershipsRemoved: normalizedIdentity.groupMembershipsRemoved || 0,
      };
    });
  }
}

export const identityProviderProvisioningService = new IdentityProviderProvisioningService();
