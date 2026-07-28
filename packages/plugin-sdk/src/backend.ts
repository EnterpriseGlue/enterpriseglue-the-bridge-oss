import { z } from 'zod';

import {
  namespacedIdentifierSchema,
  opaqueReferenceSchema,
  pluginIdSchema,
  pluginPermissionSchema,
  safeRelativePathSchema,
  semVerSchema,
  type PluginId,
  type SemVer,
} from './common.js';

const resourceReferenceV1Schema = z
  .object({
    kind: z.enum(['engine', 'incident', 'failed_job', 'process_instance', 'project']),
    ref: opaqueReferenceSchema,
  })
  .strict();

const brokerHttpMethodV1Schema = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

/**
 * A plugin can request one deployment-owned HTTP operation without supplying a
 * destination, credential, authorization header, tenant, or arbitrary headers.
 * The host binds those values from signed invocation claims and local policy.
 */
export const pluginSecretUseRequestV1Schema = z
  .object({
    apiVersion: z.literal('secret-use.plugin.enterpriseglue.io/v1'),
    callId: opaqueReferenceSchema,
    operationId: namespacedIdentifierSchema,
    reference: opaqueReferenceSchema,
    operation: z.literal('http.bearer-json-v1'),
    payload: z
      .object({
        method: brokerHttpMethodV1Schema,
        path: safeRelativePathSchema,
        body: z.unknown().optional(),
        idempotencyKey: opaqueReferenceSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const pluginSecretUseResponseV1Schema = z
  .object({
    apiVersion: z.literal('secret-use-result.plugin.enterpriseglue.io/v1'),
    status: z.number().int().min(100).max(599),
    body: z.unknown(),
  })
  .strict();

const tenantBoundPathTemplateSchema = z
  .string()
  .min(10)
  .max(500)
  .superRefine((value, context) => {
    if ((value.match(/\{tenant\}/g) ?? []).length !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'Path template must contain exactly one {tenant} segment',
      });
      return;
    }
    for (const segment of value.split('/')) {
      if (
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        segment.includes('\\') ||
        (segment !== '{tenant}' &&
          !/^[A-Za-z0-9._~-]+$/.test(segment))
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Path template must contain safe literal segments and one {tenant} segment',
        });
        return;
      }
    }
  });

const pluginSecretBrokerPolicyEntryV1Schema = z
  .object({
    pluginId: pluginIdSchema,
    reference: opaqueReferenceSchema,
    operation: z.literal('http.bearer-json-v1'),
    invocationOperations: z
      .array(namespacedIdentifierSchema)
      .min(1)
      .max(100),
    baseUrl: z.string().url().max(2_000),
    tenantBoundPath: tenantBoundPathTemplateSchema,
    allowedMethods: z.array(brokerHttpMethodV1Schema).min(1).max(5),
    allowedPathPrefixes: z.array(safeRelativePathSchema).min(1).max(100),
    credentialFile: z
      .string()
      .min(2)
      .max(500)
      .regex(/^\/[A-Za-z0-9._/-]+$/),
    timeoutMs: z.number().int().min(100).max(30_000),
    maxRequestBytes: z.number().int().min(1).max(10 * 1024 * 1024),
    maxResponseBytes: z.number().int().min(1).max(10 * 1024 * 1024),
  })
  .strict()
  .superRefine((entry, context) => {
    const operations = new Set(entry.invocationOperations);
    if (operations.size !== entry.invocationOperations.length) {
      context.addIssue({
        code: 'custom',
        path: ['invocationOperations'],
        message: 'Invocation operations must be unique',
      });
    }
    if (
      entry.invocationOperations.some(
        (operationId) => !operationId.startsWith(`${entry.pluginId}.`),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['invocationOperations'],
        message: 'Invocation operations must be owned by the policy plugin',
      });
    }
  });

export const pluginSecretBrokerPolicyV1Schema = z
  .object({
    apiVersion: z.literal('secret-broker-policy.plugin.enterpriseglue.io/v1'),
    kind: z.literal('EnterpriseGluePluginSecretBrokerPolicy'),
    entries: z.array(pluginSecretBrokerPolicyEntryV1Schema).max(1_000),
  })
  .strict()
  .superRefine((policy, context) => {
    const identities = new Set<string>();
    for (const [index, entry] of policy.entries.entries()) {
      const identity = `${entry.pluginId}\0${entry.reference}\0${entry.operation}`;
      if (identities.has(identity)) {
        context.addIssue({
          code: 'custom',
          path: ['entries', index],
          message: 'Secret broker policy identities must be unique',
        });
      }
      identities.add(identity);
    }
  });

