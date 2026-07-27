import { z } from 'zod';

import {
  namespacedIdentifierSchema,
  opaqueReferenceSchema,
  pluginNotificationTemplateSchema,
  pluginPermissionSchema,
  type PluginPermissionV1,
} from './common.js';
import { pluginEventEnvelopeV1Schema } from './backend.js';

const safeMetadataCodeSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const pluginBrokerCallV1Schema = z
  .object({
    callId: opaqueReferenceSchema,
    operationId: namespacedIdentifierSchema,
  })
  .strict();

const brokerCallShape = pluginBrokerCallV1Schema.shape;

export const pluginIdentityRequestV1Schema = z
  .object({
    apiVersion: z.literal('identity-request.plugin.enterpriseglue.io/v1'),
    ...brokerCallShape,
  })
  .strict();

export const pluginIdentityResponseV1Schema = z
  .object({
    apiVersion: z.literal('identity.plugin.enterpriseglue.io/v1'),
    subjectRef: opaqueReferenceSchema,
    tenantRef: opaqueReferenceSchema.optional(),
    deploymentRef: opaqueReferenceSchema,
    grantedPermissions: z.array(pluginPermissionSchema).max(100),
  })
  .strict();

const resourceRequestCommon = {
  apiVersion: z.literal('resource-request.plugin.enterpriseglue.io/v1'),
  ...brokerCallShape,
  engineRef: opaqueReferenceSchema,
};

export const pluginIncidentMetadataRequestV1Schema = z
  .object({
    ...resourceRequestCommon,
    kind: z.literal('incident'),
    incidentRef: opaqueReferenceSchema,
  })
  .strict();

export const pluginFailedJobMetadataRequestV1Schema = z
  .object({
    ...resourceRequestCommon,
    kind: z.literal('failed_job'),
    jobRef: opaqueReferenceSchema,
  })
  .strict();

export const pluginProcessInstanceMetadataRequestV1Schema = z
  .object({
    ...resourceRequestCommon,
    kind: z.literal('process_instance'),
    processInstanceRef: opaqueReferenceSchema,
  })
  .strict();

export const pluginEngineMetadataRequestV1Schema = z
  .object({
    ...resourceRequestCommon,
    kind: z.literal('engine'),
  })
  .strict();

export const pluginResourceMetadataRequestV1Schema = z.discriminatedUnion(
  'kind',
  [
    pluginIncidentMetadataRequestV1Schema,
    pluginFailedJobMetadataRequestV1Schema,
    pluginProcessInstanceMetadataRequestV1Schema,
    pluginEngineMetadataRequestV1Schema,
  ],
);

const resourceResponseCommon = {
  apiVersion: z.literal('resource.plugin.enterpriseglue.io/v1'),
  engineRef: opaqueReferenceSchema,
};

export const pluginIncidentMetadataResponseV1Schema = z
  .object({
    ...resourceResponseCommon,
    kind: z.literal('incident'),
    incidentRef: opaqueReferenceSchema,
    incidentType: safeMetadataCodeSchema,
    activityId: safeMetadataCodeSchema.optional(),
    errorCode: safeMetadataCodeSchema.optional(),
    processDefinitionRef: opaqueReferenceSchema.optional(),
    processInstanceRef: opaqueReferenceSchema.optional(),
    occurredAt: z.string().datetime().optional(),
  })
  .strict();

export const pluginFailedJobMetadataResponseV1Schema = z
  .object({
    ...resourceResponseCommon,
    kind: z.literal('failed_job'),
    jobRef: opaqueReferenceSchema,
    activityId: safeMetadataCodeSchema.optional(),
    processDefinitionRef: opaqueReferenceSchema.optional(),
    processInstanceRef: opaqueReferenceSchema.optional(),
    retries: z.number().int().min(0).max(1_000_000),
    exceptionClass: safeMetadataCodeSchema.optional(),
    dueAt: z.string().datetime().optional(),
  })
  .strict();

export const pluginProcessInstanceMetadataResponseV1Schema = z
  .object({
    ...resourceResponseCommon,
    kind: z.literal('process_instance'),
    processInstanceRef: opaqueReferenceSchema,
    processDefinitionRef: opaqueReferenceSchema,
    state: z.enum(['active', 'suspended', 'ended', 'unknown']),
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().optional(),
  })
  .strict();

