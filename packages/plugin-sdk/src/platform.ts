import { z } from 'zod';

import {
  pluginEventTypeSchema,
  pluginIdSchema,
  pluginPermissionSchema,
  pluginPermissionValues,
  pluginSlotIdSchema,
  pluginSlotIdValues,
  semVerSchema,
  type PluginEventTypeV1,
  type PluginId,
  type PluginPermissionV1,
  type PluginSlotIdV1,
} from './common.js';

export const pluginPlatformCatalogRevisionV1 = '2026-08-24.1';

/**
 * Release identity consumed by the OSS host, reference plugin, installer
 * evidence, and private-plugin compatibility checks. Keeping this alongside
 * the capability schema prevents product, SDK, and shared-frontend versions
 * from being assembled independently in different host entry points.
 */
export const pluginPlatformReleaseIdentityV1 = {
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
} as const;

/**
 * Return the supported semantic-version range for one release minor line.
 * Plugin manifests and release fixtures use this helper so advancing the
 * canonical host or SDK identity cannot leave checked-in compatibility
 * ranges behind.
 */
export function pluginMinorCompatibilityRangeV1(version: string): string {
  const [major, minor] = semVerSchema.parse(version).split('.').map(Number);
  return `>=${major}.${minor}.0 <${major}.${minor + 1}.0`;
}

const minorLineSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/);

const sharedFrontendRuntimeCatalogV1Schema = z
  .object({
    react: semVerSchema,
    reactDom: semVerSchema,
    router: semVerSchema,
    carbonReact: semVerSchema,
    pluginSdk: semVerSchema,
  })
  .strict();

const pluginPermissionCatalogEntryV1Schema = z
  .object({
    id: pluginPermissionSchema,
    broker: z.enum([
      'identity',
      'engine_metadata',
      'engine_access',
      'diagnostics',
      'events',
      'plugin_storage',
      'secret_use',
      'notifications',
      'scheduler',
    ]),
    scope: z.enum(['deployment', 'tenant', 'resource']),
    dataClass: z.enum([
      'none',
      'safe_metadata',
      'sanitized_content',
      'plugin_private',
      'credential_indirect',
    ]),
    risk: z.enum(['low', 'medium', 'high']),
    grantMode: z.literal('explicit'),
  })
  .strict();

const pluginSlotCatalogEntryV1Schema = z
  .object({
    id: pluginSlotIdSchema,
    surface: z.enum(['mission_control', 'settings', 'global_shell']),
    scope: z.enum(['deployment', 'tenant', 'resource']),
    contextVersion: z.literal(1),
    multiplicity: z.literal('many'),
    ordering: z.literal('host_deterministic'),
  })
  .strict();

const pluginEventCatalogEntryV1Schema = z
  .object({
    id: pluginEventTypeSchema,
    permission: pluginPermissionSchema,
    delivery: z.literal('at_least_once'),
    payloadClass: z.literal('safe_metadata'),
    payloadSchemaVersion: z.literal(1),
    tenantDerivedByHost: z.literal(true),
    payloadErasedAfterDelivery: z.literal(true),
  })
  .strict();

const pluginEgressPolicyCatalogEntryV1Schema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^(none|[a-z][a-z0-9-]*)$/),
    source: z.enum(['host_builtin', 'deployment']),
    enforcement: z.enum(['deny_all', 'deployment_policy']),
    credentials: z.enum(['none', 'host_broker_only']),
  })
  .strict();

const trustedPluginPublisherCatalogEntryV1Schema = z
  .object({
    id: pluginIdSchema,
    source: z.enum(['host_default', 'deployment']),
    keyMaterialExposed: z.literal(false),
  })
  .strict();

