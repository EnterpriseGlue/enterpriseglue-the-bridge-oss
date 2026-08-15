import { Router, type NextFunction, type Request, type Response } from 'express';
import { ZodError, z } from 'zod';
import { identityProvisioningDirectoryService } from '@enterpriseglue/shared/services/platform-admin/IdentityProvisioningDirectoryService.js';
import {
  ScimProtocolError,
  scimService,
  type ScimRequestContext,
  type VerifiedProvisioningCredential,
} from '@enterpriseglue/shared/services/platform-admin/index.js';
import {
  SCIM_ERROR_SCHEMA,
  SCIM_BULK_RESPONSE_SCHEMA,
  SCIM_GROUP_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_USER_SCHEMA,
  ScimGroupCreateSchema,
  ScimGroupReplaceSchema,
  ScimListQuerySchema,
  ScimPatchRequestSchema,
  ScimUserCreateSchema,
  ScimUserReplaceSchema,
  ScimBulkRequestSchema,
  ScimBulkResponseSchema,
} from '@enterpriseglue/shared/schemas/scim.js';
import { ScimOAuthTokenRequestSchema, ScimOAuthTokenResponseSchema } from '@enterpriseglue/shared/schemas/platform-admin/provisioning.js';
import { scimProvisioningLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { SCIM_JSON_LIMIT_BYTES } from '@enterpriseglue/shared/middleware/requestSizeLimit.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';

declare global {
  namespace Express {
    interface Request {
      provisioning?: VerifiedProvisioningCredential;
      scimContext?: ScimRequestContext;
    }
  }
}

const rootRouter = Router();
const router = Router({ mergeParams: true });
const directoryKeySchema = z.string().min(1).max(128).regex(/^[a-z][a-z0-9._-]*$/);
const resourceIdSchema = z.string().min(1).max(255);

function basicClientCredentials(req: Request): { clientId: string; clientSecret: string } | null {
  const authorization = req.headers.authorization;
  const match = typeof authorization === 'string' ? /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(authorization.trim()) : null;
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 1) return null;
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch { return null; }
}

function scimError(status: number, detail: string, scimType?: string) {
  return {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail,
  };
}

function parsedBodySize(body: unknown): number {
  if (body == null) return 0;
  if (Buffer.isBuffer(body)) return body.byteLength;
  if (typeof body === 'string') return Buffer.byteLength(body);
  return Buffer.byteLength(JSON.stringify(body));
}

function requestOrigin(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

function requestId(req: Request): string {
  const candidate = req.headers['x-request-id'] ?? req.headers['x-correlation-id'];
  const value = Array.isArray(candidate) ? candidate[0] : candidate;
  return typeof value === 'string' && value.trim() && value.length <= 128 ? value.trim() : generateId();
}

type AttributeSelection = Map<string, Set<string> | null>;

function parseAttributeSelection(value: unknown): AttributeSelection | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2000) {
    throw new ScimProtocolError(400, 'invalidSyntax', 'The requested attribute projection is invalid');
  }
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0 || entries.length > 100) {
    throw new ScimProtocolError(400, 'tooMany', 'The requested attribute projection is invalid');
  }
  const selection: AttributeSelection = new Map();
  for (const entry of entries) {
    const match = /^([A-Za-z][A-Za-z0-9$_-]*)(?:\.([A-Za-z][A-Za-z0-9$_-]*))?$/.exec(entry);
    if (!match) throw new ScimProtocolError(400, 'invalidPath', 'The requested attribute projection contains an unsupported path');
    const root = match[1].toLowerCase();
    const child = match[2]?.toLowerCase();
    if (!child) {
      selection.set(root, null);
      continue;
    }
    if (selection.get(root) === null) continue;
    const children = selection.get(root) ?? new Set<string>();
    children.add(child);
    selection.set(root, children);
  }
  return selection;
}

function projectComplexAttribute(value: unknown, children: Set<string>): unknown {
  const projectObject = (candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
    return Object.fromEntries(Object.entries(candidate as Record<string, unknown>)
      .filter(([key]) => children.has(key.toLowerCase())));
  };
  return Array.isArray(value) ? value.map(projectObject) : projectObject(value);
}

