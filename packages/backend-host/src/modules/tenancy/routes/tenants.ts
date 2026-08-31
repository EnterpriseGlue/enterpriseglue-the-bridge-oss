import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from '@enterpriseglue/shared/config/index.js';
import { shouldUseSecureCookies } from '@enterpriseglue/shared/config/index.js';
import { requireAuth, requireAdmin } from '@enterpriseglue/shared/middleware/auth.js';
import { requireServiceAccountScope } from '@enterpriseglue/shared/middleware/apiClientAuth.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireTenantRole, resolveTenantContext } from '@enterpriseglue/shared/middleware/tenant.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { identityFlowLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { tenantDiscoveryService } from '@enterpriseglue/shared/services/platform-admin/TenantDiscoveryService.js';
import { tenantService } from '@enterpriseglue/shared/services/platform-admin/TenantService.js';
import { tenantWorkloadLifecycleService } from '@enterpriseglue/shared/services/platform-admin/TenantWorkloadLifecycleService.js';
import { tenantCloudIdentityService } from '@enterpriseglue/shared/services/platform-admin/TenantCloudIdentityService.js';
import { tenantReleaseWorkAssignmentService } from '@enterpriseglue/shared/services/platform-admin/TenantReleaseWorkAssignmentService.js';
import { tenantIdentityProviderSecretService } from '@enterpriseglue/shared/services/platform-admin/TenantIdentityProviderSecretService.js';
import { ServiceAccountScopes } from '@enterpriseglue/shared/services/platform-admin/ServiceAccountService.js';
import { tenantLoginPolicyService } from '@enterpriseglue/shared/services/platform-admin/TenantLoginPolicyService.js';
import { authSessionService } from '@enterpriseglue/shared/services/AuthSessionService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import {
  TenantCreateRequestSchema,
  TenantDiscoveryDomainCreateRequestSchema,
  TenantDiscoveryDomainSchema,
  TenantDiscoveryDomainVerifyRequestSchema,
  TenantDiscoveryExchangeRequestSchema,
  TenantDiscoveryExchangeResponseSchema,
  TenantDiscoveryRequestSchema,
  TenantDiscoveryResponseSchema,
  TenantDomainCreateRequestSchema,
  TenantDomainSchema,
  TenantDomainVerifyRequestSchema,
  TenantLoginPolicySchema,
  TenantMemberSchema,
  TenantMemberUpsertRequestSchema,
  NativeTenantMembershipSchema,
  NativeTenantSchema,
  TenantCloudIdentityResponseSchema,
  TenancyCapabilitiesSchema,
  TenantUpdateRequestSchema,
  TenantWorkloadAliasReconcileRequestSchema,
  TenantWorkloadCreateRequestSchema,
  TenantWorkloadEpochRequestSchema,
  TenantReleaseWorkAssignmentRequestSchema,
  TenantReleaseWorkAssignmentResponseSchema,
  TenantWorkloadSecretBreakGlassRequestSchema,
  SignedTenantWorkloadReceiptSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/tenant.js';

const router = Router();
const tenantIdSchema = z.string().min(1).max(160);

function requiredHeader(req: { headers: Record<string, unknown> }, name: string): string {
  const value = req.headers[name];
  if (typeof value !== 'string' || !value.trim()) throw Errors.validation(`${name} header is required`);
  return value.trim();
}

function tenancyCapabilities(includeShardIdentity: boolean) {
  const placementAssertionVersions = [
    ...(config.tenantPlacementKey ? ['v1' as const] : []),
    ...(config.tenantPlacementV2JwksJson ? ['v2' as const] : []),
    ...(config.tenantPlacementV2JwksJson && config.tenantPlacementReleaseId ? ['v3' as const] : []),
  ];
  const workloadConfigured = Boolean(
    config.tenantPlacementV2ShardId
    && config.tenantWorkloadReceiptPrivateKey
    && config.tenantWorkloadReceiptKeyId
    && config.tenantWorkloadReceiptIssuer,
  );
  return TenancyCapabilitiesSchema.parse({
    mode: config.tenancyMode,
    rootTenantAliasesEnabled: config.tenancyMode !== 'pooled',
    tenantScopedLoginRequired: config.tenancyMode === 'pooled',
    databaseIsolation: config.tenancyMode === 'pooled' ? 'postgres_rls' : 'application',
    customDomainsEnabled: config.tenancyMode === 'pooled',
    organizationDiscoveryEnabled: config.tenancyMode === 'pooled',
    signedPlacementAssertionsEnabled: placementAssertionVersions.length > 0,
    placementAssertionVersions,
    placementV2Required: config.tenancyCloudRequired,
    workloadTenantLifecycleEnabled: config.tenancyMode === 'pooled' && workloadConfigured,
    tenantSecretBrokerEnabled: Boolean(config.tenantSecretBrokerUrl && config.tenantSecretBrokerTokenRef),
    tenantSecretWriteOnlyAdminEnabled: Boolean(config.tenantSecretBrokerUrl && config.tenantSecretBrokerTokenRef),
    tenantSecretBreakGlassEnabled: includeShardIdentity && workloadConfigured && config.tenantSecretBreakGlassEnabled,
    shardId: includeShardIdentity ? config.tenantPlacementV2ShardId || null : null,
    workloadReceipt: includeShardIdentity && config.tenantWorkloadReceiptKeyId && config.tenantWorkloadReceiptIssuer
      ? { algorithm: 'ES256', keyId: config.tenantWorkloadReceiptKeyId, issuer: config.tenantWorkloadReceiptIssuer }
      : null,
  });
}

router.get('/api/tenancy/capabilities', (_req, res) => {
  res.json(tenancyCapabilities(false));
});

const workloadScope = requireServiceAccountScope(ServiceAccountScopes.TENANT_LIFECYCLE);

function requireTenantReleaseController(req: { headers: Record<string, unknown> }, _res: unknown, next: (error?: unknown) => void): void {
  try {
    const expected = config.tenantReleaseControllerToken;
    const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!expected || !supplied) throw Errors.unauthorized('Tenant release controller bearer token required');
    const expectedBytes = Buffer.from(expected);
    const suppliedBytes = Buffer.from(supplied);
    if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
      throw Errors.unauthorized('Tenant release controller bearer token required');
    }
    next();
  } catch (error) { next(error); }
}