export const pluginEngineMetadataResponseV1Schema = z
  .object({
    ...resourceResponseCommon,
    kind: z.literal('engine'),
    product: z.enum(['operaton', 'camunda7']),
    version: safeMetadataCodeSchema,
    connected: z.boolean(),
    lastSeenAt: z.string().datetime().optional(),
  })
  .strict();

export const pluginResourceMetadataResponseV1Schema = z.discriminatedUnion(
  'kind',
  [
    pluginIncidentMetadataResponseV1Schema,
    pluginFailedJobMetadataResponseV1Schema,
    pluginProcessInstanceMetadataResponseV1Schema,
    pluginEngineMetadataResponseV1Schema,
  ],
);

export const pluginStorageKeyV1Schema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z0-9][A-Za-z0-9._/-]*$/)
  .superRefine((value, context) => {
    if (
      value.split('/').some((segment) => segment === '' || segment === '..')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Storage key contains an unsafe segment',
      });
    }
  });

export const pluginStorageRevisionV1Schema = z
  .string()
  .regex(/^r[1-9][0-9]*$/);

const storageRequestCommon = {
  apiVersion: z.literal('storage-request.plugin.enterpriseglue.io/v1'),
  ...brokerCallShape,
  scope: z.enum(['deployment', 'tenant']),
  key: pluginStorageKeyV1Schema,
};

export const pluginStorageGetRequestV1Schema = z
  .object({
    ...storageRequestCommon,
    action: z.literal('get'),
  })
  .strict();

export const pluginStoragePutRequestV1Schema = z
  .object({
    ...storageRequestCommon,
    action: z.literal('put'),
    value: z.unknown(),
    expectedRevision: pluginStorageRevisionV1Schema.optional(),
  })
  .strict();

export const pluginStorageDeleteRequestV1Schema = z
  .object({
    ...storageRequestCommon,
    action: z.literal('delete'),
    expectedRevision: pluginStorageRevisionV1Schema,
  })
  .strict();

export const pluginStorageRequestV1Schema = z.discriminatedUnion('action', [
  pluginStorageGetRequestV1Schema,
  pluginStoragePutRequestV1Schema,
  pluginStorageDeleteRequestV1Schema,
]);

export const pluginStorageGetResponseV1Schema = z
  .discriminatedUnion('found', [
    z
      .object({
        apiVersion: z.literal('storage-result.plugin.enterpriseglue.io/v1'),
        action: z.literal('get'),
        found: z.literal(false),
      })
      .strict(),
    z
      .object({
        apiVersion: z.literal('storage-result.plugin.enterpriseglue.io/v1'),
        action: z.literal('get'),
        found: z.literal(true),
        value: z.unknown(),
        revision: pluginStorageRevisionV1Schema,
      })
      .strict(),
  ]);

export const pluginStorageMutationResponseV1Schema = z.discriminatedUnion(
  'action',
  [
    z
      .object({
        apiVersion: z.literal('storage-result.plugin.enterpriseglue.io/v1'),
        action: z.literal('put'),
        revision: pluginStorageRevisionV1Schema,
      })
      .strict(),
    z
      .object({
        apiVersion: z.literal('storage-result.plugin.enterpriseglue.io/v1'),
        action: z.literal('delete'),
        deleted: z.literal(true),
      })
      .strict(),
  ],
);

export const pluginStorageResponseV1Schema = z.union([
  pluginStorageGetResponseV1Schema,
  pluginStorageMutationResponseV1Schema,
]);

export const pluginIncidentEventDataV1Schema = z
  .object({
    engineRef: opaqueReferenceSchema,
    incidentRef: opaqueReferenceSchema,
    incidentType: safeMetadataCodeSchema,
    activityId: safeMetadataCodeSchema.optional(),
    errorCode: safeMetadataCodeSchema.optional(),
    processDefinitionRef: opaqueReferenceSchema.optional(),
    processInstanceRef: opaqueReferenceSchema.optional(),
    occurredAt: z.string().datetime().optional(),
  })
  .strict();

