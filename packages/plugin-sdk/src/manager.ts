import { z } from 'zod';

import {
  namespacedIdentifierSchema,
  ociDigestReferenceSchema,
  opaqueReferenceSchema,
  pluginIdSchema,
  pluginPermissionSchema,
  semVerSchema,
  sha256Schema,
} from './common.js';

const timestampSchema = z.string().datetime();
const revisionSchema = z.number().int().nonnegative();
const digestSchema = sha256Schema;
const boundedTextSchema = z.string().min(1).max(500);
const urlSchema = z.string().url().max(2_000);

export const pluginDeploymentModeValues = [
  'compose_planner',
  'compose_managed',
  'kubernetes',
  'openshift',
] as const;
export const pluginDeploymentModeSchema = z.enum(pluginDeploymentModeValues);

export const pluginArchitectureValues = ['amd64', 'arm64'] as const;
export const pluginArchitectureSchema = z.enum(pluginArchitectureValues);

export const pluginRollbackClassValues = [
  'stateless',
  'backward_compatible_data',
  'backup_required',
  'forward_only',
] as const;
export const pluginRollbackClassSchema = z.enum(pluginRollbackClassValues);

export const pluginEntitlementStateValues = [
  'not_required',
  'unavailable',
  'trial',
  'active',
  'grace',
  'expired',
  'revoked',
] as const;
export const pluginEntitlementStateSchema = z.enum(
  pluginEntitlementStateValues,
);

export const pluginReleaseStateValues = [
  'available',
  'deprecated',
  'withdrawn',
  'security_revoked',
] as const;
export const pluginReleaseStateSchema = z.enum(pluginReleaseStateValues);

export const pluginManagerStateValues = [
  'unavailable',
  'planner_only',
  'ready',
  'busy',
  'recovery_required',
] as const;
export const pluginManagerStateSchema = z.enum(pluginManagerStateValues);

export const pluginInstallationStateValues = [
  'requested',
  'planning',
  'awaiting_approval',
  'approved',
  'acquiring',
  'verified',
  'staged_disabled',
  'ready',
  'enabled',
  'upgrading',
  'rollback_pending',
  'disabled',
  'uninstalling',
  'uninstalled',
  'cancelled',
  'failed',
  'manual_intervention',
] as const;
export const pluginInstallationStateSchema = z.enum(
  pluginInstallationStateValues,
);

export const pluginInstallationReasonValues = [
  'none',
  'manager_unavailable',
  'manager_incompatible',
  'lease_expired',
  'revision_conflict',
  'approval_required',
  'approval_expired',
  'approval_digest_mismatch',
  'catalog_expired',
  'release_withdrawn',
  'security_revoked',
  'signature_invalid',
  'provenance_invalid',
  'artifact_closure_incomplete',
  'host_incompatible',
  'validation_pending',
  'platform_unsupported',
  'architecture_unsupported',
  'database_unsupported',
  'entitlement_inactive',
  'permission_denied',
  'acquisition_failed',
  'verification_failed',
  'operator_apply_required',
  'staging_failed',
  'readiness_failed',
  'migration_failed',
  'health_gate_failed',
  'rollback_unavailable',
  'rollback_failed',
  'administrator_cancelled',
] as const;
export const pluginInstallationReasonSchema = z.enum(
  pluginInstallationReasonValues,
);

export const pluginProductDescriptorV1Schema = z
  .object({
    apiVersion: z.literal('product.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginProduct'),
    productId: pluginIdSchema,
    pluginId: pluginIdSchema,
    publisher: z
      .object({
        id: pluginIdSchema,
        displayName: z.string().min(1).max(100),
        verification: z.enum(['first_party', 'verified', 'unverified']),
      })
      .strict(),
    displayName: z.string().min(1).max(100),
    summary: z.string().min(1).max(500),
    categories: z.array(namespacedIdentifierSchema).max(20),
    documentationUrl: urlSchema,
    supportUrl: urlSchema,
    securityUrl: urlSchema,
    privacyUrl: urlSchema,
    dataFlowUrl: urlSchema,
    retentionUrl: urlSchema,
    subprocessorsUrl: urlSchema.optional(),
    deploymentModes: z.array(pluginDeploymentModeSchema).min(1).max(4),
    architectures: z.array(pluginArchitectureSchema).min(1).max(2),
    commercialAction: z.enum([
      'contact',
      'trial',
      'purchase',
      'entitled',
    ]),
  })
  .strict();