export const pluginPlatformCapabilityCatalogV1Schema = z
  .object({
    apiVersion: z.literal(
      'platform-capabilities.plugin.enterpriseglue.io/v1',
    ),
    kind: z.literal('EnterpriseGluePluginPlatformCapabilities'),
    metadata: z
      .object({
        catalogRevision: z.literal(pluginPlatformCatalogRevisionV1),
      })
      .strict(),
    compatibility: z
      .object({
        hostVersion: semVerSchema,
        sdkVersion: semVerSchema,
        frontendProtocols: z.array(z.literal(1)).length(1),
        backendProtocols: z.array(z.literal(1)).length(1),
        sharedFrontend: sharedFrontendRuntimeCatalogV1Schema,
        supportWindow: z
          .object({
            policy: z.literal(
              'current-and-previous-minor-when-available',
            ),
            hostMinorLines: z.array(minorLineSchema).min(1).max(2),
            sdkMinorLines: z.array(minorLineSchema).min(1).max(2),
            sdkVersions: z.array(semVerSchema).min(1).max(20),
            exactPrivateCiHostEvidenceRequired: z.literal(true),
          })
          .strict(),
      })
      .strict(),
    permissions: z.array(pluginPermissionCatalogEntryV1Schema).max(100),
    slots: z.array(pluginSlotCatalogEntryV1Schema).max(100),
    events: z.array(pluginEventCatalogEntryV1Schema).max(100),
    egressPolicies: z
      .array(pluginEgressPolicyCatalogEntryV1Schema)
      .min(1)
      .max(100),
    trustedPublishers: z
      .array(trustedPluginPublisherCatalogEntryV1Schema)
      .max(100),
  })
  .strict()
  .superRefine((catalog, context) => {
    for (const [field, values] of [
      [
        'permissions',
        catalog.permissions.map((entry) => entry.id),
      ],
      ['slots', catalog.slots.map((entry) => entry.id)],
      ['events', catalog.events.map((entry) => entry.id)],
      ['egressPolicies', catalog.egressPolicies.map((entry) => entry.id)],
      [
        'trustedPublishers',
        catalog.trustedPublishers.map((entry) => entry.id),
      ],
      [
        'compatibility.supportWindow.hostMinorLines',
        catalog.compatibility.supportWindow.hostMinorLines,
      ],
      [
        'compatibility.supportWindow.sdkMinorLines',
        catalog.compatibility.supportWindow.sdkMinorLines,
      ],
      [
        'compatibility.supportWindow.sdkVersions',
        catalog.compatibility.supportWindow.sdkVersions,
      ],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: 'custom',
          path: field.split('.'),
          message: 'Capability catalog identifiers must be unique',
        });
      }
    }

    const permissionIds = new Set(
      catalog.permissions.map((entry) => entry.id),
    );
    for (const [index, event] of catalog.events.entries()) {
      if (!permissionIds.has(event.permission)) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'permission'],
          message: 'Event permission must be present in the permission catalog',
        });
      }
    }

    const none = catalog.egressPolicies.find((entry) => entry.id === 'none');
    if (
      !none ||
      none.source !== 'host_builtin' ||
      none.enforcement !== 'deny_all' ||
      none.credentials !== 'none'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['egressPolicies'],
        message: 'The catalog must contain the fixed deny-all none policy',
      });
    }
    for (const [index, policy] of catalog.egressPolicies.entries()) {
      if (
        policy.id !== 'none' &&
        (policy.source !== 'deployment' ||
          policy.enforcement !== 'deployment_policy' ||
          policy.credentials !== 'host_broker_only')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['egressPolicies', index],
          message:
            'Named egress policies must remain deployment-owned and host-brokered',
        });
      }
    }

    if (
      catalog.compatibility.sharedFrontend.pluginSdk !==
      catalog.compatibility.sdkVersion
    ) {
      context.addIssue({
        code: 'custom',
        path: ['compatibility', 'sharedFrontend', 'pluginSdk'],
        message: 'Shared plugin SDK must equal the active SDK version',
      });
    }
    if (
      !catalog.compatibility.supportWindow.hostMinorLines.includes(
        minorLine(catalog.compatibility.hostVersion),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['compatibility', 'supportWindow', 'hostMinorLines'],
        message: 'Support window must include the active host minor line',
      });
    }
    if (
      !catalog.compatibility.supportWindow.sdkMinorLines.includes(
        minorLine(catalog.compatibility.sdkVersion),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['compatibility', 'supportWindow', 'sdkMinorLines'],
        message: 'Support window must include the active SDK minor line',
      });
    }
    if (
      !catalog.compatibility.supportWindow.sdkVersions.includes(
        catalog.compatibility.sdkVersion,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['compatibility', 'supportWindow', 'sdkVersions'],
        message: 'Support window must include the active SDK version',
      });
    }
    const supportedSdkMinorLines = uniqueSorted(
      catalog.compatibility.supportWindow.sdkVersions.map(minorLine),
    );
    if (
      supportedSdkMinorLines.length !==
        catalog.compatibility.supportWindow.sdkMinorLines.length ||
      supportedSdkMinorLines.some(
        (line, index) =>
          line !== catalog.compatibility.supportWindow.sdkMinorLines[index],
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['compatibility', 'supportWindow'],
        message:
          'SDK versions must cover exactly the declared supported minor lines',
      });
    }
  });

