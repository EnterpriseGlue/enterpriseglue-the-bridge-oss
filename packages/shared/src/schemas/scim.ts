import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

// SCIM schemas are imported directly by the protocol router before the main
// OpenAPI module in some runtimes. Extend first so cached instances remain
// registerable when the OpenAPI document is generated later.
extendZodWithOpenApi(z);

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User' as const;
export const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group' as const;
export const SCIM_LIST_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse' as const;
export const SCIM_PATCH_OP_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp' as const;
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error' as const;
export const SCIM_BULK_REQUEST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:BulkRequest' as const;
export const SCIM_BULK_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:BulkResponse' as const;

export const ScimResourceIdSchema = z.string().min(1).max(255);
export const ScimExternalIdSchema = z.string().min(1).max(255);
export const ScimVersionSchema = z.string().regex(/^W\/"[A-Za-z0-9._:-]+"$/, 'Use a weak SCIM ETag such as W/"1"');

export const ScimMetaSchema = z.object({
  resourceType: z.enum(['User', 'Group']),
  created: z.iso.datetime({ offset: true }),
  lastModified: z.iso.datetime({ offset: true }),
  location: z.string().url(),
  version: ScimVersionSchema,
}).strict();

export const ScimNameSchema = z.object({
  formatted: z.string().max(512).optional(),
  familyName: z.string().max(255).optional(),
  givenName: z.string().max(255).optional(),
  middleName: z.string().max(255).optional(),
  honorificPrefix: z.string().max(128).optional(),
  honorificSuffix: z.string().max(128).optional(),
}).strict();

export const ScimEmailSchema = z.object({
  value: z.string().email().max(320),
  display: z.string().max(320).optional(),
  type: z.string().max(64).optional(),
  primary: z.boolean().optional(),
}).strict();

const ScimUserWriteFieldsSchema = z.object({
  schemas: z.array(z.string()).min(1).max(8)
    .refine((schemas) => schemas.includes(SCIM_USER_SCHEMA), 'The core SCIM User schema is required'),
  externalId: ScimExternalIdSchema.optional(),
  userName: z.string().trim().min(1).max(320),
  name: ScimNameSchema.optional(),
  displayName: z.string().trim().min(1).max(512).optional(),
  nickName: z.string().max(255).optional(),
  profileUrl: z.string().url().max(2048).optional(),
  title: z.string().max(255).optional(),
  userType: z.string().max(128).optional(),
  preferredLanguage: z.string().max(35).optional(),
  locale: z.string().max(35).optional(),
  timezone: z.string().max(128).optional(),
  /** Accepted for IdP interoperability but never persisted or returned. */
  password: z.string().max(4096).optional(),
  active: z.boolean().default(true),
  emails: z.array(ScimEmailSchema).max(20).optional(),
}).strict();

export const ScimUserCreateSchema = ScimUserWriteFieldsSchema;
export const ScimUserReplaceSchema = ScimUserWriteFieldsSchema;
export const ScimUserResponseSchema = ScimUserWriteFieldsSchema.extend({
  id: ScimResourceIdSchema,
  meta: ScimMetaSchema,
}).omit({ password: true }).strict();

export const ScimGroupMemberSchema = z.object({
  value: ScimResourceIdSchema,
  display: z.string().max(512).optional(),
  $ref: z.string().url().max(2048).optional(),
  type: z.enum(['User']).optional(),
}).strict();

const ScimGroupWriteFieldsSchema = z.object({
  schemas: z.array(z.string()).min(1).max(8)
    .refine((schemas) => schemas.includes(SCIM_GROUP_SCHEMA), 'The core SCIM Group schema is required'),
  externalId: ScimExternalIdSchema.optional(),
  displayName: z.string().trim().min(1).max(512),
  members: z.array(ScimGroupMemberSchema).max(10_000).default([]),
}).strict();

export const ScimGroupCreateSchema = ScimGroupWriteFieldsSchema;
export const ScimGroupReplaceSchema = ScimGroupWriteFieldsSchema;
export const ScimGroupResponseSchema = ScimGroupWriteFieldsSchema.extend({
  id: ScimResourceIdSchema,
  meta: ScimMetaSchema,
}).strict();

