import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import https from "node:https";
import http from "node:http";
import net from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { lookup } from "node:dns/promises";
import {
  approvedProxyAddress,
  fetchSsoHttp,
  withResolvedSsoHttpContext,
} from "@enterpriseglue/shared/services/platform-admin/SsoHttpTransport.js";
import { genericOidcService } from "@enterpriseglue/shared/services/platform-admin/GenericOidcService.js";
import type { SsoProxyProfile } from "@enterpriseglue/shared/schemas/platform-admin/sso-connection.js";

vi.mock("node:dns/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:dns/promises")>()),
  lookup: vi.fn(),
}));
vi.mock(
  "@enterpriseglue/shared/services/platform-admin/SecretResolver.js",
  () => ({
    secretResolver: {
      resolveStored: vi.fn(async () => process.env.EG_SSO_TEST_CA || null),
    },
  }),
);

const address = Object.values(networkInterfaces())
  .flat()
  .find((n) => n?.family === "IPv4" && !n.internal)?.address;
const counts = [0, 0],
  targets: string[] = [];
const sockets = new Set<net.Socket>();
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
let tlsServer: https.Server,
  proxies: http.Server[],
  ports: number[],
  dir: string,
  origin: string,
  nonce = "nonce-a";
const configuration = () => ({
  issuerUrl: origin,
  clientId: "eg-test",
  callbackUrl: "http://localhost:5173/api/auth/identity/callback",
  scopes: ["openid"],
});
const profile = (index = 0): SsoProxyProfile => ({
  key: `proxy.${index}`,
  displayName: "Test approved proxy",
  host: "proxy.example.test",
  port: ports[index],
  enabled: true,
  scopeKeys: ["platform"],
  requiredScopeKeys: [],
  allowedIdentityProviderHosts: ["idp.example.test"],
  allowPrivateProxy: true,
  caCertificateRef: "env://EG_SSO_TEST_CA",
});
const run = <T>(index: number, work: () => Promise<T>, p = profile(index)) =>
  withResolvedSsoHttpContext(
    `tenant-${index}`,
    { version: "test", profile: p, legacy: false },
    work,
  );
async function listen(server: net.Server, host: string) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  return (server.address() as net.AddressInfo).port;
}
function track(socket: net.Socket) {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
}

beforeAll(async () => {
  if (!address)
    throw new Error(
      "CONNECT acceptance needs a non-loopback IPv4 interface; run in the database/identity container lane",
    );
  dir = mkdtempSync(`${tmpdir()}/eg-sso-tls-`);
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      `${dir}/key.pem`,
      "-out",
      `${dir}/cert.pem`,
      "-subj",
      "/CN=idp.example.test",
      "-addext",
      "subjectAltName=DNS:idp.example.test",
    ],
    { stdio: "ignore" },
  );
  process.env.EG_SSO_TEST_CA = readFileSync(`${dir}/cert.pem`, "utf8");
  tlsServer = https.createServer(
    {
      key: readFileSync(`${dir}/key.pem`),
      cert: readFileSync(`${dir}/cert.pem`),
    },
    (req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url?.endsWith("/.well-known/openid-configuration"))
        res.end(
          JSON.stringify({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            jwks_uri: `${origin}/jwks`,
          }),
        );
      else if (req.url === "/jwks")
        res.end(
          JSON.stringify({
            keys: [
              {
                ...keys.publicKey.export({ format: "jwk" }),
                kid: "k1",
                alg: "RS256",
                use: "sig",
              },
            ],
          }),
        );
      else if (req.url === "/token")
        res.end(
          JSON.stringify({
            id_token: jwt.sign(
              { nonce, email: "person@example.test" },
              keys.privateKey,
              {
                algorithm: "RS256",
                keyid: "k1",
                issuer: origin,
                audience: "eg-test",
                subject: "subject-1",
                expiresIn: 300,
              },
            ),
          }),
        );
      else if (req.url === "/redirect") {
        res.statusCode = 302;
        res.setHeader("location", "https://unapproved.example.test");
        res.end();
      } else res.end("{}");
    },
  );
  tlsServer.on("connection", track);
  const tlsPort = await listen(tlsServer, "127.0.0.1");
  origin = `https://idp.example.test:${tlsPort}`;
  proxies = [0, 1].map((index) => {
    const proxy = http.createServer((_req, res) => {
      res.statusCode = 405;
      res.end();
    });
    proxy.on("connection", track);
    proxy.on("connect", (req, client, head) => {
      counts[index]++;
      targets.push(req.url!);
      if (req.url !== `idp.example.test:${tlsPort}`) {
        client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      const upstream = net.connect(tlsPort, "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      track(upstream);
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
      client.on("close", () => upstream.destroy());
    });
    return proxy;
  });
  ports = await Promise.all(proxies.map((p) => listen(p, address!)));
}, 20_000);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(lookup).mockReset();
  counts.fill(0);
  targets.length = 0;
  nonce = "nonce-a";
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
});
afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await Promise.all(
    [tlsServer, ...proxies].map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ),
  );
  rmSync(dir, { recursive: true, force: true });
  delete process.env.EG_SSO_TEST_CA;
});

