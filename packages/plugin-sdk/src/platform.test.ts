import { describe, expect, it } from 'vitest';

import {
  pluginEventTypeValues,
  pluginPermissionValues,
  pluginSlotIdValues,
} from './common.js';
import {
  createPluginPlatformCapabilityCatalogV1,
  getPluginPlatformCapabilityCatalogV1JsonSchema,
  pluginPlatformReleaseIdentityV1,
  safeParsePluginPlatformCapabilityCatalogV1,
} from './platform.js';

function catalog() {
  return createPluginPlatformCapabilityCatalogV1({
    hostVersion: '0.4.6',
    sdkVersion: '0.2.0',
    sharedFrontend: {
      react: '19.2.6',
      reactDom: '19.2.6',
      router: '7.18.1',
      carbonReact: '1.107.0',
      pluginSdk: '0.2.0',
    },
    supportedSdkVersions: ['0.2.0', '0.1.0'],
    egressPolicies: ['ion-support-cloud', 'ion-support-cloud', 'none'],
    trustedPublishers: ['io.enterpriseglue', 'io.partner'],
  });
}

describe('plugin platform capability catalog', () => {
  it('projects every built-in contract and only safe deployment identifiers', () => {
    const value = catalog();

    expect(value.metadata.catalogRevision).toBe('2026-08-24.1');
    expect(value.permissions.map((entry) => entry.id)).toEqual(
      pluginPermissionValues,
    );
    expect(value.slots.map((entry) => entry.id)).toEqual(pluginSlotIdValues);
    expect(value.events.map((entry) => entry.id)).toEqual(
      pluginEventTypeValues,
    );
    expect(
      value.permissions.find(
        (entry) =>
          entry.id === 'host.events.subscribe.engine_inventory',
      ),
    ).toMatchObject({
      risk: 'high',
      grantMode: 'explicit',
      dataClass: 'safe_metadata',
    });
    expect(
      value.events.find(
        (entry) =>
          entry.id ===
          'io.enterpriseglue.host.engine-inventory.v1',
      ),
    ).toMatchObject({
      permission: 'host.events.subscribe.engine_inventory',
      delivery: 'at_least_once',
      payloadErasedAfterDelivery: true,
    });
    expect(value.egressPolicies).toEqual([
      {
        id: 'none',
        source: 'host_builtin',
        enforcement: 'deny_all',
        credentials: 'none',
      },
      {
        id: 'ion-support-cloud',
        source: 'deployment',
        enforcement: 'deployment_policy',
        credentials: 'host_broker_only',
      },
    ]);
    expect(value.compatibility.supportWindow).toEqual({
      policy: 'current-and-previous-minor-when-available',
      hostMinorLines: ['0.4'],
      sdkMinorLines: ['0.1', '0.2'],
      sdkVersions: ['0.1.0', '0.2.0'],
      exactPrivateCiHostEvidenceRequired: true,
    });

    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain('privateKey');
    expect(serialized).not.toContain('publicKey');
    expect(serialized).not.toContain('credentialFile');
    expect(serialized).not.toContain('baseUrl');
    expect(serialized).not.toContain('tenantRef');
  });

  it('publishes one exact current v0.15 release identity', () => {
    expect(pluginPlatformReleaseIdentityV1).toEqual({
      hostVersion: '0.16.0',
      sdkVersion: '0.3.1',
      supportedSdkVersions: ['0.3.1', '0.3.0', '0.2.0'],
      sharedFrontend: {
        react: '19.2.6',
        reactDom: '19.2.6',
        router: '7.18.2',
        carbonReact: '1.107.0',
        pluginSdk: '0.3.1',
      },
    });
  });

  it('supports an exact host subset without inventing unavailable capabilities', () => {
    const value = createPluginPlatformCapabilityCatalogV1({
      hostVersion: '0.4.6',
      sdkVersion: '0.1.0',
      sharedFrontend: {
        react: '19.2.6',
        reactDom: '19.2.6',
        router: '7.18.1',
        carbonReact: '1.107.0',
        pluginSdk: '0.1.0',
      },
      permissions: ['host.identity.read_safe'],
      slots: ['settings.deployment.pages.v1'],
    });

    expect(value.permissions.map((entry) => entry.id)).toEqual([
      'host.identity.read_safe',
    ]);
    expect(value.slots.map((entry) => entry.id)).toEqual([
      'settings.deployment.pages.v1',
    ]);
    expect(value.events).toEqual([]);
  });

  it('validates support windows, duplicate IDs, and named egress policy semantics', () => {
    const missingCurrentMinor = structuredClone(catalog());
    missingCurrentMinor.compatibility.supportWindow.hostMinorLines = ['0.3'];
    expect(
      safeParsePluginPlatformCapabilityCatalogV1(missingCurrentMinor).success,
    ).toBe(false);

    const duplicatePermission = structuredClone(catalog());
    duplicatePermission.permissions.push(
      structuredClone(duplicatePermission.permissions[0]!),
    );
    expect(
      safeParsePluginPlatformCapabilityCatalogV1(duplicatePermission).success,
    ).toBe(false);

    const directCredential = structuredClone(catalog());
    directCredential.egressPolicies[1]!.credentials = 'none';
    expect(
      safeParsePluginPlatformCapabilityCatalogV1(directCredential).success,
    ).toBe(false);

    const unsupportedSdkLine = structuredClone(catalog());
    unsupportedSdkLine.compatibility.supportWindow.sdkVersions = ['0.2.0'];
    expect(
      safeParsePluginPlatformCapabilityCatalogV1(unsupportedSdkLine).success,
    ).toBe(false);

    const twoPatchesFromOneMinor = structuredClone(catalog());
    twoPatchesFromOneMinor.compatibility.supportWindow.sdkVersions = [
      '0.2.0',
      '0.2.1',
    ];
    twoPatchesFromOneMinor.compatibility.supportWindow.sdkMinorLines = [
      '0.2',
    ];
    expect(
      safeParsePluginPlatformCapabilityCatalogV1(twoPatchesFromOneMinor)
        .success,
    ).toBe(true);
  });

  it('exports a closed draft 2020-12 structural schema', () => {
    const schema = getPluginPlatformCapabilityCatalogV1JsonSchema();

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toContain(
      'enterpriseglue-plugin-platform-capabilities-v1',
    );
    expect(schema.additionalProperties).toBe(false);
  });
});
