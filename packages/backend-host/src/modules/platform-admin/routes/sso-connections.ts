import { config } from "@enterpriseglue/shared/config/index.js";
import { Router, type Request, type RequestHandler } from "express";
import { requireAuth } from "@enterpriseglue/shared/middleware/auth.js";
import { requireAction } from "@enterpriseglue/shared/middleware/requireAction.js";
import {
  asyncHandler,
  Errors,
} from "@enterpriseglue/shared/middleware/errorHandler.js";
import { validateBody } from "@enterpriseglue/shared/middleware/validate.js";
import {
  identityAdminLimiter,
  reconciliationLimiter,
} from "@enterpriseglue/shared/middleware/rateLimiter.js";
import { identityAdminJsonPayloadLimit } from "@enterpriseglue/shared/middleware/requestSizeLimit.js";
import { logAudit } from "@enterpriseglue/shared/services/audit.js";
import { SsoTransportError } from "@enterpriseglue/shared/services/platform-admin/SsoHttpTransport.js";
import { ssoConnectionService } from "@enterpriseglue/shared/services/platform-admin/SsoConnectionService.js";
import {
  SsoConnectionUpdateSchema,
  SsoConnectionTestSchema,
  SsoProxyCatalogueUpdateSchema,
} from "@enterpriseglue/shared/schemas/platform-admin/sso-connection.js";

const router = Router();
// Root-shaped tenant-host requests must pass the existing hostname resolver
// before receiving tenant authority. Do not treat their session as platform scope.
const connectionScope:RequestHandler=(req,res,next)=>{
  if(config.tenancyMode==='pooled'&&req.tenant&&!res.locals.tenantIdentityProviderScope)return next('router');
  next();
};
const read: RequestHandler = (req, res, next) =>
  requireAction(
    res.locals.tenantIdentityProviderScope
      ? "tenant.sso.providers.read"
      : "platform.sso.providers.read",
  )(req, res, next);
const manage: RequestHandler = (req, res, next) =>
  requireAction(
    res.locals.tenantIdentityProviderScope
      ? "tenant.sso.providers.manage"
      : "platform.sso.providers.manage",
  )(req, res, next);
const scope = (req: Request) => req.tenant?.tenantId || null;
const operator: RequestHandler = (req, res, next) => {
  if (
    res.locals.tenantIdentityProviderScope ||
    (config.tenancyMode === "pooled" && req.tenant)
  )
    throw Errors.forbidden(
      "Proxy approval requires platform-scoped administration",
    );
  requireAction("platform.sso.providers.manage")(req, res, next);
};
async function audit(
  req: Request,
  action: string,
  details: Record<string, unknown>,
) {
  await logAudit({
    tenantId: scope(req) || undefined,
    userId: req.user!.userId,
    action,
    resourceType: "sso_connection",
    resourceId: scope(req) || "platform",
    details,
  });
}
router.get(
  "/api/identity/sso-connection",
  requireAuth,
  connectionScope,
  identityAdminLimiter,
  read,
  asyncHandler(async (req, res) => {
    res.json(await ssoConnectionService.view(scope(req)));
  }),
);
router.put(
  "/api/identity/sso-connection",
  requireAuth,
  connectionScope,
  identityAdminLimiter,
  manage,
  identityAdminJsonPayloadLimit,
  validateBody(SsoConnectionUpdateSchema),
  asyncHandler(async (req, res) => {
    await ssoConnectionService.saveConnection(
      scope(req),
      req.body.connection,
      req.body.expectedVersion,
      req.user!.userId,
      { providerKey: req.body.providerKey },
    );
    await audit(req, "identity.sso.connection.updated", {
      mode: req.body.connection.mode,
    });
    res.json(await ssoConnectionService.view(scope(req)));
  }),
);
router.post(
  "/api/identity/sso-connection/test",
  requireAuth,
  connectionScope,
  identityAdminLimiter,
  reconciliationLimiter,
  manage,
  identityAdminJsonPayloadLimit,
  validateBody(SsoConnectionTestSchema),
  asyncHandler(async (req, res) => {
    try {
      const result = await ssoConnectionService.test(
        scope(req),
        req.body.connection,
        req.body.providerKey,
      );
      await audit(req, "identity.sso.connection.tested", {
        mode: req.body.connection.mode,
        success: true,
        version: result.version,
        runtimeKey: result.runtimeKey,
      });
      res.json(result);
    } catch (error) {
      const stage =
        error instanceof SsoTransportError
          ? error.stage
          : (error as { details?: { stage?: string } })?.details?.stage;
      const labels: Record<string, string> = {
        proxy_dns_tcp: "proxy DNS/TCP",
        connect_tls: "CONNECT/TLS",
        discovery: "OIDC discovery",
        signing_keys: "public signing keys",
      };
      const failedStage =
        stage && labels[stage] ? stage : "assignment_or_configuration";
      await audit(req, "identity.sso.connection.tested", {
        mode: req.body.connection.mode,
        success: false,
        stage: failedStage,
      });
      throw Errors.validation(
        `SSO connection test failed during ${labels[failedStage] || "profile assignment or provider configuration"}. Check the approved profile, network access and TLS trust. Active routing has not changed.`,
        { stage: failedStage },
      );
    }
  }),
);
router.get(
  "/api/identity/sso-proxy-catalogue",
  requireAuth,
  identityAdminLimiter,
  operator,
  asyncHandler(async (_req, res) => {
    res.json(await ssoConnectionService.catalogueView());
  }),
);
router.put(
  "/api/identity/sso-proxy-catalogue",
  requireAuth,
  identityAdminLimiter,
  operator,
  identityAdminJsonPayloadLimit,
  validateBody(SsoProxyCatalogueUpdateSchema),
  asyncHandler(async (req, res) => {
    await ssoConnectionService.saveCatalogue(
      req.body.catalogue,
      req.body.expectedVersion,
      req.user!.userId,
    );
    await audit(req, "identity.sso.proxy_catalogue.updated", {
      profileKeys: req.body.catalogue.profiles.map(
        (p: { key: string }) => p.key,
      ),
    });
    res.json(await ssoConnectionService.catalogueView());
  }),
);
export default router;
