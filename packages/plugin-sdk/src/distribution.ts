import { z } from 'zod';

import {
  ociDigestReferenceSchema,
  pluginIdSchema,
  safeRelativePathSchema,
  semVerSchema,
  sha256Schema,
} from './common.js';

const timestampSchema = z.string().datetime();

export const pluginResourceDescriptorV1Schema = z
  .object({
    apiVersion: z.literal('resources.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginResources'),
    service: z
      .object({
        containerPort: z.number().int().min(1024).max(65_535),
        runAsNonRoot: z.literal(true),
        readOnlyRootFilesystem: z.literal(true),
        tmpfsMiB: z.number().int().min(1).max(1_024),
        cpuLimit: z.string().regex(/^(?:[1-9]\d*m|[1-9]\d*(?:\.\d+)?)$/),
        memoryLimitMiB: z.number().int().min(32).max(32_768),
      })
      .strict(),
    configuration: z
      .array(
        z
          .object({
            name: z
              .string()
              .min(1)
              .max(100)
              .regex(/^[A-Z][A-Z0-9_]*$/),
            source: z.enum([
              'deployment_config',
              'deployment_file',
              'secret_reference',
            ]),
            reference: z
              .string()
              .min(1)
              .max(200)
              .regex(/^[a-z][a-z0-9._-]*$/),
            required: z.boolean(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    storage: z
      .array(
        z
          .object({
            name: z.string().regex(/^[a-z][a-z0-9-]*$/),
            mountPath: z
              .string()
              .min(2)
              .max(300)
              .regex(/^\/[a-zA-Z0-9._/-]+$/),
            readOnly: z.boolean(),
            sizeMiB: z.number().int().min(1).max(102_400),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    network: z
      .object({
        ingress: z.literal('host-gateway-only'),
        egressPolicy: z
          .string()
          .min(1)
          .max(100)
          .regex(/^(none|[a-z][a-z0-9-]*)$/),
      })
      .strict(),
    probes: z
      .object({
        healthPath: z.literal('/_plugin/health'),
        readyPath: z.literal('/_plugin/ready'),
        initialDelaySeconds: z.number().int().min(0).max(600),
        periodSeconds: z.number().int().min(1).max(300),
        timeoutSeconds: z.number().int().min(1).max(60),
        failureThreshold: z.number().int().min(1).max(100),
      })
      .strict(),
  })
  .strict()
  .superRefine((descriptor, context) => {
    const configurationNames = new Set<string>();
    for (const [index, item] of descriptor.configuration.entries()) {
      if (configurationNames.has(item.name)) {
        context.addIssue({
          code: 'custom',
          path: ['configuration', index, 'name'],
          message: 'Configuration names must be unique',
        });
      }
      configurationNames.add(item.name);
    }

    const storageNames = new Set<string>();
    const storagePaths = new Set<string>();
    for (const [index, item] of descriptor.storage.entries()) {
      if (storageNames.has(item.name) || storagePaths.has(item.mountPath)) {
        context.addIssue({
          code: 'custom',
          path: ['storage', index],
          message: 'Storage names and mount paths must be unique',
        });
      }
      storageNames.add(item.name);
      storagePaths.add(item.mountPath);
    }
  });

const pluginCatalogReleaseV1Schema = z
  .object({
    version: semVerSchema,
    channel: z.enum(['stable', 'preview']),
    bundle: ociDigestReferenceSchema,
    manifestSha256: sha256Schema,
    hostCompatibility: z.string().min(1).max(100),
    testedHostVersions: z.array(semVerSchema).min(1).max(20),
    sdkCompatibility: z.string().min(1).max(100),
    revoked: z.boolean().default(false),
    revocationReasonCode: z
      .enum(['none', 'security', 'publisher', 'compatibility', 'superseded'])
      .default('none'),
  })
  .strict()
  .superRefine((release, context) => {
    if (
      new Set(release.testedHostVersions).size !==
      release.testedHostVersions.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['testedHostVersions'],
        message: 'Tested host versions must be unique',
      });
    }
    if (release.revoked && release.revocationReasonCode === 'none') {
      context.addIssue({
        code: 'custom',
        path: ['revocationReasonCode'],
        message: 'A revoked release requires a bounded reason code',
      });
    }
    if (!release.revoked && release.revocationReasonCode !== 'none') {
      context.addIssue({
        code: 'custom',
        path: ['revocationReasonCode'],
        message: 'A non-revoked release must use reason code none',
      });
    }
  });

export const pluginCatalogV1Schema = z
  .object({
    apiVersion: z.literal('catalog.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginCatalog'),
    metadata: z
      .object({
        revision: semVerSchema,
        generatedAt: timestampSchema,
        expiresAt: timestampSchema,
      })
      .strict(),
    entries: z
      .array(
        z
          .object({
            pluginId: pluginIdSchema,
            displayName: z.string().min(1).max(100),
            publisher: pluginIdSchema,
            releases: z.array(pluginCatalogReleaseV1Schema).min(1).max(100),
          })
          .strict(),
      )
      .max(1_000),
  })
  .strict()
  .superRefine((catalog, context) => {
    if (
      Date.parse(catalog.metadata.expiresAt) <=
      Date.parse(catalog.metadata.generatedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'expiresAt'],
        message: 'Catalog expiry must be after generation time',
      });
    }
    const pluginIds = new Set<string>();
    for (const [entryIndex, entry] of catalog.entries.entries()) {
      if (pluginIds.has(entry.pluginId)) {
        context.addIssue({
          code: 'custom',
          path: ['entries', entryIndex, 'pluginId'],
          message: 'Catalog plugin IDs must be unique',
        });
      }
      pluginIds.add(entry.pluginId);

      const versions = new Set<string>();
      for (const [releaseIndex, release] of entry.releases.entries()) {
        if (versions.has(release.version)) {
          context.addIssue({
            code: 'custom',
            path: ['entries', entryIndex, 'releases', releaseIndex, 'version'],
            message: 'Catalog release versions must be unique per plugin',
          });
        }
        versions.add(release.version);
      }
    }
  });

export const signedArtifactEnvelopeV1Schema = z
  .object({
    apiVersion: z.literal('signature.plugin.enterpriseglue.io/v1'),
    algorithm: z.literal('Ed25519'),
    publisher: pluginIdSchema,
    keyId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/),
    payloadSha256: sha256Schema,
    signature: z
      .string()
      .min(80)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

const pluginCompatibilityMatrixCellV1Schema = z
  .object({
    hostVersion: semVerSchema,
    pluginVersion: semVerSchema,
    hostArtifact: ociDigestReferenceSchema,
    pluginArtifact: ociDigestReferenceSchema,
    result: z.literal('passed'),
    suiteRevision: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/),
    testedAt: timestampSchema,
    evidenceSha256: sha256Schema,
  })
  .strict();

/**
 * Signed positive release evidence for the current/previous supported host
 * crossed with the current/previous supported plugin release.
 *
 * A failed or missing cell cannot be represented as a releasable matrix. The
 * publisher retains failed test output separately and signs this document only
 * after all four exact artifact combinations pass.
 */
export const pluginCompatibilityMatrixV1Schema = z
  .object({
    apiVersion: z.literal(
      'compatibility-matrix.plugin.enterpriseglue.io/v1',
    ),
    kind: z.literal('EnterpriseGluePluginCompatibilityMatrix'),
    metadata: z
      .object({
        revision: semVerSchema,
        generatedAt: timestampSchema,
      })
      .strict(),
    pluginId: pluginIdSchema,
    publisher: pluginIdSchema,
    hostVersions: z
      .object({
        current: semVerSchema,
        previous: semVerSchema,
      })
      .strict(),
    pluginVersions: z
      .object({
        current: semVerSchema,
        previous: semVerSchema,
      })
      .strict(),
    cells: z.array(pluginCompatibilityMatrixCellV1Schema).length(4),
  })
  .strict()
  .superRefine((matrix, context) => {
    if (matrix.hostVersions.current === matrix.hostVersions.previous) {
      context.addIssue({
        code: 'custom',
        path: ['hostVersions'],
        message: 'Current and previous host versions must be distinct',
      });
    }
    if (matrix.pluginVersions.current === matrix.pluginVersions.previous) {
      context.addIssue({
        code: 'custom',
        path: ['pluginVersions'],
        message: 'Current and previous plugin versions must be distinct',
      });
    }

    const requiredCells = new Set(
      [
        matrix.hostVersions.current,
        matrix.hostVersions.previous,
      ].flatMap((hostVersion) =>
        [
          matrix.pluginVersions.current,
          matrix.pluginVersions.previous,
        ].map((pluginVersion) => `${hostVersion}\0${pluginVersion}`),
      ),
    );
    const observedCells = new Set<string>();
    const hostArtifacts = new Map<string, string>();
    const pluginArtifacts = new Map<string, string>();
    for (const [cellIndex, cell] of matrix.cells.entries()) {
      const key = `${cell.hostVersion}\0${cell.pluginVersion}`;
      if (!requiredCells.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['cells', cellIndex],
          message:
            'Compatibility cell must use one declared host and plugin version',
        });
      }
      if (observedCells.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['cells', cellIndex],
          message: 'Compatibility cells must be unique',
        });
      }
      observedCells.add(key);
      const observedHostArtifact = hostArtifacts.get(cell.hostVersion);
      if (
        observedHostArtifact !== undefined &&
        observedHostArtifact !== cell.hostArtifact
      ) {
        context.addIssue({
          code: 'custom',
          path: ['cells', cellIndex, 'hostArtifact'],
          message:
            'One host version must use one immutable artifact in every matrix cell',
        });
      }
      hostArtifacts.set(cell.hostVersion, cell.hostArtifact);
      const observedPluginArtifact = pluginArtifacts.get(cell.pluginVersion);
      if (
        observedPluginArtifact !== undefined &&
        observedPluginArtifact !== cell.pluginArtifact
      ) {
        context.addIssue({
          code: 'custom',
          path: ['cells', cellIndex, 'pluginArtifact'],
          message:
            'One plugin version must use one immutable artifact in every matrix cell',
        });
      }
      pluginArtifacts.set(cell.pluginVersion, cell.pluginArtifact);
      if (
        Date.parse(cell.testedAt) >
        Date.parse(matrix.metadata.generatedAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['cells', cellIndex, 'testedAt'],
          message: 'Compatibility evidence cannot postdate matrix generation',
        });
      }
    }
    for (const key of requiredCells) {
      if (!observedCells.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['cells'],
          message:
            'Compatibility matrix must contain the exact current/previous Cartesian product',
        });
      }
    }
  });