const ScimPatchScalarSchema = z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()]);
const ScimPatchLeafObjectSchema = z.record(z.string().max(255), ScimPatchScalarSchema);
const ScimPatchCompoundSchema = z.union([
  ScimPatchScalarSchema,
  z.array(ScimPatchScalarSchema).max(10_000),
  ScimPatchLeafObjectSchema,
  z.array(ScimPatchLeafObjectSchema).max(10_000),
]);
/** Bounded, non-recursive JSON shape sufficient for the supported core User and Group PATCH attributes. */
export const ScimPatchValueSchema = z.union([
  ScimPatchCompoundSchema,
  z.record(z.string().max(255), ScimPatchCompoundSchema),
  z.array(z.record(z.string().max(255), ScimPatchCompoundSchema)).max(10_000),
]);

export const ScimPatchOperationSchema = z.object({
  op: z.string().trim().transform((value) => value.toLowerCase()).pipe(z.enum(['add', 'remove', 'replace'])),
  path: z.string().trim().min(1).max(1000).optional(),
  value: ScimPatchValueSchema.optional(),
}).strict().superRefine((operation, context) => {
  if (operation.op === 'remove' && !operation.path) {
    context.addIssue({ code: 'custom', path: ['path'], message: 'Remove operations require a path' });
  }
  if ((operation.op === 'add' || operation.op === 'replace') && operation.value === undefined) {
    context.addIssue({ code: 'custom', path: ['value'], message: `${operation.op} operations require a value` });
  }
});

export const ScimPatchRequestSchema = z.object({
  schemas: z.tuple([z.literal(SCIM_PATCH_OP_SCHEMA)]),
  Operations: z.array(ScimPatchOperationSchema).min(1).max(100),
}).strict();

export const ScimErrorSchema = z.object({
  schemas: z.tuple([z.literal(SCIM_ERROR_SCHEMA)]),
  status: z.string().regex(/^[1-5][0-9]{2}$/),
  scimType: z.enum(['invalidFilter', 'tooMany', 'uniqueness', 'mutability', 'invalidSyntax', 'invalidPath', 'noTarget', 'invalidValue', 'invalidVers', 'sensitive']).optional(),
  detail: z.string().max(1000).optional(),
}).strict();

export function createScimListResponseSchema<T extends z.ZodType>(resourceSchema: T) {
  return z.object({
    schemas: z.tuple([z.literal(SCIM_LIST_RESPONSE_SCHEMA)]),
    totalResults: z.number().int().nonnegative(),
    startIndex: z.number().int().min(1),
    itemsPerPage: z.number().int().nonnegative(),
    Resources: z.array(resourceSchema),
  }).strict();
}

export const ScimUserListResponseSchema = createScimListResponseSchema(ScimUserResponseSchema);
export const ScimGroupListResponseSchema = createScimListResponseSchema(ScimGroupResponseSchema);

export const ScimListQuerySchema = z.object({
  filter: z.string().trim().min(1).max(2000).optional(),
  startIndex: z.coerce.number().int().min(1).max(1_000_000).default(1),
  count: z.coerce.number().int().min(0).max(200).default(100),
  attributes: z.string().trim().max(2000).optional(),
  excludedAttributes: z.string().trim().max(2000).optional(),
  sortBy: z.string().trim().min(1).max(255).optional(),
  sortOrder: z.enum(['ascending', 'descending']).default('ascending'),
}).strict();