/**
 * Discovery-only catalog. All executable, compatibility, support, evidence,
 * and rollback authority lives in the referenced PluginReleaseV1 record.
 */
export const pluginCatalogV2Schema = z
  .object({
    apiVersion: z.literal('catalog.plugin.enterpriseglue.io/v2'),
    kind: z.literal('EnterpriseGluePluginCatalog'),
    metadata: z
      .object({
        revision: semVerSchema,
        generatedAt: timestampSchema,
        expiresAt: timestampSchema,
      })
      .strict(),
    products: z
      .array(
        z
          .object({
            descriptor: pluginProductDescriptorV1Schema,
            releases: z
              .array(
                z
                  .object({
                    version: semVerSchema,
                    channel: z.enum(['stable', 'preview', 'withdrawn']),
                    state: pluginReleaseStateSchema,
                    release: ociDigestReferenceSchema,
                  })
                  .strict(),
              )
              .min(1)
              .max(100),
          })
          .strict(),
      )
      .max(1_000),
  })
  .strict()
  .superRefine((catalog, context) => {
    if (Date.parse(catalog.metadata.expiresAt) <= Date.parse(catalog.metadata.generatedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'expiresAt'],
        message: 'Catalog expiry must be after generation time',
      });
    }
    const pluginIds = new Set<string>();
    for (const [productIndex, product] of catalog.products.entries()) {
      const pluginId = product.descriptor.pluginId;
      if (pluginIds.has(pluginId)) {
        context.addIssue({
          code: 'custom',
          path: ['products', productIndex, 'descriptor', 'pluginId'],
          message: 'Catalog plugin IDs must be unique',
        });
      }
      pluginIds.add(pluginId);
      const versions = new Set<string>();
      for (const [releaseIndex, release] of product.releases.entries()) {
        if (versions.has(release.version)) {
          context.addIssue({
            code: 'custom',
            path: ['products', productIndex, 'releases', releaseIndex, 'version'],
            message: 'Release versions must be unique per product',
          });
        }
        versions.add(release.version);
      }
    }
  });