/** Implements the common SCIM attributes/excludedAttributes projection used by Entra and Okta. */
function projectResource(resource: Record<string, unknown>, req: Request): Record<string, unknown> {
  const include = parseAttributeSelection(req.query.attributes);
  const exclude = parseAttributeSelection(req.query.excludedAttributes);
  if (include && exclude) {
    throw new ScimProtocolError(400, 'invalidSyntax', 'Use attributes or excludedAttributes, not both');
  }
  if (!include && !exclude) return resource;
  const alwaysReturned = new Set(['schemas', 'id', 'meta']);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resource)) {
    const normalized = key.toLowerCase();
    if (alwaysReturned.has(normalized)) {
      output[key] = value;
      continue;
    }
    if (include) {
      if (!include.has(normalized)) continue;
      const children = include.get(normalized);
      output[key] = children ? projectComplexAttribute(value, children) : value;
      continue;
    }
    const excludedChildren = exclude!.get(normalized);
    if (excludedChildren === null) continue;
    output[key] = excludedChildren ? projectComplexAttribute(value, new Set(
      Object.keys((Array.isArray(value) ? value[0] : value) as Record<string, unknown> || {})
        .map((child) => child.toLowerCase())
        .filter((child) => !excludedChildren.has(child)),
    )) : value;
  }
  return output;
}

function projectListResponse(response: Record<string, unknown>, req: Request): Record<string, unknown> {
  return {
    ...response,
    Resources: Array.isArray(response.Resources)
      ? response.Resources.map((resource) => projectResource(resource as Record<string, unknown>, req))
      : [],
  };
}

router.use((req, res, next) => {
  res.type('application/scim+json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Authorization');
  next();
});

router.use(async (req, res, next) => {
  try {
    const directoryKey = directoryKeySchema.parse(req.params.directoryKey);
    const authorization = req.headers.authorization;
    const match = typeof authorization === 'string' ? /^Bearer\s+(.+)$/i.exec(authorization.trim()) : null;
    if (!match) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="EnterpriseGlue SCIM"');
      return res.status(401).json(scimError(401, 'A valid provisioning bearer credential is required'));
    }
    const verified = await identityProvisioningDirectoryService.verifyCredential(directoryKey, match[1])
      || await identityProvisioningDirectoryService.verifyOAuthAccessToken(directoryKey, match[1]);
    if (!verified) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="EnterpriseGlue SCIM", error="invalid_token"');
      return res.status(401).json(scimError(401, 'A valid provisioning bearer credential is required'));
    }
    req.provisioning = verified;
    req.scimContext = {
      directory: verified.directory,
      baseUrl: `${requestOrigin(req)}/scim/v2/${encodeURIComponent(directoryKey)}`,
      requestId: requestId(req),
    };
    next();
  } catch (error) {
    next(error);
  }
});

router.use(scimProvisioningLimiter);

router.use((req, res, next) => {
  const declared = Number(req.headers['content-length']);
  if ((Number.isFinite(declared) && declared > SCIM_JSON_LIMIT_BYTES) || parsedBodySize(req.body) > SCIM_JSON_LIMIT_BYTES) {
    return res.status(413).json(scimError(413, 'The provisioning request exceeds the 256 KiB payload limit', 'tooMany'));
  }
  next();
});

function context(req: Request): ScimRequestContext {
  if (!req.scimContext) throw new ScimProtocolError(401, undefined, 'A valid provisioning bearer credential is required');
  return req.scimContext;
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

rootRouter.post('/scim/v2/:directoryKey/oauth/token', scimProvisioningLimiter, asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const directoryKey = directoryKeySchema.parse(req.params.directoryKey);
  if (!req.is('application/x-www-form-urlencoded')) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Use application/x-www-form-urlencoded' });
  }
  const parsedBody = ScimOAuthTokenRequestSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: 'invalid_request', error_description: 'A client_credentials grant is required' });
  const body = parsedBody.data;
  if (body.scope && !body.scope.split(/\s+/).includes('scim')) {
    return res.status(400).json({ error: 'invalid_scope', error_description: 'Only the scim scope is supported' });
  }
  const basic = basicClientCredentials(req);
  const clientId = basic?.clientId || body.client_id || '';
  const clientSecret = basic?.clientSecret || body.client_secret || '';
  if ((basic && (body.client_id || body.client_secret)) || !clientId || !clientSecret) {
    res.setHeader('WWW-Authenticate', 'Basic realm="EnterpriseGlue SCIM OAuth"');
    return res.status(401).json({ error: 'invalid_client' });
  }
  const issued = await identityProvisioningDirectoryService.issueOAuthAccessToken({ directoryKey, clientId, clientSecret });
  if (!issued) {
    res.setHeader('WWW-Authenticate', 'Basic realm="EnterpriseGlue SCIM OAuth", error="invalid_client"');
    return res.status(401).json({ error: 'invalid_client' });
  }
  return res.json(ScimOAuthTokenResponseSchema.parse({
    access_token: issued.accessToken,
    token_type: 'Bearer',
    expires_in: issued.expiresIn,
    scope: 'scim',
  }));
}));

