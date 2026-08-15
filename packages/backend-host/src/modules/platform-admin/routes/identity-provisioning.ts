import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { identityAdminLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { identityAdminJsonPayloadLimit } from '@enterpriseglue/shared/middleware/requestSizeLimit.js';
import {
  IdentityProvisioningCredentialCreateSchema,
  IdentityProvisioningCredentialRotateSchema,
  IdentityProvisioningDiagnosticsQuerySchema,
  IdentityProvisioningDirectoryCreateSchema,
  IdentityProvisioningDirectoryKeySchema,
  IdentityProvisioningDirectoryQuerySchema,
  IdentityProvisioningDirectoryUpdateSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/provisioning.js';
import { identityProvisioningDirectoryService } from '@enterpriseglue/shared/services/platform-admin/IdentityProvisioningDirectoryService.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';

const router = Router();
const credentialIdSchema = z.string().min(1).max(255);

function tenantId(req: Express.Request): string | null {
  return req.tenant?.tenantId || null;
}

async function directoryOrThrow(key: string, tenant: string | null) {
  const directory = await identityProvisioningDirectoryService.getByKey(key, tenant);
  if (!directory || directory.status === 'archived') throw Errors.notFound('Provisioning directory', key);
  return directory;
}

router.get('/api/identity/provisioning-directories', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.read'), asyncHandler(async (req, res) => {
  const query = IdentityProvisioningDirectoryQuerySchema.parse(req.query);
  let directories = await identityProvisioningDirectoryService.list(tenantId(req));
  if (query.status) directories = directories.filter((directory) => directory.status === query.status);
  if (query.identityProviderKey) directories = directories.filter((directory) => directory.identityProviderKey === query.identityProviderKey);
  if (query.search) {
    const search = query.search.toLowerCase();
    directories = directories.filter((directory) => (
      directory.key.toLowerCase().includes(search)
      || directory.displayName.toLowerCase().includes(search)
      || directory.description?.toLowerCase().includes(search)
    ));
  }
  res.json({ items: directories.slice(query.offset, query.offset + query.limit), total: directories.length, limit: query.limit, offset: query.offset });
}));

router.post('/api/identity/provisioning-directories', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), identityAdminJsonPayloadLimit, asyncHandler(async (req, res) => {
  const input = IdentityProvisioningDirectoryCreateSchema.parse(req.body);
  const directory = await identityProvisioningDirectoryService.create(input, tenantId(req), req.user!.userId);
  await logAudit({
    action: 'identity.provisioning.directory.create', userId: req.user!.userId,
    resourceType: 'identity_provisioning_directory', resourceId: directory.id,
    details: { key: directory.key, status: directory.status, identityProviderKey: directory.identityProviderKey },
  });
  res.status(201).json(directory);
}));

router.get('/api/identity/provisioning-directories/:key', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.read'), asyncHandler(async (req, res) => {
  const key = IdentityProvisioningDirectoryKeySchema.parse(req.params.key);
  const directory = await directoryOrThrow(key, tenantId(req));
  res.json({
    id: directory.id,
    tenantId: directory.tenantId,
    key: directory.key,
    directoryKeyIdentity: directory.directoryKeyIdentity,
    displayName: directory.displayName,
    description: directory.description,
    type: directory.type,
    identityProviderKey: directory.identityProviderKey,
    authoritative: true,
    status: directory.status,
    ownershipMode: directory.ownershipMode,
    sourceRef: directory.sourceRef,
    sourceHash: directory.sourceHash,
    credentialSecretRef: directory.credentialSecretRef,
    lastAppliedAt: directory.lastAppliedAt == null ? null : Number(directory.lastAppliedAt),
    driftStatus: directory.driftStatus,
    createdAt: Number(directory.createdAt),
    updatedAt: Number(directory.updatedAt),
    archivedAt: directory.archivedAt == null ? null : Number(directory.archivedAt),
  });
}));

router.put('/api/identity/provisioning-directories/:key', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), identityAdminJsonPayloadLimit, asyncHandler(async (req, res) => {
  const key = IdentityProvisioningDirectoryKeySchema.parse(req.params.key);
  const input = IdentityProvisioningDirectoryUpdateSchema.parse(req.body);
  const directory = await identityProvisioningDirectoryService.update(key, input, tenantId(req));
  await logAudit({
    action: 'identity.provisioning.directory.update', userId: req.user!.userId,
    resourceType: 'identity_provisioning_directory', resourceId: directory.id,
    details: { key, changedFields: Object.keys(input), status: directory.status },
  });
  res.json(directory);
}));

router.delete('/api/identity/provisioning-directories/:key', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), asyncHandler(async (req, res) => {
  const key = IdentityProvisioningDirectoryKeySchema.parse(req.params.key);
  const directory = await directoryOrThrow(key, tenantId(req));
  await identityProvisioningDirectoryService.archive(key, tenantId(req));
  await logAudit({
    action: 'identity.provisioning.directory.archive', userId: req.user!.userId,
    resourceType: 'identity_provisioning_directory', resourceId: directory.id,
    details: { key, credentialsRevoked: true },
  });
  res.status(204).send();
}));

