import type {
  EnterpriseGluePluginManifestV1,
  FrontendContributionSetV1,
  PluginId,
  PluginNavigationContributionV1,
  PluginRouteContributionV1,
  PluginSettingsContributionV1,
  PluginSlotContributionV1,
  PluginSlotIdV1,
  SemVer,
} from '@enterpriseglue/plugin-sdk';

export type PluginFrontendRegistryErrorCode =
  | 'plugin_already_active'
  | 'plugin_not_active'
  | 'plugin_identity_mismatch'
  | 'contribution_not_namespaced'
  | 'duplicate_contribution_id'
  | 'invalid_route_path'
  | 'invalid_contribution_availability'
  | 'missing_route_reference'
  | 'manifest_contribution_mismatch';

export class PluginFrontendRegistryError extends Error {
  constructor(
    public readonly code: PluginFrontendRegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PluginFrontendRegistryError';
  }
}

export interface PluginFrontendActivationV1 {
  pluginId: PluginId;
  version: SemVer;
  manifest: EnterpriseGluePluginManifestV1;
  contributions: FrontendContributionSetV1;
  /**
   * Optional host-filtered visibility set. Full runtime contributions are
   * validated against the signed manifest before this set is applied.
   */
  availableContributionIds?: readonly string[];
}

export interface ActiveFrontendPluginV1 {
  pluginId: PluginId;
  version: SemVer;
  contributions: Readonly<NormalizedFrontendContributionSetV1>;
}

interface NormalizedFrontendContributionSetV1 {
  routes: PluginRouteContributionV1[];
  navigation: PluginNavigationContributionV1[];
  slots: PluginSlotContributionV1[];
  settings: PluginSettingsContributionV1[];
}

function normalizeContributions(
  contributions: FrontendContributionSetV1,
): NormalizedFrontendContributionSetV1 {
  return {
    routes: [...(contributions.routes ?? [])],
    navigation: [...(contributions.navigation ?? [])],
    slots: [...(contributions.slots ?? [])],
    settings: [...(contributions.settings ?? [])],
  };
}

function allRuntimeContributions(
  contributions: NormalizedFrontendContributionSetV1,
): Array<
  | (PluginRouteContributionV1 & { kind: 'route' })
  | (PluginNavigationContributionV1 & { kind: 'navigation' })
  | (PluginSlotContributionV1 & { kind: 'slot' })
  | (PluginSettingsContributionV1 & { kind: 'settings' })
> {
  return [
    ...contributions.routes.map((contribution) => ({
      ...contribution,
      kind: 'route' as const,
    })),
    ...contributions.navigation.map((contribution) => ({
      ...contribution,
      kind: 'navigation' as const,
    })),
    ...contributions.slots.map((contribution) => ({
      ...contribution,
      kind: 'slot' as const,
    })),
    ...contributions.settings.map((contribution) => ({
      ...contribution,
      kind: 'settings' as const,
    })),
  ];
}

function isSafeRoutePath(path: string): boolean {
  if (
    path.length === 0 ||
    path.length > 500 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('?') ||
    path.includes('#')
  ) {
    return false;
  }

  return !path
    .split('/')
    .some((segment) => segment === '' || segment === '.' || segment === '..');
}

function compareOrdered(
  a: { id: string; order?: number; pluginId: PluginId },
  b: { id: string; order?: number; pluginId: PluginId },
): number {
  return (
    (a.order ?? 100) - (b.order ?? 100) ||
    a.pluginId.localeCompare(b.pluginId) ||
    a.id.localeCompare(b.id)
  );
}