function schemaAttribute(input: {
  name: string;
  type: 'string' | 'boolean' | 'decimal' | 'integer' | 'dateTime' | 'reference' | 'complex';
  multiValued?: boolean;
  description: string;
  required?: boolean;
  caseExact?: boolean;
  mutability?: 'readOnly' | 'readWrite' | 'immutable' | 'writeOnly';
  returned?: 'always' | 'never' | 'default' | 'request';
  uniqueness?: 'none' | 'server' | 'global';
  subAttributes?: any[];
}) {
  return {
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite' as const,
    returned: 'default' as const,
    uniqueness: 'none' as const,
    ...input,
  };
}

function discoveryResources(req: Request) {
  const ctx = context(req);
  const base = ctx.baseUrl;
  const userSchema = {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
    id: SCIM_USER_SCHEMA,
    name: 'User',
    description: 'EnterpriseGlue provisioned user',
    attributes: [
      schemaAttribute({ name: 'userName', type: 'string', description: 'Stable sign-in name', required: true, uniqueness: 'server' }),
      schemaAttribute({ name: 'externalId', type: 'string', description: 'Client-managed stable identifier' }),
      schemaAttribute({ name: 'displayName', type: 'string', description: 'Display name' }),
      schemaAttribute({ name: 'active', type: 'boolean', description: 'Whether access is active' }),
      schemaAttribute({ name: 'name', type: 'complex', description: 'Structured name', subAttributes: [
        schemaAttribute({ name: 'givenName', type: 'string', description: 'Given name' }),
        schemaAttribute({ name: 'familyName', type: 'string', description: 'Family name' }),
        schemaAttribute({ name: 'formatted', type: 'string', description: 'Formatted name' }),
      ] }),
      schemaAttribute({ name: 'emails', type: 'complex', multiValued: true, description: 'Email addresses', subAttributes: [
        schemaAttribute({ name: 'value', type: 'string', description: 'Email address', required: true }),
        schemaAttribute({ name: 'type', type: 'string', description: 'Email type' }),
        schemaAttribute({ name: 'primary', type: 'boolean', description: 'Primary email marker' }),
      ] }),
      ...['nickName', 'profileUrl', 'title', 'userType', 'preferredLanguage', 'locale', 'timezone'].map((name) => (
        schemaAttribute({ name, type: 'string' as const, description: `User ${name}` })
      )),
      schemaAttribute({
        name: 'password', type: 'string', description: 'Accepted for provisioning interoperability and discarded; EnterpriseGlue never creates a local password from SCIM',
        mutability: 'writeOnly', returned: 'never',
      }),
    ],
    meta: { resourceType: 'Schema', location: `${base}/Schemas/${encodeURIComponent(SCIM_USER_SCHEMA)}` },
  };
  const groupSchema = {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
    id: SCIM_GROUP_SCHEMA,
    name: 'Group',
    description: 'EnterpriseGlue provisioned group',
    attributes: [
      schemaAttribute({ name: 'displayName', type: 'string', description: 'Directory group name', required: true }),
      schemaAttribute({ name: 'externalId', type: 'string', description: 'Client-managed stable identifier' }),
      schemaAttribute({ name: 'members', type: 'complex', multiValued: true, description: 'User members', subAttributes: [
        schemaAttribute({ name: 'value', type: 'string', description: 'SCIM User identifier', required: true }),
        schemaAttribute({ name: '$ref', type: 'reference', description: 'SCIM User location', mutability: 'readOnly' }),
        schemaAttribute({ name: 'display', type: 'string', description: 'User display value', mutability: 'readOnly' }),
      ] }),
    ],
    meta: { resourceType: 'Schema', location: `${base}/Schemas/${encodeURIComponent(SCIM_GROUP_SCHEMA)}` },
  };
  const resourceTypes = [
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'User', name: 'User', endpoint: '/Users', description: 'EnterpriseGlue user', schema: SCIM_USER_SCHEMA,
      schemaExtensions: [], meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/User` },
    },
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'Group', name: 'Group', endpoint: '/Groups', description: 'EnterpriseGlue group', schema: SCIM_GROUP_SCHEMA,
      schemaExtensions: [], meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/Group` },
    },
  ];
  return { userSchema, groupSchema, resourceTypes };
}

