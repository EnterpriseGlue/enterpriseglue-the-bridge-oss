import { ociDigestReferenceSchema } from '@enterpriseglue/plugin-sdk';
import { pluginManagerCapabilityV1Schema } from '@enterpriseglue/plugin-sdk/manager';
import { resolve } from 'node:path';
import { z } from 'zod';

const pathSchema = z.string().min(1).max(4096);
const digestReferenceSchema = ociDigestReferenceSchema;

const composeAdapterSchema = z
  .object({
    type: z.literal('compose'),
    projectDirectory: pathSchema,
    composeFiles: z.array(pathSchema).min(1).max(10),
    projectName: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
    utilityImage: digestReferenceSchema,
    imageMode: z.enum(['pull', 'local']).default('pull'),
  })
  .strict();

const kubernetesAdapterSchema = z
  .object({
    type: z.enum(['kubernetes', 'openshift']),
    projectDirectory: pathSchema,
    chartPath: pathSchema,
    valuesFile: pathSchema,
    namespace: z.string().min(1).max(63),
    releaseName: z.string().min(1).max(63),
    utilityImage: digestReferenceSchema,
    context: z.string().min(1).max(256).optional(),
    artifactStorageMiB: z.number().int().min(64).max(1_048_576).optional(),
    storageClassName: z.string().min(1).max(253).optional(),
    imagePullSecrets: z.array(z.string().min(1).max(63)).max(8).optional(),
    rolloutTimeoutSeconds: z.number().int().min(10).max(1_800).optional(),
  })
  .strict();

export const pluginManagerBootstrapConfigV1Schema = z
  .object({
    apiVersion: z.literal('manager-config.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginManagerConfig'),
    capability: pluginManagerCapabilityV1Schema,
    host: z
      .object({
        baseUrl: z.string().url(),
        workloadTokenFile: pathSchema,
        version: z.string().min(1).max(64),
        artifact: digestReferenceSchema,
        apiVersion: z.string().min(1).max(64),
        sdkVersion: z.string().min(1).max(64),
        platformRevision: z.number().int().nonnegative(),
        database: z.enum(['postgres', 'mysql', 'mssql', 'oracle', 'spanner']),
        entitlementState: z.enum([
          'not_required',
          'unavailable',
          'trial',
          'active',
          'grace',
          'expired',
          'revoked',
        ]),
      })
      .strict(),
    deployment: z
      .object({
        mode: z.enum(['compose_planner', 'compose_managed', 'kubernetes', 'openshift']),
        platform: z.enum(['docker', 'kubernetes', 'openshift']),
        architecture: z.enum(['amd64', 'arm64']),
      })
      .strict(),
    storage: z
      .object({
        releaseRoot: pathSchema,
        executionRoot: pathSchema,
        installerOutput: pathSchema,
      })
      .strict(),
    connectedRegistry: z
      .object({
        trustFile: pathSchema,
        cosignPolicyFile: pathSchema,
        registryConfigFile: pathSchema.optional(),
        registryCaFile: pathSchema.optional(),
        permissionGrantsFile: pathSchema.optional(),
        maximumDownloadBytes: z
          .number()
          .int()
          .min(1024 ** 2)
          .max(20 * 1024 ** 3)
          .optional(),
        allowPlainHttp: z.boolean().default(false),
        allowInsecureTls: z.boolean().default(false),
      })
      .strict(),
    offlineDelivery: z
      .object({
        intakeRoot: pathSchema,
        registryConfigFile: pathSchema.optional(),
        registryCaFile: pathSchema.optional(),
        permissionGrantsFile: pathSchema.optional(),
        allowPlainHttp: z.boolean().default(false),
        allowInsecureTls: z.boolean().default(false),
      })
      .strict(),
    adapter: z.discriminatedUnion('type', [
      composeAdapterSchema,
      kubernetesAdapterSchema,
    ]),
    service: z
      .object({
        host: z.string().min(1).max(256).default('0.0.0.0'),
        port: z.number().int().min(1).max(65535).default(8788),
        pollIntervalMs: z.number().int().min(250).max(300_000).default(5_000),
      })
      .strict()
      .default({ host: '0.0.0.0', port: 8788, pollIntervalMs: 5_000 }),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      resolve(value.storage.releaseRoot) !==
      resolve(value.offlineDelivery.intakeRoot)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['offlineDelivery', 'intakeRoot'],
        message:
          'Offline delivery intake and verified release storage must use the same protected root.',
      });
    }
    const matches =
      (value.adapter.type === 'compose' && value.deployment.platform === 'docker') ||
      (value.adapter.type === 'kubernetes' &&
        value.deployment.mode === 'kubernetes' &&
        value.deployment.platform === 'kubernetes') ||
      (value.adapter.type === 'openshift' &&
        value.deployment.mode === 'openshift' &&
        value.deployment.platform === 'openshift');
    if (!matches) {
      context.addIssue({
        code: 'custom',
        path: ['adapter', 'type'],
        message: 'Adapter and deployment mode/platform must describe the same target.',
      });
    }
    if (
      !value.capability.deploymentModes.includes(value.deployment.mode) ||
      !value.capability.architectures.includes(value.deployment.architecture)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['capability'],
        message: 'Capability must advertise the configured deployment and architecture.',
      });
    }
  });

export type PluginManagerBootstrapConfigV1 = z.infer<
  typeof pluginManagerBootstrapConfigV1Schema
>;