function assertActivationValid(
  activation: PluginFrontendActivationV1,
): NormalizedFrontendContributionSetV1 {
  if (
    activation.manifest.metadata.id !== activation.pluginId ||
    activation.manifest.metadata.version !== activation.version
  ) {
    throw new PluginFrontendRegistryError(
      'plugin_identity_mismatch',
      'Activation identity/version must match the signed manifest',
    );
  }

  const normalized = normalizeContributions(activation.contributions);
  const runtimeContributions = allRuntimeContributions(normalized);
  const runtimeIds = new Set<string>();
  const namespace = `${activation.pluginId}.`;

  for (const contribution of runtimeContributions) {
    if (!contribution.id.startsWith(namespace)) {
      throw new PluginFrontendRegistryError(
        'contribution_not_namespaced',
        `Contribution ${contribution.id} is not namespaced by ${activation.pluginId}`,
      );
    }
    if (runtimeIds.has(contribution.id)) {
      throw new PluginFrontendRegistryError(
        'duplicate_contribution_id',
        `Contribution ${contribution.id} is declared more than once`,
      );
    }
    runtimeIds.add(contribution.id);
  }

  for (const route of normalized.routes) {
    if (!isSafeRoutePath(route.relativePath)) {
      throw new PluginFrontendRegistryError(
        'invalid_route_path',
        `Route ${route.id} has an unsafe relative path`,
      );
    }
  }

  const routeIds = new Set(normalized.routes.map((route) => route.id));
  for (const navigation of normalized.navigation) {
    if (!routeIds.has(navigation.routeId)) {
      throw new PluginFrontendRegistryError(
        'missing_route_reference',
        `Navigation ${navigation.id} references missing route ${navigation.routeId}`,
      );
    }
  }
  for (const settings of normalized.settings) {
    if (!routeIds.has(settings.routeId)) {
      throw new PluginFrontendRegistryError(
        'missing_route_reference',
        `Settings contribution ${settings.id} references missing route ${settings.routeId}`,
      );
    }
  }

  const declaredById = new Map(
    activation.manifest.contributions.map((contribution) => [
      contribution.id,
      contribution,
    ]),
  );

  if (declaredById.size !== runtimeContributions.length) {
    throw new PluginFrontendRegistryError(
      'manifest_contribution_mismatch',
      'Runtime contributions must exactly match the signed manifest contribution set',
    );
  }

  for (const runtime of runtimeContributions) {
    const declared = declaredById.get(runtime.id);
    if (!declared || declared.kind !== runtime.kind) {
      throw new PluginFrontendRegistryError(
        'manifest_contribution_mismatch',
        `Runtime contribution ${runtime.id} is not declared with kind ${runtime.kind}`,
      );
    }

    const matches =
      (runtime.kind === 'route' &&
        declared.kind === 'route' &&
        runtime.scope === declared.scope &&
        runtime.relativePath === declared.relativePath) ||
      (runtime.kind === 'navigation' &&
        declared.kind === 'navigation' &&
        runtime.routeId === declared.routeId &&
        runtime.section === declared.section) ||
      (runtime.kind === 'slot' &&
        declared.kind === 'slot' &&
        runtime.slot === declared.slot) ||
      (runtime.kind === 'settings' &&
        declared.kind === 'settings' &&
        runtime.routeId === declared.routeId &&
        runtime.scope === declared.scope);

    if (!matches) {
      throw new PluginFrontendRegistryError(
        'manifest_contribution_mismatch',
        `Runtime contribution ${runtime.id} differs from the signed manifest`,
      );
    }
  }

  return normalized;
}

function filterAvailableContributions(
  contributions: NormalizedFrontendContributionSetV1,
  availableContributionIds: readonly string[] | undefined,
): NormalizedFrontendContributionSetV1 {
  if (availableContributionIds === undefined) return contributions;
  const available = new Set(availableContributionIds);
  if (available.size !== availableContributionIds.length) {
    throw new PluginFrontendRegistryError(
      'invalid_contribution_availability',
      'Available contribution IDs must be unique',
    );
  }
  const declaredIds = new Set(
    allRuntimeContributions(contributions).map(
      (contribution) => contribution.id,
    ),
  );
  for (const contributionId of available) {
    if (!declaredIds.has(contributionId)) {
      throw new PluginFrontendRegistryError(
        'invalid_contribution_availability',
        `Available contribution ${contributionId} is not declared`,
      );
    }
  }
  const routes = contributions.routes.filter((route) =>
    available.has(route.id),
  );
  const routeIds = new Set(routes.map((route) => route.id));
  return {
    routes,
    navigation: contributions.navigation.filter(
      (navigation) =>
        available.has(navigation.id) && routeIds.has(navigation.routeId),
    ),
    slots: contributions.slots.filter((slot) => available.has(slot.id)),
    settings: contributions.settings.filter(
      (settings) =>
        available.has(settings.id) && routeIds.has(settings.routeId),
    ),
  };
}