router.get('/ServiceProviderConfig', (req, res) => {
  const ctx = context(req);
  res.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: `${requestOrigin(req)}/docs/how-to/scim-provisioning`,
    patch: { supported: true },
    bulk: { supported: true, maxOperations: 50, maxPayloadSize: SCIM_JSON_LIMIT_BYTES },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: true },
    etag: { supported: true },
    authenticationSchemes: [{
      type: 'oauth2',
      name: 'OAuth 2.0 client credentials',
      description: 'Short-lived directory-scoped access tokens issued from a reveal-once client credential',
      specUri: 'https://www.rfc-editor.org/rfc/rfc6749',
      primary: true,
    }, {
      type: 'oauthbearertoken',
      name: 'Provisioning bearer credential',
      description: 'Directory-scoped bearer credential created by a Platform SSO Administrator',
      specUri: 'https://www.rfc-editor.org/rfc/rfc6750',
      primary: false,
    }],
    meta: { resourceType: 'ServiceProviderConfig', location: `${ctx.baseUrl}/ServiceProviderConfig` },
  });
});

router.get('/Schemas', (req, res) => {
  const { userSchema, groupSchema } = discoveryResources(req);
  res.json({ schemas: [SCIM_LIST_RESPONSE_SCHEMA], totalResults: 2, startIndex: 1, itemsPerPage: 2, Resources: [userSchema, groupSchema] });
});

router.get('/Schemas/:schemaId', (req, res, next) => {
  const { userSchema, groupSchema } = discoveryResources(req);
  const schema = req.params.schemaId === SCIM_USER_SCHEMA ? userSchema : req.params.schemaId === SCIM_GROUP_SCHEMA ? groupSchema : null;
  if (!schema) return next(new ScimProtocolError(404, undefined, 'Schema not found'));
  res.json(schema);
});

router.get('/ResourceTypes', (req, res) => {
  const { resourceTypes } = discoveryResources(req);
  res.json({ schemas: [SCIM_LIST_RESPONSE_SCHEMA], totalResults: 2, startIndex: 1, itemsPerPage: 2, Resources: resourceTypes });
});

router.get('/ResourceTypes/:resourceType', (req, res, next) => {
  const { resourceTypes } = discoveryResources(req);
  const resource = resourceTypes.find((candidate) => candidate.id === req.params.resourceType);
  if (!resource) return next(new ScimProtocolError(404, undefined, 'Resource type not found'));
  res.json(resource);
});

function resolveBulkReferences(value: unknown, resources: Map<string, string>): unknown {
  if (typeof value === 'string' && value.startsWith('bulkId:')) {
    const resolved = resources.get(value.slice('bulkId:'.length));
    if (!resolved) throw new ScimProtocolError(400, 'noTarget', `Bulk reference '${value}' has not been created`);
    return resolved;
  }
  if (Array.isArray(value)) return value.map((entry) => resolveBulkReferences(entry, resources));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, resolveBulkReferences(entry, resources)]));
  }
  return value;
}

function bulkFailure(error: unknown): { status: number; scimType?: string; detail: string } {
  if (error instanceof ScimProtocolError) {
    return { status: error.status, ...(error.scimType ? { scimType: error.scimType } : {}), detail: error.message };
  }
  if (error instanceof ZodError) return { status: 400, scimType: 'invalidSyntax', detail: 'The bulk operation does not satisfy the SCIM schema' };
  logger.error('Unexpected SCIM bulk operation failure', { error: error instanceof Error ? error.name : 'UnknownError' });
  return { status: 500, detail: 'The bulk operation could not be completed' };
}