export const pluginFailedJobEventDataV1Schema = z
  .object({
    engineRef: opaqueReferenceSchema,
    jobRef: opaqueReferenceSchema,
    activityId: safeMetadataCodeSchema.optional(),
    processDefinitionRef: opaqueReferenceSchema.optional(),
    processInstanceRef: opaqueReferenceSchema.optional(),
    retries: z.number().int().min(0).max(1_000_000),
    occurredAt: z.string().datetime().optional(),
  })
  .strict();

/**
 * A deliberately minimal daily fleet observation. Names, endpoints,
 * credentials, topology, health payloads, and arbitrary engine metadata are
 * not representable.
 */
export const pluginEngineInventoryEventDataV1Schema = z
  .object({
    engineRef: opaqueReferenceSchema,
    product: z.enum(['operaton', 'camunda7']),
    version: safeMetadataCodeSchema,
    observedAtBucket: z.string().datetime(),
  })
  .strict();

export const pluginIncidentEventV1Schema = pluginEventEnvelopeV1Schema(
  pluginIncidentEventDataV1Schema,
).extend({ type: z.literal('io.enterpriseglue.host.incident.v1') });
export const pluginFailedJobEventV1Schema = pluginEventEnvelopeV1Schema(
  pluginFailedJobEventDataV1Schema,
).extend({ type: z.literal('io.enterpriseglue.host.failed-job.v1') });
export const pluginEngineInventoryEventV1Schema = pluginEventEnvelopeV1Schema(
  pluginEngineInventoryEventDataV1Schema,
).extend({
  type: z.literal('io.enterpriseglue.host.engine-inventory.v1'),
});
export const pluginHostEventV1Schema = z.union([
  pluginIncidentEventV1Schema,
  pluginFailedJobEventV1Schema,
  pluginEngineInventoryEventV1Schema,
]);

export const pluginEventDeliveryV1Schema = z
  .object({
    apiVersion: z.literal('event-delivery.plugin.enterpriseglue.io/v1'),
    deliveryId: opaqueReferenceSchema,
    operationId: namespacedIdentifierSchema,
    subscriptionType: namespacedIdentifierSchema,
    attempt: z.number().int().min(1).max(100),
    event: pluginHostEventV1Schema,
  })
  .strict();

export const pluginEventReceiptV1Schema = z
  .object({
    apiVersion: z.literal('event-receipt.plugin.enterpriseglue.io/v1'),
    deliveryId: opaqueReferenceSchema,
    status: z.enum([
      'accepted',
      'duplicate',
      'retryable_rejected',
      'permanent_rejected',
    ]),
    reasonCode: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z][a-z0-9_]*$/),
  })
  .strict();

export const pluginDiagnosticCollectionRequestV1Schema = z
  .object({
    apiVersion: z.literal(
      'diagnostic-collection-request.plugin.enterpriseglue.io/v1',
    ),
    ...brokerCallShape,
    engineRef: opaqueReferenceSchema,
    trigger: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('incident'),
          incidentRef: opaqueReferenceSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('failed_job'),
          jobRef: opaqueReferenceSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('engine'),
        })
        .strict(),
    ]),
    profile: z.enum([
      'incident_minimal',
      'failed_job_minimal',
      'engine_health',
    ]),
    mode: z.enum(['manual', 'metadata_auto', 'sanitized_bundle_auto']),
    idempotencyKey: opaqueReferenceSchema,
    /**
     * Optional opaque reference owned by the consuming plugin. The host does
     * not interpret this value; the signed collector handoff lets the remote
     * consumer bind accepted evidence to an existing tenant-scoped context.
     */
    consumerContextRef: opaqueReferenceSchema.optional(),
  })
  .strict();

export const pluginDiagnosticCollectionResponseV1Schema = z
  .object({
    apiVersion: z.literal(
      'diagnostic-collection-result.plugin.enterpriseglue.io/v1',
    ),
    intentRef: opaqueReferenceSchema,
    status: z.enum([
      'requires_confirmation',
      'metadata_ready',
      'collection_queued',
      'sanitized_bundle_ready',
      'rejected',
    ]),
    filteringBoundary: z.enum([
      'customer_adapter',
      'enterpriseglue_backend',
      'not_applicable',
    ]),
    rawUploadPermitted: z.literal(false),
    reasonCode: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z][a-z0-9_]*$/),
    consumerContextRef: opaqueReferenceSchema.optional(),
    artifactRef: opaqueReferenceSchema.optional(),
  })
  .strict();

