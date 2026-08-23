import { z } from 'zod';

import {
  namespacedIdentifierSchema,
  pluginEventTypeSchema,
  ociDigestReferenceSchema,
  pluginIdSchema,
  pluginPermissionSchema,
  pluginSlotIdSchema,
  safeRelativePathSchema,
  semVerSchema,
  sha256Schema,
} from './common.js';

const bundleRelativePathSchema = safeRelativePathSchema.refine(
  (path) => !path.includes(':'),
  'Bundle file paths must not contain a URI scheme or colon',
);

const schemaReferenceV1Schema = z
  .object({
    path: bundleRelativePathSchema,
    sha256: sha256Schema,
  })
  .strict();

const sharedFrontendRuntimeV1Schema = z
  .object({
    react: semVerSchema,
    reactDom: semVerSchema,
    router: semVerSchema,
    carbonReact: semVerSchema,
    pluginSdk: semVerSchema,
  })
  .strict();

const resourceBindingV1Schema = z
  .object({
    kind: z.enum(['engine', 'incident', 'failed_job', 'process_instance', 'project']),
    source: z.enum(['path', 'body']),
    field: z.string().min(1).max(100).regex(/^[A-Za-z][A-Za-z0-9_.-]*$/),
  })
  .strict();

/**
 * End-user authorization is deliberately separate from a plugin's installer
 * capabilities (`requiredPermissions`). The host resolves this declaration
 * against its static FGA action registry; plugins cannot invent action IDs or
 * pass a resource identity other than the host-owned binding.
 */
const pluginOperationAuthorizationV1Schema = z
  .object({
    actionId: namespacedIdentifierSchema,
    resource: z.enum(['platform.self', 'engine.binding']),
  })
  .strict();

const backendOperationPathSchema = safeRelativePathSchema
  .refine(
    (path) => path.startsWith('v1/'),
    'Backend operation paths must begin with v1/',
  )
  .superRefine((path, context) => {
    const parameters = new Set<string>();
    for (const [index, segment] of path.split('/').entries()) {
      if (!segment.includes(':')) continue;
      if (!/^:[A-Za-z][A-Za-z0-9_.-]*$/.test(segment)) {
        context.addIssue({
          code: 'custom',
          path: [index],
          message:
            'A dynamic backend path segment must be one complete named parameter',
        });
        continue;
      }
      const parameter = segment.slice(1);
      if (parameters.has(parameter)) {
        context.addIssue({
          code: 'custom',
          path: [index],
          message: 'Backend path parameter names must be unique',
        });
      }
      parameters.add(parameter);
    }
  });

export const pluginBackendOperationV1Schema = z
  .object({
    operationId: namespacedIdentifierSchema,
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    path: backendOperationPathSchema,
    requestSchema: schemaReferenceV1Schema,
    responseSchema: schemaReferenceV1Schema,
    requiredPermissions: z.array(pluginPermissionSchema).min(1).max(20),
    resourceBinding: resourceBindingV1Schema.optional(),
    authorization: pluginOperationAuthorizationV1Schema.optional(),
    maxRequestBytes: z.number().int().min(0).max(100 * 1024 * 1024),
    maxResponseBytes: z.number().int().min(1).max(100 * 1024 * 1024),
    timeoutMs: z.number().int().min(100).max(120_000),
    streaming: z.enum(['none', 'sse', 'upload']).default('none'),
  })
  .strict()
  .superRefine((operation, context) => {
    if (
      operation.resourceBinding?.source === 'body' &&
      (operation.method === 'GET' || operation.method === 'DELETE')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['resourceBinding', 'source'],
        message:
          'GET and DELETE operations must bind resources from the path',
      });
    }
    if (
      operation.authorization?.resource === 'engine.binding' &&
      operation.resourceBinding?.kind !== 'engine'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authorization', 'resource'],
        message:
          'engine.binding authorization requires an engine resource binding',
      });
    }
    if (
      operation.authorization?.resource === 'platform.self' &&
      operation.resourceBinding
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authorization', 'resource'],
        message:
          'platform.self authorization cannot be paired with a resource binding',
      });
    }
    const pathParameters = operation.path
      .split('/')
      .filter((segment) => segment.startsWith(':'))
      .map((segment) => segment.slice(1));
    if (pathParameters.length === 0) {
      if (operation.resourceBinding?.source === 'path') {
        context.addIssue({
          code: 'custom',
          path: ['resourceBinding', 'field'],
          message:
            'A path resource binding must name the operation path parameter',
        });
      }
      return;
    }
    if (
      pathParameters.length !== 1 ||
      operation.resourceBinding?.source !== 'path' ||
      operation.resourceBinding.field !== pathParameters[0]
    ) {
      context.addIssue({
        code: 'custom',
        path: ['resourceBinding'],
        message:
          'A v1 dynamic operation path must contain exactly one parameter bound by resourceBinding',
      });
    }
  });

