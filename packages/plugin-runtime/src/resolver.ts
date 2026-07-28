import type {
  EnterpriseGluePluginManifestV1,
  PluginId,
  PluginPermissionV1,
  PluginPlatformCapabilityCatalogV1,
  PluginSlotIdV1,
  SharedFrontendRuntimeV1,
} from '@enterpriseglue/plugin-sdk';
import { satisfies, validRange } from 'semver';

export type PluginResolutionIssueCode =
  | 'duplicate_plugin'
  | 'untrusted_publisher'
  | 'invalid_version_range'
  | 'incompatible_host'
  | 'incompatible_sdk'
  | 'unsupported_frontend_protocol'
  | 'unsupported_backend_protocol'
  | 'incompatible_shared_runtime'
  | 'missing_slot'
  | 'unknown_permission'
  | 'unapproved_egress_policy'
  | 'missing_dependency'
  | 'incompatible_dependency'
  | 'dependency_cycle'
  | 'plugin_conflict';

export interface PluginResolutionIssueV1 {
  code: PluginResolutionIssueCode;
  pluginId: PluginId;
  field: string;
  relatedPluginId?: PluginId;
  detail?: string;
}

export interface PluginHostCapabilitiesV1 {
  hostVersion: string;
  sdkVersion: string;
  supportedSdkVersions: ReadonlySet<string>;
  frontendProtocol: 1;
  backendProtocol: 1;
  sharedFrontend: SharedFrontendRuntimeV1;
  slots: ReadonlySet<PluginSlotIdV1>;
  permissions: ReadonlySet<PluginPermissionV1>;
  egressPolicies: ReadonlySet<string>;
  trustedPublishers: ReadonlySet<PluginId>;
}

export interface PluginResolutionV1 {
  compatible: boolean;
  activationOrder: PluginId[];
  issues: PluginResolutionIssueV1[];
}

/**
 * Convert the closed, admin-visible host catalog into the exact resolver
 * capability sets. Keeping one projection as the source prevents the runtime,
 * installer documentation, and future plugin-author tooling from silently
 * drifting to different permission/slot/event/egress assumptions.
 */
export function pluginHostCapabilitiesFromCatalogV1(
  catalog: PluginPlatformCapabilityCatalogV1,
): PluginHostCapabilitiesV1 {
  return {
    hostVersion: catalog.compatibility.hostVersion,
    sdkVersion: catalog.compatibility.sdkVersion,
    supportedSdkVersions: new Set(
      catalog.compatibility.supportWindow.sdkVersions,
    ),
    frontendProtocol: catalog.compatibility.frontendProtocols[0],
    backendProtocol: catalog.compatibility.backendProtocols[0],
    sharedFrontend: catalog.compatibility.sharedFrontend,
    slots: new Set(catalog.slots.map((entry) => entry.id)),
    permissions: new Set(catalog.permissions.map((entry) => entry.id)),
    egressPolicies: new Set(
      catalog.egressPolicies.map((entry) => entry.id),
    ),
    trustedPublishers: new Set(
      catalog.trustedPublishers.map((entry) => entry.id),
    ),
  };
}

export interface IsolatedPluginResolutionV1 {
  activationOrder: PluginId[];
  disabledPluginIds: PluginId[];
  issues: PluginResolutionIssueV1[];
}

function exactRuntimeMatches(
  plugin: SharedFrontendRuntimeV1,
  host: SharedFrontendRuntimeV1,
): boolean {
  return (
    plugin.react === host.react &&
    plugin.reactDom === host.reactDom &&
    plugin.router === host.router &&
    plugin.carbonReact === host.carbonReact
  );
}

function rangeMatches(version: string, range: string): boolean | undefined {
  if (!validRange(range)) {
    return undefined;
  }
  return satisfies(version, range, { includePrerelease: true });
}

function sortIssues(
  left: PluginResolutionIssueV1,
  right: PluginResolutionIssueV1,
): number {
  return (
    left.pluginId.localeCompare(right.pluginId) ||
    left.code.localeCompare(right.code) ||
    left.field.localeCompare(right.field) ||
    (left.relatedPluginId ?? '').localeCompare(right.relatedPluginId ?? '')
  );
}

function indexPluginManifests(
  manifests: readonly EnterpriseGluePluginManifestV1[],
): {
  byId: Map<PluginId, EnterpriseGluePluginManifestV1>;
  issues: PluginResolutionIssueV1[];
} {
  const byId = new Map<PluginId, EnterpriseGluePluginManifestV1>();
  const issues: PluginResolutionIssueV1[] = [];

  for (const manifest of manifests) {
    const pluginId = manifest.metadata.id;
    if (byId.has(pluginId)) {
      issues.push({
        code: 'duplicate_plugin',
        pluginId,
        field: 'metadata.id',
      });
      continue;
    }
    byId.set(pluginId, manifest);
  }

  return { byId, issues };
}