export const pluginAirgapOciLayoutMediaTypeV1 =
  'application/vnd.enterpriseglue.oci-layout.v1.tar' as const;

export const pluginAirgapIndexV1Schema = z
  .object({
    apiVersion: z.literal('airgap.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginAirgapIndex'),
    catalogRevision: semVerSchema,
    generatedAt: timestampSchema,
    artifacts: z
      .array(
        z
          .object({
            source: ociDigestReferenceSchema,
            archivePath: safeRelativePathSchema.refine(
              (path) => !path.includes(':'),
              'Archive paths must not contain a URI scheme or colon',
            ),
            mediaType: z.literal(pluginAirgapOciLayoutMediaTypeV1),
            sizeBytes: z.number().int().positive().max(20 * 1024 ** 3),
            sha256: sha256Schema,
          })
          .strict(),
      )
      .min(1)
      .max(10_000),
  })
  .strict()
  .superRefine((index, context) => {
    const paths = new Set<string>();
    for (const [artifactIndex, artifact] of index.artifacts.entries()) {
      if (paths.has(artifact.archivePath)) {
        context.addIssue({
          code: 'custom',
          path: ['artifacts', artifactIndex, 'archivePath'],
          message: 'Air-gap archive paths must be unique',
        });
      }
      paths.add(artifact.archivePath);
    }
  });

