import * as Carbon from '@carbon/react';
import * as CarbonIcons from '@carbon/icons-react';
import {
  parseEnterpriseGluePluginManifestV1,
  pluginContributionAvailabilityProjectionV1Schema,
  pluginIdSchema,
  semVerSchema,
  type EnterpriseGluePluginManifestV1,
  type FrontendPluginHostContextV1,
  type PluginContributionAvailabilityEntryV1,
  type PluginFrontendModuleV1,
  type PluginId,
  type PluginRoutePropsV1,
  type PluginSlotContextMapV1,
  type PluginSlotIdV1,
} from '@enterpriseglue/plugin-sdk';
import { PluginFrontendRegistry } from '@enterpriseglue/plugin-runtime/frontend';
import React from 'react';
import * as ReactRuntime from 'react';
import * as ReactDomRuntime from 'react-dom';
import * as RouterRuntime from 'react-router-dom';
import {
  useParams,
  useSearchParams,
  type RouteObject,
} from 'react-router-dom';

import { apiClient } from '../shared/api/client';
import {
  pluginUiPreferencesV1,
  pluginUiPrimitivesV1,
} from './pluginUiPrimitives';
import {
  PluginFrontendFailureCircuitV1,
  type PluginFrontendFailureCodeV1,
  type PluginFrontendFailureTargetV1,
} from './frontendFailureCircuit';

const SHARED_RUNTIME_GLOBAL = '__ENTERPRISEGLUE_PLUGIN_SHARED_V1__';
const FRONTEND_BOOTSTRAP_API = '/api/plugins/v1/frontend';

interface FrontendBootstrapRecord {
  pluginId: PluginId;
  version: string;
  displayName: string;
  manifest: unknown;
  entryUrl: string;
  contributionAvailability?: unknown;
}

interface FrontendBootstrap {
  apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1';
  revision: number;
  plugins: FrontendBootstrapRecord[];
  issues: Array<{ pluginId?: PluginId; code: string }>;
}

export interface NativePluginLoadFailureV1 {
  pluginId?: PluginId;
  code:
    | 'bootstrap_unavailable'
    | 'bootstrap_invalid'
    | 'entry_url_invalid'
    | 'module_invalid'
    | 'activation_failed'
    | 'activation_quarantined';
}

export interface NativePluginLoadResultV1 {
  revision: number;
  activePluginIds: PluginId[];
  failures: NativePluginLoadFailureV1[];
}

export interface NativePluginNavigationV1 {
  id: string;
  label: string;
  path: string;
  section: 'main' | 'tenant' | 'settings' | 'administration';
  order?: number;
  pluginId: PluginId;
  scope: 'root' | 'tenant';
}

type PluginImporter = (url: string) => Promise<unknown>;

const registry = new PluginFrontendRegistry();
const activeModules = new Map<PluginId, PluginFrontendModuleV1>();
const failureCircuit = new PluginFrontendFailureCircuitV1();
let loadPromise: Promise<NativePluginLoadResultV1> | null = null;

function contributionNavigationPath(
  relativePath: string,
  params: Readonly<Record<string, string>>,
): string {
  let path = relativePath;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const token = `:${key}`;
    if (path.includes(token)) {
      path = path.split(token).join(encodeURIComponent(value));
    } else {
      query.set(key, value);
    }
  }
  const serialized = query.toString();
  return serialized ? `${path}?${serialized}` : path;
}

