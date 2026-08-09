import { identityProviderService } from './IdentityProviderService.js';
import { directLdapIdentityService } from './DirectLdapIdentityService.js';
import { identityProviderProvisioningService } from './IdentityProviderProvisioningService.js';
import { identityReconciliationCheckpointService } from './IdentityReconciliationCheckpointService.js';
import { ssoSyncDiagnosticsService } from './SsoSyncDiagnosticsService.js';
import { ssoNormalizedIdentityService } from './SsoNormalizedIdentityService.js';

function sync(provider: { syncJson: string }): Record<string, unknown> { try { return JSON.parse(provider.syncJson) as Record<string, unknown>; } catch { return {}; } }

const LDAP_RECONCILIATION_LEASE_MS = 60_000;

function leaseLostError(): Error {
  return new Error('LDAP reconciliation lease was lost; authoritative changes stopped before absence removal');
}

class LdapReconciliationService {
  async reconcileProvider(key: string, tenantId?: string | null, trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<{ skipped?: string; processed?: number; runId?: string | null }> {
    const provider = await identityProviderService.getByKey(key, tenantId);
    if (!provider || !provider.isEnabled || provider.protocol !== 'ldap') return { skipped: 'provider_unavailable' };
    const configuration = sync(provider);
    if (configuration.connectorCapability !== 'ldap_directory') return { skipped: 'connector_unavailable' };
    if (trigger === 'scheduled' && configuration.scheduled !== true) return { skipped: 'connector_not_scheduled' };
    const intervalSeconds = typeof configuration.intervalSeconds === 'number' ? configuration.intervalSeconds : 60;
    const lease = await identityReconciliationCheckpointService.acquire(provider.id, tenantId, LDAP_RECONCILIATION_LEASE_MS, trigger === 'scheduled' ? intervalSeconds * 1_000 : 0);
    if (!lease) return { skipped: 'not_due_or_lease_held' };
    const runId = await ssoSyncDiagnosticsService.startRun({ tenantId, providerId: provider.id, trigger, details: { source: 'ldap_reconciliation', cursor: lease.cursor } });
    let leaseLost = false;
    let renewalInFlight: Promise<boolean> | null = null;
    const renewLease = async (): Promise<void> => {
      if (leaseLost) return;
      if (!renewalInFlight) {
        renewalInFlight = identityReconciliationCheckpointService
          .renew(provider.id, lease.leaseId, LDAP_RECONCILIATION_LEASE_MS)
          .catch(() => false)
          .finally(() => { renewalInFlight = null; });
      }
      try {
        leaseLost = !(await renewalInFlight);
      } catch {
        leaseLost = true;
      }
    };
    const heartbeat = setInterval(() => { void renewLease(); }, Math.floor(LDAP_RECONCILIATION_LEASE_MS / 3));
    try {
      const page = await directLdapIdentityService.listDirectoryPage(provider);
      await renewLease();
      if (leaseLost) throw leaseLostError();
      let groupMembershipsCreated = 0;
      let groupMembershipsRemoved = 0;
      for (const identity of page.identities) {
        const reconciliation = await identityProviderProvisioningService.provisionLdapUserForReconciliation(
          provider,
          { subjectId: identity.subjectId, email: identity.email, displayName: identity.displayName, firstName: identity.firstName, lastName: identity.lastName, claims: { sub: identity.subjectId, email: identity.email, groups: identity.groups } },
          { providerId: provider.id, leaseId: lease.leaseId },
        );
        groupMembershipsCreated += reconciliation.groupMembershipsCreated;
        groupMembershipsRemoved += reconciliation.groupMembershipsRemoved;
        if (leaseLost) throw leaseLostError();
      }
      if (page.nextCursor !== null) throw new Error('LDAP authoritative reconciliation cannot remove access from an incomplete directory snapshot');
      await renewLease();
      if (leaseLost) throw leaseLostError();
      clearInterval(heartbeat);
      // Wait for the shared heartbeat promise before the transactional fence;
      // no detached renewal may race checkpoint completion.
      if (renewalInFlight) leaseLost = !(await renewalInFlight);
      if (leaseLost) throw leaseLostError();
      const deactivated = await ssoNormalizedIdentityService.deactivateMissingProviderIdentities({
        tenantId,
        providerId: provider.id,
        seenProviderSubjects: page.identities.map((identity) => identity.subjectId),
        leaseId: lease.leaseId,
        providerUpdatedAt: Number(provider.updatedAt),
        providerProtocol: provider.protocol,
        providerAuthenticationMode: provider.authenticationMode,
        providerDirectoryTenantId: provider.directoryTenantId,
        providerConfigurationJson: provider.configurationJson,
        cursor: page.nextCursor,
      });
      groupMembershipsRemoved += deactivated.providerManagedMembershipsRemoved;
      await ssoSyncDiagnosticsService.completeRun(runId, { tenantId, providerId: provider.id, groupMembershipsCreated, groupMembershipsRemoved, details: { source: 'ldap_reconciliation', processed: page.identities.length, identitiesDeactivated: deactivated.identitiesDeactivated, providerRefreshSessionsRevoked: deactivated.providerRefreshSessionsRevoked, providerUserSessionsInvalidated: deactivated.providerUserSessionsInvalidated } });
      return { processed: page.identities.length, runId };
    } catch (error) { await identityReconciliationCheckpointService.release(provider.id, lease.leaseId); await ssoSyncDiagnosticsService.failRun(runId, error, { tenantId, providerId: provider.id, details: { source: 'ldap_reconciliation' } }); throw error; }
    finally { clearInterval(heartbeat); }
  }
}
export const ldapReconciliationService = new LdapReconciliationService();