const pluginReleaseArtifactV1Schema = z
  .object({
    role: z.enum(['package', 'runtime', 'migration', 'helper']),
    subject: ociDigestReferenceSchema,
    mediaType: z.string().min(1).max(200),
    platforms: z
      .array(
        z
          .object({
            os: z.enum(['linux']),
            architecture: pluginArchitectureSchema,
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();

const pluginCompatibilityEvidenceV1Schema = z
  .object({
    hostVersion: semVerSchema,
    hostArtifact: ociDigestReferenceSchema,
    deploymentMode: pluginDeploymentModeSchema,
    platform: z.enum(['docker', 'kubernetes', 'openshift']),
    architecture: pluginArchitectureSchema,
    database: z.enum([
      'postgres',
      'mysql',
      'mssql',
      'oracle',
      'spanner',
    ]),
    suiteRevision: opaqueReferenceSchema,
    testedAt: timestampSchema,
    evidenceSha256: sha256Schema,
  })
  .strict();

export const pluginReleaseV1Schema = z
  .object({
    apiVersion: z.literal('release.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginRelease'),
    pluginId: pluginIdSchema,
    publisher: pluginIdSchema,
    version: semVerSchema,
    channel: z.enum(['stable', 'preview', 'withdrawn']),
    releaseState: pluginReleaseStateSchema,
    package: ociDigestReferenceSchema,
    artifacts: z.array(pluginReleaseArtifactV1Schema).min(1).max(100),
    compatibility: z
      .object({
        hostRange: z.string().min(1).max(100),
        hostApiRange: z.string().min(1).max(100),
        sdkRange: z.string().min(1).max(100),
        deploymentModes: z.array(pluginDeploymentModeSchema).min(1).max(4),
        architectures: z.array(pluginArchitectureSchema).min(1).max(2),
        evidence: z
          .array(pluginCompatibilityEvidenceV1Schema)
          .min(1)
          .max(200),
      })
      .strict(),
    dependencies: z
      .array(
        z
          .object({ pluginId: pluginIdSchema, versionRange: boundedTextSchema })
          .strict(),
      )
      .max(50),
    conflicts: z.array(pluginIdSchema).max(50),
    requiredCapabilities: z.array(namespacedIdentifierSchema).max(100),
    permissions: z.array(pluginPermissionSchema).max(100),
    data: z
      .object({
        reads: z.array(namespacedIdentifierSchema).max(100),
        generates: z.array(namespacedIdentifierSchema).max(100),
        retentionClass: z.enum(['none', 'ephemeral', 'customer_policy']),
        leavesDeployment: z.boolean(),
      })
      .strict(),
    infrastructure: z
      .object({
        storageMiB: z.number().int().nonnegative().max(1_048_576),
        cpuLimit: boundedTextSchema,
        memoryLimitMiB: z.number().int().positive().max(1_048_576),
        egressPolicy: namespacedIdentifierSchema,
        secretReferences: z.array(namespacedIdentifierSchema).max(100),
      })
      .strict(),
    schemaTransition: z
      .object({
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative(),
        rollbackClass: pluginRollbackClassSchema,
        backupRequired: z.boolean(),
        downtimeExpected: z.boolean(),
      })
      .strict(),
    support: z
      .object({
        startsAt: timestampSchema,
        endsAt: timestampSchema,
        deprecatedAt: timestampSchema.optional(),
        reasonCode: z
          .enum(['none', 'superseded', 'security', 'compatibility', 'publisher'])
          .default('none'),
        replacement: ociDigestReferenceSchema.optional(),
      })
      .strict(),
    evidence: z
      .object({
        signature: ociDigestReferenceSchema,
        provenance: ociDigestReferenceSchema,
        sbom: ociDigestReferenceSchema,
        vex: ociDigestReferenceSchema.optional(),
        scan: ociDigestReferenceSchema,
        license: ociDigestReferenceSchema,
      })
      .strict(),
    entitlementSku: namespacedIdentifierSchema.optional(),
    updateEdges: z
      .array(
        z
          .object({
            fromVersion: semVerSchema,
            migration: z.enum(['none', 'automatic', 'operator_assisted']),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((release, context) => {
    const artifactSubjects = new Set<string>();
    for (const [index, artifact] of release.artifacts.entries()) {
      if (artifactSubjects.has(artifact.subject)) {
        context.addIssue({
          code: 'custom',
          path: ['artifacts', index, 'subject'],
          message: 'Artifact subjects must be unique',
        });
      }
      artifactSubjects.add(artifact.subject);
    }
    if (!artifactSubjects.has(release.package)) {
      context.addIssue({
        code: 'custom',
        path: ['package'],
        message: 'The package subject must be present in the artifact closure',
      });
    }
    if (Date.parse(release.support.endsAt) <= Date.parse(release.support.startsAt)) {
      context.addIssue({
        code: 'custom',
        path: ['support', 'endsAt'],
        message: 'Support end must be after support start',
      });
    }
    if (
      release.schemaTransition.backupRequired !==
      (release.schemaTransition.rollbackClass === 'backup_required')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['schemaTransition', 'backupRequired'],
        message: 'backupRequired must match rollback class backup_required',
      });
    }
    if (
      release.releaseState === 'security_revoked' &&
      release.support.reasonCode !== 'security'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['support', 'reasonCode'],
        message: 'A security-revoked release requires security reason code',
      });
    }
  });

export const pluginInstallationIntentV1Schema = z
  .object({
    apiVersion: z.literal('installation-intent.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginInstallationIntent'),
    installationId: opaqueReferenceSchema,
    pluginId: pluginIdSchema,
    release: ociDigestReferenceSchema,
    operation: z.enum(['install', 'upgrade']).default('install'),
    fromVersion: semVerSchema.optional(),
    currentEnabled: z.boolean().optional(),
    source: z.enum(['connected_registry', 'offline_delivery', 'static_catalog']),
    deploymentMode: pluginDeploymentModeSchema,
    requesterRef: opaqueReferenceSchema,
    expectedPlatformRevision: revisionSchema,
    idempotencyKey: opaqueReferenceSchema,
    requestedAt: timestampSchema,
  })
  .strict()
  .superRefine((intent, context) => {
    if (
      (intent.operation === 'upgrade' &&
        (intent.fromVersion === undefined ||
          intent.currentEnabled === undefined)) ||
      (intent.operation === 'install' &&
        (intent.fromVersion !== undefined ||
          intent.currentEnabled !== undefined))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['fromVersion'],
        message:
          'An upgrade requires fromVersion and currentEnabled; an install must omit both',
      });
    }
  });

const reviewFindingSchema = z
  .object({
    status: z.enum(['pass', 'warning', 'blocked']),
    reasonCode: pluginInstallationReasonSchema,
    summary: boundedTextSchema,
  })
  .strict();

export const pluginInstallReviewV1Schema = z
  .object({
    apiVersion: z.literal('install-review.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginInstallReview'),
    installationId: opaqueReferenceSchema,
    pluginId: pluginIdSchema,
    version: semVerSchema,
    release: ociDigestReferenceSchema,
    planSha256: digestSchema,
    reviewSha256: digestSchema,
    platformRevision: revisionSchema,
    generatedAt: timestampSchema,
    expiresAt: timestampSchema,
    identity: reviewFindingSchema,
    compatibility: reviewFindingSchema,
    permissionsAndData: reviewFindingSchema,
    infrastructure: reviewFindingSchema,
    migrationAndRollback: reviewFindingSchema,
    entitlement: reviewFindingSchema,
    entitlementState: pluginEntitlementStateSchema,
    rollbackClass: pluginRollbackClassSchema,
    requestedPermissions: z.array(pluginPermissionSchema).max(100),
    materialChanges: z.array(namespacedIdentifierSchema).max(100),
    approvable: z.boolean(),
  })
  .strict()
  .superRefine((review, context) => {
    if (Date.parse(review.expiresAt) <= Date.parse(review.generatedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Review expiry must be after generation time',
      });
    }
    const findings = [
      review.identity,
      review.compatibility,
      review.permissionsAndData,
      review.infrastructure,
      review.migrationAndRollback,
      review.entitlement,
    ];
    if (review.approvable === findings.some((finding) => finding.status === 'blocked')) {
      context.addIssue({
        code: 'custom',
        path: ['approvable'],
        message: 'A review is approvable exactly when no section is blocked',
      });
    }
  });

export const pluginInstallApprovalV1Schema = z
  .object({
    apiVersion: z.literal('install-approval.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginInstallApproval'),
    installationId: opaqueReferenceSchema,
    decision: z.enum(['approve', 'reject']),
    reviewSha256: digestSchema,
    planSha256: digestSchema,
    approverRef: opaqueReferenceSchema,
    expectedRevision: revisionSchema,
    decidedAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict()
  .superRefine((approval, context) => {
    if (Date.parse(approval.expiresAt) <= Date.parse(approval.decidedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Approval expiry must be after decision time',
      });
    }
  });

export const pluginInstallationObservationV1Schema = z
  .object({
    apiVersion: z.literal('installation-observation.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginInstallationObservation'),
    installationId: opaqueReferenceSchema,
    pluginId: pluginIdSchema,
    // Resolution and signature failures can happen before a release document
    // is trusted. In that case the manager must report a bounded failure
    // without copying an unverified version into the safe host projection.
    version: semVerSchema.optional(),
    revision: revisionSchema,
    state: pluginInstallationStateSchema,
    reasonCode: pluginInstallationReasonSchema,
    planSha256: digestSchema.optional(),
    occurredAt: timestampSchema,
    retryable: z.boolean(),
    recoveryActions: z
      .array(z.enum(['retry', 'cancel', 'rollback', 'manual_intervention']))
      .max(4),
  })
  .strict();

export const pluginManagerCapabilityV1Schema = z
  .object({
    apiVersion: z.literal('manager-capability.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginManagerCapability'),
    managerId: opaqueReferenceSchema,
    managerVersion: semVerSchema,
    protocolVersions: z.array(z.literal('v1')).length(1),
    deploymentModes: z.array(pluginDeploymentModeSchema).min(1).max(4),
    architectures: z.array(pluginArchitectureSchema).min(1).max(2),
    operations: z
      .array(
        z.enum([
          'plan',
          'install',
          'enable',
          'disable',
          'upgrade',
          'rollback',
          'uninstall',
          'offline_import',
          'host_upgrade_preflight',
        ]),
      )
      .min(1)
      .max(9),
    state: pluginManagerStateSchema,
    observedAt: timestampSchema,
  })
  .strict();

export const pluginOfflineDeliveryRequestV1Schema = z
  .object({
    apiVersion: z.literal('offline-delivery-request.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginOfflineDeliveryRequest'),
    requestId: opaqueReferenceSchema,
    deploymentPublicId: opaqueReferenceSchema,
    hostVersion: semVerSchema,
    hostArtifact: ociDigestReferenceSchema,
    deploymentMode: pluginDeploymentModeSchema,
    platform: z.enum(['docker', 'kubernetes', 'openshift']),
    architecture: pluginArchitectureSchema,
    releases: z.array(ociDigestReferenceSchema).min(1).max(100),
    nonce: opaqueReferenceSchema,
    requestedAt: timestampSchema,
  })
  .strict();

const offlineDeliveryPathSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !path.endsWith('/') &&
      !path.split('/').some((segment) => segment === '..' || segment === '.'),
    'Offline delivery paths must be normalized relative paths',
  );

export const pluginOfflineDeliveryManifestV1Schema = z
  .object({
    apiVersion: z.literal('offline-delivery.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginOfflineDelivery'),
    deliveryId: opaqueReferenceSchema,
    release: ociDigestReferenceSchema,
    generatedAt: timestampSchema,
    expiresAt: timestampSchema,
    files: z
      .array(
        z
          .object({
            path: offlineDeliveryPathSchema,
            role: z.enum([
              'release_metadata',
              'release_signature',
              'airgap_content',
              'registry_map',
              'trust_snapshot',
              'revocation_snapshot',
              'documentation',
            ]),
            sizeBytes: z.number().int().nonnegative().max(20 * 1024 ** 3),
            sha256: sha256Schema,
          })
          .strict(),
      )
      .min(4)
      .max(10_000),
  })
  .strict()
  .superRefine((delivery, context) => {
    if (Date.parse(delivery.expiresAt) <= Date.parse(delivery.generatedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Delivery expiry must be after generation time',
      });
    }
    const paths = new Set<string>();
    for (const [index, file] of delivery.files.entries()) {
      if (paths.has(file.path)) {
        context.addIssue({
          code: 'custom',
          path: ['files', index, 'path'],
          message: 'Offline delivery paths must be unique',
        });
      }
      paths.add(file.path);
    }
    const required = [
      ['release_metadata', 'release.json'],
      ['release_signature', 'release.signature.json'],
      ['registry_map', 'airgap-registry-map.json'],
    ] as const;
    for (const [role, path] of required) {
      if (!delivery.files.some((file) => file.role === role && file.path === path)) {
        context.addIssue({
          code: 'custom',
          path: ['files'],
          message: `Offline delivery requires ${path} with role ${role}`,
        });
      }
    }
    if (!delivery.files.some((file) => file.role === 'airgap_content')) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'Offline delivery requires signed air-gap content',
      });
    }
  });