router.get('/api/workloads/tenancy/capabilities', workloadScope, (_req, res) => {
  res.json(tenancyCapabilities(true));
});

router.post('/api/workloads/tenants', workloadScope, validateBody(TenantWorkloadCreateRequestSchema), asyncHandler(async (req, res) => {
  const idempotencyKey = requiredHeader(req, 'idempotency-key');
  const correlationId = requiredHeader(req, 'x-correlation-id');
  const placementKey = req.body.placementKey || config.tenantPlacementV2ShardId || 'local';
  if (config.tenantPlacementV2ShardId && placementKey !== config.tenantPlacementV2ShardId) {
    throw Errors.validation('Tenant placementKey must match this shard identity');
  }
  const requestBody = { ...req.body, placementKey };
  const receipt = await tenantWorkloadLifecycleService.execute({
    actorId: req.serviceAccount!.id,
    command: 'create',
    idempotencyKey,
    correlationId,
    request: requestBody,
    mutate: async (manager) => {
      const tenant = await tenantService.create(requestBody, manager);
      return {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantStatus: tenant.status,
        placementEpoch: Number(tenant.placementEpoch),
      };
    },
  });
  res.status(receipt.idempotent ? 200 : 201).json(SignedTenantWorkloadReceiptSchema.parse(receipt));
}));

