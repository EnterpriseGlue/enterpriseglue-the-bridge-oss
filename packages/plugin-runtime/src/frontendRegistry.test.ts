import type {
  EnterpriseGluePluginManifestV1,
  FrontendContributionSetV1,
  PluginRoutePropsV1,
} from '@enterpriseglue/plugin-sdk';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';

import {
  PluginFrontendRegistry,
  PluginFrontendRegistryError,
  type PluginFrontendActivationV1,
} from './frontendRegistry.js';

const component = (() => null) as ComponentType<PluginRoutePropsV1>;
const slotComponent = (() => null) as ComponentType<any>;
const hash = 'c'.repeat(64);

function activation(
  pluginId: string,
  version = '1.0.0',
  slotOrder = 100,
): PluginFrontendActivationV1 {
  const routeId = `${pluginId}.home`;
  const navId = `${pluginId}.navigation`;
  const slotId = `${pluginId}.incident-action`;
  const contributions: FrontendContributionSetV1 = {
    routes: [
      {
        id: routeId,
        scope: 'tenant',
        relativePath: 'home',
        component,
      },
    ],
    navigation: [
      {
        id: navId,
        label: `${pluginId} home`,
        routeId,
        section: 'tenant',
        order: slotOrder,
      },
    ],
    slots: [
      {
        id: slotId,
        slot: 'mission-control.incident.actions.v1',
        order: slotOrder,
        component: slotComponent,
      },
    ],
  };

  const manifest = {
    apiVersion: 'plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePlugin',
    metadata: {
      id: pluginId,
      version,
      displayName: pluginId,
      publisher: 'io.enterpriseglue',
    },
    compatibility: {
      host: '>=0.4.0 <0.5.0',
      sdk: '^1.0.0',
      frontendProtocol: 1,
      requiredSlots: ['mission-control.incident.actions.v1'],
    },
    deployment: {
      frontend: {
        entry: 'frontend/index.js',
        sha256: hash,
        shared: {
          react: '19.2.6',
          reactDom: '19.2.6',
          router: '7.18.1',
          carbonReact: '1.107.0',
          pluginSdk: '1.0.0',
        },
      },
    },
    scope: {
      installation: 'deployment',
      enablement: 'tenant',
    },
    permissions: {
      required: [],
      optional: [],
    },
    network: {
      egressPolicy: 'none',
    },
    entitlement: {
      provider: 'none',
    },
    dependencies: [],
    conflicts: [],
    events: {
      subscriptions: [],
    },
    jobs: { fixedSchedules: [] },
    contributions: [
      {
        id: routeId,
        kind: 'route',
        scope: 'tenant',
        relativePath: 'home',
      },
      {
        id: navId,
        kind: 'navigation',
        routeId,
        section: 'tenant',
      },
      {
        id: slotId,
        kind: 'slot',
        slot: 'mission-control.incident.actions.v1',
      },
    ],
  } as EnterpriseGluePluginManifestV1;

  return { pluginId, version, manifest, contributions };
}