/**
 * Resolve only relationships inside a desired plugin set.
 *
 * This product-neutral contract is shared by deployment authorities and the
 * host runtime. It deliberately excludes host capability checks so an
 * installer can reject dependency-breaking state before it writes desired
 * state or invokes a Compose/Kubernetes reconciler.
 */
export function resolvePluginRelationshipsV1(
  manifests: readonly EnterpriseGluePluginManifestV1[],
): PluginResolutionV1 {
  const { byId, issues } = indexPluginManifests(manifests);

  for (const manifest of byId.values()) {
    const pluginId = manifest.metadata.id;

    for (const dependency of manifest.dependencies) {
      const installed = byId.get(dependency.id);
      if (!installed) {
        if (!dependency.optional) {
          issues.push({
            code: 'missing_dependency',
            pluginId,
            field: 'dependencies',
            relatedPluginId: dependency.id,
          });
        }
        continue;
      }

      const match = rangeMatches(installed.metadata.version, dependency.version);
      if (match === undefined) {
        issues.push({
          code: 'invalid_version_range',
          pluginId,
          field: 'dependencies.version',
          relatedPluginId: dependency.id,
        });
      } else if (!match) {
        issues.push({
          code: 'incompatible_dependency',
          pluginId,
          field: 'dependencies.version',
          relatedPluginId: dependency.id,
        });
      }
    }

    for (const conflict of manifest.conflicts) {
      const installed = byId.get(conflict.id);
      if (!installed) continue;

      const match = rangeMatches(installed.metadata.version, conflict.version);
      if (match === undefined) {
        issues.push({
          code: 'invalid_version_range',
          pluginId,
          field: 'conflicts.version',
          relatedPluginId: conflict.id,
        });
      } else if (match) {
        issues.push({
          code: 'plugin_conflict',
          pluginId,
          field: 'conflicts',
          relatedPluginId: conflict.id,
        });
      }
    }
  }

  const visiting = new Set<PluginId>();
  const visited = new Set<PluginId>();
  const activationOrder: PluginId[] = [];
  const cyclic = new Set<PluginId>();

  const visit = (pluginId: PluginId, path: PluginId[]) => {
    if (visited.has(pluginId)) return;
    if (visiting.has(pluginId)) {
      const cycleStart = path.indexOf(pluginId);
      for (const id of path.slice(cycleStart)) cyclic.add(id);
      cyclic.add(pluginId);
      return;
    }

    visiting.add(pluginId);
    const manifest = byId.get(pluginId);
    const dependencies = (manifest?.dependencies ?? [])
      .filter((dependency) => byId.has(dependency.id))
      .map((dependency) => dependency.id)
      .sort();
    for (const dependencyId of dependencies) {
      visit(dependencyId, [...path, pluginId]);
    }
    visiting.delete(pluginId);
    visited.add(pluginId);
    activationOrder.push(pluginId);
  };

  for (const pluginId of [...byId.keys()].sort()) {
    visit(pluginId, []);
  }

  for (const pluginId of cyclic) {
    issues.push({
      code: 'dependency_cycle',
      pluginId,
      field: 'dependencies',
    });
  }

  issues.sort(sortIssues);
  if (issues.length > 0) {
    return {
      compatible: false,
      activationOrder: [],
      issues,
    };
  }

  return {
    compatible: true,
    activationOrder,
    issues: [],
  };
}

/**
 * Resolve a complete desired plugin set before any code is loaded.
 *
 * Resolution is fail-closed: if any issue exists, no activation order is
 * returned. Optional dependencies may be absent, but if installed they must be
 * version-compatible.
 */
