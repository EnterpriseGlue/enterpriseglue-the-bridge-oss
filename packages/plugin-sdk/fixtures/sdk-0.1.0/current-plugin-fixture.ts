import type { ComponentType } from 'react';

import {
  parseEnterpriseGluePluginManifestV1,
  type FrontendPluginHostContextV1,
  type PluginBackendCapabilitiesV1,
  type PluginFrontendModuleV1,
  type PluginRoutePropsV1,
} from '@enterpriseglue/plugin-sdk';

const hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const Route: ComponentType<PluginRoutePropsV1> = () => null;

/**
 * Frozen consumer fixture for the first public SDK minor.
 *
 * Do not update this file to make a breaking SDK change pass. Add the new
 * current-minor fixture and keep this one until the documented compatibility
 * window for 0.1.x ends.
 */
export const manifestFixture = parseEnterpriseGluePluginManifestV1({
  apiVersion: 'plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePlugin',
  metadata: {
    id: 'io.enterpriseglue.compatibility-fixture',
    version: '1.0.0',
    displayName: 'Compatibility fixture',
    publisher: 'io.enterpriseglue',
  },
  compatibility: {
    host: '>=0.4.6 <0.5.0',
    sdk: '^0.1.0',
    frontendProtocol: 1,
    backendProtocol: 1,
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
        pluginSdk: '0.1.0',
      },
    },
    backend: {
      image: `ghcr.io/enterpriseglue/compatibility-fixture@sha256:${hash}`,
      healthPath: '/_plugin/health',
      readyPath: '/_plugin/ready',
      protocolPath: '/_plugin/capabilities',
      operations: [],
    },
  },
  scope: {
    installation: 'deployment',
    enablement: 'tenant',
  },
  permissions: {
    required: ['host.identity.read_safe'],
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
  jobs: {
    fixedSchedules: [],
  },
  contributions: [
    {
      id: 'io.enterpriseglue.compatibility-fixture.route',
      kind: 'route',
      scope: 'tenant',
      relativePath: 'compatibility-fixture',
    },
    {
      id: 'io.enterpriseglue.compatibility-fixture.incident-action',
      kind: 'slot',
      slot: 'mission-control.incident.actions.v1',
    },
  ],
});

export const frontendModuleFixture: PluginFrontendModuleV1 = {
  apiVersion: 'frontend.plugin.enterpriseglue.io/v1',
  pluginId: manifestFixture.metadata.id,
  version: manifestFixture.metadata.version,
  activate(context: FrontendPluginHostContextV1) {
    context.telemetry.event('compatibility_fixture_activated', {
      pluginId: context.plugin.id,
    });
    return {
      routes: [
        {
          id: 'io.enterpriseglue.compatibility-fixture.route',
          scope: 'tenant',
          relativePath: 'compatibility-fixture',
          component: Route,
          requiredPermission: 'host.identity.read_safe',
        },
      ],
      slots: [
        {
          id: 'io.enterpriseglue.compatibility-fixture.incident-action',
          slot: 'mission-control.incident.actions.v1',
          component: () => null,
        },
      ],
    };
  },
};

export const backendCapabilitiesFixture: PluginBackendCapabilitiesV1 = {
  protocol: 'backend.plugin.enterpriseglue.io/v1',
  pluginId: manifestFixture.metadata.id,
  pluginVersion: manifestFixture.metadata.version,
  apiRevision: 'fixture-v1',
  schemaRevision: 1,
  operations: [],
  optionalFeatures: [],
};