export const pluginInvocationClaimsV1Schema = z
  .object({
    iss: z.literal('enterpriseglue-oss'),
    aud: pluginIdSchema,
    sub: opaqueReferenceSchema,
    exp: z.number().int().positive(),
    iat: z.number().int().positive(),
    jti: opaqueReferenceSchema,
    tenantRef: opaqueReferenceSchema.optional(),
    deploymentRef: opaqueReferenceSchema,
    operationId: namespacedIdentifierSchema,
    grantedPermissions: z.array(pluginPermissionSchema).max(100),
    resourceRefs: z.array(resourceReferenceV1Schema).max(20).optional(),
    correlationId: opaqueReferenceSchema,
  })
  .strict()
  .superRefine((claims, context) => {
    if (claims.exp <= claims.iat) {
      context.addIssue({
        code: 'custom',
        path: ['exp'],
        message: 'Invocation expiry must be later than issuance time',
      });
    }
    if (!claims.operationId.startsWith(`${claims.aud}.`)) {
      context.addIssue({
        code: 'custom',
        path: ['operationId'],
        message: 'Invocation operation must be namespaced by the audience plugin',
      });
    }
  });

const entitlementCapabilityV1Schema = z
  .object({
    feature: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/),
    status: z.enum([
      'active',
      'grace',
      'wind_down',
      'expired',
      'revoked',
      'unavailable',
    ]),
    reasonCode: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/),
    validUntil: z.string().datetime().optional(),
  })
  .strict();

export const pluginBackendCapabilitiesV1Schema = z
  .object({
    protocol: z.literal('backend.plugin.enterpriseglue.io/v1'),
    pluginId: pluginIdSchema,
    pluginVersion: semVerSchema,
    apiRevision: z.string().min(1).max(100),
    schemaRevision: z.number().int().nonnegative(),
    operations: z
      .array(
        z
          .object({
            operationId: namespacedIdentifierSchema,
            requestSchemaSha256: z.string().regex(/^[a-f0-9]{64}$/),
            responseSchemaSha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(200),
    optionalFeatures: z
      .array(z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/))
      .max(100),
    entitlement: entitlementCapabilityV1Schema.optional(),
  })
  .strict()
  .superRefine((capabilities, context) => {
    const ids = new Set<string>();
    for (const [index, operation] of capabilities.operations.entries()) {
      if (!operation.operationId.startsWith(`${capabilities.pluginId}.`)) {
        context.addIssue({
          code: 'custom',
          path: ['operations', index, 'operationId'],
          message: 'Capability operation must be namespaced by the plugin ID',
        });
      }
      if (ids.has(operation.operationId)) {
        context.addIssue({
          code: 'custom',
          path: ['operations', index, 'operationId'],
          message: 'Capability operation IDs must be unique',
        });
      }
      ids.add(operation.operationId);
    }
  });

export const pluginHealthResponseV1Schema = z
  .object({
    status: z.literal('alive'),
  })
  .strict();

export const pluginReadyResponseV1Schema = z
  .object({
    ready: z.boolean(),
    reasonCode: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z][a-z0-9_]*$/),
  })
  .strict();

export const pluginEventEnvelopeV1BaseSchema = z
  .object({
    specversion: z.literal('1.0'),
    id: opaqueReferenceSchema,
    source: z.literal('enterpriseglue-oss'),
    type: namespacedIdentifierSchema,
    subject: opaqueReferenceSchema,
    time: z.string().datetime(),
    dataschema: z.string().min(1).max(500),
    tenantRef: opaqueReferenceSchema.optional(),
  })
  .strict();

export function pluginEventEnvelopeV1Schema<T extends z.ZodType>(
  dataSchema: T,
) {
  return pluginEventEnvelopeV1BaseSchema.extend({
    data: dataSchema,
  });
}

export type PluginInvocationClaimsV1 = z.infer<
  typeof pluginInvocationClaimsV1Schema
>;
export type PluginBackendCapabilitiesV1 = z.infer<
  typeof pluginBackendCapabilitiesV1Schema
>;
export type PluginHealthResponseV1 = z.infer<
  typeof pluginHealthResponseV1Schema
>;
export type PluginReadyResponseV1 = z.infer<
  typeof pluginReadyResponseV1Schema
>;
export type PluginSecretUseRequestV1 = z.infer<
  typeof pluginSecretUseRequestV1Schema
>;
export type PluginSecretUseResponseV1 = z.infer<
  typeof pluginSecretUseResponseV1Schema
>;
export type PluginSecretBrokerPolicyV1 = z.infer<
  typeof pluginSecretBrokerPolicyV1Schema
>;
export type PluginSecretBrokerPolicyEntryV1 =
  PluginSecretBrokerPolicyV1['entries'][number];

export interface PluginEventEnvelopeV1<T> {
  specversion: '1.0';
  id: string;
  source: 'enterpriseglue-oss';
  type: string;
  subject: string;
  time: string;
  dataschema: string;
  tenantRef?: string;
  data: T;
}

export interface PluginBackendIdentityV1 {
  pluginId: PluginId;
  pluginVersion: SemVer;
}