router.post('/api/workloads/tenants/:tenantId/suspend', workloadScope, validateBody(TenantWorkloadEpochRequestSchema), asyncHandler(async (req, res) => {
  const tenantId = tenantIdSchema.parse(req.params.tenantId);
  const idempotencyKey = requiredHeader(req, 'idempotency-key');
  const correlationId = requiredHeader(req, 'x-correlation-id');
  const receipt = await tenantWorkloadLifecycleService.execute({
    actorId: req.serviceAccount!.id,
    command: 'suspend',
    idempotencyKey,
    correlationId,
    request: { tenantId, ...req.body },
    mutate: async (manager) => {
      const tenant = await tenantService.update(tenantId, {
        status: 'suspended', expectedPlacementEpoch: req.body.expectedPlacementEpoch,
      }, manager);
      return {
        tenantId: tenant.id, tenantSlug: tenant.slug, tenantStatus: tenant.status,
        placementEpoch: Number(tenant.placementEpoch),
      };
    },
  });
  res.json(SignedTenantWorkloadReceiptSchema.parse(receipt));
}));

router.post('/api/workloads/tenants/:tenantId/resume', workloadScope, validateBody(TenantWorkloadEpochRequestSchema), asyncHandler(async (req, res) => {
  const tenantId = tenantIdSchema.parse(req.params.tenantId);
  const idempotencyKey = requiredHeader(req, 'idempotency-key');
  const correlationId = requiredHeader(req, 'x-correlation-id');
  const receipt = await tenantWorkloadLifecycleService.execute({
    actorId: req.serviceAccount!.id,
    command: 'resume',
    idempotencyKey,
    correlationId,
    request: { tenantId, ...req.body },
    mutate: async (manager) => {
      const tenant = await tenantService.update(tenantId, {
        status: 'active', expectedPlacementEpoch: req.body.expectedPlacementEpoch,
      }, manager);
      return {
        tenantId: tenant.id, tenantSlug: tenant.slug, tenantStatus: tenant.status,
        placementEpoch: Number(tenant.placementEpoch),
      };
    },
  });
  res.json(SignedTenantWorkloadReceiptSchema.parse(receipt));
}));

router.put('/api/workloads/tenants/:tenantId/release-assignment', requireTenantReleaseController, validateBody(TenantReleaseWorkAssignmentRequestSchema), asyncHandler(async (req, res) => {
  const tenantId = tenantIdSchema.parse(req.params.tenantId);
  res.setHeader('cache-control', 'no-store');
  res.json(TenantReleaseWorkAssignmentResponseSchema.parse(await tenantReleaseWorkAssignmentService.assign({
    tenantId,
    releaseId: req.body.releaseId,
    assignmentEpoch: req.body.assignmentEpoch,
  })));
}));

router.put('/api/workloads/tenants/:tenantId/routing-aliases', workloadScope, validateBody(TenantWorkloadAliasReconcileRequestSchema), asyncHandler(async (req, res) => {
  const tenantId = tenantIdSchema.parse(req.params.tenantId);
  const idempotencyKey = requiredHeader(req, 'idempotency-key');
  const correlationId = requiredHeader(req, 'x-correlation-id');
  const receipt = await tenantWorkloadLifecycleService.execute({
    actorId: req.serviceAccount!.id,
    command: 'reconcile_aliases',
    idempotencyKey,
    correlationId,
    request: { tenantId, ...req.body },
    mutate: async (manager) => {
      const result = await tenantService.reconcileRoutingAliases(
        tenantId, req.body.aliases, req.body.expectedPlacementEpoch, manager,
      );
      return {
        tenantId: result.tenant.id,
        tenantSlug: result.tenant.slug,
        tenantStatus: result.tenant.status,
        placementEpoch: Number(result.tenant.placementEpoch),
        routingAliases: result.aliases.map((alias) => alias.hostname),
      };
    },
  });
  res.json(SignedTenantWorkloadReceiptSchema.parse(receipt));
}));