const frontendDeploymentV1Schema = z
  .object({
    entry: bundleRelativePathSchema,
    sha256: sha256Schema,
    shared: sharedFrontendRuntimeV1Schema,
  })
  .strict();

const backendDeploymentV1Schema = z
  .object({
    image: ociDigestReferenceSchema,
    healthPath: z.literal('/_plugin/health'),
    readyPath: z.literal('/_plugin/ready'),
    protocolPath: z.literal('/_plugin/capabilities'),
    operations: z.array(pluginBackendOperationV1Schema).max(200).default([]),
  })
  .strict();

const migrationDeploymentV1Schema = z
  .object({
    image: ociDigestReferenceSchema,
    fromSchema: z.number().int().nonnegative(),
    toSchema: z.number().int().positive(),
    rollbackThrough: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.toSchema < value.fromSchema) {
      context.addIssue({
        code: 'custom',
        path: ['toSchema'],
        message: 'Migration target schema must not be older than the source schema',
      });
    }
    if (value.rollbackThrough > value.toSchema) {
      context.addIssue({
        code: 'custom',
        path: ['rollbackThrough'],
        message: 'Rollback boundary must not be newer than the target schema',
      });
    }
  });

const resourcesDeploymentV1Schema = z
  .object({
    descriptor: bundleRelativePathSchema,
    sha256: sha256Schema,
  })
  .strict();

const routeContributionV1Schema = z
  .object({
    id: namespacedIdentifierSchema,
    kind: z.literal('route'),
    scope: z.enum(['root', 'tenant']),
    relativePath: safeRelativePathSchema,
  })
  .strict();

const navigationContributionV1Schema = z
  .object({
    id: namespacedIdentifierSchema,
    kind: z.literal('navigation'),
    routeId: namespacedIdentifierSchema,
    section: z.enum(['main', 'tenant', 'settings', 'administration']),
    destination: z
      .enum(['voyager', 'operations', 'tenant', 'admin'])
      .optional(),
    parentDestination: z
      .enum(['mission-control', 'engines', 'platform-settings', 'plugins'])
      .optional(),
  })
  .strict();

const slotContributionV1Schema = z
  .object({
    id: namespacedIdentifierSchema,
    kind: z.literal('slot'),
    slot: pluginSlotIdSchema,
  })
  .strict();

const settingsContributionV1Schema = z
  .object({
    id: namespacedIdentifierSchema,
    kind: z.literal('settings'),
    routeId: namespacedIdentifierSchema,
    scope: z.enum(['tenant', 'deployment']),
  })
  .strict();

export const declaredContributionV1Schema = z.discriminatedUnion('kind', [
  routeContributionV1Schema,
  navigationContributionV1Schema,
  slotContributionV1Schema,
  settingsContributionV1Schema,
]);

const pluginDependencyV1Schema = z
  .object({
    id: pluginIdSchema,
    version: z.string().min(1).max(100),
    optional: z.boolean().default(false),
  })
  .strict();

const pluginConflictV1Schema = z
  .object({
    id: pluginIdSchema,
    version: z.string().min(1).max(100),
  })
  .strict();

const pluginEventSubscriptionV1Schema = z
  .object({
    type: pluginEventTypeSchema,
    deliveryOperationId: namespacedIdentifierSchema,
    schema: schemaReferenceV1Schema,
    permission: pluginPermissionSchema,
    maxAttempts: z.number().int().min(1).max(100).default(10),
  })
  .strict();