export const pluginOfflineDeliveryReceiptV1Schema = z
  .object({
    apiVersion: z.literal('offline-delivery-receipt.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginOfflineDeliveryReceipt'),
    requestId: opaqueReferenceSchema,
    deliverySha256: digestSchema,
    importedArtifacts: z.array(ociDigestReferenceSchema).min(1).max(1_000),
    result: z.enum(['verified', 'rejected', 'partial']),
    reasonCode: z.enum([
      'none',
      'inventory_invalid',
      'signature_invalid',
      'artifact_missing',
      'digest_mismatch',
      'destination_verification_failed',
    ]),
    completedAt: timestampSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    if ((receipt.result === 'verified') !== (receipt.reasonCode === 'none')) {
      context.addIssue({
        code: 'custom',
        path: ['reasonCode'],
        message: 'Only a verified receipt may use reason code none',
      });
    }
  });

function jsonSchema(
  schema: z.ZodType,
  id: string,
  title: string,
  description: string,
): z.core.JSONSchema.JSONSchema {
  return {
    ...z.toJSONSchema(schema, { target: 'draft-2020-12' }),
    $id: `https://schemas.enterpriseglue.io/plugin/${id}.schema.json`,
    title,
    description,
  };
}

export function getPluginReleaseV1JsonSchema(): z.core.JSONSchema.JSONSchema {
  return jsonSchema(
    pluginReleaseV1Schema,
    'enterpriseglue-plugin-release-v1',
    'EnterpriseGlue Plugin Release v1',
    'Canonical signed authority for one immutable plugin release and its complete compatibility, artifact, evidence, support, and rollback graph.',
  );
}