router.post('/api/workloads/tenants/:tenantId/identity-provider-secret-reference', workloadScope, validateBody(TenantWorkloadSecretBreakGlassRequestSchema), asyncHandler(async (req, res) => {
  if (!config.tenantSecretBreakGlassEnabled) throw Errors.forbidden('Tenant secret break-glass recovery is disabled');
  const tenantId = tenantIdSchema.parse(req.params.tenantId);
  const idempotencyKey = requiredHeader(req, 'idempotency-key');
  const correlationId = requiredHeader(req, 'x-correlation-id');
  const receipt = await tenantWorkloadLifecycleService.execute({
    actorId: req.serviceAccount!.id,
    command: 'set_secret_reference_break_glass',
    idempotencyKey,
    correlationId,
    request: { tenantId, ...req.body },
    mutate: async (manager) => {
      const tenant = await manager.getRepository(Tenant).findOneBy({ id: tenantId });
      if (!tenant) throw Errors.notFound('Tenant');
      if (Number(tenant.placementEpoch) !== req.body.expectedPlacementEpoch) {
        throw Errors.conflict('Tenant placement epoch changed; refresh the tenant before retrying');
      }
      await tenantIdentityProviderSecretService.setBreakGlassReference({
        tenantId,
        providerKey: req.body.providerKey,
        purpose: req.body.purpose,
        reference: req.body.reference,
        enableProvider: req.body.enableProvider,
        store: manager,
      });
      return {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantStatus: tenant.status,
        placementEpoch: Number(tenant.placementEpoch),
      };
    },
  });
  await logAudit({
    tenantId,
    userId: req.serviceAccount!.id,
    action: 'identity.provider.secret.break_glass_reference_set',
    resourceType: 'identity_provider',
    resourceId: req.body.providerKey,
    details: {
      purpose: req.body.purpose,
      providerEnabled: req.body.enableProvider,
      correlationId,
      operationId: receipt.payload.operationId,
      secretMaterialIncluded: false,
    },
  });
  res.json(SignedTenantWorkloadReceiptSchema.parse(receipt));
}));

router.post('/api/auth/tenant-discovery', identityFlowLimiter, validateBody(TenantDiscoveryRequestSchema), asyncHandler(async (req, res) => {
  res.json(TenantDiscoveryResponseSchema.parse(await tenantDiscoveryService.request(req.body.email)));
}));

router.post('/api/auth/tenant-discovery/exchange', identityFlowLimiter, validateBody(TenantDiscoveryExchangeRequestSchema), asyncHandler(async (req, res) => {
  res.json(TenantDiscoveryExchangeResponseSchema.parse({
    tenants: await tenantDiscoveryService.exchange(req.body.token),
  }));
}));

router.get('/api/auth/my-tenants', requireAuth, asyncHandler(async (req, res) => {
  const memberships = await tenantService.listForUser(req.user!.userId);
  res.json(z.array(NativeTenantMembershipSchema).parse(memberships));
}));

router.post('/api/auth/switch-tenant', requireAuth, validateBody(z.object({ tenantSlug: z.string().min(1).max(63) })), asyncHandler(async (req, res) => {
  if (config.tenancyMode !== 'pooled') throw Errors.conflict('Tenant switching is available only in pooled mode');
  const tenant = await tenantService.getBySlug(req.body.tenantSlug);
  if (!tenant || tenant.status !== 'active') throw Errors.notFound('Tenant');
  if (!await tenantService.hasMembership(req.user!.userId, tenant.id)) throw Errors.forbidden('Tenant membership is required');
  const user = await (await getDataSource()).getRepository(User).findOneByOrFail({ id: req.user!.userId, isActive: true });
  const session = await authSessionService.issue(user, {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    authenticationMethod: req.user!.authenticationMethod,
    mfaVerified: req.user!.mfaVerified === true,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    ipAddress: req.ip,
  });
  const cookieOptions = { httpOnly: true, secure: shouldUseSecureCookies(), sameSite: 'lax' as const, path: '/' };
  res.cookie('accessToken', session.accessToken, { ...cookieOptions, maxAge: session.expiresIn * 1000 });
  res.cookie('refreshToken', session.refreshToken, { ...cookieOptions, maxAge: config.jwtRefreshTokenExpires * 1000 });
  res.json({ tenantId: tenant.id, tenantSlug: tenant.slug });
}));

