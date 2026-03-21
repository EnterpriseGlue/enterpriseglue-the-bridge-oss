import { Router, type Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { apiLimiter, createUserLimiter, passwordResetVerifyLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { addCaseInsensitiveEquals } from '@enterpriseglue/shared/db/adapters/QueryHelpers.js';
import { userService } from '@enterpriseglue/shared/services/platform-admin/UserService.js';
import { invitationService } from '@enterpriseglue/shared/services/invitations.js';
import { getEmailConfigForTenant } from '@enterpriseglue/shared/services/email/index.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { engineService } from '@enterpriseglue/shared/services/platform-admin/EngineService.js';
import { ENGINE_MANAGE_ROLES, MANAGE_ROLES } from '@enterpriseglue/shared/constants/roles.js';
import { generateOnboardingToken } from '@enterpriseglue/shared/utils/jwt.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';

const router = Router();

const invitationParamsSchema = z.object({
  token: z.string().min(1),
});

const createInvitationSchema = z.object({
  email: z.string().email(),
  resourceType: z.enum(['tenant', 'project', 'engine']),
  resourceId: z.string().optional(),
  resourceName: z.string().optional(),
  role: z.string().optional(),
  deliveryMethod: z.enum(['email', 'manual']).default('email'),
});

const verifyInvitationSchema = z.object({
  oneTimePassword: z.string().min(1),
});

function setOnboardingCookie(res: ExpressResponse, payload: {
  userId: string;
  email: string;
  platformRole: User['platformRole'];
  invitationId: string;
  tenantSlug: string;
}) {
  const onboardingToken = generateOnboardingToken({
    userId: payload.userId,
    email: payload.email,
    platformRole: payload.platformRole as any,
    invitationId: payload.invitationId,
    tenantSlug: payload.tenantSlug,
  });

  res.cookie('onboardingToken', onboardingToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict',
    maxAge: config.jwtAccessTokenExpires * 1000,
    path: '/',
  });
}

async function ensureInvitationPermission(req: Express.Request, resourceType: 'tenant' | 'project' | 'engine', resourceId?: string): Promise<void> {
  if (resourceType === 'tenant') {
    if (req.user?.platformRole !== 'admin') {
      throw Errors.forbidden('Only platform admins can invite workspace users');
    }
    return;
  }

  if (!resourceId) {
    throw Errors.validation('Resource ID is required');
  }

  if (resourceType === 'project') {
    const membership = await projectMemberService.getMembership(resourceId, req.user!.userId);
    const roles = Array.isArray((membership as any)?.roles) ? (membership as any).roles : membership ? [membership.role] : [];
    if (!roles.some((role: string) => MANAGE_ROLES.includes(role as any))) {
      throw Errors.forbidden('Only owners and delegates can invite project members');
    }
    return;
  }

  const canManageEngine = await engineService.hasEngineAccess(req.user!.userId, resourceId, ENGINE_MANAGE_ROLES);
  if (!canManageEngine) {
    throw Errors.forbidden('Only owners and delegates can invite engine members');
  }
}

async function loadResourceName(resourceType: 'tenant' | 'project' | 'engine', tenantSlug: string, resourceId?: string, providedResourceName?: string): Promise<string> {
  if (providedResourceName && providedResourceName.trim().length > 0) {
    return providedResourceName.trim();
  }

  if (resourceType === 'tenant') {
    return tenantSlug;
  }

  const dataSource = await getDataSource();
  if (resourceType === 'project' && resourceId) {
    const project = await dataSource.getRepository(Project).findOne({ where: { id: resourceId }, select: ['name'] });
    return project?.name || resourceId;
  }

  if (resourceType === 'engine' && resourceId) {
    const engine = await dataSource.getRepository(Engine).findOne({ where: { id: resourceId }, select: ['name'] });
    return engine?.name || resourceId;
  }

  return resourceId || tenantSlug;
}

router.get('/api/t/:tenantSlug/invitations/capabilities', apiLimiter, requireAuth, asyncHandler(async (req, res) => {
  const emailConfig = await getEmailConfigForTenant((req as any).tenant?.tenantId);
  const ssoRequired = await invitationService.isLocalLoginDisabled();

  res.json({
    ssoRequired,
    emailConfigured: Boolean(emailConfig),
  });
}));

router.post('/api/t/:tenantSlug/invitations', apiLimiter, requireAuth, createUserLimiter, validateBody(createInvitationSchema), asyncHandler(async (req, res) => {
  const tenantSlug = String(req.params.tenantSlug || '').trim() || 'default';
  const { email, resourceType, resourceId, resourceName, role, deliveryMethod } = req.body as z.infer<typeof createInvitationSchema>;
  const normalizedEmail = email.toLowerCase();

  await ensureInvitationPermission(req, resourceType, resourceId);

  if (resourceType === 'engine' && role && role !== 'operator' && role !== 'deployer') {
    throw Errors.validation('Engine invitations only support operator or deployer roles');
  }

  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
  let existingQb = userRepo.createQueryBuilder('u');
  existingQb = addCaseInsensitiveEquals(existingQb, 'u', 'email', 'email', normalizedEmail);
  const existingUser = await existingQb.getOne();

  if (existingUser && existingUser.passwordHash) {
    throw Errors.conflict('User already exists. Add them directly instead of creating an invitation.');
  }

  const pendingUser = existingUser || await userService.createPendingUser({
    email: normalizedEmail,
    platformRole: 'user',
    createdByUserId: req.user!.userId,
  }).then((user) => ({ id: user.id, email: user.email } as Pick<User, 'id' | 'email'>));

  if (!pendingUser) {
    throw Errors.internal('Failed to prepare invitation user');
  }

  const resolvedResourceName = await loadResourceName(resourceType, tenantSlug, resourceId, resourceName);
  const result = await invitationService.createInvitation({
    userId: pendingUser.id,
    email: normalizedEmail,
    tenantSlug,
    resourceType,
    resourceId,
    resourceName: resolvedResourceName,
    resourceRole: role,
    resourceRoles: role ? [role] : undefined,
    createdByUserId: req.user!.userId,
    invitedByName: req.user!.email,
    deliveryMethod,
  });

  await logAudit({
    userId: req.user!.userId,
    action: `${resourceType}.invitation.created`,
    resourceType,
    resourceId: resourceId || tenantSlug,
    ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    details: {
      email: normalizedEmail,
      deliveryMethod,
      inviteUrlReturned: !result.emailSent,
    },
  });

  res.status(201).json({
    invited: true,
    emailSent: result.emailSent,
    emailError: result.emailError,
    inviteUrl: result.emailSent ? undefined : result.inviteUrl,
    oneTimePassword: deliveryMethod === 'manual' ? result.oneTimePassword : undefined,
  });
}));

router.get('/api/invitations/:token', apiLimiter, validateParams(invitationParamsSchema), asyncHandler(async (req, res) => {
  const info = await invitationService.getInvitationInfo(String(req.params.token));
  res.json(info);
}));

router.post('/api/invitations/:token/verify-otp', apiLimiter, passwordResetVerifyLimiter, validateParams(invitationParamsSchema), validateBody(verifyInvitationSchema), asyncHandler(async (req, res) => {
  const token = String(req.params.token);
  const { oneTimePassword } = req.body as z.infer<typeof verifyInvitationSchema>;
  const invitationInfo = await invitationService.getInvitationInfo(token);
  const verified = await invitationService.verifyOneTimePassword(token, oneTimePassword);
  const dataSource = await getDataSource();
  const user = await dataSource.getRepository(User).findOneBy({ id: verified.userId });

  if (!user) {
    throw Errors.validation('Invitation user could not be found');
  }

  setOnboardingCookie(res, {
    userId: user.id,
    email: user.email,
    platformRole: user.platformRole,
    invitationId: verified.invitationId,
    tenantSlug: verified.tenantSlug,
  });

  await logAudit({
    userId: user.id,
    action: 'auth.invitation.otp_verified',
    resourceType: 'invitation',
    resourceId: verified.invitationId,
    ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    details: {
      deliveryMethod: 'manual',
      tenantSlug: verified.tenantSlug,
      invitedEmail: invitationInfo.email,
      invitedResourceType: invitationInfo.resourceType,
      invitedResourceName: invitationInfo.resourceName,
    },
  });

  res.json({ requiresPasswordSet: true, tenantSlug: verified.tenantSlug, deliveryMethod: 'manual' });
}));

router.post('/api/invitations/:token/redeem', apiLimiter, passwordResetVerifyLimiter, validateParams(invitationParamsSchema), asyncHandler(async (req, res) => {
  const token = String(req.params.token);
  const invitationInfo = await invitationService.getInvitationInfo(token);
  const verified = await invitationService.redeemEmailInvitation(token);
  const dataSource = await getDataSource();
  const user = await dataSource.getRepository(User).findOneBy({ id: verified.userId });

  if (!user) {
    throw Errors.validation('Invitation user could not be found');
  }

  setOnboardingCookie(res, {
    userId: user.id,
    email: user.email,
    platformRole: user.platformRole,
    invitationId: verified.invitationId,
    tenantSlug: verified.tenantSlug,
  });

  await logAudit({
    userId: user.id,
    action: 'auth.invitation.email_redeemed',
    resourceType: 'invitation',
    resourceId: verified.invitationId,
    ipAddress: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    details: {
      deliveryMethod: 'email',
      tenantSlug: verified.tenantSlug,
      invitedEmail: invitationInfo.email,
      invitedResourceType: invitationInfo.resourceType,
      invitedResourceName: invitationInfo.resourceName,
    },
  });

  res.json({ requiresPasswordSet: true, tenantSlug: verified.tenantSlug, deliveryMethod: 'email' });
}));

export default router;
