import type { ComponentType } from 'react';

import {
  createPluginPlatformCapabilityCatalogV1,
  parseEnterpriseGluePluginManifestV1,
  type FrontendPluginHostContextV1,
  type PluginBackendCapabilitiesV1,
  type PluginFrontendModuleV1,
  type PluginRoutePropsV1,
} from '@enterpriseglue/plugin-sdk';

const hash = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const Route: ComponentType<PluginRoutePropsV1> = () => null;

/**
 * Frozen consumer fixture for the current SDK minor.
 *
 * New additive 0.2.x contracts may be exercised here. Do not rewrite the
 * sdk-0.1.0 fixture when evolving the current line.
 */
export const manifestFixture = parseEnterpriseGluePluginManifestV1({
  apiVersion: 'plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePlugin',
  metadata: {
    id: 'io.enterpriseglue.current-compatibility-fixture',
    version: '1.0.0',
    displayName: 'Current compatibility fixture',
    publisher: 'io.enterpriseglue',
  },
  compatibility: {
    host: '>=0.14.0 <0.15.0',
    sdk: '^0.2.0',
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
        router: '7.18.2',
        carbonReact: '1.107.0',
        pluginSdk: '0.2.0',
      },
    },
    backend: {
      image: `ghcr.io/enterpriseglue/current-compatibility-fixture@sha256:${hash}`,
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
      id: 'io.enterpriseglue.current-compatibility-fixture.route',
      kind: 'route',
      scope: 'tenant',
      relativePath: 'current-compatibility-fixture',
    },
  ],
});

export const platformCatalogFixture =
  createPluginPlatformCapabilityCatalogV1({
    hostVersion: '0.14.0',
    sdkVersion: '0.2.0',
    supportedSdkVersions: ['0.2.0', '0.1.0'],
    sharedFrontend: {
      react: '19.2.6',
      reactDom: '19.2.6',
      router: '7.18.2',
      carbonReact: '1.107.0',
      pluginSdk: '0.2.0',
    },
    permissions: ['host.identity.read_safe'],
    slots: ['mission-control.incident.actions.v1'],
    trustedPublishers: ['io.enterpriseglue'],
  });

export const frontendModuleFixture: PluginFrontendModuleV1 = {
  apiVersion: 'frontend.plugin.enterpriseglue.io/v1',
  pluginId: manifestFixture.metadata.id,
  version: manifestFixture.metadata.version,
  activate(context: FrontendPluginHostContextV1) {
    context.telemetry.event('current_compatibility_fixture_activated', {
      pluginId: context.plugin.id,
    });
    return {
      routes: [
        {
          id: 'io.enterpriseglue.current-compatibility-fixture.route',
          scope: 'tenant',
          relativePath: 'current-compatibility-fixture',
          component: Route,
          requiredPermission: 'host.identity.read_safe',
        },
      ],
      slots: [],
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