router.get('/api/platform/tenants', requireAuth, requireAdmin, requireAction('platform.tenants.read'), asyncHandler(async (_req, res) => {
  res.json(z.array(NativeTenantSchema).parse(await tenantService.list()));
}));

router.post('/api/platform/tenants', requireAuth, requireAdmin, requireAction('platform.tenants.manage'), validateBody(TenantCreateRequestSchema), asyncHandler(async (req, res) => {
  const tenant = await tenantService.create(req.body);
  res.status(201).json(NativeTenantSchema.parse(tenant));
}));

router.patch('/api/platform/tenants/:tenantId', requireAuth, requireAdmin, requireAction('platform.tenants.manage'), validateBody(TenantUpdateRequestSchema), asyncHandler(async (req, res) => {
  const tenant = await tenantService.update(tenantIdSchema.parse(req.params.tenantId), req.body);
  res.json(NativeTenantSchema.parse(tenant));
}));

const tenantScope = [resolveTenantContext({ required: true }), requireAuth] as const;

router.get('/api/t/:tenantSlug/tenant/cloud-identity', ...tenantScope, requireTenantRole(), asyncHandler(async (req, res) => {
  const tenant = req.tenant!;
  if (tenant.placementAssertionVersion !== 'v3' || !tenant.placementKey || !tenant.releaseId || !tenant.assignmentEpoch || !tenant.placementEpoch) {
    throw Errors.serviceUnavailable('Release-aware tenant cloud identity is unavailable');
  }
  res.setHeader('cache-control', 'no-store');
  res.json(TenantCloudIdentityResponseSchema.parse({ ...tenantCloudIdentityService.issue({
    userId: req.user!.userId,
    tenantId: tenant.tenantId,
    tenantSlug: tenant.tenantSlug,
    tenantRole: req.tenantRole!,
    shardId: tenant.placementKey,
    releaseId: tenant.releaseId,
    placementEpoch: tenant.placementEpoch,
    assignmentEpoch: tenant.assignmentEpoch,
  }), tenantRole: req.tenantRole }));
}));

router.get('/api/t/:tenantSlug/tenant', ...tenantScope, requireAction('tenant.settings.read'), asyncHandler(async (req, res) => {
  const tenant = await tenantService.getById(req.tenant!.tenantId);
  if (!tenant) throw Errors.notFound('Tenant');
  res.json(NativeTenantSchema.parse(tenant));
}));

router.get('/api/t/:tenantSlug/tenant/login-policy', ...tenantScope, requireAction('tenant.settings.manage'), asyncHandler(async (req, res) => {
  const policy = await tenantLoginPolicyService.get(req.tenant!.tenantId);
  res.json(TenantLoginPolicySchema.parse(policy || {
    localPasswordMode: 'auto',
    providerSelectionMode: 'chooser',
  }));
}));

router.put('/api/t/:tenantSlug/tenant/login-policy', ...tenantScope, requireAction('tenant.settings.manage'), validateBody(TenantLoginPolicySchema), asyncHandler(async (req, res) => {
  res.json(TenantLoginPolicySchema.parse(await tenantLoginPolicyService.upsert(
    req.tenant!.tenantId,
    req.body,
    req.user!.userId,
  )));
}));

router.get('/api/t/:tenantSlug/tenant/domains', ...tenantScope, requireAction('tenant.settings.manage'), asyncHandler(async (req, res) => {
  res.json(z.array(TenantDomainSchema).parse(await tenantService.listDomains(req.tenant!.tenantId)));
}));