const pluginFixedScheduleV1Schema = z
  .object({
    jobType: namespacedIdentifierSchema,
    deliveryOperationId: namespacedIdentifierSchema,
    allowedIntervalsSeconds: z
      .array(z.number().int().min(60).max(31 * 24 * 60 * 60))
      .min(1)
      .max(20),
    permission: z.literal('host.jobs.schedule_fixed'),
    maxAttempts: z.number().int().min(1).max(100).default(10),
  })
  .strict()
  .superRefine((schedule, context) => {
    if (
      new Set(schedule.allowedIntervalsSeconds).size !==
      schedule.allowedIntervalsSeconds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['allowedIntervalsSeconds'],
        message: 'Fixed schedule intervals must be unique',
      });
    }
  });

export const pluginContributionAvailabilityDeclarationV1Schema = z
  .object({
    refreshOperationId: namespacedIdentifierSchema,
    refreshIntervalSeconds: z.number().int().min(60).max(3_600),
    maximumStalenessSeconds: z.number().int().min(60).max(86_400),
    gatedContributionIds: z
      .array(namespacedIdentifierSchema)
      .min(1)
      .max(500),
  })
  .strict()
  .superRefine((declaration, context) => {
    if (
      declaration.maximumStalenessSeconds <
      declaration.refreshIntervalSeconds
    ) {
      context.addIssue({
        code: 'custom',
        path: ['maximumStalenessSeconds'],
        message:
          'Maximum staleness must be at least the refresh interval',
      });
    }
    if (
      new Set(declaration.gatedContributionIds).size !==
      declaration.gatedContributionIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['gatedContributionIds'],
        message: 'Gated contribution IDs must be unique',
      });
    }
  });

const noEntitlementSchema = z
  .object({
    provider: z.literal('none'),
  })
  .strict();

const pluginEntitlementSchema = z
  .object({
    provider: z.literal('plugin'),
    feature: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/),
  })
  .strict();

