import { afterEach, describe, expect, it } from 'vitest';

import { listPluginExtensionOwners, unregisterPluginExtensions } from './extensionRegistry';
import { loadTrustedSystemFrontendModules, validateTrustedSystemModuleDescriptors } from './trustedSystemFrontendModules';

const descriptor = {
  ownerId: 'io.enterpriseglue.cloud-system',
  entryPath: '/cloud-system/release-management.js',
  integrity: `sha256-${'A'.repeat(43)}=` as const,
  required: true,
};

afterEach(() => unregisterPluginExtensions(descriptor.ownerId));

describe('trusted system frontend modules', () => {
  it('activates one owner-isolated additive route without replacing host features', async () => {
    const result = await loadTrustedSystemFrontendModules([descriptor], async () => ({
      ownerId: descriptor.ownerId,
      async activate(context) {
        expect(context.runtime?.react.createElement).toBeTypeOf('function');
        return {
          tenantRoutes: [{ path: 'admin/releases' }],
          navItems: [{ id: 'cloud-releases', label: 'Releases & updates', path: '/admin/releases', scope: 'tenant', section: 'tenant-admin', requiresTenantAdmin: true }],
        };
      },
    }));
    expect(result).toEqual({ activeOwnerIds: [descriptor.ownerId], failures: [] });
    expect(listPluginExtensionOwners()).toContain(descriptor.ownerId);
  });

  it('rejects cross-origin, duplicate-owner and malformed-integrity descriptors', () => {
    expect(() => validateTrustedSystemModuleDescriptors([{ ...descriptor, entryPath: 'https://foreign.example/module.js' }])).toThrow('system_module_entry_invalid');
    expect(() => validateTrustedSystemModuleDescriptors([descriptor, descriptor])).toThrow('system_module_owner_invalid');
    expect(() => validateTrustedSystemModuleDescriptors([{ ...descriptor, integrity: 'sha256-bad' }])).toThrow('system_module_integrity_invalid');
  });

  it('allows optional failure but fails startup for a required module', async () => {
    const fail = async () => { throw new Error('synthetic'); };
    await expect(loadTrustedSystemFrontendModules([{ ...descriptor, required: false }], fail)).resolves.toMatchObject({ failures: [{ ownerId: descriptor.ownerId, code: 'activation_failed' }] });
    await expect(loadTrustedSystemFrontendModules([descriptor], fail)).rejects.toThrow('Required system frontend module');
  });
});