export const pluginDiagnosticCollectorStatusRequestV1Schema = z
  .object({
    apiVersion: z.literal(
      'diagnostic-collector-status-request.plugin.enterpriseglue.io/v1',
    ),
    ...brokerCallShape,
  })
  .strict();

export const pluginDiagnosticCollectorStatusResponseV1Schema = z
  .object({
    apiVersion: z.literal(
      'diagnostic-collector-status.plugin.enterpriseglue.io/v1',
    ),
    state: z.enum(['ready', 'disabled', 'degraded', 'unavailable']),
    reasonCode: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z][a-z0-9_]*$/),
    collectionPermission: z.enum(['granted', 'not_granted']),
    sourceClass: z.enum(['none', 'single', 'multiple']),
    filteringBoundary: z.literal('enterpriseglue_backend'),
    rawUploadPermitted: z.literal(false),
    browserEditable: z.literal(false),
    checkedAt: z.string().datetime(),
  })
  .strict();

const pluginDiagnosticTriggerV1Schema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('incident'),
      incidentRef: opaqueReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('failed_job'),
      jobRef: opaqueReferenceSchema,
    })
    .strict(),
  z.object({ kind: z.literal('engine') }).strict(),
]);

export const pluginSanitizedDiagnosticBundleV1Schema = z
  .object({
    apiVersion: z.literal(
      'sanitized-diagnostic-bundle.plugin.enterpriseglue.io/v1',
    ),
    bundleRef: opaqueReferenceSchema,
    pluginId: z.string().min(3).max(200),
    deploymentRef: opaqueReferenceSchema,
    tenantRef: opaqueReferenceSchema,
    engineRef: opaqueReferenceSchema,
    consumerContextRef: opaqueReferenceSchema.optional(),
    trigger: pluginDiagnosticTriggerV1Schema,
    profile: z.enum([
      'incident_minimal',
      'failed_job_minimal',
      'engine_health',
    ]),
    sourceId: namespacedIdentifierSchema,
    policyRevision: opaqueReferenceSchema,
    collectedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    nonce: opaqueReferenceSchema,
    contentType: z.literal('text/plain; charset=utf-8'),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    contentBytes: z.number().int().min(1).max(256 * 1024),
    lineCount: z.number().int().min(1).max(100_000),
    redactionSummary: z
      .object({
        secrets: z.number().int().min(0).max(1_000_000),
        emails: z.number().int().min(0).max(1_000_000),
        networkAddresses: z.number().int().min(0).max(1_000_000),
        identifiers: z.number().int().min(0).max(1_000_000),
      })
      .strict(),
    filteringBoundary: z.literal('enterpriseglue_backend'),
    sanitizedContent: z.string().min(1).max(256 * 1024),
    signingKeyId: safeMetadataCodeSchema,
    signatureAlgorithm: z.literal('Ed25519'),
    signature: z
      .string()
      .min(80)
      .max(128)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();

export const pluginSanitizedDiagnosticBundleReceiptV1Schema = z
  .object({
    apiVersion: z.literal(
      'sanitized-diagnostic-bundle-receipt.plugin.enterpriseglue.io/v1',
    ),
    bundleRef: opaqueReferenceSchema,
    status: z.enum(['accepted', 'duplicate']),
    consumerContextRef: opaqueReferenceSchema.optional(),
    artifactRef: opaqueReferenceSchema.optional(),
  })
  .strict();

export function pluginDiagnosticBundleSignaturePayloadV1(
  bundle: Omit<PluginSanitizedDiagnosticBundleV1, 'signature'>,
): string {
  const values: unknown[] = [
    bundle.apiVersion,
    bundle.bundleRef,
    bundle.pluginId,
    bundle.deploymentRef,
    bundle.tenantRef,
    bundle.engineRef,
    bundle.trigger,
    bundle.profile,
    bundle.sourceId,
    bundle.policyRevision,
    bundle.collectedAt,
    bundle.expiresAt,
    bundle.nonce,
    bundle.contentType,
    bundle.contentSha256,
    bundle.contentBytes,
    bundle.lineCount,
    bundle.redactionSummary,
    bundle.filteringBoundary,
    bundle.signingKeyId,
    bundle.signatureAlgorithm,
  ];
  // Keep the v1 signature byte-for-byte compatible for bundles created before
  // consumerContextRef was added. When present, the binding is signed.
  if (bundle.consumerContextRef !== undefined) {
    values.push(bundle.consumerContextRef);
  }
  return JSON.stringify(values);
}

const pluginSafeResourceReferenceV1Schema = z
  .object({
    kind: z.enum([
      'engine',
      'incident',
      'failed_job',
      'process_instance',
      'project',
    ]),
    ref: opaqueReferenceSchema,
  })
  .strict();

export const pluginNotificationPublishRequestV1Schema = z
  .object({
    apiVersion: z.literal(
      'notification-publish-request.plugin.enterpriseglue.io/v1',
    ),
    ...brokerCallShape,
    templateId: pluginNotificationTemplateSchema,
    reasonCode: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z][a-z0-9_]*$/),
    resource: pluginSafeResourceReferenceV1Schema.optional(),
    occurrenceCount: z.number().int().min(1).max(1_000_000).optional(),
    idempotencyKey: opaqueReferenceSchema,
  })
  .strict();