const permissionDescriptors: ReadonlyArray<{
  id: PluginPermissionV1;
  broker:
    | 'identity'
    | 'engine_metadata'
    | 'engine_access'
    | 'diagnostics'
    | 'events'
    | 'plugin_storage'
    | 'secret_use'
    | 'notifications'
    | 'scheduler';
  scope: 'deployment' | 'tenant' | 'resource';
  dataClass:
    | 'none'
    | 'safe_metadata'
    | 'sanitized_content'
    | 'plugin_private'
    | 'credential_indirect';
  risk: 'low' | 'medium' | 'high';
  grantMode: 'explicit';
}> = [
  {
    id: 'host.identity.read_safe',
    broker: 'identity',
    scope: 'tenant',
    dataClass: 'safe_metadata',
    risk: 'low',
    grantMode: 'explicit',
  },
  {
    id: 'host.engine.incidents.read_metadata',
    broker: 'engine_metadata',
    scope: 'resource',
    dataClass: 'safe_metadata',
    risk: 'medium',
    grantMode: 'explicit',
  },
  {
    id: 'host.engine.failed_jobs.read_metadata',
    broker: 'engine_metadata',
    scope: 'resource',
    dataClass: 'safe_metadata',
    risk: 'medium',
    grantMode: 'explicit',
  },
  {
    id: 'host.engine.process_instances.read_metadata',
    broker: 'engine_metadata',
    scope: 'resource',
    dataClass: 'safe_metadata',
    risk: 'medium',
    grantMode: 'explicit',
  },
  {
    id: 'host.engine.metadata.read',
    broker: 'engine_metadata',
    scope: 'resource',
    dataClass: 'safe_metadata',
    risk: 'medium',
    grantMode: 'explicit',
  },
  {
    id: 'host.engine.access.list_safe',
    broker: 'engine_access',
    scope: 'tenant',
    dataClass: 'safe_metadata',
    risk: 'medium',
    grantMode: 'explicit',
  },
  {
    id: 'host.engine.diagnostics.collect_sanitized',
    broker: 'diagnostics',
    scope: 'resource',
    dataClass: 'sanitized_content',
    risk: 'high',
    grantMode: 'explicit',
  },
  {
    id: 'host.events.subscribe.incident',
    broker: 'events',
    scope: 'tenant',
    dataClass: 'safe_metadata',
    risk: 'high',
    grantMode: 'explicit',
  },
  {
    id: 'host.events.subscribe.failed_job',
    broker: 'events',
    scope: 'tenant',
    dataClass: 'safe_metadata',
    risk: 'high',
    grantMode: 'explicit',
  },
  {
    id: 'host.events.subscribe.engine_inventory',
    broker: 'events',
    scope: 'tenant',
    dataClass: 'safe_metadata',
    risk: 'high',
    grantMode: 'explicit',
  },
  {
    id: 'host.plugin_storage.deployment',
    broker: 'plugin_storage',
    scope: 'deployment',
    dataClass: 'plugin_private',
    risk: 'medium',
    grantMode: 'explicit',
  },
  {
    id: 'host.plugin_storage.tenant',
    broker: 'plugin_storage',
    scope: 'tenant',
    dataClass: 'plugin_private',
    risk: 'medium',
    grantMode: 'explicit',
  },
  {
    id: 'host.secret.use_reference',
    broker: 'secret_use',
    scope: 'tenant',
    dataClass: 'credential_indirect',
    risk: 'high',
    grantMode: 'explicit',
  },
  {
    id: 'host.notifications.publish_safe',
    broker: 'notifications',
    scope: 'tenant',
    dataClass: 'none',
    risk: 'low',
    grantMode: 'explicit',
  },
  {
    id: 'host.jobs.schedule_fixed',
    broker: 'scheduler',
    scope: 'deployment',
    dataClass: 'none',
    risk: 'medium',
    grantMode: 'explicit',
  },
];

