import { AsyncLocalStorage } from "node:async_hooks";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getCACertificates } from "node:tls";
import {
  Agent,
  ProxyAgent,
  fetch as undiciFetch,
  type Dispatcher,
} from "undici";
import { Address4, Address6 } from "ip-address";
import { secretResolver } from "./SecretResolver.js";
import type { SsoProxyProfile } from "../../schemas/platform-admin/sso-connection.js";

export interface SsoHttpContext {
  tenantId: string | null;
  expectedVersion?: string;
}
export interface ResolvedSsoHttpContext {
  version: string;
  profile: SsoProxyProfile | null;
  legacy: boolean;
}
export class SsoTransportError extends Error {
  constructor(
    readonly stage: "proxy_dns_tcp" | "connect_tls",
    readonly cause: unknown,
  ) {
    super(`SSO connection failed during ${stage}`);
    this.name = "SsoTransportError";
  }
}
interface Lease {
  dispatcher: Dispatcher;
  profile: SsoProxyProfile | null;
  active: boolean;
}
const leases = new AsyncLocalStorage<Lease | undefined>();
const budgets = new Map<string, number>();

function unsafeAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const parsed = new Address6(address);
    if (parsed.is4()) return unsafeAddress(parsed.to4().address);
    const canonical = parsed.canonicalForm();
    return (
      parsed.isLoopback() ||
      /^(?:fe[89ab]|ff)/i.test(canonical) ||
      canonical === "0000:0000:0000:0000:0000:0000:0000:0000" ||
      canonical === "fd00:0ec2:0000:0000:0000:0000:0000:0254"
    );
  }
  const parts = address.split(".").map(Number);
  return (
    parts[0] === 0 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    parts[0] >= 224
  );
}
function privateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const parsed = new Address6(address);
    return parsed.is4()
      ? privateAddress(parsed.to4().address)
      : /^(?:fc|fd)/i.test(parsed.canonicalForm());
  }
  if (!Address4.isValid(address)) return true;
  const [a, b] = address.split(".").map(Number);
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Resolve once, validate every answer, then connect only to that validated answer. */
export async function approvedProxyAddress(
  profile: SsoProxyProfile,
): Promise<{ address: string; family: 4 | 6 }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const answers = await Promise.race([
    lookup(profile.host, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("SSO proxy DNS resolution timed out")),
        5_000,
      );
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
  if (
    !answers.length ||
    answers.some(
      ({ address }) =>
        unsafeAddress(address) ||
        (!profile.allowPrivateProxy && privateAddress(address)),
    )
  )
    throw new Error("SSO proxy destination is not approved");
  return answers[0] as { address: string; family: 4 | 6 };
}

export function fetchSsoHttp(
  input: URL | string,
  init: RequestInit = {},
): Promise<Response> {
  const lease = leases.getStore();
  if (!lease) return fetch(input, init);
  if (!lease.active) throw new Error("SSO connection lease has expired");
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("SSO requests require HTTPS without URL credentials");
  if (
    lease.profile &&
    !lease.profile.allowedIdentityProviderHosts.includes(
      url.hostname.toLowerCase(),
    )
  )
    throw new Error("SSO destination is not approved for this proxy profile");
  // The explicit dispatcher overrides any ambient environment or global dispatcher.
  return (
    undiciFetch(url, {
      ...init,
      redirect: "error",
      dispatcher: lease.dispatcher,
    } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>
  ).catch((cause) => {
    throw new SsoTransportError("connect_tls", cause);
  });
}

export async function withSsoHttpContext<T>(
  context: SsoHttpContext,
  work: () => Promise<T>,
): Promise<T> {
  const { ssoConnectionService } = await import("./SsoConnectionService.js");
  const resolved = await ssoConnectionService.resolve(context.tenantId);
  if (context.expectedVersion && context.expectedVersion !== resolved.version)
    throw new Error("SSO connection changed; restart sign-in");
  if (resolved.legacy) return leases.run(undefined, work);
  return withResolvedSsoHttpContext(context.tenantId, resolved, work);
}

export async function withResolvedSsoHttpContext<T>(
  tenantId: string | null,
  resolved: ResolvedSsoHttpContext,
  work: () => Promise<T>,
): Promise<T> {
  const scope = tenantId || "platform";
  const active = budgets.get(scope) || 0;
  if (active >= 8) throw new Error("SSO connection concurrency limit reached");
  budgets.set(scope, active + 1);
  let dispatcher: Dispatcher | undefined;
  try {
    if (resolved.profile) {
      const p = resolved.profile;
      const address = await approvedProxyAddress(p).catch((cause) => {
        throw new SsoTransportError("proxy_dns_tcp", cause);
      });
      const certificate = p.caCertificateRef
        ? await secretResolver.resolveStored(`ref:${p.caCertificateRef}`)
        : null;
      if (p.caCertificateRef && !certificate)
        throw new Error("SSO certificate reference unavailable");
      dispatcher = new ProxyAgent({
        uri: `http://${address.family === 6 ? "[" + address.address + "]" : address.address}:${p.port}`,
        connections: 2,
        connectTimeout: 10_000,
        requestTls: certificate
          ? {
              ca: [...getCACertificates("default"), certificate],
              rejectUnauthorized: true,
            }
          : { rejectUnauthorized: true },
      });
    } else
      dispatcher = new Agent({
        connections: 2,
        connect: { rejectUnauthorized: true, timeout: 10_000 },
      });
    const lease: Lease = {
      dispatcher,
      profile: resolved.profile,
      active: true,
    };
    try {
      return await leases.run(lease, work);
    } finally {
      lease.active = false;
    }
  } finally {
    // Destroy on completion, including partial responses; no cross-tenant pool survives.
    await dispatcher?.destroy();
    const remaining = (budgets.get(scope) || 1) - 1;
    if (remaining) budgets.set(scope, remaining);
    else budgets.delete(scope);
  }
}
