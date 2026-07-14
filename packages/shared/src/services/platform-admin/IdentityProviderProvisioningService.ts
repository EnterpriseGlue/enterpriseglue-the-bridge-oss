import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { externalIdentityKey, externalIdentityService } from './ExternalIdentityService.js';
import { authzGroupService } from './AuthzGroupService.js';
import { ssoNormalizedIdentityService } from './SsoNormalizedIdentityService.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import type { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import type { OidcIdentityClaims } from './GenericOidcService.js';
import type { IdentityProviderType } from './IdentityProviderAdapter.js';
import { ssoSyncDiagnosticsService } from './SsoSyncDiagnosticsService.js';

export interface ProvisionedIdentityUser { id: string; email: string; firstName: string | null; lastName: string | null; isActive: boolean; }
export interface ProvisionIdentityInput {
  providerType: IdentityProviderType; subjectId: string; email: string; emailVerified: boolean; displayName?: string | null;
  firstName?: string | null; lastName?: string | null; directoryTenantId?: string | null; claims: Record<string, unknown>;
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

class IdentityProviderProvisioningService {
  async provisionOidcUser(provider: IdentityProvider, claims: OidcIdentityClaims): Promise<ProvisionedIdentityUser> {
    return this.provision(provider, this.oidcInput(provider, claims));
  }

  async reconcileOidcLogin(provider: IdentityProvider, claims: OidcIdentityClaims): Promise<ProvisionedIdentityUser> {
    return this.reconcileLogin(provider, this.oidcInput(provider, claims));
  }

  async provisionLdapUser(provider: IdentityProvider, input: Omit<ProvisionIdentityInput, 'providerType' | 'emailVerified'>): Promise<ProvisionedIdentityUser> {
    return this.provision(provider, { ...input, providerType: 'ldap', emailVerified: true });
  }

  async reconcileLdapLogin(provider: IdentityProvider, input: Omit<ProvisionIdentityInput, 'providerType' | 'emailVerified'>): Promise<ProvisionedIdentityUser> {
    return this.reconcileLogin(provider, { ...input, providerType: 'ldap', emailVerified: true });
  }

  async provisionSamlUser(provider: IdentityProvider, input: Omit<ProvisionIdentityInput, 'providerType' | 'emailVerified'>): Promise<ProvisionedIdentityUser> {
    return this.provision(provider, { ...input, providerType: 'saml', emailVerified: true });
  }

  async reconcileSamlLogin(provider: IdentityProvider, input: Omit<ProvisionIdentityInput, 'providerType' | 'emailVerified'>): Promise<ProvisionedIdentityUser> {
    return this.reconcileLogin(provider, { ...input, providerType: 'saml', emailVerified: true });
  }

  private oidcInput(provider: IdentityProvider, claims: OidcIdentityClaims): ProvisionIdentityInput {
    const email = requiredEmail(claims);
    return { providerType: 'oidc', subjectId: claims.sub, email, emailVerified: claims.email_verified === true, displayName: typeof claims.name === 'string' ? claims.name : null, firstName: typeof claims.given_name === 'string' ? claims.given_name : null, lastName: typeof claims.family_name === 'string' ? claims.family_name : null, directoryTenantId: typeof claims.tid === 'string' ? claims.tid : provider.directoryTenantId, claims: claims as Record<string, unknown> };
  }

  private async reconcileLogin(provider: IdentityProvider, input: ProvisionIdentityInput): Promise<ProvisionedIdentityUser> {
    const details = { source: 'identity_provider_reconciliation', protocol: input.providerType, mode: 'login' };
    const runId = await ssoSyncDiagnosticsService.startRun({ tenantId: provider.tenantId, providerId: provider.id, trigger: 'login', details });
    try {
      const user = await this.provision(provider, input);
      await ssoSyncDiagnosticsService.completeRun(runId, { tenantId: provider.tenantId, providerId: provider.id, userId: user.id, details });
      return user;
    } catch (error) {
      await ssoSyncDiagnosticsService.failRun(runId, error, { tenantId: provider.tenantId, providerId: provider.id, details });
      throw error;
    }
  }

  private async provision(provider: IdentityProvider, input: ProvisionIdentityInput): Promise<ProvisionedIdentityUser> {
    const email = input.email.trim().toLowerCase();
    if (!email.includes('@')) throw new Error('Identity provider must return an email address');
    const emailVerified = input.emailVerified;
    const now = Date.now();
    const dataSource = await getDataSource();
    return dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const externalIdentityRepo = manager.getRepository(ExternalIdentity);
      const identityKey = externalIdentityKey({ tenantId: provider.tenantId, providerId: provider.id, subjectId: input.subjectId });
      const externalIdentity = await externalIdentityRepo.findOne({ where: { identityKey } });
      if (externalIdentity?.status === 'unlinked') {
        throw new Error('External identity has been unlinked and requires administrator relinking');
      }
      let user = externalIdentity ? await userRepo.findOneBy({ id: externalIdentity.userId }) : null;
      if (externalIdentity && !user) throw new Error('External identity references a missing user account');
      if (!externalIdentity) {
        if (!emailVerified) throw new Error('Identity provider email must be verified before a new identity can be linked');
        const matchingEmailUser = await userRepo.findOneBy({ email });
        if (matchingEmailUser && !allowsVerifiedEmailLinking(provider)) {
          throw new Error('Verified email account linking is disabled for this identity provider');
        }
        user = matchingEmailUser;
      }
      if (!user) {
        const id = generateId();
        await userRepo.insert({ id, email, authProvider: input.providerType, passwordHash: null, entraId: null, entraEmail: null, googleId: null, firstName: input.firstName || null, lastName: input.lastName || null, platformRole: 'user', isActive: true, mustResetPassword: false, failedLoginAttempts: 0, lockedUntil: null, isEmailVerified: emailVerified, emailVerificationToken: null, emailVerificationTokenExpiry: null, createdAt: now, updatedAt: now, lastLoginAt: now, createdByUserId: null });
        user = { id, email, firstName: input.firstName || null, lastName: input.lastName || null, platformRole: 'user', isActive: true } as User;
      } else {
        if (emailVerified && user.email !== email) {
          const matchingEmailUser = await userRepo.findOneBy({ email });
          if (matchingEmailUser && matchingEmailUser.id !== user.id) throw new Error('Identity provider email is already linked to another user account');
        }
        const authProvider = user.authProvider === 'local' && user.passwordHash ? 'local' : input.providerType;
        await userRepo.update({ id: user.id }, { email: emailVerified ? email : user.email, authProvider, firstName: input.firstName || user.firstName, lastName: input.lastName || user.lastName, isEmailVerified: Boolean(user.isEmailVerified || emailVerified), lastLoginAt: now, updatedAt: now });
        user = { ...user, email: emailVerified ? email : user.email } as User;
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
      await ssoNormalizedIdentityService.upsertIdentityWithManager(manager, {
        tenantId: provider.tenantId, providerId: provider.id, providerType: input.providerType, providerSubject: input.subjectId, subjectClaim: input.providerType === 'ldap' ? 'directory_id' : 'sub', providerTenantId: input.directoryTenantId || provider.directoryTenantId, userId: user.id, email, displayName: input.displayName || null, firstName: input.firstName || null, lastName: input.lastName || null, claims: input.claims, authorizationAttributeKeys: authorizationAttributeKeys(provider), now,
      });
      await authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager, user.id);
      return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, isActive: user.isActive };
    });
  }
}

export const identityProviderProvisioningService = new IdentityProviderProvisioningService();