const slotDescriptors: ReadonlyArray<{
  id: PluginSlotIdV1;
  surface: 'mission_control' | 'settings' | 'global_shell';
  scope: 'deployment' | 'tenant' | 'resource';
  contextVersion: 1;
  multiplicity: 'many';
  ordering: 'host_deterministic';
}> = [
  {
    id: 'mission-control.incident.actions.v1',
    surface: 'mission_control',
    scope: 'resource',
    contextVersion: 1,
    multiplicity: 'many',
    ordering: 'host_deterministic',
  },
  {
    id: 'mission-control.failed-job.actions.v1',
    surface: 'mission_control',
    scope: 'resource',
    contextVersion: 1,
    multiplicity: 'many',
    ordering: 'host_deterministic',
  },
  {
    id: 'mission-control.process-instance.actions.v1',
    surface: 'mission_control',
    scope: 'resource',
    contextVersion: 1,
    multiplicity: 'many',
    ordering: 'host_deterministic',
  },
  {
    id: 'mission-control.engine.actions.v1',
    surface: 'mission_control',
    scope: 'resource',
    contextVersion: 1,
    multiplicity: 'many',
    ordering: 'host_deterministic',
  },
  {
    id: 'mission-control.engine.tabs.v1',
    surface: 'mission_control',
    scope: 'resource',
    contextVersion: 1,
    multiplicity: 'many',
    ordering: 'host_deterministic',
  },
  {
    id: 'settings.tenant.pages.v1',
    surface: 'settings',
    scope: 'tenant',
    contextVersion: 1,
    multiplicity: 'many',
    ordering: 'host_deterministic',
  },
  {
    id: 'settings.deployment.pages.v1',
    surface: 'settings',
    scope: 'deployment',
    contextVersion: 1,
    multiplicity: 'many',
    ordering: 'host_deterministic',
  },
  {
    id: 'global.header.actions.v1',
    surface: 'global_shell',
    scope: 'deployment',
    contextVersion: 1,
    multiplicity: 'many',
    ordering: 'host_deterministic',
  },
];

const eventDescriptors: ReadonlyArray<{
  id: PluginEventTypeV1;
  permission: PluginPermissionV1;
  delivery: 'at_least_once';
  payloadClass: 'safe_metadata';
  payloadSchemaVersion: 1;
  tenantDerivedByHost: true;
  payloadErasedAfterDelivery: true;
}> = [
  {
    id: 'io.enterpriseglue.host.incident.v1',
    permission: 'host.events.subscribe.incident',
    delivery: 'at_least_once',
    payloadClass: 'safe_metadata',
    payloadSchemaVersion: 1,
    tenantDerivedByHost: true,
    payloadErasedAfterDelivery: true,
  },
  {
    id: 'io.enterpriseglue.host.failed-job.v1',
    permission: 'host.events.subscribe.failed_job',
    delivery: 'at_least_once',
    payloadClass: 'safe_metadata',
    payloadSchemaVersion: 1,
    tenantDerivedByHost: true,
    payloadErasedAfterDelivery: true,
  },
  {
    id: 'io.enterpriseglue.host.engine-inventory.v1',
    permission: 'host.events.subscribe.engine_inventory',
    delivery: 'at_least_once',
    payloadClass: 'safe_metadata',
    payloadSchemaVersion: 1,
    tenantDerivedByHost: true,
    payloadErasedAfterDelivery: true,
  },
];

export interface CreatePluginPlatformCapabilityCatalogV1Input {
  hostVersion: string;
  sdkVersion: string;
  sharedFrontend: {
    react: string;
    reactDom: string;
    router: string;
    carbonReact: string;
    pluginSdk: string;
  };
  permissions?: readonly PluginPermissionV1[];
  slots?: readonly PluginSlotIdV1[];
  egressPolicies?: readonly string[];
  trustedPublishers?: readonly PluginId[];
  defaultTrustedPublishers?: readonly PluginId[];
  hostMinorLines?: readonly string[];
  sdkMinorLines?: readonly string[];
  supportedSdkVersions?: readonly string[];
}

