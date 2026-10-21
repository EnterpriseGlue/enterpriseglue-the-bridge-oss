import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import router from "../../../../../packages/backend-host/src/modules/platform-admin/routes/sso-connections.js";
import { errorHandler } from "@enterpriseglue/shared/middleware/errorHandler.js";
import { logAudit } from "@enterpriseglue/shared/services/audit.js";
const state = vi.hoisted(() => ({
  tenantId: null as string | null,
  tenantAdmin: false,
  authenticated: true,
  allowed: new Set<string>(),
  config: { tenancyMode: "pooled" },
}));
const service = vi.hoisted(() => ({
  view: vi.fn(),
  saveConnection: vi.fn(),
  test: vi.fn(),
  catalogueView: vi.fn(),
  saveCatalogue: vi.fn(),
}));
vi.mock("@enterpriseglue/shared/config/index.js", () => ({
  config: state.config,
}));
vi.mock(
  "@enterpriseglue/shared/services/platform-admin/SsoConnectionService.js",
  () => ({ ssoConnectionService: service }),
);
vi.mock("@enterpriseglue/shared/services/audit.js", () => ({
  logAudit: vi.fn(),
}));
vi.mock("@enterpriseglue/shared/middleware/rateLimiter.js", () => ({
  identityAdminLimiter: (_q: any, _r: any, n: any) => n(),
  reconciliationLimiter: (_q: any, _r: any, n: any) => n(),
}));
vi.mock("@enterpriseglue/shared/middleware/auth.js", () => ({
  requireAuth: (q: any, r: any, n: any) => {
    if (!state.authenticated) return r.sendStatus(401);
    q.user = { userId: "admin" };
    if (state.tenantId) q.tenant = { tenantId: state.tenantId };
    r.locals.tenantIdentityProviderScope = state.tenantAdmin;
    n();
  },
}));
vi.mock("@enterpriseglue/shared/middleware/requireAction.js", () => ({
  requireAction: (action: string) => (_q: any, r: any, n: any) =>
    state.allowed.has(action) ? n() : r.sendStatus(403),
}));
const app = express();
app.use(express.json());
app.use(router);
app.use(errorHandler);
beforeEach(() => {
  vi.clearAllMocks();
  state.tenantId = null;
  state.tenantAdmin = false;
  state.authenticated = true;
  state.config.tenancyMode = "pooled";
  state.allowed = new Set([
    "platform.sso.providers.read",
    "platform.sso.providers.manage",
    "tenant.sso.providers.read",
    "tenant.sso.providers.manage",
  ]);
  service.view.mockResolvedValue({ connection: { mode: "direct" } });
  service.catalogueView.mockResolvedValue({ catalogue: { profiles: [] } });
  service.test.mockResolvedValue({
    success: true,
    version: "v",
    runtimeKey: "r",
  });
});
describe("SSO connection API boundaries", () => {
  it('defers root-shaped tenant sessions to hostname resolution instead of using platform authority',async()=>{
    state.tenantId='tenant-a';state.tenantAdmin=false;
    expect((await request(app).get('/api/identity/sso-connection')).status).toBe(404);
    expect(service.view).not.toHaveBeenCalled();
    state.tenantAdmin=true;
    expect((await request(app).get('/api/identity/sso-connection')).status).toBe(200);
    expect(service.view).toHaveBeenCalledWith('tenant-a');
  });
  it("requires authentication and the scoped read permission", async () => {
    state.authenticated = false;
    expect(
      (await request(app).get("/api/identity/sso-connection")).status,
    ).toBe(401);
    state.authenticated = true;
    state.allowed.clear();
    expect(
      (await request(app).get("/api/identity/sso-connection")).status,
    ).toBe(403);
    expect(service.view).not.toHaveBeenCalled();
  });
  it("derives tenant scope from the trusted request and rejects body scope injection", async () => {
    state.tenantId = "tenant-a";
    state.tenantAdmin = true;
    expect(
      (await request(app).get("/api/identity/sso-connection")).status,
    ).toBe(200);
    expect(service.view).toHaveBeenCalledWith("tenant-a");
    expect(
      (
        await request(app)
          .put("/api/identity/sso-connection")
          .send({
            connection: { mode: "direct" },
            expectedVersion: "v",
            tenantId: "tenant-b",
          })
      ).status,
    ).toBe(400);
    expect(service.saveConnection).not.toHaveBeenCalled();
  });
  it("does not let tenant administrators approve endpoints through root aliases", async () => {
    state.tenantId = "tenant-a";
    state.tenantAdmin = true;
    expect(
      (await request(app).get("/api/identity/sso-proxy-catalogue")).status,
    ).toBe(403);
    state.tenantAdmin = false;
    expect(
      (
        await request(app)
          .put("/api/identity/sso-proxy-catalogue")
          .send({ catalogue: { profiles: [] }, expectedVersion: "v" })
      ).status,
    ).toBe(403);
    expect(service.saveCatalogue).not.toHaveBeenCalled();
  });
  it("requires manage permission for testing and activation", async () => {
    state.allowed.delete("platform.sso.providers.manage");
    expect(
      (
        await request(app)
          .post("/api/identity/sso-connection/test")
          .send({ connection: { mode: "direct" }, providerKey: "entra" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .put("/api/identity/sso-connection")
          .send({ connection: { mode: "direct" }, expectedVersion: "v" })
      ).status,
    ).toBe(403);
  });
  it("tests a draft without saving it and audits only safe context", async () => {
    expect(
      (
        await request(app)
          .post("/api/identity/sso-connection/test")
          .send({
            connection: { mode: "proxy", proxyProfileKey: "corporate" },
            providerKey: "entra",
          })
      ).status,
    ).toBe(200);
    expect(service.test).toHaveBeenCalledWith(
      null,
      { mode: "proxy", proxyProfileKey: "corporate" },
      "entra",
    );
    expect(service.saveConnection).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "identity.sso.connection.tested",
        details: expect.objectContaining({ success: true }),
      }),
    );
  });
  it("sanitizes failures and preserves the active connection", async () => {
    service.test.mockRejectedValueOnce(
      new Error("secret credential and private endpoint"),
    );
    const response = await request(app)
      .post("/api/identity/sso-connection/test")
      .send({ connection: { mode: "direct" }, providerKey: "entra" });
    expect(response.status).toBe(400);
    expect(response.text).not.toContain("secret credential");
    expect(response.body.details.stage).toBe("assignment_or_configuration");
    expect(service.saveConnection).not.toHaveBeenCalled();
  });
  it("permits platform catalogue administration and explicit single-tenant scope", async () => {
    expect(
      (
        await request(app)
          .put("/api/identity/sso-proxy-catalogue")
          .send({ catalogue: { profiles: [] }, expectedVersion: "v" })
      ).status,
    ).toBe(200);
    expect(service.saveCatalogue).toHaveBeenCalledWith(
      { profiles: [] },
      "v",
      "admin",
    );
    state.config.tenancyMode = "single";
    state.tenantId = "default";
    expect(
      (await request(app).get("/api/identity/sso-proxy-catalogue")).status,
    ).toBe(200);
  });
});