export function getPluginCatalogV2JsonSchema(): z.core.JSONSchema.JSONSchema {
  return jsonSchema(
    pluginCatalogV2Schema,
    'enterpriseglue-plugin-catalog-v2',
    'EnterpriseGlue Plugin Catalog v2',
    'Safe discovery catalog whose release entries reference the canonical signed PluginReleaseV1 authority by immutable digest.',
  );
}

export function getPluginInstallationIntentV1JsonSchema(): z.core.JSONSchema.JSONSchema {
  return jsonSchema(
    pluginInstallationIntentV1Schema,
    'enterpriseglue-plugin-installation-intent-v1',
    'EnterpriseGlue Plugin Installation Intent v1',
    'Browser-safe, revision-bound request for the isolated Plugin Manager.',
  );
}

export function getPluginInstallReviewV1JsonSchema(): z.core.JSONSchema.JSONSchema {
  return jsonSchema(
    pluginInstallReviewV1Schema,
    'enterpriseglue-plugin-install-review-v1',
    'EnterpriseGlue Plugin Install Review v1',
    'Safe pre-install projection bound to an exact lifecycle plan digest.',
  );
}

export function getPluginInstallApprovalV1JsonSchema(): z.core.JSONSchema.JSONSchema {
  return jsonSchema(
    pluginInstallApprovalV1Schema,
    'enterpriseglue-plugin-install-approval-v1',
    'EnterpriseGlue Plugin Install Approval v1',
    'Explicit approval or rejection bound to exact review and plan digests.',
  );
}

