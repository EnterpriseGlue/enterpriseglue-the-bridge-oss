import { Router } from 'express';
import { z } from 'zod';
import { config } from '@enterpriseglue/shared/config/index.js';
import { shouldUseSecureCookies } from '@enterpriseglue/shared/config/index.js';
import { requireAuth, requireAdmin } from '@enterpriseglue/shared/middleware/auth.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { resolveTenantContext } from '@enterpriseglue/shared/middleware/tenant.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { identityFlowLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { tenantDiscoveryService } from '@enterpriseglue/shared/services/platform-admin/TenantDiscoveryService.js';
import { tenantService } from '@enterpriseglue/shared/services/platform-admin/TenantService.js';
import { tenantLoginPolicyService } from '@enterpriseglue/shared/services/platform-admin/TenantLoginPolicyService.js';
import { authSessionService } from '@enterpriseglue/shared/services/AuthSessionService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
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
  TenancyCapabilitiesSchema,
  TenantUpdateRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/tenant.js';

const router = Router();
const tenantIdSchema = z.string().min(1).max(160);

router.get('/api/tenancy/capabilities', (_req, res) => {
  res.json(TenancyCapabilitiesSchema.parse({
    mode: config.tenancyMode,
    rootTenantAliasesEnabled: config.tenancyMode !== 'pooled',
    tenantScopedLoginRequired: config.tenancyMode === 'pooled',
    databaseIsolation: config.tenancyMode === 'pooled' ? 'postgres_rls' : 'application',
    customDomainsEnabled: config.tenancyMode === 'pooled',
    organizationDiscoveryEnabled: config.tenancyMode === 'pooled',
    signedPlacementAssertionsEnabled: Boolean(config.tenantPlacementKey),
  }));
});

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
