import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: new Map<string, any[]>(),
  config: { tenancyMode: "pooled",tenancyCloudRequired:false },
  failNetwork: false,
}));
vi.mock("@enterpriseglue/shared/config/index.js", () => ({
  config: mocks.config,
}));
vi.mock(
  "@enterpriseglue/shared/services/platform-admin/SecretResolver.js",
  () => ({ secretResolver: { resolveStored: vi.fn(() => null) } }),
);
vi.mock(
  "@enterpriseglue/shared/services/platform-admin/GenericOidcService.js",
  () => ({
    genericOidcService: {
      testConnection: vi.fn(async () => ({
        issuer: "https://login.microsoftonline.com/test",
        jwksUri: "https://login.microsoftonline.com/keys",
      })),
    },
  }),
);
vi.mock(
  "@enterpriseglue/shared/services/platform-admin/SsoHttpTransport.js",
  () => ({
    withResolvedSsoHttpContext: vi.fn(
      async (
        _tenant: unknown,
        _resolved: unknown,
        work: () => Promise<unknown>,
      ) => {
        if (mocks.failNetwork) throw new Error("Proxy refused");
        return work();
      },
    ),
    fetchSsoHttp: vi.fn(
      async () =>
        new Response(JSON.stringify({ keys: [{ kid: "key-1" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  }),
);
vi.mock("@enterpriseglue/shared/db/data-source.js", () => ({
  getDataSource: async () => ({
    getRepository: (entity: { name: string }) => {
      const rows = () => {
        if (!mocks.rows.has(entity.name)) mocks.rows.set(entity.name, []);
        return mocks.rows.get(entity.name)!;
      };
      const matches = (row: any, where: any) =>
        Object.entries(where).every(([key, value]: any) =>
          value?._type === "isNull" ? row[key] == null : row[key] === value,
        );
      return {
        findOneBy: async (where: any) =>
          structuredClone(rows().find((row) => matches(row, where)) || null),
        find: async () => structuredClone(rows()),
        insert: async (row: any) => {
          rows().push(structuredClone(row));
          return { identifiers: [{ id: row.id }] };
        },
        update: async (where: any, patch: any) => {
          let affected = 0;
          for (const row of rows())
            if (matches(row, where)) {
              Object.assign(row, structuredClone(patch));
              affected++;
            }
          return { affected };
        },
      };
    },
  }),
}));
import { SsoConnectionService } from "@enterpriseglue/shared/services/platform-admin/SsoConnectionService.js";
import {
  SsoProxyCatalogueSchema,
  SsoConnectionUpdateSchema,
  ConfigSsoProxyCatalogueFileSchema,
} from "@enterpriseglue/shared/schemas/platform-admin/sso-connection.js";
import { withResolvedSsoHttpContext } from "@enterpriseglue/shared/services/platform-admin/SsoHttpTransport.js";

const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
const profile = (scope = A, key = "proxy.a") => ({
  key,
  displayName: key,
  host: "proxy.example.net",
  port: 8090,
  enabled: true,
  scopeKeys: [scope],
  requiredScopeKeys: [],
  allowedIdentityProviderHosts: ["login.microsoftonline.com"],
  allowPrivateProxy: false,
});
const service = new SsoConnectionService();
async function configure() {
  await service.saveCatalogue(
    { profiles: [profile(), profile(B, "proxy.b")] },
    undefined,
    "operator",
  );
}
function provider(tenantId = A, key = "entra") {
  const list = mocks.rows.get("IdentityProvider") || [];
  list.push({
    id: "provider-" + tenantId,
    key,
    tenantId,
    protocol: "oidc",
    authenticationMode: "direct",
    configurationJson: "{}",
  });
  mocks.rows.set("IdentityProvider", list);
}
beforeEach(() => {
  mocks.rows.clear();
  mocks.failNetwork = false;
  mocks.config.tenancyMode = "pooled";mocks.config.tenancyCloudRequired=false;
  vi.clearAllMocks();
  delete process.env.EG_TENANCY_CLOUD_REQUIRED;
  process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS = "login.microsoftonline.com";
});

describe("tenant SSO connection configuration", () => {
  it("preserves unset legacy routing and isolates an explicit Direct choice", async () => {
    expect((await service.resolve(A)).legacy).toBe(true);
    await service.saveConnection(A, { mode: "direct" }, undefined, "admin");
    expect((await service.resolve(A)).legacy).toBe(false);
    expect((await service.resolve(B)).legacy).toBe(true);
  });
  it("lists only assigned profiles and never discloses their endpoints to tenant selectors", async () => {
    await configure();
    const view = await service.view(A);
    expect(view.profiles.map((p) => p.key)).toEqual(["proxy.a"]);
    expect(view.profiles[0]).not.toHaveProperty("host");
  });
  it("rejects another tenant profile before testing or activation", async () => {
    await configure();
    provider();
    await expect(
      service.test(A, { mode: "proxy", proxyProfileKey: "proxy.b" }, "entra"),
    ).rejects.toThrow("unavailable");
    expect(withResolvedSsoHttpContext).not.toHaveBeenCalled();
  });
  it("tests a draft without activating it and permits a version-bound activation", async () => {
    await configure();
    provider();
    const before = await service.view(A);
    const test = await service.test(
      A,
      { mode: "proxy", proxyProfileKey: "proxy.a" },
      "entra",
    );
    expect(test.success).toBe(true);
    expect((await service.view(A)).connection).toBeNull();
    await service.saveConnection(
      A,
      { mode: "proxy", proxyProfileKey: "proxy.a" },
      before.version,
      "admin",
    );
    expect((await service.view(A)).lastTest?.version).toBe(test.version);
    expect((await service.resolve(A)).profile?.key).toBe("proxy.a");
  });
  it("never activates a failed proxy test or changes the previous route", async () => {
    await configure();
    provider();
    await service.saveConnection(A, { mode: "direct" }, undefined, "admin");
    mocks.failNetwork = true;
    await expect(
      service.saveConnection(
        A,
        { mode: "proxy", proxyProfileKey: "proxy.a" },
        undefined,
        "admin",
        { providerKey: "entra" },
      ),
    ).rejects.toThrow("refused");
    expect((await service.view(A)).connection).toEqual({ mode: "direct" });
  });
  it("enforces config-locked ownership for portal and other bundle sources", async () => {
    await service.saveConnection(A, { mode: "direct" }, undefined, "ci", {
      sourceRef: "config_bundle:tenant.a",
    });
    await expect(
      service.saveConnection(A, { mode: "direct" }, undefined, "admin"),
    ).rejects.toThrow("locked");
    await expect(
      service.saveConnection(A, { mode: "direct" }, undefined, "ci", {
        sourceRef: "config_bundle:tenant.b",
      }),
    ).rejects.toThrow("locked");
  });
  it("records drift for editable headless settings", async () => {
    await service.saveConnection(A, { mode: "direct" }, undefined, "ci", {
      sourceRef: "config_bundle:tenant.a",
      ownershipMode: "config_warn",
    });
    await service.saveConnection(A, { mode: "direct" }, undefined, "admin");
    expect((await service.view(A)).ownership.driftStatus).toBe("drifted");
  });
  it("rejects stale UI edits instead of overwriting another administrator", async () => {
    const version = (await service.view(A)).version;
    await service.saveConnection(A, { mode: "direct" }, version, "first");
    await expect(
      service.saveConnection(A, { mode: "direct" }, version, "second"),
    ).rejects.toThrow("changed");
  });
  it("blocks implicit bypass of an operator-required proxy", async () => {
    await service.saveCatalogue(
      { profiles: [{ ...profile(), requiredScopeKeys: [A] }] },
      undefined,
      "operator",
    );
    await expect(
      service.saveConnection(A, { mode: "direct" }, undefined, "admin"),
    ).rejects.toThrow("requires");
    await expect(service.resolve(A)).rejects.toThrow("requires");
  });
  it("prevents removing, disabling or changing the endpoint of an active profile", async () => {
    await configure();
    provider();
    await service.saveConnection(
      A,
      { mode: "proxy", proxyProfileKey: "proxy.a" },
      undefined,
      "admin",
      { providerKey: "entra" },
    );
    await expect(
      service.saveCatalogue({ profiles: [] }, undefined, "operator"),
    ).rejects.toThrow("Replace active");
    await expect(
      service.saveCatalogue(
        {
          profiles: [
            { ...profile(), host: "new.example.net" },
            profile(B, "proxy.b"),
          ],
        },
        undefined,
        "operator",
      ),
    ).rejects.toThrow("replacement");
  });
  it("requires Cloud qualification for the serving release and shard", async () => {
    await configure();
    provider();
    await service.saveConnection(
      A,
      { mode: "proxy", proxyProfileKey: "proxy.a" },
      undefined,
      "admin",
      { providerKey: "entra" },
    );
    mocks.config.tenancyCloudRequired=true;
    expect((await service.resolve(A)).profile?.key).toBe("proxy.a");
    process.env.EG_TENANT_PLACEMENT_RELEASE_ID = "new-release";
    await expect(service.resolve(A)).rejects.toThrow("not qualified");
    delete process.env.EG_TENANT_PLACEMENT_RELEASE_ID;
  });
  it("does not invalidate another tenant connection when an unrelated profile changes", async () => {
    await configure();
    provider();
    await service.saveConnection(
      A,
      { mode: "proxy", proxyProfileKey: "proxy.a" },
      undefined,
      "admin",
      { providerKey: "entra" },
    );
    const version = (await service.resolve(A)).version;
    await service.saveCatalogue(
      {
        profiles: [
          profile(),
          { ...profile(B, "proxy.b"), host: "changed.example.net" },
        ],
      },
      undefined,
      "operator",
    );
    expect((await service.resolve(A)).version).toBe(version);
  });
});

describe("SSO proxy canonical configuration", () => {
  it("validates headless profiles with the same endpoint and assignment rules", () => {
    expect(
      ConfigSsoProxyCatalogueFileSchema.parse({
        ssoProxyCatalogue: { profiles: [profile()] },
      }).ssoProxyCatalogue.ownershipMode,
    ).toBe("config_locked");
  });
  it.each([
    "http://proxy.example.net",
    "proxy.example.net/path",
    "user:password@proxy.example.net",
    "proxy.example.net:8090",
  ])("rejects proxy hostname syntax %s", (host) => {
    expect(
      SsoProxyCatalogueSchema.safeParse({ profiles: [{ ...profile(), host }] })
        .success,
    ).toBe(false);
  });
  it("rejects ambiguous required proxies and extra untrusted settings", () => {
    expect(
      SsoProxyCatalogueSchema.safeParse({
        profiles: [
          { ...profile(), requiredScopeKeys: [A] },
          { ...profile(A, "second"), requiredScopeKeys: [A] },
        ],
      }).success,
    ).toBe(false);
    expect(
      SsoConnectionUpdateSchema.safeParse({
        connection: { mode: "direct" },
        expectedVersion: "v",
        tenantId: B,
      }).success,
    ).toBe(false);
  });
});