export const pluginAirgapRegistryMapV1Schema = z
  .object({
    apiVersion: z.literal('airgap-map.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginAirgapRegistryMap'),
    catalogRevision: semVerSchema,
    generatedAt: timestampSchema,
    mappings: z
      .array(
        z
          .object({
            source: ociDigestReferenceSchema,
            target: ociDigestReferenceSchema,
            archivePath: safeRelativePathSchema.refine(
              (path) => !path.includes(':'),
              'Archive paths must not contain a URI scheme or colon',
            ),
          })
          .strict(),
      )
      .min(1)
      .max(10_000),
  })
  .strict()
  .superRefine((registryMap, context) => {
    const sources = new Set<string>();
    const targets = new Set<string>();
    for (const [mappingIndex, mapping] of registryMap.mappings.entries()) {
      if (sources.has(mapping.source)) {
        context.addIssue({
          code: 'custom',
          path: ['mappings', mappingIndex, 'source'],
          message: 'Air-gap mapping sources must be unique',
        });
      }
      if (targets.has(mapping.target)) {
        context.addIssue({
          code: 'custom',
          path: ['mappings', mappingIndex, 'target'],
          message: 'Air-gap mapping targets must be unique',
        });
      }
      sources.add(mapping.source);
      targets.add(mapping.target);
      const sourceDigest = mapping.source.slice(
        mapping.source.lastIndexOf('@sha256:') + 8,
      );
      const targetDigest = mapping.target.slice(
        mapping.target.lastIndexOf('@sha256:') + 8,
      );
      if (sourceDigest !== targetDigest) {
        context.addIssue({
          code: 'custom',
          path: ['mappings', mappingIndex, 'target'],
          message: 'Air-gap registry mapping must preserve the source digest',
        });
      }
    }
  });