export const enterpriseGluePluginManifestV1Schema = z
  .object({
    apiVersion: z.literal('plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePlugin'),
    metadata: z
      .object({
        id: pluginIdSchema,
        version: semVerSchema,
        displayName: z.string().min(1).max(100),
        publisher: pluginIdSchema,
      })
      .strict(),
    compatibility: z
      .object({
        host: z.string().min(1).max(100),
        sdk: z.string().min(1).max(100),
        frontendProtocol: z.literal(1).optional(),
        backendProtocol: z.literal(1).optional(),
        requiredSlots: z.array(pluginSlotIdSchema).max(100).default([]),
      })
      .strict(),
    deployment: z
      .object({
        frontend: frontendDeploymentV1Schema.optional(),
        backend: backendDeploymentV1Schema.optional(),
        migration: migrationDeploymentV1Schema.optional(),
        resources: resourcesDeploymentV1Schema.optional(),
      })
      .strict(),
    scope: z
      .object({
        installation: z.literal('deployment'),
        enablement: z.enum(['deployment', 'tenant']),
      })
      .strict(),
    permissions: z
      .object({
        required: z.array(pluginPermissionSchema).max(100),
        optional: z.array(pluginPermissionSchema).max(100).default([]),
      })
      .strict(),
    network: z
      .object({
        egressPolicy: z
          .string()
          .min(1)
          .max(100)
          .regex(/^(none|[a-z][a-z0-9-]*)$/),
      })
      .strict(),
    entitlement: z
      .discriminatedUnion('provider', [noEntitlementSchema, pluginEntitlementSchema])
      .default({ provider: 'none' }),
    dependencies: z.array(pluginDependencyV1Schema).max(100).default([]),
    conflicts: z.array(pluginConflictV1Schema).max(100).default([]),
    events: z
      .object({
        subscriptions: z.array(pluginEventSubscriptionV1Schema).max(100).default([]),
      })
      .strict()
      .default({ subscriptions: [] }),
    jobs: z
      .object({
        fixedSchedules: z
          .array(pluginFixedScheduleV1Schema)
          .max(100)
          .default([]),
      })
      .strict()
      .default({ fixedSchedules: [] }),
    contributionAvailability:
      pluginContributionAvailabilityDeclarationV1Schema.optional(),
    contributions: z.array(declaredContributionV1Schema).max(500).default([]),
  })
  .strict()
  .superRefine((manifest, context) => {
    const pluginPrefix = `${manifest.metadata.id}.`;
    const contributionIds = new Set<string>();
    const routeIds = new Set(
      manifest.contributions
        .filter((contribution) => contribution.kind === 'route')
        .map((contribution) => contribution.id),
    );

    for (const [index, contribution] of manifest.contributions.entries()) {
      if (!contribution.id.startsWith(pluginPrefix)) {
        context.addIssue({
          code: 'custom',
          path: ['contributions', index, 'id'],
          message: `Contribution ID must be namespaced by ${manifest.metadata.id}`,
        });
      }
      if (contributionIds.has(contribution.id)) {
        context.addIssue({
          code: 'custom',
          path: ['contributions', index, 'id'],
          message: 'Contribution IDs must be unique within a plugin manifest',
        });
      }
      contributionIds.add(contribution.id);

      if (
        (contribution.kind === 'navigation' || contribution.kind === 'settings') &&
        !routeIds.has(contribution.routeId)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['contributions', index, 'routeId'],
          message: 'Navigation and settings contributions must reference a declared route',
        });
      }
    }

    if (manifest.contributions.length > 0 && !manifest.deployment.frontend) {
      context.addIssue({
        code: 'custom',
        path: ['deployment', 'frontend'],
        message: 'A frontend deployment is required when contributions are declared',
      });
    }

    if (
      manifest.deployment.frontend &&
      manifest.compatibility.frontendProtocol === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['compatibility', 'frontendProtocol'],
        message: 'A frontend deployment must declare its frontend protocol',
      });
    }

    if (
      manifest.deployment.backend &&
      manifest.compatibility.backendProtocol === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['compatibility', 'backendProtocol'],
        message: 'A backend deployment must declare its backend protocol',
      });
    }

    const allPermissions = [
      ...manifest.permissions.required,
      ...manifest.permissions.optional,
    ];
    const permissionSet = new Set(allPermissions);
    if (permissionSet.size !== allPermissions.length) {
      context.addIssue({
        code: 'custom',
        path: ['permissions'],
        message: 'Required and optional permissions must be unique and non-overlapping',
      });
    }

    const backendOperationIds = new Set<string>();
    for (const [index, operation] of (
      manifest.deployment.backend?.operations ?? []
    ).entries()) {
      if (!operation.operationId.startsWith(pluginPrefix)) {
        context.addIssue({
          code: 'custom',
          path: ['deployment', 'backend', 'operations', index, 'operationId'],
          message: `Operation ID must be namespaced by ${manifest.metadata.id}`,
        });
      }
      if (backendOperationIds.has(operation.operationId)) {
        context.addIssue({
          code: 'custom',
          path: ['deployment', 'backend', 'operations', index, 'operationId'],
          message: 'Backend operation IDs must be unique',
        });
      }
      backendOperationIds.add(operation.operationId);
      for (const permission of operation.requiredPermissions) {
        if (!permissionSet.has(permission)) {
          context.addIssue({
            code: 'custom',
            path: [
              'deployment',
              'backend',
              'operations',
              index,
              'requiredPermissions',
            ],
            message: `Operation permission ${permission} is not declared by the plugin`,
          });
        }
      }
    }

    const availability = manifest.contributionAvailability;
    if (availability) {
      if (!availability.refreshOperationId.startsWith(pluginPrefix)) {
        context.addIssue({
          code: 'custom',
          path: ['contributionAvailability', 'refreshOperationId'],
          message: 'Availability refresh operation must be owned by the plugin',
        });
      }
      const refreshOperation = manifest.deployment.backend?.operations.find(
        (operation) =>
          operation.operationId === availability.refreshOperationId,
      );
      if (
        !refreshOperation ||
        refreshOperation.method !== 'POST' ||
        refreshOperation.streaming !== 'none' ||
        refreshOperation.resourceBinding !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['contributionAvailability', 'refreshOperationId'],
          message:
            'Availability refresh must be a declared non-streaming POST without a resource binding',
        });
      }
      const gatedIds = new Set(availability.gatedContributionIds);
      for (const [index, contributionId] of
        availability.gatedContributionIds.entries()) {
        if (!contributionId.startsWith(pluginPrefix)) {
          context.addIssue({
            code: 'custom',
            path: [
              'contributionAvailability',
              'gatedContributionIds',
              index,
            ],
            message: 'Gated contribution must be owned by the plugin',
          });
        }
        if (!contributionIds.has(contributionId)) {
          context.addIssue({
            code: 'custom',
            path: [
              'contributionAvailability',
              'gatedContributionIds',
              index,
            ],
            message: 'Gated contribution must be declared by the manifest',
          });
        }
      }
      for (const [index, contribution] of manifest.contributions.entries()) {
        if (
          (contribution.kind === 'navigation' ||
            contribution.kind === 'settings') &&
          gatedIds.has(contribution.id) !== gatedIds.has(contribution.routeId)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['contributions', index],
            message:
              'Route-linked navigation/settings contributions must share availability gating with their route',
          });
        }
      }
    }

    for (const [index, subscription] of manifest.events.subscriptions.entries()) {
      const expectedPermission =
        subscription.type === 'io.enterpriseglue.host.incident.v1'
          ? 'host.events.subscribe.incident'
          : subscription.type ===
              'io.enterpriseglue.host.failed-job.v1'
            ? 'host.events.subscribe.failed_job'
            : 'host.events.subscribe.engine_inventory';
      if (!permissionSet.has(subscription.permission)) {
        context.addIssue({
          code: 'custom',
          path: ['events', 'subscriptions', index, 'permission'],
          message: 'Event subscription permission is not declared by the plugin',
        });
      }
      if (subscription.permission !== expectedPermission) {
        context.addIssue({
          code: 'custom',
          path: ['events', 'subscriptions', index, 'permission'],
          message: 'Event subscription permission does not match its event type',
        });
      }
      if (!subscription.deliveryOperationId.startsWith(pluginPrefix)) {
        context.addIssue({
          code: 'custom',
          path: ['events', 'subscriptions', index, 'deliveryOperationId'],
          message: 'Event delivery operation must be owned by the plugin',
        });
      }
      const deliveryOperation = manifest.deployment.backend?.operations.find(
        (operation) =>
          operation.operationId === subscription.deliveryOperationId,
      );
      if (
        !deliveryOperation ||
        deliveryOperation.method !== 'POST' ||
        deliveryOperation.streaming !== 'none' ||
        !deliveryOperation.requiredPermissions.includes(
          subscription.permission,
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['events', 'subscriptions', index, 'deliveryOperationId'],
          message:
            'Event delivery operation must be a declared non-streaming POST with the subscription permission',
        });
      }
    }

    const jobTypes = new Set<string>();
    for (const [index, schedule] of manifest.jobs.fixedSchedules.entries()) {
      if (!schedule.jobType.startsWith(pluginPrefix)) {
        context.addIssue({
          code: 'custom',
          path: ['jobs', 'fixedSchedules', index, 'jobType'],
          message: 'Fixed job type must be owned by the plugin',
        });
      }
      if (jobTypes.has(schedule.jobType)) {
        context.addIssue({
          code: 'custom',
          path: ['jobs', 'fixedSchedules', index, 'jobType'],
          message: 'Fixed job types must be unique',
        });
      }
      jobTypes.add(schedule.jobType);
      if (!permissionSet.has(schedule.permission)) {
        context.addIssue({
          code: 'custom',
          path: ['jobs', 'fixedSchedules', index, 'permission'],
          message: 'Fixed schedule permission is not declared by the plugin',
        });
      }
      const deliveryOperation = manifest.deployment.backend?.operations.find(
        (operation) =>
          operation.operationId === schedule.deliveryOperationId,
      );
      if (
        !deliveryOperation ||
        deliveryOperation.method !== 'POST' ||
        deliveryOperation.streaming !== 'none' ||
        !deliveryOperation.requiredPermissions.includes(schedule.permission)
      ) {
        context.addIssue({
          code: 'custom',
          path: [
            'jobs',
            'fixedSchedules',
            index,
            'deliveryOperationId',
          ],
          message:
            'Fixed schedule delivery operation must be a declared non-streaming POST with the schedule permission',
        });
      }
    }

    const dependencyIds = new Set<string>();
    for (const [index, dependency] of manifest.dependencies.entries()) {
      if (dependency.id === manifest.metadata.id) {
        context.addIssue({
          code: 'custom',
          path: ['dependencies', index, 'id'],
          message: 'A plugin cannot depend on itself',
        });
      }
      if (dependencyIds.has(dependency.id)) {
        context.addIssue({
          code: 'custom',
          path: ['dependencies', index, 'id'],
          message: 'Dependency IDs must be unique',
        });
      }
      dependencyIds.add(dependency.id);
    }

    const conflictIds = new Set<string>();
    for (const [index, conflict] of manifest.conflicts.entries()) {
      if (conflict.id === manifest.metadata.id) {
        context.addIssue({
          code: 'custom',
          path: ['conflicts', index, 'id'],
          message: 'A plugin cannot conflict with itself',
        });
      }
      if (dependencyIds.has(conflict.id)) {
        context.addIssue({
          code: 'custom',
          path: ['conflicts', index, 'id'],
          message: 'A plugin cannot both depend on and conflict with the same plugin',
        });
      }
      if (conflictIds.has(conflict.id)) {
        context.addIssue({
          code: 'custom',
          path: ['conflicts', index, 'id'],
          message: 'Conflict IDs must be unique',
        });
      }
      conflictIds.add(conflict.id);
    }
  });