export function resolvePluginSetV1(
  manifests: readonly EnterpriseGluePluginManifestV1[],
  host: PluginHostCapabilitiesV1,
): PluginResolutionV1 {
  const relationshipResolution = resolvePluginRelationshipsV1(manifests);
  const issues = [...relationshipResolution.issues];
  const { byId } = indexPluginManifests(manifests);

  for (const manifest of byId.values()) {
    const pluginId = manifest.metadata.id;
    if (!host.trustedPublishers.has(manifest.metadata.publisher)) {
      issues.push({
        code: 'untrusted_publisher',
        pluginId,
        field: 'metadata.publisher',
      });
    }

    const hostMatch = rangeMatches(
      host.hostVersion,
      manifest.compatibility.host,
    );
    if (hostMatch === undefined) {
      issues.push({
        code: 'invalid_version_range',
        pluginId,
        field: 'compatibility.host',
      });
    } else if (!hostMatch) {
      issues.push({
        code: 'incompatible_host',
        pluginId,
        field: 'compatibility.host',
      });
    }

    const sdkRange = validRange(manifest.compatibility.sdk);
    if (!sdkRange) {
      issues.push({
        code: 'invalid_version_range',
        pluginId,
        field: 'compatibility.sdk',
      });
    } else {
      const declaredFrontendSdk =
        manifest.deployment.frontend?.shared.pluginSdk;
      const sdkCandidates = declaredFrontendSdk
        ? [declaredFrontendSdk]
        : [...host.supportedSdkVersions];
      if (
        !sdkCandidates.some(
          (version) =>
            satisfies(version, sdkRange, { includePrerelease: true }),
        )
      ) {
        issues.push({
          code: 'incompatible_sdk',
          pluginId,
          field: 'compatibility.sdk',
        });
      }
    }

    if (
      manifest.deployment.frontend &&
      !host.supportedSdkVersions.has(
        manifest.deployment.frontend.shared.pluginSdk,
      )
    ) {
      issues.push({
        code: 'incompatible_shared_runtime',
        pluginId,
        field: 'deployment.frontend.shared.pluginSdk',
      });
    }

    if (
      manifest.deployment.frontend &&
      manifest.compatibility.frontendProtocol !== host.frontendProtocol
    ) {
      issues.push({
        code: 'unsupported_frontend_protocol',
        pluginId,
        field: 'compatibility.frontendProtocol',
      });
    }
    if (
      manifest.deployment.backend &&
      manifest.compatibility.backendProtocol !== host.backendProtocol
    ) {
      issues.push({
        code: 'unsupported_backend_protocol',
        pluginId,
        field: 'compatibility.backendProtocol',
      });
    }
    if (
      manifest.deployment.frontend &&
      !exactRuntimeMatches(
        manifest.deployment.frontend.shared,
        host.sharedFrontend,
      )
    ) {
      issues.push({
        code: 'incompatible_shared_runtime',
        pluginId,
        field: 'deployment.frontend.shared',
      });
    }

    for (const slot of manifest.compatibility.requiredSlots) {
      if (!host.slots.has(slot)) {
        issues.push({
          code: 'missing_slot',
          pluginId,
          field: 'compatibility.requiredSlots',
          detail: slot,
        });
      }
    }

    for (const permission of manifest.permissions.required) {
      if (!host.permissions.has(permission)) {
        issues.push({
          code: 'unknown_permission',
          pluginId,
          field: 'permissions.required',
          detail: permission,
        });
      }
    }

    if (
      manifest.network.egressPolicy !== 'none' &&
      !host.egressPolicies.has(manifest.network.egressPolicy)
    ) {
      issues.push({
        code: 'unapproved_egress_policy',
        pluginId,
        field: 'network.egressPolicy',
      });
    }

  }

  issues.sort(sortIssues);
  if (issues.length > 0) {
    return {
      compatible: false,
      activationOrder: [],
      issues,
    };
  }

  return {
    compatible: true,
    activationOrder: relationshipResolution.activationOrder,
    issues: [],
  };
}

/**
 * Resolves the largest dependency-consistent subset that is safe to activate.
 *
 * A failing plugin and any dependants that become unsatisfied are disabled, while unrelated
 * compatible plugins remain available. Issues remain reason-coded for administration. This is
 * intentionally separate from `resolvePluginSetV1`, whose all-or-nothing behavior is still used
 * for atomic installer transactions.
 */
export function resolveIsolatedPluginSetV1(
  manifests: readonly EnterpriseGluePluginManifestV1[],
  host: PluginHostCapabilitiesV1,
): IsolatedPluginResolutionV1 {
  let remaining = [...manifests];
  const issues: PluginResolutionIssueV1[] = [];
  const disabled = new Set<PluginId>();

  while (remaining.length > 0) {
    const resolution = resolvePluginSetV1(remaining, host);
    if (resolution.compatible) {
      return {
        activationOrder: resolution.activationOrder,
        disabledPluginIds: [...disabled].sort(),
        issues: issues.sort(sortIssues),
      };
    }
    const rejected = new Set(resolution.issues.map((issue) => issue.pluginId));
    if (rejected.size === 0) break;
    for (const issue of resolution.issues) {
      if (
        !issues.some(
          (existing) =>
            existing.code === issue.code &&
            existing.pluginId === issue.pluginId &&
            existing.field === issue.field &&
            existing.relatedPluginId === issue.relatedPluginId &&
            existing.detail === issue.detail,
        )
      ) {
        issues.push(issue);
      }
      disabled.add(issue.pluginId);
    }
    remaining = remaining.filter(
      (manifest) => !rejected.has(manifest.metadata.id),
    );
  }

  return {
    activationOrder: [],
    disabledPluginIds: [...disabled].sort(),
    issues: issues.sort(sortIssues),
  };
}