router.post('/Bulk', asyncRoute(async (req, res) => {
  const bulk = ScimBulkRequestSchema.parse(req.body);
  const resources = new Map<string, string>();
  const seenBulkIds = new Set<string>();
  const operations: Array<Record<string, unknown>> = [];
  let failures = 0;

  for (const operation of bulk.Operations) {
    if (operation.bulkId && seenBulkIds.has(operation.bulkId)) {
      throw new ScimProtocolError(400, 'uniqueness', `Duplicate bulkId '${operation.bulkId}'`);
    }
    if (operation.bulkId) seenBulkIds.add(operation.bulkId);
    const base = { method: operation.method, ...(operation.bulkId ? { bulkId: operation.bulkId } : {}) };
    try {
      const match = /^\/(Users|Groups)(?:\/([^/]+))?$/.exec(operation.path);
      if (!match) throw new ScimProtocolError(400, 'invalidPath', `Unsupported bulk path '${operation.path}'`);
      const [, kind, encodedId] = match;
      const id = encodedId ? resourceIdSchema.parse(decodeURIComponent(encodedId)) : null;
      const data = resolveBulkReferences(operation.data, resources);
      let resource: { id: string; meta: { location: string; version: string } } | null = null;
      let status = 200;

      if (operation.method === 'POST') {
        if (id) throw new ScimProtocolError(400, 'invalidPath', 'Bulk POST requires a collection path');
        resource = kind === 'Users'
          ? await scimService.createUser(context(req), ScimUserCreateSchema.parse(data))
          : await scimService.createGroup(context(req), ScimGroupCreateSchema.parse(data));
        status = 201;
        resources.set(operation.bulkId!, resource.id);
      } else {
        if (!id) throw new ScimProtocolError(400, 'invalidPath', `Bulk ${operation.method} requires a resource path`);
        if (operation.method === 'PUT') {
          resource = kind === 'Users'
            ? await scimService.replaceUser(context(req), id, ScimUserReplaceSchema.parse(data), operation.version)
            : await scimService.replaceGroup(context(req), id, ScimGroupReplaceSchema.parse(data), operation.version);
        } else if (operation.method === 'PATCH') {
          resource = kind === 'Users'
            ? await scimService.patchUser(context(req), id, ScimPatchRequestSchema.parse(data), operation.version)
            : await scimService.patchGroup(context(req), id, ScimPatchRequestSchema.parse(data), operation.version);
        } else {
          if (kind === 'Users') await scimService.deleteUser(context(req), id, operation.version);
          else await scimService.deleteGroup(context(req), id, operation.version);
          status = 204;
        }
      }

      operations.push({
        ...base,
        status: String(status),
        ...(resource ? { location: resource.meta.location, version: resource.meta.version } : {}),
      });
    } catch (error) {
      failures += 1;
      const failure = bulkFailure(error);
      operations.push({
        ...base,
        status: String(failure.status),
        response: scimError(failure.status, failure.detail, failure.scimType),
      });
      await scimService.recordFailure(context(req), {
        eventType: 'scim.bulk.operation.failed',
        resourceType: operation.path.startsWith('/Users') ? 'User' : operation.path.startsWith('/Groups') ? 'Group' : null,
        statusCode: failure.status,
        scimType: failure.scimType,
        message: failure.detail,
      });
      if (bulk.failOnErrors && failures >= bulk.failOnErrors) break;
    }
  }

  res.json(ScimBulkResponseSchema.parse({ schemas: [SCIM_BULK_RESPONSE_SCHEMA], Operations: operations }));
}));

router.get('/Users', asyncRoute(async (req, res) => {
  const query = ScimListQuerySchema.parse(req.query);
  res.json(projectListResponse(await scimService.listUsers(context(req), query), req));
}));

router.post('/Users', asyncRoute(async (req, res) => {
  const resource = await scimService.createUser(context(req), ScimUserCreateSchema.parse(req.body));
  res.status(201).set('Location', resource.meta.location).set('ETag', resource.meta.version).json(projectResource(resource, req));
}));

router.get('/Users/:id', asyncRoute(async (req, res) => {
  const resource = await scimService.getUser(context(req), resourceIdSchema.parse(req.params.id));
  res.set('ETag', resource.meta.version).json(projectResource(resource, req));
}));

router.put('/Users/:id', asyncRoute(async (req, res) => {
  const resource = await scimService.replaceUser(
    context(req), resourceIdSchema.parse(req.params.id), ScimUserReplaceSchema.parse(req.body), req.get('If-Match') || undefined,
  );
  res.set('ETag', resource.meta.version).json(projectResource(resource, req));
}));