export type SchemaReferenceV1 = z.infer<typeof schemaReferenceV1Schema>;
export type SharedFrontendRuntimeV1 = z.infer<typeof sharedFrontendRuntimeV1Schema>;
export type PluginBackendOperationV1 = z.infer<typeof pluginBackendOperationV1Schema>;
export type PluginResourceBindingV1 = z.infer<typeof resourceBindingV1Schema>;
export type PluginOperationAuthorizationV1 = z.infer<typeof pluginOperationAuthorizationV1Schema>;
export type DeclaredContributionV1 = z.infer<typeof declaredContributionV1Schema>;
export type PluginContributionAvailabilityDeclarationV1 = z.infer<
  typeof pluginContributionAvailabilityDeclarationV1Schema
>;
export type EnterpriseGluePluginManifestV1 = z.infer<
  typeof enterpriseGluePluginManifestV1Schema
>;

export function parseEnterpriseGluePluginManifestV1(
  input: unknown,
): EnterpriseGluePluginManifestV1 {
  return enterpriseGluePluginManifestV1Schema.parse(input);
}

export function safeParseEnterpriseGluePluginManifestV1(input: unknown) {
  return enterpriseGluePluginManifestV1Schema.safeParse(input);
}

/**
 * Produce the distributable structural schema used by installers and editors.
 *
 * JSON Schema cannot express the cross-field checks implemented by
 * `superRefine` (namespaces, route references, permission membership, and
 * dependency/conflict overlap). Consumers must still call
 * `parseEnterpriseGluePluginManifestV1` before trusting a manifest.
 */
export function getEnterpriseGluePluginManifestV1JsonSchema(): z.core.JSONSchema.JSONSchema {
  return {
    ...z.toJSONSchema(enterpriseGluePluginManifestV1Schema, {
      target: 'draft-2020-12',
    }),
    $id: 'https://schemas.enterpriseglue.io/plugin/enterpriseglue-plugin-manifest-v1.schema.json',
    title: 'EnterpriseGlue Plugin Manifest v1',
    description:
      'Structural schema for an EnterpriseGlue plugin manifest. Runtime parsing also enforces semantic cross-field rules.',
  };
}