export const pluginNotificationPublishResponseV1Schema = z
  .object({
    apiVersion: z.literal(
      'notification-publish-result.plugin.enterpriseglue.io/v1',
    ),
    notificationRef: opaqueReferenceSchema,
    status: z.enum(['published', 'duplicate']),
  })
  .strict();

const fixedScheduleRequestCommon = {
  apiVersion: z.literal('fixed-schedule-request.plugin.enterpriseglue.io/v1'),
  ...brokerCallShape,
  jobType: namespacedIdentifierSchema,
  idempotencyKey: opaqueReferenceSchema,
};

export const pluginFixedScheduleUpsertRequestV1Schema = z
  .object({
    ...fixedScheduleRequestCommon,
    action: z.literal('upsert'),
    intervalSeconds: z.number().int().min(60).max(31 * 24 * 60 * 60),
  })
  .strict();

export const pluginFixedScheduleCancelRequestV1Schema = z
  .object({
    ...fixedScheduleRequestCommon,
    action: z.literal('cancel'),
  })
  .strict();

export const pluginFixedScheduleRequestV1Schema = z.discriminatedUnion(
  'action',
  [
    pluginFixedScheduleUpsertRequestV1Schema,
    pluginFixedScheduleCancelRequestV1Schema,
  ],
);

export const pluginFixedScheduleResponseV1Schema = z
  .object({
    apiVersion: z.literal('fixed-schedule-result.plugin.enterpriseglue.io/v1'),
    jobRef: opaqueReferenceSchema,
    status: z.enum(['scheduled', 'cancelled', 'duplicate']),
    nextRunAt: z.string().datetime().optional(),
    revision: z.number().int().positive(),
  })
  .strict();

export const pluginScheduledJobDeliveryV1Schema = z
  .object({
    apiVersion: z.literal('scheduled-job-delivery.plugin.enterpriseglue.io/v1'),
    deliveryId: opaqueReferenceSchema,
    jobRef: opaqueReferenceSchema,
    jobType: namespacedIdentifierSchema,
    operationId: namespacedIdentifierSchema,
    scheduledFor: z.string().datetime(),
    attempt: z.number().int().min(1).max(100),
  })
  .strict();

export const pluginScheduledJobReceiptV1Schema = z
  .object({
    apiVersion: z.literal('scheduled-job-receipt.plugin.enterpriseglue.io/v1'),
    deliveryId: opaqueReferenceSchema,
    status: z.enum([
      'accepted',
      'duplicate',
      'retryable_rejected',
      'permanent_rejected',
    ]),
    reasonCode: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z][a-z0-9_]*$/),
  })
  .strict();

export type PluginBrokerCallV1 = z.infer<typeof pluginBrokerCallV1Schema>;
export type PluginIdentityRequestV1 = z.infer<
  typeof pluginIdentityRequestV1Schema
>;
export type PluginIdentityResponseV1 = z.infer<
  typeof pluginIdentityResponseV1Schema
>;
export type PluginResourceMetadataRequestV1 = z.infer<
  typeof pluginResourceMetadataRequestV1Schema
