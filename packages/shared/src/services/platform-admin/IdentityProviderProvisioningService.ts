import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { externalIdentityKey } from './ExternalIdentityService.js';
import { ssoNormalizedIdentityService } from './SsoNormalizedIdentityService.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import type { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import type { OidcIdentityClaims } from './GenericOidcService.js';

export interface ProvisionedIdentityUser { id: string; email: string; firstName: string | null; lastName: string | null; platformRole: string; isActive: boolean; }

function requiredEmail(claims: OidcIdentityClaims): string {
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : typeof claims.preferred_username === 'string' ? claims.preferred_username.trim().toLowerCase() : '';
  if (!email.includes('@')) throw new Error('OIDC ID token must contain an email address');
  return email;
}

class IdentityProviderProvisioningService {
  async provisionOidcUser(provider: IdentityProvider, claims: OidcIdentityClaims): Promise<ProvisionedIdentityUser> {
    const email = requiredEmail(claims);
    const emailVerified = claims.email_verified === true;
    const now = Date.now();
    const dataSource = await getDataSource();
    return dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const externalIdentityRepo = manager.getRepository(ExternalIdentity);
      const identityKey = externalIdentityKey({ tenantId: provider.tenantId, providerId: provider.id, subjectId: claims.sub });
      const externalIdentity = await externalIdentityRepo.findOne({ where: { identityKey } });
      let user = externalIdentity ? await userRepo.findOneBy({ id: externalIdentity.userId }) : null;
      if (!user && emailVerified) user = await userRepo.findOneBy({ email });
      if (!user && !emailVerified) throw new Error('OIDC email must be verified before a new identity can be linked');
      if (!user) {
        const id = generateId();
        await userRepo.insert({ id, email, authProvider: 'oidc', passwordHash: null, entraId: null, entraEmail: null, googleId: null, firstName: typeof claims.given_name === 'string' ? claims.given_name : null, lastName: typeof claims.family_name === 'string' ? claims.family_name : null, platformRole: 'user', isActive: true, mustResetPassword: false, failedLoginAttempts: 0, lockedUntil: null, isEmailVerified: emailVerified, emailVerificationToken: null, emailVerificationTokenExpiry: null, createdAt: now, updatedAt: now, lastLoginAt: now, createdByUserId: null });
        user = { id, email, firstName: typeof claims.given_name === 'string' ? claims.given_name : null, lastName: typeof claims.family_name === 'string' ? claims.family_name : null, platformRole: 'user', isActive: true } as User;
      } else {
        await userRepo.update({ id: user.id }, { authProvider: 'oidc', firstName: typeof claims.given_name === 'string' ? claims.given_name : user.firstName, lastName: typeof claims.family_name === 'string' ? claims.family_name : user.lastName, isEmailVerified: Boolean(user.isEmailVerified || emailVerified), lastLoginAt: now, updatedAt: now });
      }
      await ssoNormalizedIdentityService.upsertIdentityWithManager(manager, {
        tenantId: provider.tenantId, providerId: provider.id, providerType: 'oidc', providerSubject: claims.sub, subjectClaim: 'sub', providerTenantId: typeof claims.tid === 'string' ? claims.tid : provider.directoryTenantId, userId: user.id, email, displayName: typeof claims.name === 'string' ? claims.name : null, firstName: typeof claims.given_name === 'string' ? claims.given_name : null, lastName: typeof claims.family_name === 'string' ? claims.family_name : null, claims: claims as Record<string, unknown>, now,
      });
      return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, platformRole: user.platformRole, isActive: user.isActive };
    });
  }
}

export const identityProviderProvisioningService = new IdentityProviderProvisioningService();