function copyActivePlugin(
  record: ActiveFrontendPluginV1,
): ActiveFrontendPluginV1 {
  return {
    pluginId: record.pluginId,
    version: record.version,
    contributions: normalizeContributions(record.contributions),
  };
}

export class PluginFrontendRegistry {
  private readonly active = new Map<PluginId, ActiveFrontendPluginV1>();

  activate(activation: PluginFrontendActivationV1): ActiveFrontendPluginV1 {
    if (this.active.has(activation.pluginId)) {
      throw new PluginFrontendRegistryError(
        'plugin_already_active',
        `Plugin ${activation.pluginId} is already active`,
      );
    }

    const contributions = filterAvailableContributions(
      assertActivationValid(activation),
      activation.availableContributionIds,
    );
    const record: ActiveFrontendPluginV1 = {
      pluginId: activation.pluginId,
      version: activation.version,
      contributions,
    };
    this.active.set(activation.pluginId, record);
    return copyActivePlugin(record);
  }

  replace(activation: PluginFrontendActivationV1): ActiveFrontendPluginV1 {
    if (!this.active.has(activation.pluginId)) {
      throw new PluginFrontendRegistryError(
        'plugin_not_active',
        `Plugin ${activation.pluginId} is not active`,
      );
    }

    // Validate first. If this throws, the previous record remains active.
    const contributions = filterAvailableContributions(
      assertActivationValid(activation),
      activation.availableContributionIds,
    );
    const record: ActiveFrontendPluginV1 = {
      pluginId: activation.pluginId,
      version: activation.version,
      contributions,
    };
    this.active.set(activation.pluginId, record);
    return copyActivePlugin(record);
  }

  deactivate(pluginId: PluginId): boolean {
    return this.active.delete(pluginId);
  }

  getPlugin(pluginId: PluginId): ActiveFrontendPluginV1 | undefined {
    const record = this.active.get(pluginId);
    return record ? copyActivePlugin(record) : undefined;
  }

  listPlugins(): ActiveFrontendPluginV1[] {
    return [...this.active.values()]
      .sort((a, b) => a.pluginId.localeCompare(b.pluginId))
      .map(copyActivePlugin);
  }

  getRoutes(scope: 'root' | 'tenant'): Array<
    PluginRouteContributionV1 & { pluginId: PluginId }
  > {
    return [...this.active.values()]
      .flatMap((plugin) =>
        plugin.contributions.routes
          .filter((route) => route.scope === scope)
          .map((route) => ({ ...route, pluginId: plugin.pluginId })),
      )
      .sort(
        (a, b) =>
          a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
      );
  }

  getNavigation(
    section: PluginNavigationContributionV1['section'],
  ): Array<PluginNavigationContributionV1 & { pluginId: PluginId }> {
    return [...this.active.values()]
      .flatMap((plugin) =>
        plugin.contributions.navigation
          .filter((navigation) => navigation.section === section)
          .map((navigation) => ({
            ...navigation,
            pluginId: plugin.pluginId,
          })),
      )
      .sort(compareOrdered);
  }

  getSlotContributions(
    slot: PluginSlotIdV1,
  ): Array<PluginSlotContributionV1 & { pluginId: PluginId }> {
    return [...this.active.values()]
      .flatMap((plugin) =>
        plugin.contributions.slots
          .filter((contribution) => contribution.slot === slot)
          .map((contribution) => ({
            ...contribution,
            pluginId: plugin.pluginId,
          })),
      )
      .sort(compareOrdered);
  }

  getSettings(
    scope: PluginSettingsContributionV1['scope'],
  ): Array<PluginSettingsContributionV1 & { pluginId: PluginId }> {
    return [...this.active.values()]
      .flatMap((plugin) =>
        plugin.contributions.settings
          .filter((settings) => settings.scope === scope)
          .map((settings) => ({
            ...settings,
            pluginId: plugin.pluginId,
          })),
      )
      .sort(compareOrdered);
  }

  clear(): void {
    this.active.clear();
  }
}