router.post('/api/identity/provisioning-directories/:key/test', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), asyncHandler(async (req, res) => {
  const key = IdentityProvisioningDirectoryKeySchema.parse(req.params.key);
  const directory = await directoryOrThrow(key, tenantId(req));
  const credentials = await identityProvisioningDirectoryService.listCredentials(directory.id);
  const result = {
    status: directory.status === 'active' && credentials.some((credential) => credential.status === 'active') ? 'ready' : 'attention_required',
    directoryStatus: directory.status,
    activeCredentialCount: credentials.filter((credential) => credential.status === 'active').length,
    endpointPath: `/scim/v2/${directory.key}`,
  };
  await logAudit({
    action: 'identity.provisioning.directory.test', userId: req.user!.userId,
    resourceType: 'identity_provisioning_directory', resourceId: directory.id,
    details: result,
  });
  res.json(result);
}));

router.get('/api/identity/provisioning-directories/:key/credentials', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.read'), asyncHandler(async (req, res) => {
  const directory = await directoryOrThrow(IdentityProvisioningDirectoryKeySchema.parse(req.params.key), tenantId(req));
  res.json({ items: await identityProvisioningDirectoryService.listCredentials(directory.id) });
}));

router.post('/api/identity/provisioning-directories/:key/credentials', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), identityAdminJsonPayloadLimit, asyncHandler(async (req, res) => {
  const directory = await directoryOrThrow(IdentityProvisioningDirectoryKeySchema.parse(req.params.key), tenantId(req));
  const input = IdentityProvisioningCredentialCreateSchema.parse(req.body);
  const issued = await identityProvisioningDirectoryService.issueCredential({
    directoryId: directory.id, ...input, actorUserId: req.user!.userId,
  });
  await logAudit({
    action: 'identity.provisioning.credential.create', userId: req.user!.userId,
    resourceType: 'identity_provisioning_credential', resourceId: issued.credential.id,
    details: { directoryId: directory.id, fingerprint: issued.credential.fingerprint, expiresAt: issued.credential.expiresAt },
  });
  res.status(201).json({
    ...issued,
    clientId: issued.credential.id,
    tokenEndpointPath: `/scim/v2/${directory.key}/oauth/token`,
  });
}));

router.post('/api/identity/provisioning-directories/:key/credentials/:credentialId/rotate', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), identityAdminJsonPayloadLimit, asyncHandler(async (req, res) => {
  const directory = await directoryOrThrow(IdentityProvisioningDirectoryKeySchema.parse(req.params.key), tenantId(req));
  const credentialId = credentialIdSchema.parse(req.params.credentialId);
  const input = IdentityProvisioningCredentialRotateSchema.parse(req.body);
  const issued = await identityProvisioningDirectoryService.rotateCredential({
    directoryId: directory.id, credentialId, ...input, actorUserId: req.user!.userId,
  });
  await logAudit({
    action: 'identity.provisioning.credential.rotate', userId: req.user!.userId,
    resourceType: 'identity_provisioning_credential', resourceId: issued.credential.id,
    details: { directoryId: directory.id, replacedCredentialId: credentialId, fingerprint: issued.credential.fingerprint, overlapSeconds: input.overlapSeconds },
  });
  res.status(201).json({
    ...issued,
    clientId: issued.credential.id,
    tokenEndpointPath: `/scim/v2/${directory.key}/oauth/token`,
  });
}));

router.delete('/api/identity/provisioning-directories/:key/credentials/:credentialId', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.manage'), asyncHandler(async (req, res) => {
  const directory = await directoryOrThrow(IdentityProvisioningDirectoryKeySchema.parse(req.params.key), tenantId(req));
  const credentialId = credentialIdSchema.parse(req.params.credentialId);
  const credential = await identityProvisioningDirectoryService.revokeCredential(directory.id, credentialId);
  await logAudit({
    action: 'identity.provisioning.credential.revoke', userId: req.user!.userId,
    resourceType: 'identity_provisioning_credential', resourceId: credential.id,
    details: { directoryId: directory.id, fingerprint: credential.fingerprint },
  });
  res.status(204).send();
}));

router.get('/api/identity/provisioning-directories/:key/events', requireAuth, identityAdminLimiter, requireAction('platform.sso.providers.read'), asyncHandler(async (req, res) => {
  const directory = await directoryOrThrow(IdentityProvisioningDirectoryKeySchema.parse(req.params.key), tenantId(req));
  const query = IdentityProvisioningDiagnosticsQuerySchema.parse(req.query);
  res.json({ items: await identityProvisioningDirectoryService.listDiagnostics({
    directoryId: directory.id, status: query.status, resourceType: query.resourceType, limit: query.limit,
  }) });
}));

export default router;