function installSharedRuntime(): FrontendPluginHostContextV1['shared'] {
  const root = globalThis as Record<string, unknown>;
  const existing = root[SHARED_RUNTIME_GLOBAL];
  if (existing) {
    return existing as FrontendPluginHostContextV1['shared'];
  }
  const shared = Object.freeze({
    react: ReactRuntime,
    reactDom: ReactDomRuntime,
    router: RouterRuntime,
    carbon: Carbon,
    carbonIcons: CarbonIcons,
  }) as unknown as FrontendPluginHostContextV1['shared'];
  Object.defineProperty(root, SHARED_RUNTIME_GLOBAL, {
    value: shared,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return shared;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBootstrap(input: unknown): input is FrontendBootstrap {
  if (!input || typeof input !== 'object') return false;
  const value = input as Record<string, unknown>;
  return (
    value.apiVersion === 'frontend-bootstrap.plugin.enterpriseglue.io/v1' &&
    Number.isSafeInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    Array.isArray(value.plugins) &&
    value.plugins.length <= 100 &&
    value.plugins.every(isBootstrapRecord) &&
    Array.isArray(value.issues) &&
    value.issues.length <= 1_000 &&
    value.issues.every(isBootstrapIssue)
  );
}

function isBootstrapRecord(value: unknown): value is FrontendBootstrapRecord {
  if (!isRecord(value)) return false;
  const keys = new Set([
    'pluginId',
    'version',
    'displayName',
    'manifest',
    'entryUrl',
    'contributionAvailability',
  ]);
  return (
    Object.keys(value).every((key) => keys.has(key)) &&
    pluginIdSchema.safeParse(value.pluginId).success &&
    semVerSchema.safeParse(value.version).success &&
    typeof value.displayName === 'string' &&
    value.displayName.length > 0 &&
    value.displayName.length <= 200 &&
    typeof value.entryUrl === 'string' &&
    value.entryUrl.length > 0 &&
    value.entryUrl.length <= 1_000 &&
    Object.prototype.hasOwnProperty.call(value, 'manifest')
  );
}

function isBootstrapIssue(
  value: unknown,
): value is { pluginId?: PluginId; code: string } {
  if (!isRecord(value)) return false;
  const keys = new Set(['pluginId', 'code']);
  return (
    Object.keys(value).every((key) => keys.has(key)) &&
    (value.pluginId === undefined ||
      pluginIdSchema.safeParse(value.pluginId).success) &&
    typeof value.code === 'string' &&
    /^[a-z][a-z0-9_]{0,99}$/.test(value.code)
  );
}

function expectedEntryUrl(
  pluginId: PluginId,
  version: string,
  entry: string,
): string {
  return `/_enterpriseglue/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(
    version,
  )}/${entry
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

function resolveModule(input: unknown): PluginFrontendModuleV1 | null {
  if (!input || typeof input !== 'object') return null;
  const imported = input as Record<string, unknown>;
  const candidate =
    imported.default ?? imported.enterpriseGluePlugin ?? imported.plugin ?? input;
  if (!candidate || typeof candidate !== 'object') return null;
  const plugin = candidate as Partial<PluginFrontendModuleV1>;
  if (
    plugin.apiVersion !== 'frontend.plugin.enterpriseglue.io/v1' ||
    typeof plugin.pluginId !== 'string' ||
    typeof plugin.version !== 'string' ||
    typeof plugin.activate !== 'function' ||
    (plugin.deactivate !== undefined && typeof plugin.deactivate !== 'function')
  ) {
    return null;
  }
  return plugin as PluginFrontendModuleV1;
}

async function requestPluginOperation<T>(
  pluginId: PluginId,
  operationId: string,
  request?: Parameters<FrontendPluginHostContextV1['api']['request']>[1],
): Promise<T> {
  const method = request?.method ?? 'POST';
  const tenantMatch =
    typeof window !== 'undefined'
      ? window.location.pathname.match(/^\/t\/([A-Za-z0-9_-]+)(?:\/|$)/)
      : null;
  const tenantPrefix = tenantMatch?.[1]
    ? `/t/${encodeURIComponent(tenantMatch[1])}`
    : '';
  const url = `${tenantPrefix}/api/plugins/v1/${encodeURIComponent(
    pluginId,
  )}/operations/${encodeURIComponent(operationId)}`;
  const envelope = {
    path: request?.path,
    body: request?.body,
  };
  const options = { signal: request?.signal };
  switch (method) {
    case 'GET':
      return apiClient.get<T>(
        url,
        request?.path ? { path: request.path } : undefined,
        options,
      );
    case 'PUT':
      return apiClient.put<T>(url, envelope, options);
    case 'PATCH':
      return apiClient.patch<T>(url, envelope, options);
    case 'DELETE': {
      const deleteUrl = request?.path
        ? `${url}?${new URLSearchParams({ path: request.path }).toString()}`
        : url;
      return apiClient.delete<T>(deleteUrl, options);
    }
    default:
      return apiClient.post<T>(url, envelope, options);
  }
}

async function streamPluginOperation<T>(
  pluginId: PluginId,
  operationId: string,
  request: Parameters<
    NonNullable<FrontendPluginHostContextV1['api']['stream']>
  >[1],
): Promise<void> {
  const method = request.method ?? 'POST';
  const tenantMatch =
    typeof window !== 'undefined'
      ? window.location.pathname.match(/^\/t\/([A-Za-z0-9_-]+)(?:\/|$)/)
      : null;
  const tenantPrefix = tenantMatch?.[1]
    ? `/t/${encodeURIComponent(tenantMatch[1])}`
    : '';
  const url = `${tenantPrefix}/api/plugins/v1/${encodeURIComponent(
    pluginId,
  )}/operations/${encodeURIComponent(operationId)}`;
  await apiClient.streamSse<T>(
    url,
    {
      path: request.path,
      body: request.body,
    },
    request.onEvent,
    {
      method,
      signal: request.signal,
    },
  );
}

function hostContext(
  pluginId: PluginId,
  version: string,
  availability: ReadonlyMap<string, PluginContributionAvailabilityEntryV1>,
): FrontendPluginHostContextV1 {
  const shared = installSharedRuntime();
  const locale =
    (typeof document !== 'undefined' &&
      document.documentElement.lang.trim()) ||
    (typeof navigator !== 'undefined' && navigator.language
      ? navigator.language
      : 'en');
  const uiPreferences = pluginUiPreferencesV1({
    locale,
    reducedMotion:
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  return {
    plugin: { id: pluginId, version },
    api: {
      request: <T,>(
        operationId: string,
        request?: Parameters<FrontendPluginHostContextV1['api']['request']>[1],
      ) => requestPluginOperation<T>(pluginId, operationId, request),
      stream: <T,>(
        operationId: string,
        request: Parameters<
          NonNullable<FrontendPluginHostContextV1['api']['stream']>
        >[1],
      ) => streamPluginOperation<T>(pluginId, operationId, request),
    },
    availability: {
      get(contributionId) {
        return (
          availability.get(contributionId) ?? Object.freeze({
            contributionId,
            available: false,
            reasonCode: 'dependency_unavailable',
          })
        );
      },
      isAvailable(contributionId) {
        return availability.get(contributionId)?.available ?? false;
      },
      reason(contributionId) {
        return (
          availability.get(contributionId)?.reasonCode ??
          'dependency_unavailable'
        );
      },
    },
    navigation: {
      toContribution(contributionId, params = {}) {
        const rootRoute = registry
          .getRoutes('root')
          .find((candidate) => candidate.id === contributionId);
        const tenantRoute = registry
          .getRoutes('tenant')
          .find((candidate) => candidate.id === contributionId);
        const route = rootRoute ?? tenantRoute;
        if (!route) return;
        const path = contributionNavigationPath(route.relativePath, params);
        const tenantMatch = window.location.pathname.match(
          /^\/t\/([A-Za-z0-9_-]+)(?:\/|$)/,
        );
        if (tenantRoute && !tenantMatch?.[1]) return;
        const prefix = tenantRoute
          ? `/t/${encodeURIComponent(tenantMatch![1])}`
          : '';
        window.history.pushState({}, '', `${prefix}/${path}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
    },
    notifications: {
      show(input) {
        window.dispatchEvent(
          new CustomEvent('enterpriseglue:plugin-notification:v1', {
            detail: input,
          }),
        );
      },
    },
    telemetry: {
      event(name, attributes = {}) {
        if (!name.startsWith(`${pluginId}.`) || name.length > 250) return;
        window.dispatchEvent(
          new CustomEvent('enterpriseglue:plugin-telemetry:v1', {
            detail: { pluginId, name, attributes },
          }),
        );
      },
    },
    ui: {
      theme: 'g100',
      density: 'normal',
      ...uiPreferences,
      primitives: pluginUiPrimitivesV1,
    },
    shared,
  };
}

function contributionAvailabilitySnapshot(
  manifest: EnterpriseGluePluginManifestV1,
  input: unknown,
): {
  availableContributionIds: string[];
  entries: ReadonlyMap<string, PluginContributionAvailabilityEntryV1>;
} {
  const declaration = manifest.contributionAvailability;
  const allIds = manifest.contributions.map((contribution) => contribution.id);
  if (!declaration) {
    return {
      availableContributionIds: allIds,
      entries: new Map(
        allIds.map((contributionId) => [
          contributionId,
          { contributionId, available: true, reasonCode: 'available' },
        ]),
      ),
    };
  }
  const gatedIds = new Set(declaration.gatedContributionIds);
  const projection =
    pluginContributionAvailabilityProjectionV1Schema.safeParse(input);
  const validProjection =
    projection.success &&
    Date.parse(projection.data.validUntil) > Date.now() &&
    projection.data.contributions.length === gatedIds.size &&
    projection.data.contributions.every((entry) =>
      gatedIds.has(entry.contributionId),
    )
      ? projection.data
      : undefined;
  const projectedById = new Map(
    (validProjection?.contributions ?? []).map((entry) => [
      entry.contributionId,
      entry,
    ]),
  );
  const entries = new Map<string, PluginContributionAvailabilityEntryV1>();
  const availableContributionIds: string[] = [];
  for (const contributionId of allIds) {
    const resolvedEntry = gatedIds.has(contributionId)
      ? (projectedById.get(contributionId) ?? {
          contributionId,
          available: false,
          reasonCode: 'dependency_unavailable' as const,
        })
      : {
          contributionId,
          available: true,
          reasonCode: 'available' as const,
        };
    const entry: PluginContributionAvailabilityEntryV1 = Object.freeze({
      ...resolvedEntry,
    });
    entries.set(contributionId, entry);
    if (entry.available) availableContributionIds.push(contributionId);
  }
  return { availableContributionIds, entries };
}

async function defaultImporter(url: string): Promise<unknown> {
  return import(/* @vite-ignore */ url);
}

export async function activateNativePluginBootstrapV1(
  input: unknown,
  importer: PluginImporter = defaultImporter,
  circuit: PluginFrontendFailureCircuitV1 = failureCircuit,
): Promise<NativePluginLoadResultV1> {
  if (!isBootstrap(input)) {
    return {
      revision: 0,
      activePluginIds: [],
      failures: [{ code: 'bootstrap_invalid' }],
    };
  }

  for (const module of activeModules.values()) {
    try {
      await module.deactivate?.();
    } catch {
      // One plugin's cleanup failure must not block replacement of the full
      // owner-aware registry. Plugin-provided exception content is omitted.
      console.error('[Plugin runtime] A frontend plugin failed to deactivate');
    }
  }
  activeModules.clear();
  registry.clear();
  installSharedRuntime();

  const failures: NativePluginLoadFailureV1[] = [];
  for (const record of input.plugins) {
    const target: PluginFrontendFailureTargetV1 = {
      pluginId: record.pluginId,
      version: record.version,
      bootstrapRevision: input.revision,
    };
    if (circuit.isQuarantined(target)) {
      console.error(
        `[Plugin runtime] Frontend plugin ${record.pluginId} is temporarily quarantined after repeated activation failures`,
      );
      failures.push({
        pluginId: record.pluginId,
        code: 'activation_quarantined',
      });
      continue;
    }
    let module: PluginFrontendModuleV1 | null = null;
    try {
      const manifest = parseEnterpriseGluePluginManifestV1(record.manifest);
      const frontend = manifest.deployment.frontend;
      if (
        manifest.metadata.id !== record.pluginId ||
        manifest.metadata.version !== record.version ||
        !frontend ||
        record.entryUrl !==
          expectedEntryUrl(record.pluginId, record.version, frontend.entry)
      ) {
        recordFrontendFailure(
          failures,
          circuit,
          target,
          'entry_url_invalid',
        );
        continue;
      }
      module = resolveModule(await importer(record.entryUrl));
      if (
        !module ||
        module.pluginId !== record.pluginId ||
        module.version !== record.version
      ) {
        recordFrontendFailure(
          failures,
          circuit,
          target,
          'module_invalid',
        );
        continue;
      }
      const availability = contributionAvailabilitySnapshot(
        manifest,
        record.contributionAvailability,
      );
      const contributions = await module.activate(
        hostContext(record.pluginId, record.version, availability.entries),
      );
      registry.activate({
        pluginId: record.pluginId,
        version: record.version,
        manifest,
        contributions,
        availableContributionIds: availability.availableContributionIds,
      });
      activeModules.set(record.pluginId, module);
      circuit.clear(target);
    } catch {
      try {
        await module?.deactivate?.();
      } catch {
        // Best-effort cleanup; never include plugin exception content.
      }
      recordFrontendFailure(
        failures,
        circuit,
        target,
        'activation_failed',
      );
    }
  }

  return {
    revision: input.revision,
    activePluginIds: registry.listPlugins().map((plugin) => plugin.pluginId),
    failures,
  };
}

function recordFrontendFailure(
  failures: NativePluginLoadFailureV1[],
  circuit: PluginFrontendFailureCircuitV1,
  target: PluginFrontendFailureTargetV1,
  code: PluginFrontendFailureCodeV1,
): void {
  const result = circuit.recordFailure(target, code);
  console.error(
    `[Plugin runtime] Frontend plugin ${target.pluginId} failed with ${code}${
      result.quarantined ? ' and was temporarily quarantined' : ''
    }`,
  );
  failures.push({ pluginId: target.pluginId, code });
}

export function loadInstalledNativePluginsV1(): Promise<NativePluginLoadResultV1> {
  if (!loadPromise) {
    const tenantMatch =
      typeof window !== 'undefined'
        ? window.location.pathname.match(/^\/t\/([A-Za-z0-9_-]+)(?:\/|$)/)
        : null;
    const bootstrapApi = tenantMatch?.[1]
      ? `/t/${encodeURIComponent(tenantMatch[1])}${FRONTEND_BOOTSTRAP_API}`
      : FRONTEND_BOOTSTRAP_API;
    loadPromise = apiClient
      .get<unknown>(bootstrapApi, undefined, {
        credentials: 'include',
      })
      .then((bootstrap) => activateNativePluginBootstrapV1(bootstrap))
      .catch(() => ({
        revision: 0,
        activePluginIds: [],
        failures: [{ code: 'bootstrap_unavailable' as const }],
      }));
  }
  return loadPromise;
}

class PluginErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // Deliberately omit the exception and plugin-provided content from logs.
    console.error('[Plugin runtime] A frontend contribution failed to render');
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function PluginRouteElement({
  component: Component,
}: {
  component: React.ComponentType<PluginRoutePropsV1>;
}) {
  const routeParams = useParams();
  const [searchParams] = useSearchParams();
  const params = {
    ...Object.fromEntries(searchParams.entries()),
    ...Object.fromEntries(
      Object.entries(routeParams).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
  };
  return (
    <PluginErrorBoundary>
      <Component
        params={params}
        tenantRef={routeParams.tenantSlug}
      />
    </PluginErrorBoundary>
  );
}

export function getNativePluginRoutesV1(
  scope: 'root' | 'tenant',
): RouteObject[] {
  return registry.getRoutes(scope).map((route) => ({
    path: route.relativePath,
    element: <PluginRouteElement component={route.component} />,
  }));
}

export function getNativePluginNavigationV1(): NativePluginNavigationV1[] {
  const routes = new Map(
    [...registry.getRoutes('root'), ...registry.getRoutes('tenant')].map(
      (route) => [route.id, route],
    ),
  );
  return (
    ['main', 'tenant', 'settings', 'administration'] as const
  ).flatMap((section) =>
    registry.getNavigation(section).flatMap((navigation) => {
      const route = routes.get(navigation.routeId);
      return route
        ? [
            {
              id: navigation.id,
              label: navigation.label,
              path: `/${route.relativePath}`,
              section,
              order: navigation.order,
              pluginId: navigation.pluginId,
              scope: route.scope,
            },
          ]
        : [];
    }),
  );
}

export function NativePluginSlotV1<Slot extends PluginSlotIdV1>({
  slot,
  context,
}: {
  slot: Slot;
  context: Omit<PluginSlotContextMapV1[Slot], 'slot'>;
}) {
  const contributions = registry.getSlotContributions(slot);
  if (contributions.length === 0) return null;
  return (
    <>
      {contributions.map((contribution) => {
        const Component = contribution.component as React.ComponentType<
          PluginSlotContextMapV1[Slot]
        >;
        const slotContext = {
          ...context,
          slot,
        } as PluginSlotContextMapV1[Slot];
        return (
          <PluginErrorBoundary key={`${contribution.pluginId}:${contribution.id}`}>
            <Component {...slotContext} />
          </PluginErrorBoundary>
        );
      })}
    </>
  );
}

export const __nativePluginRuntimeTestUtils = {
  registry,
  failureCircuit,
  expectedEntryUrl,
  resolveModule,
  contributionNavigationPath,
};