function approve() {
  vi.mocked(lookup).mockResolvedValue([
    { address: address!, family: 4 },
  ] as any);
}
describe("SSO CONNECT transport acceptance", () => {
  it("isolates concurrent tenants through different unauthenticated CONNECT proxies", async () => {
    approve();
    const outside = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", outside);
    await Promise.all(
      [0, 1].map((index) =>
        run(index, async () => {
          const auth = await genericOidcService.createAuthorizationRequest(
            configuration(),
            "state",
            "nonce-a",
          );
          expect(
            new URL(auth.url).searchParams.get("code_challenge_method"),
          ).toBe("S256");
          const claims = await genericOidcService.exchangeCode(
            configuration(),
            { code: "test", codeVerifier: auth.codeVerifier, nonce: "nonce-a" },
          );
          expect(claims.sub).toBe("subject-1");
        }),
      ),
    );
    expect(counts.every((n) => n > 0)).toBe(true);
    expect(outside).not.toHaveBeenCalled();
    expect(targets.every((t) => t.startsWith("idp.example.test:"))).toBe(true);
    await fetchSsoHttp("https://unrelated.example.test");
    expect(outside).toHaveBeenCalledTimes(1);
    // DNS is resolved only once per lease; CONNECT uses its validated literal IP.
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it("rejects a bad nonce even when network and signing keys are reachable", async () => {
    approve();
    nonce = "wrong";
    await expect(
      run(0, () =>
        genericOidcService.exchangeCode(configuration(), {
          code: "test",
          codeVerifier: "v",
          nonce: "expected",
        }),
      ),
    ).rejects.toThrow();
    expect(counts[0]).toBeGreaterThan(0);
  });
  it("keeps TLS verification enabled and does not share scoped trust", async () => {
    approve();
    await expect(
      run(
        0,
        async () => {
          const r = await fetchSsoHttp(origin);
          await r.text();
        },
        { ...profile(), caCertificateRef: undefined },
      ),
    ).rejects.toThrow();
    await expect(
      run(0, async () => {
        const r = await fetchSsoHttp(origin);
        await r.text();
      }),
    ).resolves.toBeUndefined();
  });
  it("never falls back to Direct or an ambient proxy when the approved proxy is unavailable", async () => {
    approve();
    process.env.HTTPS_PROXY = `http://${address}:${ports[1]}`;
    const outside = vi.fn();
    vi.stubGlobal("fetch", outside);
    await expect(
      run(0, () => fetchSsoHttp(origin), { ...profile(), port: 1 }),
    ).rejects.toThrow();
    expect(counts).toEqual([0, 0]);
    expect(outside).not.toHaveBeenCalled();
  });
  it("makes explicit Direct independent of ambient proxy settings", async () => {
    process.env.HTTPS_PROXY = `http://${address}:${ports[1]}`;
    const outside = vi.fn();
    vi.stubGlobal("fetch", outside);
    await expect(
      withResolvedSsoHttpContext(
        "direct",
        { version: "test", profile: null, legacy: false },
        () => fetchSsoHttp("https://127.0.0.1:1"),
      ),
    ).rejects.toThrow();
    expect(counts).toEqual([0, 0]);
    expect(lookup).not.toHaveBeenCalled();
    expect(outside).not.toHaveBeenCalled();
  });
  it("denies unapproved destinations, redirects and HTTP before forwarding credentials", async () => {
    approve();
    await run(0, async () => {
      expect(() => fetchSsoHttp("https://unapproved.example.test")).toThrow(
        "not approved",
      );
      expect(() => fetchSsoHttp("http://idp.example.test")).toThrow("HTTPS");
      await expect(fetchSsoHttp(`${origin}/redirect`)).rejects.toThrow();
    });
    expect(targets.every((t) => t.startsWith("idp.example.test:"))).toBe(true);
  });
  it.each([
    "127.0.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fd00:ec2::254",
    "fe80::1",
  ])(
    "denies unsafe proxy address %s even with private approval",
    async (ip) => {
      vi.mocked(lookup).mockResolvedValue([
        { address: ip, family: net.isIP(ip) },
      ] as any);
      await expect(approvedProxyAddress(profile())).rejects.toThrow(
        "not approved",
      );
    },
  );
  it("rejects any unsafe DNS answer and requires explicit approval for private addresses", async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: address!, family: 4 },
      { address: "127.0.0.1", family: 4 },
    ] as any);
    await expect(approvedProxyAddress(profile())).rejects.toThrow(
      "not approved",
    );
    vi.mocked(lookup).mockResolvedValue([
      { address: "10.2.3.4", family: 4 },
    ] as any);
    await expect(
      approvedProxyAddress({ ...profile(), allowPrivateProxy: false }),
    ).rejects.toThrow("not approved");
  });
  it("invalidates asynchronous work inherited from a completed operation", async () => {
    approve();
    let later: Promise<unknown>;
    await run(0, async () => {
      later = new Promise((resolve) =>
        setTimeout(() => {
          try {
            fetchSsoHttp(origin);
            resolve("unexpected");
          } catch (e) {
            resolve((e as Error).message);
          }
        }, 30),
      );
    });
    expect(await later!).toBe("SSO connection lease has expired");
  });
});