export function getPluginInstallationObservationV1JsonSchema(): z.core.JSONSchema.JSONSchema {
  return jsonSchema(
    pluginInstallationObservationV1Schema,
    'enterpriseglue-plugin-installation-observation-v1',
    'EnterpriseGlue Plugin Installation Observation v1',
    'Bounded manager status projection without credentials, commands, paths, or raw exceptions.',
  );
}

export function getPluginManagerCapabilityV1JsonSchema(): z.core.JSONSchema.JSONSchema {
  return jsonSchema(
    pluginManagerCapabilityV1Schema,
    'enterpriseglue-plugin-manager-capability-v1',
    'EnterpriseGlue Plugin Manager Capability v1',
    'Version-skew and adapter capability handshake for an isolated manager workload.',
  );
}

export function getPluginOfflineDeliveryRequestV1JsonSchema(): z.core.JSONSchema.JSONSchema {
  return jsonSchema(
    pluginOfflineDeliveryRequestV1Schema,
    'enterpriseglue-plugin-offline-delivery-request-v1',
    'EnterpriseGlue Plugin Offline Delivery Request v1',
    'Customer-content-free request for an exact signed offline delivery.',
  );
}

export function getPluginOfflineDeliveryManifestV1JsonSchema(): z.core.JSONSchema.JSONSchema {
  return jsonSchema(
    pluginOfflineDeliveryManifestV1Schema,
    'enterpriseglue-plugin-offline-delivery-v1',
    'EnterpriseGlue Plugin Offline Delivery v1',
    'Signed outer inventory binding release authority, air-gap content, registry mapping, trust, revocation, and documentation snapshots.',
  );
}