router.patch('/Users/:id', asyncRoute(async (req, res) => {
  const resource = await scimService.patchUser(
    context(req), resourceIdSchema.parse(req.params.id), ScimPatchRequestSchema.parse(req.body), req.get('If-Match') || undefined,
  );
  res.set('ETag', resource.meta.version).json(projectResource(resource, req));
}));

router.delete('/Users/:id', asyncRoute(async (req, res) => {
  await scimService.deleteUser(context(req), resourceIdSchema.parse(req.params.id), req.get('If-Match') || undefined);
  res.status(204).send();
}));

router.get('/Groups', asyncRoute(async (req, res) => {
  const query = ScimListQuerySchema.parse(req.query);
  res.json(projectListResponse(await scimService.listGroups(context(req), query), req));
}));

router.post('/Groups', asyncRoute(async (req, res) => {
  const resource = await scimService.createGroup(context(req), ScimGroupCreateSchema.parse(req.body));
  res.status(201).set('Location', resource.meta.location).set('ETag', resource.meta.version).json(projectResource(resource, req));
}));

router.get('/Groups/:id', asyncRoute(async (req, res) => {
  const resource = await scimService.getGroup(context(req), resourceIdSchema.parse(req.params.id));
  res.set('ETag', resource.meta.version).json(projectResource(resource, req));
}));

router.put('/Groups/:id', asyncRoute(async (req, res) => {
  const resource = await scimService.replaceGroup(
    context(req), resourceIdSchema.parse(req.params.id), ScimGroupReplaceSchema.parse(req.body), req.get('If-Match') || undefined,
  );
  res.set('ETag', resource.meta.version).json(projectResource(resource, req));
}));

router.patch('/Groups/:id', asyncRoute(async (req, res) => {
  const resource = await scimService.patchGroup(
    context(req), resourceIdSchema.parse(req.params.id), ScimPatchRequestSchema.parse(req.body), req.get('If-Match') || undefined,
  );
  res.set('ETag', resource.meta.version).json(projectResource(resource, req));
}));

router.delete('/Groups/:id', asyncRoute(async (req, res) => {
  await scimService.deleteGroup(context(req), resourceIdSchema.parse(req.params.id), req.get('If-Match') || undefined);
  res.status(204).send();
}));

router.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  let failure: { status: number; detail: string; scimType?: string };
  if (error instanceof ScimProtocolError) {
    failure = { status: error.status, detail: error.message, ...(error.scimType ? { scimType: error.scimType } : {}) };
  } else if (error instanceof ZodError) {
    failure = { status: 400, detail: 'The request does not satisfy the SCIM schema', scimType: 'invalidSyntax' };
  } else {
    const bodyError = error as { status?: number; statusCode?: number; type?: string };
    if (bodyError.status === 413 || bodyError.statusCode === 413 || bodyError.type === 'entity.too.large') {
      failure = { status: 413, detail: 'The provisioning request exceeds the payload limit', scimType: 'tooMany' };
    } else {
      logger.error('Unexpected SCIM request failure', { error: error instanceof Error ? error.name : 'UnknownError' });
      failure = { status: 500, detail: 'The provisioning request could not be completed' };
    }
  }

  const send = () => {
    if (!res.headersSent) res.status(failure.status).json(scimError(failure.status, failure.detail, failure.scimType));
  };
  if (!req.scimContext) return send();
  const resourceType = req.path.includes('/Users') ? 'User' : req.path.includes('/Groups') ? 'Group' : 'Directory';
  const pathResourceId = /^\/(?:Users|Groups)\/([^/]+)/.exec(req.path)?.[1];
  const resourceId = typeof req.params.id === 'string'
    ? req.params.id
    : pathResourceId ? decodeURIComponent(pathResourceId) : null;
  void scimService.recordFailure(req.scimContext, {
    eventType: `scim.${resourceType.toLowerCase()}.${req.method.toLowerCase()}.failed`,
    resourceType,
    resourceId,
    statusCode: failure.status,
    scimType: failure.scimType,
    message: failure.detail,
  }).catch((diagnosticError) => {
    logger.warn('Could not persist sanitized SCIM failure diagnostic', {
      error: diagnosticError instanceof Error ? diagnosticError.name : 'UnknownError',
    });
  }).finally(send);
});

rootRouter.use('/scim/v2/:directoryKey', router);

export default rootRouter;
