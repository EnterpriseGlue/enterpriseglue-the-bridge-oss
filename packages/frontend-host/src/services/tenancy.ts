import type { z } from 'zod';
import { TenancyCapabilitiesSchema } from '@enterpriseglue/shared/schemas/platform-admin/tenant.js';
import { config } from '../config.js';
import { registerFeatureOverride } from '../enterprise/extensionRegistry.js';

export type TenancyCapabilities = z.infer<typeof TenancyCapabilitiesSchema>;

let capabilities: TenancyCapabilities = {
  mode: 'single',
  rootTenantAliasesEnabled: true,
  tenantScopedLoginRequired: false,
  databaseIsolation: 'application',
  customDomainsEnabled: false,
  organizationDiscoveryEnabled: false,
  signedPlacementAssertionsEnabled: false,
};

export async function initializeTenancyCapabilities(): Promise<TenancyCapabilities> {
  try {
    const base = config.apiBaseUrl.replace(/\/$/, '');
    const response = await fetch(`${base}/api/tenancy/capabilities`, { credentials: 'include' });
    if (!response.ok) return capabilities;
    capabilities = TenancyCapabilitiesSchema.parse(await response.json());
    if (capabilities.mode === 'pooled') registerFeatureOverride({ flag: 'multiTenant', enabled: true });
  } catch {
    // A deployment that predates the native endpoint remains in the established
    // single/EE-plugin compatibility behavior.
  }
  return capabilities;
}

export function getTenancyCapabilities(): TenancyCapabilities {
  return capabilities;
}