const pluginPackageFileRoleV1Schema = z.enum([
  'runtime',
  'image_archive',
  'sbom',
  'provenance',
  'vulnerability_report',
  'license_report',
  'malware_report',
  'secret_scan_report',
  'documentation',
]);

/**
 * Closed inventory for an extracted, privately delivered plugin package.
 *
 * The index itself is signed with SignedArtifactEnvelopeV1. Every regular file
 * below the package root, except the fixed catalog/index control files, must be
 * present in this inventory. Installers therefore never trust archive names,
 * unindexed executable files, or mutable "latest" references.
 */
export const pluginPackageIndexV1Schema = z
  .object({
    apiVersion: z.literal('package.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginPackageIndex'),
    pluginId: pluginIdSchema,
    version: semVerSchema,
    catalogRevision: semVerSchema,
    generatedAt: timestampSchema,
    manifestPath: safeRelativePathSchema.refine(
      (path) => !path.includes(':'),
      'Manifest path must not contain a URI scheme or colon',
    ),
    resourcesPath: safeRelativePathSchema.refine(
      (path) => !path.includes(':'),
      'Resource path must not contain a URI scheme or colon',
    ),
    files: z
      .array(
        z
          .object({
            path: safeRelativePathSchema.refine(
              (path) => !path.includes(':'),
              'Package paths must not contain a URI scheme or colon',
            ),
            role: pluginPackageFileRoleV1Schema,
            sizeBytes: z.number().int().positive().max(20 * 1024 ** 3),
            sha256: sha256Schema,
          })
          .strict(),
      )
      .min(2)
      .max(10_000),
  })
  .strict()
  .superRefine((index, context) => {
    const paths = new Set<string>();
    for (const [fileIndex, file] of index.files.entries()) {
      if (paths.has(file.path)) {
        context.addIssue({
          code: 'custom',
          path: ['files', fileIndex, 'path'],
          message: 'Plugin package file paths must be unique',
        });
      }
      paths.add(file.path);
    }
    for (const [field, path] of [
      ['manifestPath', index.manifestPath],
      ['resourcesPath', index.resourcesPath],
    ] as const) {
      const file = index.files.find((candidate) => candidate.path === path);
      if (!file || file.role !== 'runtime') {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} must identify an inventoried runtime file`,
        });
      }
    }
  });

/**
 * Produce the portable structural schema used by publisher release pipelines.
 *
 * JSON Schema cannot express every semantic rule implemented by `superRefine`
 * (the exact Cartesian product and evidence timestamp ordering). Publishers
 * and verifiers must still parse the matrix with
 * `pluginCompatibilityMatrixV1Schema` before trusting it.
 */
export function getPluginCompatibilityMatrixV1JsonSchema(): z.core.JSONSchema.JSONSchema {
  return {
    ...z.toJSONSchema(pluginCompatibilityMatrixV1Schema, {
      target: 'draft-2020-12',
    }),
    $id: 'https://schemas.enterpriseglue.io/plugin/enterpriseglue-plugin-compatibility-matrix-v1.schema.json',
    title: 'EnterpriseGlue Plugin Compatibility Matrix v1',
    description:
      'Structural schema for signed current/previous EnterpriseGlue OSS host and plugin release evidence. Runtime parsing also enforces semantic cross-field rules.',
  };
}

export type PluginResourceDescriptorV1 = z.infer<
  typeof pluginResourceDescriptorV1Schema
>;
export type PluginCatalogV1 = z.infer<typeof pluginCatalogV1Schema>;
export type PluginCatalogReleaseV1 = z.infer<
  typeof pluginCatalogReleaseV1Schema
>;
export type SignedArtifactEnvelopeV1 = z.infer<
  typeof signedArtifactEnvelopeV1Schema
>;
export type PluginCompatibilityMatrixV1 = z.infer<
  typeof pluginCompatibilityMatrixV1Schema
>;
export type PluginAirgapIndexV1 = z.infer<
  typeof pluginAirgapIndexV1Schema
>;
export type PluginAirgapRegistryMapV1 = z.infer<
  typeof pluginAirgapRegistryMapV1Schema
>;
export type PluginPackageIndexV1 = z.infer<
  typeof pluginPackageIndexV1Schema
>;