>;
export type PluginResourceMetadataResponseV1 = z.infer<
  typeof pluginResourceMetadataResponseV1Schema
>;
export type PluginStorageRequestV1 = z.infer<
  typeof pluginStorageRequestV1Schema
>;
export type PluginStorageResponseV1 = z.infer<
  typeof pluginStorageResponseV1Schema
>;
export type PluginEventDeliveryV1 = z.infer<
  typeof pluginEventDeliveryV1Schema
>;
export type PluginHostEventV1 = z.infer<typeof pluginHostEventV1Schema>;
export type PluginEventReceiptV1 = z.infer<
  typeof pluginEventReceiptV1Schema
>;
export type PluginDiagnosticCollectionRequestV1 = z.infer<
  typeof pluginDiagnosticCollectionRequestV1Schema
>;
export type PluginDiagnosticCollectionResponseV1 = z.infer<
  typeof pluginDiagnosticCollectionResponseV1Schema
>;
export type PluginDiagnosticCollectorStatusRequestV1 = z.infer<
  typeof pluginDiagnosticCollectorStatusRequestV1Schema
>;
export type PluginDiagnosticCollectorStatusResponseV1 = z.infer<
  typeof pluginDiagnosticCollectorStatusResponseV1Schema
>;
export type PluginSanitizedDiagnosticBundleV1 = z.infer<
  typeof pluginSanitizedDiagnosticBundleV1Schema
>;
export type PluginSanitizedDiagnosticBundleReceiptV1 = z.infer<
  typeof pluginSanitizedDiagnosticBundleReceiptV1Schema
>;
export type PluginNotificationPublishRequestV1 = z.infer<
  typeof pluginNotificationPublishRequestV1Schema
>;
export type PluginNotificationPublishResponseV1 = z.infer<
  typeof pluginNotificationPublishResponseV1Schema
>;
export type PluginFixedScheduleRequestV1 = z.infer<
  typeof pluginFixedScheduleRequestV1Schema
>;
export type PluginFixedScheduleResponseV1 = z.infer<
  typeof pluginFixedScheduleResponseV1Schema
>;
export type PluginScheduledJobDeliveryV1 = z.infer<
  typeof pluginScheduledJobDeliveryV1Schema
>;
export type PluginScheduledJobReceiptV1 = z.infer<
  typeof pluginScheduledJobReceiptV1Schema
>;

export interface PluginBrokerClientV1 {
  identity: {
    getSafeContext(
      input: PluginIdentityRequestV1,
    ): Promise<PluginIdentityResponseV1>;
  };
  resources: {
    getMetadata(
      input: PluginResourceMetadataRequestV1,
    ): Promise<PluginResourceMetadataResponseV1>;
  };
  storage: {
    execute(input: PluginStorageRequestV1): Promise<PluginStorageResponseV1>;
  };
  diagnostics: {
    collect(
      input: PluginDiagnosticCollectionRequestV1,
    ): Promise<PluginDiagnosticCollectionResponseV1>;
    /**
     * Optional in SDK 0.1.x so older hosts remain compatible. The response is
     * deliberately class-only and never exposes paths, source identifiers,
     * credentials, endpoints, keys, pod names, or raw diagnostic bytes.
     */
    status?(
      input: PluginDiagnosticCollectorStatusRequestV1,
    ): Promise<PluginDiagnosticCollectorStatusResponseV1>;
  };
  notifications: {
    publish(
      input: PluginNotificationPublishRequestV1,
    ): Promise<PluginNotificationPublishResponseV1>;
  };
  schedules: {
    execute(
      input: PluginFixedScheduleRequestV1,
    ): Promise<PluginFixedScheduleResponseV1>;
  };
  secrets: {
    use(input: import('./backend.js').PluginSecretUseRequestV1): Promise<
      import('./backend.js').PluginSecretUseResponseV1
    >;
  };
}

export function permissionForResourceKindV1(
  kind: PluginResourceMetadataRequestV1['kind'],
): PluginPermissionV1 {
  if (kind === 'incident') return 'host.engine.incidents.read_metadata';
  if (kind === 'failed_job') return 'host.engine.failed_jobs.read_metadata';
  if (kind === 'process_instance') {
    return 'host.engine.process_instances.read_metadata';
  }
  return 'host.engine.metadata.read';
}