export const ScimBulkOperationSchema = z.object({
  method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
  bulkId: z.string().min(1).max(255).optional(),
  version: ScimVersionSchema.optional(),
  path: z.string().min(1).max(1000).regex(/^\/(?:Users|Groups)(?:\/[^/?#]+)?$/),
  data: z.unknown().optional(),
}).strict().superRefine((operation, context) => {
  if (operation.method === 'POST' && !operation.bulkId) {
    context.addIssue({ code: 'custom', path: ['bulkId'], message: 'POST bulk operations require bulkId' });
  }
  if (operation.method !== 'DELETE' && operation.data === undefined) {
    context.addIssue({ code: 'custom', path: ['data'], message: `${operation.method} bulk operations require data` });
  }
});

export const ScimBulkRequestSchema = z.object({
  schemas: z.tuple([z.literal(SCIM_BULK_REQUEST_SCHEMA)]),
  failOnErrors: z.number().int().min(0).max(50).optional(),
  Operations: z.array(ScimBulkOperationSchema).min(1).max(50),
}).strict();

export const ScimBulkResponseOperationSchema = z.object({
  method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
  bulkId: z.string().min(1).max(255).optional(),
  location: z.string().url().optional(),
  version: ScimVersionSchema.optional(),
  status: z.string().regex(/^[1-5][0-9]{2}$/),
  response: ScimErrorSchema.optional(),
}).strict();

export const ScimBulkResponseSchema = z.object({
  schemas: z.tuple([z.literal(SCIM_BULK_RESPONSE_SCHEMA)]),
  Operations: z.array(ScimBulkResponseOperationSchema).max(50),
}).strict();

const ScimFeatureSchema = z.object({ supported: z.boolean() }).strict();
export const ScimServiceProviderConfigSchema = z.object({
  schemas: z.tuple([z.literal('urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig')]),
  documentationUri: z.string().url(),
  patch: ScimFeatureSchema,
  bulk: ScimFeatureSchema.extend({ maxOperations: z.number().int().nonnegative(), maxPayloadSize: z.number().int().nonnegative() }),
  filter: ScimFeatureSchema.extend({ maxResults: z.number().int().positive() }),
  changePassword: ScimFeatureSchema,
  sort: ScimFeatureSchema,
  etag: ScimFeatureSchema,
  authenticationSchemes: z.array(z.object({
    type: z.enum(['oauth2', 'oauthbearertoken']),
    name: z.string().min(1).max(128),
    description: z.string().min(1).max(1000),
    specUri: z.string().url(),
    primary: z.boolean(),
  }).strict()).min(1),
  meta: z.object({ resourceType: z.literal('ServiceProviderConfig'), location: z.string().url() }).strict(),
}).strict();

const ScimSchemaAttributeBaseSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['string', 'boolean', 'decimal', 'integer', 'dateTime', 'reference', 'complex']),
  multiValued: z.boolean(),
  description: z.string().max(1000),
  required: z.boolean(),
  caseExact: z.boolean(),
  mutability: z.enum(['readOnly', 'readWrite', 'immutable', 'writeOnly']),
  returned: z.enum(['always', 'never', 'default', 'request']),
  uniqueness: z.enum(['none', 'server', 'global']),
  canonicalValues: z.array(z.string()).optional(),
  referenceTypes: z.array(z.string()).optional(),
}).strict();

// Core User and Group discovery needs one level of complex sub-attributes.
// Keeping the contract bounded also prevents recursive OpenAPI generation and
// rejects pathological schema payloads should discovery ever be extended.
export const ScimSchemaAttributeSchema = ScimSchemaAttributeBaseSchema.extend({
  subAttributes: z.array(ScimSchemaAttributeBaseSchema).max(100).optional(),
}).strict();

export const ScimSchemaResourceSchema = z.object({
  schemas: z.tuple([z.literal('urn:ietf:params:scim:schemas:core:2.0:Schema')]),
  id: z.string().min(1).max(512),
  name: z.string().min(1).max(255),
  description: z.string().max(1000),
  attributes: z.array(ScimSchemaAttributeSchema),
  meta: z.object({ resourceType: z.literal('Schema'), location: z.string().url() }).strict(),
}).strict();

export const ScimResourceTypeSchema = z.object({
  schemas: z.tuple([z.literal('urn:ietf:params:scim:schemas:core:2.0:ResourceType')]),
  id: z.enum(['User', 'Group']),
  name: z.enum(['User', 'Group']),
  endpoint: z.enum(['/Users', '/Groups']),
  description: z.string().max(1000),
  schema: z.enum([SCIM_USER_SCHEMA, SCIM_GROUP_SCHEMA]),
  schemaExtensions: z.array(z.object({ schema: z.string().min(1), required: z.boolean() }).strict()).default([]),
  meta: z.object({ resourceType: z.literal('ResourceType'), location: z.string().url() }).strict(),
}).strict();

export type ScimUserCreate = z.infer<typeof ScimUserCreateSchema>;
export type ScimUserResponse = z.infer<typeof ScimUserResponseSchema>;
export type ScimGroupCreate = z.infer<typeof ScimGroupCreateSchema>;
export type ScimGroupResponse = z.infer<typeof ScimGroupResponseSchema>;
export type ScimPatchRequest = z.infer<typeof ScimPatchRequestSchema>;
export type ScimError = z.infer<typeof ScimErrorSchema>;
export type ScimBulkRequest = z.infer<typeof ScimBulkRequestSchema>;
