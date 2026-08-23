import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  EnterpriseGluePluginManifestV1,
  FrontendPluginHostContextV1,
} from '@enterpriseglue/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  activateNativePluginBootstrapV1,
  getNativePluginNavigationV1,
  getNativePluginRoutesV1,
  getNativePluginSettingsV1,
  NativePluginSlotV1,
  __nativePluginRuntimeTestUtils,
} from './nativePluginRuntime';
import {
  PluginFrontendFailureCircuitV1,
  type PluginFrontendFailureStorageV1,
} from './frontendFailureCircuit';

const pluginId = 'io.enterpriseglue.reference';
const version = '1.0.0';
const hash = 'a'.repeat(64);

function manifest(id = pluginId): EnterpriseGluePluginManifestV1 {
  return {
    apiVersion: 'plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePlugin',
    metadata: {
      id,
      version,
      displayName: 'Reference',
      publisher: 'io.enterpriseglue',
    },
    compatibility: {
      host: '^0.4.0',
      sdk: '^0.1.0',
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
          pluginSdk: '0.1.0',
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
    jobs: {
      fixedSchedules: [],
    },
    contributions: [
      {
        id: `${id}.home`,
        kind: 'route',
        scope: 'tenant',
        relativePath: 'plugins/reference',
      },
      {
        id: `${id}.navigation`,
        kind: 'navigation',
        routeId: `${id}.home`,
        section: 'main',
      },
      {
        id: `${id}.incident-action`,
        kind: 'slot',
        slot: 'mission-control.incident.actions.v1',
      },
    ],
  };
}

function availabilityManifest(
  id = pluginId,
): EnterpriseGluePluginManifestV1 {
  const value = manifest(id);
  value.compatibility.backendProtocol = 1;
  value.deployment.backend = {
    image: `registry.example/reference@sha256:${'b'.repeat(64)}`,
    healthPath: '/_plugin/health',
    readyPath: '/_plugin/ready',
    protocolPath: '/_plugin/capabilities',
    operations: [
      {
        operationId: `${id}.refresh-availability`,
        method: 'POST',
        path: 'v1/contribution-availability',
        requestSchema: {
          path: 'schemas/availability-request.json',
          sha256: hash,
        },
        responseSchema: {
          path: 'schemas/availability-response.json',
          sha256: hash,
        },
        requiredPermissions: ['host.identity.read_safe'],
        maxRequestBytes: 1024,
        maxResponseBytes: 16_384,
        timeoutMs: 5_000,
        streaming: 'none',
      },
    ],
  };
  value.permissions.required = ['host.identity.read_safe'];
  return {
    ...value,
    contributionAvailability: {
      refreshOperationId: `${id}.refresh-availability`,
      refreshIntervalSeconds: 300,
      maximumStalenessSeconds: 900,
      gatedContributionIds: [
        `${id}.home`,
        `${id}.navigation`,
        `${id}.incident-action`,
      ],
    },
  };
}

const Page = () => React.createElement('div', null, 'Reference');
const IncidentAction = () => React.createElement('button', null, 'Analyze');

class MemoryFailureStorage implements PluginFrontendFailureStorageV1 {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('native plugin frontend host', () => {
  it('preserves non-path contribution parameters as encoded query state', () => {
    expect(
      __nativePluginRuntimeTestUtils.contributionNavigationPath(
        'plugins/reference/:view',
        {
          view: 'case list',
          caseRef: 'case:1',
          engineRef: 'engine/one',
        },
      ),
    ).toBe(
      'plugins/reference/case%20list?caseRef=case%3A1&engineRef=engine%2Fone',
    );
  });

  it('rejects a malformed bootstrap record before import or failure persistence', async () => {
    let imports = 0;
    const result = await activateNativePluginBootstrapV1(
      {
        apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1',
        revision: 1,
        issues: [],
        plugins: [
          {
            pluginId: { attacker: true },
            version,
            displayName: 'Malformed',
            manifest: manifest(),
            entryUrl: '/unexpected.js',
          },
        ],
      },
      async () => {
        imports += 1;
        return {};
      },
      new PluginFrontendFailureCircuitV1({
        storage: new MemoryFailureStorage(),
      }),
    );

    expect(imports).toBe(0);
    expect(result).toEqual({
      revision: 0,
      activePluginIds: [],
      failures: [{ code: 'bootstrap_invalid' }],
    });
  });

  it('activates a plural namespaced module and exposes typed host contributions', async () => {
    let activatedHost: FrontendPluginHostContextV1 | undefined;
    const result = await activateNativePluginBootstrapV1(
      {
        apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1',
        revision: 3,
        issues: [],
        plugins: [
          {
            pluginId,
            version,
            displayName: 'Reference',
            manifest: manifest(),
            entryUrl: `/_enterpriseglue/plugins/${pluginId}/${version}/frontend/index.js`,
          },
        ],
      },
      async () => ({
        default: {
          apiVersion: 'frontend.plugin.enterpriseglue.io/v1',
          pluginId,
          version,
          activate: (host: FrontendPluginHostContextV1) => {
            activatedHost = host;
            return {
              routes: [
                {
                  id: `${pluginId}.home`,
                  scope: 'tenant',
                  relativePath: 'plugins/reference',
                  component: Page,
                },
              ],
              navigation: [
                {
                  id: `${pluginId}.navigation`,
                  label: 'Reference',
                  routeId: `${pluginId}.home`,
                  section: 'main',
                },
              ],
              slots: [
                {
                  id: `${pluginId}.incident-action`,
                  slot: 'mission-control.incident.actions.v1',
                  component: IncidentAction,
                },
              ],
            };
          },
        },
      }),
    );

    expect(result).toEqual({
      revision: 3,
      activePluginIds: [pluginId],
      failures: [],
    });
    expect(getNativePluginRoutesV1('tenant')).toHaveLength(1);
    expect(getNativePluginNavigationV1()).toEqual([
      {
        id: `${pluginId}.navigation`,
        label: 'Reference',
        path: '/plugins/reference',
        section: 'main',
        order: undefined,
        pluginId,
        scope: 'tenant',
      },
    ]);
    expect(
      __nativePluginRuntimeTestUtils.registry.getSlotContributions(
        'mission-control.incident.actions.v1',
      ),
    ).toHaveLength(1);
    expect(activatedHost?.ui).toEqual(
      expect.objectContaining({
        locale: expect.stringMatching(/^en(?:-|$)/i),
        direction: 'ltr',
        prefersReducedMotion: false,
      }),
    );
    expect(Object.keys(activatedHost?.ui.primitives ?? {}).sort()).toEqual([
      'ConfirmModal',
      'PageHeader',
      'PageLayout',
    ]);

    const historyBack = vi.fn();
    vi.stubGlobal('window', {
      location: { pathname: '/' },
      history: { back: historyBack },
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    try {
      await activatedHost!.api.request(`${pluginId}.delete-engine`, {
        method: 'DELETE',
        path: 'v1/engines/engine-1',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/plugins/v1/${encodeURIComponent(
          pluginId,
        )}/operations/${encodeURIComponent(
          `${pluginId}.delete-engine`,
        )}?path=v1%2Fengines%2Fengine-1`,
        expect.objectContaining({ method: 'DELETE' }),
      );
      activatedHost!.navigation.back?.();
      expect(historyBack).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('does not render contextual plugin actions when the host FGA decision disables the slot', async () => {
    const slotManifest = manifest();
    slotManifest.contributions = [
      {
        id: `${pluginId}.incident-action`,
        kind: 'slot',
        slot: 'mission-control.incident.actions.v1',
      },
    ];
    await activateNativePluginBootstrapV1(
      {
        apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1',
        revision: 4,
        issues: [],
        plugins: [{
          pluginId,
          version,
          displayName: 'Reference',
          manifest: slotManifest,
          entryUrl: `/_enterpriseglue/plugins/${pluginId}/${version}/frontend/index.js`,
        }],
      },
      async () => ({
        default: {
          apiVersion: 'frontend.plugin.enterpriseglue.io/v1',
          pluginId,
          version,
          activate: () => ({
            routes: [],
            navigation: [],
            slots: [{
              id: `${pluginId}.incident-action`,
              slot: 'mission-control.incident.actions.v1',
              component: IncidentAction,
            }],
          }),
        },
      }),
    );

    const html = renderToStaticMarkup(
      <NativePluginSlotV1
        slot="mission-control.incident.actions.v1"
        context={{
          schemaVersion: 1,
          disabled: true,
          engineRef: 'engine-denied',
          incidentRef: 'incident-1',
        }}
      />,
    );
    expect(html).not.toContain('Analyze');
  });

  it('projects a deployment settings contribution through the host administration surface', async () => {
    const settingsRouteId = `${pluginId}.settings`;
    const settingsContributionId = `${pluginId}.deployment-settings`;
    const signedManifest = manifest();
    signedManifest.contributions.push(
      {
        id: settingsRouteId,
        kind: 'route',
        scope: 'tenant',
        relativePath: 'admin/settings/reference',
      },
      {
        id: settingsContributionId,
        kind: 'settings',
        routeId: settingsRouteId,
        scope: 'deployment',
      },
    );

    const result = await activateNativePluginBootstrapV1(
      {
        apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1',
        revision: 4,
        issues: [],
        plugins: [
          {
            pluginId,
            version,
            displayName: 'Reference',
            manifest: signedManifest,
            entryUrl: `/_enterpriseglue/plugins/${pluginId}/${version}/frontend/index.js`,
          },
        ],
      },
      async () => ({
        default: {
          apiVersion: 'frontend.plugin.enterpriseglue.io/v1',
          pluginId,
          version,
          activate: () => ({
            routes: [
              {
                id: `${pluginId}.home`,
                scope: 'tenant',
                relativePath: 'plugins/reference',
                component: Page,
              },
              {
                id: settingsRouteId,
                scope: 'tenant',
                relativePath: 'admin/settings/reference',
                component: Page,
              },
            ],
            navigation: [
              {
                id: `${pluginId}.navigation`,
                label: 'Reference',
                routeId: `${pluginId}.home`,
                section: 'main',
              },
            ],
            slots: [
              {
                id: `${pluginId}.incident-action`,
                slot: 'mission-control.incident.actions.v1',
                component: IncidentAction,
              },
            ],
            settings: [
              {
                id: settingsContributionId,
                label: 'Reference settings',
                routeId: settingsRouteId,
                scope: 'deployment',
                order: 40,
              },
            ],
          }),
        },
      }),
    );

    expect(result).toEqual({
      revision: 4,
      activePluginIds: [pluginId],
      failures: [],
    });
    expect(getNativePluginSettingsV1('deployment')).toEqual([
      {
        id: settingsContributionId,
        label: 'Reference settings',
        relativePath: 'admin/settings/reference',
        order: 40,
        pluginId,
        scope: 'deployment',
        routeScope: 'tenant',
      },
    ]);
  });

  it('fails closed when the module identity differs from bootstrap state', async () => {
    const result = await activateNativePluginBootstrapV1(
      {
        apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1',
        revision: 4,
        issues: [],
        plugins: [
          {
            pluginId,
            version,
            displayName: 'Reference',
            manifest: manifest(),
            entryUrl: `/_enterpriseglue/plugins/${pluginId}/${version}/frontend/index.js`,
          },
        ],
      },
      async () => ({
        apiVersion: 'frontend.plugin.enterpriseglue.io/v1',
        pluginId: 'io.enterpriseglue.other',
        version,
        activate: () => ({}),
      }),
    );

    expect(result.activePluginIds).toEqual([]);
    expect(result.failures).toEqual([
      { pluginId, code: 'module_invalid' },
    ]);
  });

  it('keeps an unrelated valid plugin active when another module is invalid', async () => {
    const validPluginId = 'io.enterpriseglue.valid-health';
    const invalidPluginId = 'io.enterpriseglue.invalid-health';
    const record = (id: string) => ({
      pluginId: id,
      version,
      displayName: 'Reference',
      manifest: manifest(id),
      entryUrl: `/_enterpriseglue/plugins/${id}/${version}/frontend/index.js`,
    });

    const result = await activateNativePluginBootstrapV1(
      {
        apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1',
        revision: 5,
        issues: [],
        plugins: [record(invalidPluginId), record(validPluginId)],
      },
      async (url) =>
        url.includes(invalidPluginId)
          ? {
              default: {
                apiVersion: 'frontend.plugin.enterpriseglue.io/v1',
                pluginId: 'io.enterpriseglue.attacker',
                version,
                activate: () => ({}),
              },
            }
          : {
              default: {
                apiVersion: 'frontend.plugin.enterpriseglue.io/v1',
                pluginId: validPluginId,
                version,
                activate: () => ({
                  routes: [
                    {
                      id: `${validPluginId}.home`,
                      scope: 'tenant',
                      relativePath: 'plugins/reference',
                      component: Page,
                    },
                  ],
                  navigation: [
                    {
                      id: `${validPluginId}.navigation`,
                      label: 'Valid reference',
                      routeId: `${validPluginId}.home`,
                      section: 'main',
                    },
                  ],
                  slots: [
                    {
                      id: `${validPluginId}.incident-action`,
                      slot: 'mission-control.incident.actions.v1',
                      component: IncidentAction,
                    },
                  ],
                }),
              },
            },
    );

    expect(result).toEqual({
      revision: 5,
      activePluginIds: [validPluginId],
      failures: [{ pluginId: invalidPluginId, code: 'module_invalid' }],
    });
    expect(getNativePluginNavigationV1()).toEqual([
      expect.objectContaining({ pluginId: validPluginId }),
    ]);
  });

  it('quarantines a repeatedly failing exact source without importing it or affecting another plugin', async () => {
    const failingPluginId = 'io.enterpriseglue.repeated-failure';
    const healthyPluginId = 'io.enterpriseglue.healthy-after-failure';
    const circuit = new PluginFrontendFailureCircuitV1({
      storage: new MemoryFailureStorage(),
      now: () => 1_000_000,
      threshold: 2,
      failureWindowMs: 60_000,
      quarantineMs: 120_000,
    });
    const bootstrap = {
      apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1' as const,
      revision: 9,
      issues: [],
      plugins: [
        {
          pluginId: failingPluginId,
          version,
          displayName: 'Failing',
          manifest: manifest(failingPluginId),
          entryUrl: `/_enterpriseglue/plugins/${failingPluginId}/${version}/frontend/index.js`,
        },
        {
          pluginId: healthyPluginId,
          version,
          displayName: 'Healthy',
          manifest: manifest(healthyPluginId),
          entryUrl: `/_enterpriseglue/plugins/${healthyPluginId}/${version}/frontend/index.js`,
        },
      ],
    };
    let failingImports = 0;
    const importer = async (url: string) => {
      const id = url.includes(failingPluginId)
        ? failingPluginId
        : healthyPluginId;
      if (id === failingPluginId) {
        failingImports += 1;
        throw new Error('plugin-provided-sensitive-failure');
      }
      return {
        default: {
          apiVersion: 'frontend.plugin.enterpriseglue.io/v1',
          pluginId: id,
          version,
          activate: () => ({
            routes: [
              {
                id: `${id}.home`,
                scope: 'tenant',
                relativePath: 'plugins/reference',
                component: Page,
              },
            ],
            navigation: [
              {
                id: `${id}.navigation`,
                label: 'Healthy',
                routeId: `${id}.home`,
                section: 'main',
              },
            ],
            slots: [
              {
                id: `${id}.incident-action`,
                slot: 'mission-control.incident.actions.v1',
                component: IncidentAction,
              },
            ],
          }),
        },
      };
    };

    await activateNativePluginBootstrapV1(bootstrap, importer, circuit);
    const second = await activateNativePluginBootstrapV1(
      bootstrap,
      importer,
      circuit,
    );
    const third = await activateNativePluginBootstrapV1(
      bootstrap,
      importer,
      circuit,
    );

    expect(failingImports).toBe(2);
    expect(second.failures).toEqual([
      { pluginId: failingPluginId, code: 'activation_failed' },
    ]);
    expect(third).toEqual({
      revision: 9,
      activePluginIds: [healthyPluginId],
      failures: [
        {
          pluginId: failingPluginId,
          code: 'activation_quarantined',
        },
      ],
    });
    expect(getNativePluginNavigationV1()).toEqual([
      expect.objectContaining({ pluginId: healthyPluginId }),
    ]);
  });

  it('best-effort deactivates a partially activated module after registry validation fails', async () => {
    let deactivated = 0;
    const result = await activateNativePluginBootstrapV1(
      {
        apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1',
        revision: 10,
        issues: [],
        plugins: [
          {
            pluginId,
            version,
            displayName: 'Reference',
            manifest: manifest(),
            entryUrl: `/_enterpriseglue/plugins/${pluginId}/${version}/frontend/index.js`,
          },
        ],
      },
      async () => ({
        default: {
          apiVersion: 'frontend.plugin.enterpriseglue.io/v1',
          pluginId,
          version,
          activate: () => ({
            routes: [
              {
                id: 'not-namespaced',
                scope: 'tenant',
                relativePath: 'plugins/reference',
                component: Page,
              },
            ],
          }),
          deactivate: () => {
            deactivated += 1;
          },
        },
      }),
      new PluginFrontendFailureCircuitV1({
        storage: null,
        now: () => 1_000_000,
      }),
    );

    expect(result.failures).toEqual([
      { pluginId, code: 'activation_failed' },
    ]);
    expect(deactivated).toBe(1);
    expect(getNativePluginRoutesV1('tenant')).toEqual([]);
  });

  it('hides stale gated contributions without a browser preflight or affecting another plugin', async () => {
    const otherPluginId = 'io.enterpriseglue.other';
    let snapshotAvailable: boolean | undefined;
    let snapshotEntry: { available: boolean } | undefined;
    const moduleFor = (id: string) => ({
      default: {
        apiVersion: 'frontend.plugin.enterpriseglue.io/v1',
        pluginId: id,
        version,
        activate: (host: {
          availability: {
            get(id: string): { available: boolean };
            isAvailable(id: string): boolean;
          };
        }) => {
          if (id === pluginId) {
            snapshotEntry = host.availability.get(
              `${pluginId}.incident-action`,
            );
            snapshotAvailable = host.availability.isAvailable(
              `${pluginId}.incident-action`,
            );
          }
          return {
            routes: [
              {
                id: `${id}.home`,
                scope: 'tenant',
                relativePath: 'plugins/reference',
                component: Page,
              },
            ],
            navigation: [
              {
                id: `${id}.navigation`,
                label: id,
                routeId: `${id}.home`,
                section: 'main',
              },
            ],
            slots: [
              {
                id: `${id}.incident-action`,
                slot: 'mission-control.incident.actions.v1',
                component: IncidentAction,
              },
            ],
          };
        },
      },
    });
    const result = await activateNativePluginBootstrapV1(
      {
        apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1',
        revision: 6,
        issues: [],
        plugins: [
          {
            pluginId,
            version,
            displayName: 'Gated',
            manifest: availabilityManifest(),
            entryUrl: `/_enterpriseglue/plugins/${pluginId}/${version}/frontend/index.js`,
            contributionAvailability: null,
          },
          {
            pluginId: otherPluginId,
            version,
            displayName: 'Other',
            manifest: manifest(otherPluginId),
            entryUrl: `/_enterpriseglue/plugins/${otherPluginId}/${version}/frontend/index.js`,
          },
        ],
      },
      async (url) =>
        moduleFor(url.includes(otherPluginId) ? otherPluginId : pluginId),
    );

    expect(result.failures).toEqual([]);
    expect(snapshotAvailable).toBe(false);
    expect(Object.isFrozen(snapshotEntry)).toBe(true);
    expect(() => {
      snapshotEntry!.available = true;
    }).toThrow(TypeError);
    expect(getNativePluginNavigationV1().map((entry) => entry.pluginId)).toEqual([
      otherPluginId,
    ]);
    expect(
      __nativePluginRuntimeTestUtils.registry
        .getSlotContributions('mission-control.incident.actions.v1')
        .map((entry) => entry.pluginId),
    ).toEqual([otherPluginId]);
  });
});