function minorLine(version: string): string {
  const parsed = semVerSchema.parse(version);
  const [major, minor] = parsed.split('.');
  return `${major}.${minor}`;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

/**
 * Build the exact safe capability projection enforced by one OSS host.
 *
 * Named egress entries and trusted publisher IDs are deployment-derived, but
 * destinations, credentials, trust keys, tenant IDs, and plugin state are not
 * representable in this contract.
 */
export function createPluginPlatformCapabilityCatalogV1(
  input: CreatePluginPlatformCapabilityCatalogV1Input,
): PluginPlatformCapabilityCatalogV1 {
  const enabledPermissions = new Set(
    input.permissions ?? pluginPermissionValues,
  );
  const enabledSlots = new Set(input.slots ?? pluginSlotIdValues);
  const namedEgressPolicies = uniqueSorted(
    (input.egressPolicies ?? []).filter((policy) => policy !== 'none'),
  );
  const trustedPublishers = uniqueSorted(input.trustedPublishers ?? []);
  const defaultTrustedPublishers = new Set(
    input.defaultTrustedPublishers ?? [],
  );
  const supportedSdkVersions = uniqueSorted(
    input.supportedSdkVersions ??
      (input.sdkMinorLines
        ? [
            input.sdkVersion,
            ...input.sdkMinorLines
              .filter((line) => line !== minorLine(input.sdkVersion))
              .map((line) => `${line}.0`),
          ]
        : [input.sdkVersion]),
  );
  const sdkMinorLines = uniqueSorted(
    input.sdkMinorLines ?? supportedSdkVersions.map(minorLine),
  );

  return pluginPlatformCapabilityCatalogV1Schema.parse({
    apiVersion: 'platform-capabilities.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginPlatformCapabilities',
    metadata: {
      catalogRevision: pluginPlatformCatalogRevisionV1,
    },
    compatibility: {
      hostVersion: input.hostVersion,
      sdkVersion: input.sdkVersion,
      frontendProtocols: [1],
      backendProtocols: [1],
      sharedFrontend: input.sharedFrontend,
      supportWindow: {
        policy: 'current-and-previous-minor-when-available',
        hostMinorLines: uniqueSorted(
          input.hostMinorLines ?? [minorLine(input.hostVersion)],
        ),
        sdkMinorLines,
        sdkVersions: supportedSdkVersions,
        exactPrivateCiHostEvidenceRequired: true,
      },
    },
    permissions: permissionDescriptors.filter((entry) =>
      enabledPermissions.has(entry.id),
    ),
    slots: slotDescriptors.filter((entry) => enabledSlots.has(entry.id)),
    events: eventDescriptors.filter((entry) =>
      enabledPermissions.has(entry.permission),
    ),
    egressPolicies: [
      {
        id: 'none',
        source: 'host_builtin',
        enforcement: 'deny_all',
        credentials: 'none',
      },
      ...namedEgressPolicies.map((id) => ({
        id,
        source: 'deployment' as const,
        enforcement: 'deployment_policy' as const,
        credentials: 'host_broker_only' as const,
      })),
    ],
    trustedPublishers: trustedPublishers.map((id) => ({
      id,
      source: defaultTrustedPublishers.has(id)
        ? ('host_default' as const)
        : ('deployment' as const),
      keyMaterialExposed: false as const,
    })),
  });
}

export function parsePluginPlatformCapabilityCatalogV1(
  input: unknown,
): PluginPlatformCapabilityCatalogV1 {
  return pluginPlatformCapabilityCatalogV1Schema.parse(input);
}

export function safeParsePluginPlatformCapabilityCatalogV1(input: unknown) {
  return pluginPlatformCapabilityCatalogV1Schema.safeParse(input);
}

export function getPluginPlatformCapabilityCatalogV1JsonSchema(): z.core.JSONSchema.JSONSchema {
  return {
    ...z.toJSONSchema(pluginPlatformCapabilityCatalogV1Schema, {
      target: 'draft-2020-12',
    }),
    $id: 'https://schemas.enterpriseglue.io/plugin/enterpriseglue-plugin-platform-capabilities-v1.schema.json',
    title: 'EnterpriseGlue Plugin Platform Capabilities v1',
    description:
      'Safe deployment-admin projection of the exact plugin permissions, slots, events, egress policy identifiers, trusted publisher identifiers, and compatibility window enforced by one EnterpriseGlue OSS host.',
  };
}

export type PluginPlatformCapabilityCatalogV1 = z.infer<
  typeof pluginPlatformCapabilityCatalogV1Schema
>;
