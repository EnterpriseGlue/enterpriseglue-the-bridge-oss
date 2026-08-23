import { afterEach, describe, expect, it } from 'vitest';

import {
  extensions,
  listPluginExtensionOwners,
  replacePluginExtensions,
  unregisterPluginExtensions,
} from './extensionRegistry';

const owners = [
  'io.enterpriseglue.test-alpha',
  'io.enterpriseglue.test-beta',
];

afterEach(() => {
  for (const owner of owners) {
    unregisterPluginExtensions(owner);
  }
});

describe('legacy owner-aware extension bridge', () => {
  it('composes deterministic owner records and removes only one owner', () => {
    replacePluginExtensions(owners[1], {
      navItems: [
        {
          id: 'beta-home',
          label: 'Beta',
          path: '/beta',
          order: 20,
        },
      ],
    });
    replacePluginExtensions(owners[0], {
      navItems: [
        {
          id: 'alpha-home',
          label: 'Alpha',
          path: '/alpha',
          order: 10,
        },
      ],
    });

    expect(listPluginExtensionOwners()).toEqual(owners);
    expect(extensions.navItems.map((item) => item.id)).toEqual([
      'alpha-home',
      'beta-home',
    ]);

    unregisterPluginExtensions(owners[0]);

    expect(extensions.navItems.map((item) => item.id)).toEqual(['beta-home']);
    expect(listPluginExtensionOwners()).toEqual([owners[1]]);
  });

  it('rejects an invalid owner without mutating the active records', () => {
    replacePluginExtensions(owners[0], {
      navItems: [{ id: 'alpha-home', label: 'Alpha', path: '/alpha' }],
    });

    expect(() =>
      replacePluginExtensions('not-an-owner', {
        navItems: [{ id: 'bad', label: 'Bad', path: '/bad' }],
      }),
    ).toThrow(/reverse-DNS/);
    expect(listPluginExtensionOwners()).toEqual([owners[0]]);
  });

  it('rejects a cross-owner collision atomically', () => {
    replacePluginExtensions(owners[0], {
      navItems: [{ id: 'shared-home', label: 'Alpha', path: '/alpha' }],
    });

    expect(() =>
      replacePluginExtensions(owners[1], {
        navItems: [{ id: 'shared-home', label: 'Beta', path: '/beta' }],
      }),
    ).toThrow(/extension conflict/);

    expect(listPluginExtensionOwners()).toEqual([owners[0]]);
    expect(extensions.navItems[0]?.label).toBe('Alpha');
  });

  it('rejects feature and component replacement for ordinary owner records', () => {
    expect(() =>
      replacePluginExtensions(owners[0], {
        featureOverrides: [{ flag: 'multiTenant', enabled: true }],
      }),
    ).toThrow(/restricted to the legacy enterprise-plugin bridge/);
    expect(() =>
      replacePluginExtensions(owners[0], {
        componentOverrides: [
          {
            name: 'engines-page',
            component: () => null,
          },
        ],
      }),
    ).toThrow(/restricted to the legacy enterprise-plugin bridge/);
    expect(listPluginExtensionOwners()).toEqual([]);
  });
});