router.post('/api/t/:tenantSlug/tenant/domains', ...tenantScope, requireAction('tenant.settings.manage'), validateBody(TenantDomainCreateRequestSchema), asyncHandler(async (req, res) => {
  const result = await tenantService.createDomain(req.tenant!.tenantId, req.body.hostname);
  res.status(201).json({
    domain: TenantDomainSchema.parse(result.domain),
    verificationToken: result.verificationToken,
    dnsRecord: { name: `_enterpriseglue.${result.domain.hostname}`, type: 'TXT', value: `enterpriseglue-verification=${result.verificationToken}` },
  });
}));

router.post('/api/t/:tenantSlug/tenant/domains/:domainId/verify', ...tenantScope, requireAction('tenant.settings.manage'), validateBody(TenantDomainVerifyRequestSchema), asyncHandler(async (req, res) => {
  res.json(TenantDomainSchema.parse(await tenantService.verifyDomain(
    req.tenant!.tenantId,
    z.string().min(1).parse(req.params.domainId),
    req.body.verificationToken,
  )));
}));

router.get('/api/t/:tenantSlug/tenant/discovery-domains', ...tenantScope, requireAction('tenant.settings.manage'), asyncHandler(async (req, res) => {
  res.json(z.array(TenantDiscoveryDomainSchema).parse(await tenantService.listDiscoveryDomains(req.tenant!.tenantId)));
}));

router.post('/api/t/:tenantSlug/tenant/discovery-domains', ...tenantScope, requireAction('tenant.settings.manage'), validateBody(TenantDiscoveryDomainCreateRequestSchema), asyncHandler(async (req, res) => {
  const result = await tenantService.createDiscoveryDomain(req.tenant!.tenantId, req.body.domain);
  res.status(201).json({
    domain: TenantDiscoveryDomainSchema.parse(result.domain),
    verificationToken: result.verificationToken,
    dnsRecord: {
      name: `_enterpriseglue-discovery.${result.domain.domain}`,
      type: 'TXT',
      value: `enterpriseglue-discovery-verification=${result.verificationToken}`,
    },
  });
}));

router.post('/api/t/:tenantSlug/tenant/discovery-domains/:domainId/verify', ...tenantScope, requireAction('tenant.settings.manage'), validateBody(TenantDiscoveryDomainVerifyRequestSchema), asyncHandler(async (req, res) => {
  res.json(TenantDiscoveryDomainSchema.parse(await tenantService.verifyDiscoveryDomain(
    req.tenant!.tenantId,
    z.string().min(1).parse(req.params.domainId),
    req.body.verificationToken,
  )));
}));

router.delete('/api/t/:tenantSlug/tenant/discovery-domains/:domainId', ...tenantScope, requireAction('tenant.settings.manage'), asyncHandler(async (req, res) => {
  await tenantService.disableDiscoveryDomain(req.tenant!.tenantId, z.string().min(1).parse(req.params.domainId));
  res.status(204).end();
}));

router.get('/api/t/:tenantSlug/tenant/members', ...tenantScope, requireAction('tenant.members.manage'), asyncHandler(async (req, res) => {
  res.json(z.array(TenantMemberSchema).parse(await tenantService.listMembers(req.tenant!.tenantId)));
}));

router.put('/api/t/:tenantSlug/tenant/members/:userId', ...tenantScope, requireAction('tenant.members.manage'), validateBody(TenantMemberUpsertRequestSchema.omit({ userId: true })), asyncHandler(async (req, res) => {
  const userId = z.string().min(1).parse(req.params.userId);
  await tenantService.addMember(req.tenant!.tenantId, userId, req.body.role, req.user!.userId);
  res.status(204).end();
}));

router.delete('/api/t/:tenantSlug/tenant/members/:userId', ...tenantScope, requireAction('tenant.members.manage'), asyncHandler(async (req, res) => {
  const userId = z.string().min(1).parse(req.params.userId);
  await tenantService.removeMember(req.tenant!.tenantId, userId, req.user!.userId);
  res.status(204).end();
}));

export default router;