describe('PluginFrontendRegistry', () => {
  it('composes multiple plugins deterministically and removes only the owner', () => {
    const registry = new PluginFrontendRegistry();
    registry.activate(activation('io.enterpriseglue.beta', '1.0.0', 20));
    registry.activate(activation('io.enterpriseglue.alpha', '1.0.0', 10));

    expect(registry.listPlugins().map((plugin) => plugin.pluginId)).toEqual([
      'io.enterpriseglue.alpha',
      'io.enterpriseglue.beta',
    ]);
    expect(
      registry
        .getSlotContributions('mission-control.incident.actions.v1')
        .map((entry) => entry.pluginId),
    ).toEqual(['io.enterpriseglue.alpha', 'io.enterpriseglue.beta']);

    registry.deactivate('io.enterpriseglue.alpha');

    expect(registry.getPlugin('io.enterpriseglue.alpha')).toBeUndefined();
    expect(registry.getPlugin('io.enterpriseglue.beta')).toBeDefined();
    expect(
      registry
        .getSlotContributions('mission-control.incident.actions.v1')
        .map((entry) => entry.pluginId),
    ).toEqual(['io.enterpriseglue.beta']);
  });

  it('rejects duplicate activation and non-namespaced contributions', () => {
    const registry = new PluginFrontendRegistry();
    const first = activation('io.enterpriseglue.alpha');
    registry.activate(first);

    expect(() => registry.activate(first)).toThrowError(
      expect.objectContaining({ code: 'plugin_already_active' }),
    );

    const invalid = activation('io.enterpriseglue.beta');
    invalid.contributions.routes![0].id = 'io.attacker.route';
    expect(() => registry.activate(invalid)).toThrowError(
      expect.objectContaining({ code: 'contribution_not_namespaced' }),
    );
  });

  it('requires runtime contributions to exactly match the signed manifest', () => {
    const registry = new PluginFrontendRegistry();
    const invalid = activation('io.enterpriseglue.alpha');
    invalid.contributions.routes![0].relativePath = 'different';

    expect(() => registry.activate(invalid)).toThrowError(
      expect.objectContaining({ code: 'manifest_contribution_mismatch' }),
    );
  });

  it('requires navigation and settings to reference an active plugin route', () => {
    const registry = new PluginFrontendRegistry();
    const invalid = activation('io.enterpriseglue.alpha');
    invalid.contributions.navigation![0].routeId =
      'io.enterpriseglue.alpha.missing';

    expect(() => registry.activate(invalid)).toThrowError(
      expect.objectContaining({ code: 'missing_route_reference' }),
    );
  });

  it('keeps the previous plugin active when replacement validation fails', () => {
    const registry = new PluginFrontendRegistry();
    registry.activate(activation('io.enterpriseglue.alpha', '1.0.0'));

    const invalidReplacement = activation(
      'io.enterpriseglue.alpha',
      '1.1.0',
    );
    invalidReplacement.manifest.metadata.version = '2.0.0';

    expect(() => registry.replace(invalidReplacement)).toThrow(
      PluginFrontendRegistryError,
    );
    expect(registry.getPlugin('io.enterpriseglue.alpha')?.version).toBe(
      '1.0.0',
    );
  });

  it('atomically replaces a plugin version after validation', () => {
    const registry = new PluginFrontendRegistry();
    registry.activate(activation('io.enterpriseglue.alpha', '1.0.0'));

    registry.replace(activation('io.enterpriseglue.alpha', '1.1.0'));

    expect(registry.getPlugin('io.enterpriseglue.alpha')?.version).toBe(
      '1.1.0',
    );
    expect(registry.listPlugins()).toHaveLength(1);
  });

  it('validates the complete signed set before hiding unavailable contributions', () => {
    const registry = new PluginFrontendRegistry();
    const alpha = activation('io.enterpriseglue.alpha');
    const beta = activation('io.enterpriseglue.beta');
    alpha.availableContributionIds = [
      'io.enterpriseglue.alpha.incident-action',
    ];
    registry.activate(alpha);
    registry.activate(beta);

    expect(registry.getRoutes('tenant').map((route) => route.pluginId)).toEqual([
      'io.enterpriseglue.beta',
    ]);
    expect(
      registry
        .getSlotContributions('mission-control.incident.actions.v1')
        .map((slot) => slot.pluginId),
    ).toEqual(['io.enterpriseglue.alpha', 'io.enterpriseglue.beta']);

    const invalid = activation('io.enterpriseglue.gamma');
    invalid.availableContributionIds = ['io.enterpriseglue.gamma.unknown'];
    expect(() => registry.activate(invalid)).toThrowError(
      expect.objectContaining({
        code: 'invalid_contribution_availability',
      }),
    );
  });
});