export function getPluginOfflineDeliveryReceiptV1JsonSchema(): z.core.JSONSchema.JSONSchema {
  return jsonSchema(
    pluginOfflineDeliveryReceiptV1Schema,
    'enterpriseglue-plugin-offline-delivery-receipt-v1',
    'EnterpriseGlue Plugin Offline Delivery Receipt v1',
    'Bounded verified import result for an offline delivery.',
  );
}

export type PluginDeploymentModeV1 = z.infer<typeof pluginDeploymentModeSchema>;
export type PluginArchitectureV1 = z.infer<typeof pluginArchitectureSchema>;
export type PluginRollbackClassV1 = z.infer<typeof pluginRollbackClassSchema>;
export type PluginEntitlementStateV1 = z.infer<typeof pluginEntitlementStateSchema>;
export type PluginReleaseStateV1 = z.infer<typeof pluginReleaseStateSchema>;
export type PluginManagerStateV1 = z.infer<typeof pluginManagerStateSchema>;
export type PluginInstallationStateV1 = z.infer<typeof pluginInstallationStateSchema>;
export type PluginInstallationReasonV1 = z.infer<typeof pluginInstallationReasonSchema>;
export type PluginProductDescriptorV1 = z.infer<typeof pluginProductDescriptorV1Schema>;
export type PluginCatalogV2 = z.infer<typeof pluginCatalogV2Schema>;
export type PluginReleaseV1 = z.infer<typeof pluginReleaseV1Schema>;
export type PluginInstallationIntentV1 = z.infer<typeof pluginInstallationIntentV1Schema>;
export type PluginInstallReviewV1 = z.infer<typeof pluginInstallReviewV1Schema>;
export type PluginInstallApprovalV1 = z.infer<typeof pluginInstallApprovalV1Schema>;
export type PluginInstallationObservationV1 = z.infer<typeof pluginInstallationObservationV1Schema>;
export type PluginManagerCapabilityV1 = z.infer<typeof pluginManagerCapabilityV1Schema>;
export type PluginOfflineDeliveryRequestV1 = z.infer<typeof pluginOfflineDeliveryRequestV1Schema>;
export type PluginOfflineDeliveryManifestV1 = z.infer<typeof pluginOfflineDeliveryManifestV1Schema>;
export type PluginOfflineDeliveryReceiptV1 = z.infer<typeof pluginOfflineDeliveryReceiptV1Schema>;
