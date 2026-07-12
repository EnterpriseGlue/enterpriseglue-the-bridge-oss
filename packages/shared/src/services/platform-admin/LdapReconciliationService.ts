import { identityProviderService } from './IdentityProviderService.js';
import { directLdapIdentityService } from './DirectLdapIdentityService.js';
import { identityProviderProvisioningService } from './IdentityProviderProvisioningService.js';
import { identityReconciliationCheckpointService } from './IdentityReconciliationCheckpointService.js';
import { ssoSyncDiagnosticsService } from './SsoSyncDiagnosticsService.js';

function sync(provider: { syncJson: string }): Record<string, unknown> { try { return JSON.parse(provider.syncJson) as Record<string, unknown>; } catch { return {}; } }

class LdapReconciliationService {
  async reconcileProvider(key: string, tenantId?: string | null): Promise<{ skipped?: string; processed?: number }> {
    const provider = await identityProviderService.getByKey(key, tenantId);
    if (!provider || !provider.isEnabled || provider.protocol !== 'ldap') return { skipped: 'provider_unavailable' };
    const configuration = sync(provider);
    if (configuration.connectorCapability !== 'ldap_directory' || configuration.scheduled !== true) return { skipped: 'connector_not_scheduled' };
    const lease = await identityReconciliationCheckpointService.acquire(provider.id, tenantId);
    if (!lease) return { skipped: 'lease_held' };
    const runId = await ssoSyncDiagnosticsService.startRun({ tenantId, providerId: provider.id, trigger: 'scheduled', details: { source: 'ldap_reconciliation', cursor: lease.cursor } });
    try {
      const page = await directLdapIdentityService.listDirectoryPage(provider);
      for (const identity of page.identities) await identityProviderProvisioningService.provisionLdapUser(provider, { subjectId: identity.subjectId, email: identity.email, displayName: identity.displayName, firstName: identity.firstName, lastName: identity.lastName, claims: { sub: identity.subjectId, email: identity.email, groups: identity.groups } });
      await identityReconciliationCheckpointService.complete(provider.id, lease.leaseId, page.nextCursor);
      await ssoSyncDiagnosticsService.completeRun(runId, { tenantId, providerId: provider.id, details: { source: 'ldap_reconciliation', processed: page.identities.length } });
      return { processed: page.identities.length };
    } catch (error) { await identityReconciliationCheckpointService.release(provider.id, lease.leaseId); await ssoSyncDiagnosticsService.failRun(runId, error, { tenantId, providerId: provider.id, details: { source: 'ldap_reconciliation' } }); throw error; }
  }
}
export const ldapReconciliationService = new LdapReconciliationService();
