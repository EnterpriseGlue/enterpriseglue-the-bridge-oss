import { runWithTenantDatabaseContext } from "../tenant-database-context.js";
import { runWithPlatformDatabaseCapability } from "../platform-database-context.js";
import { config } from "../../config/index.js";
import { createHash } from "node:crypto";
import { IsNull, type DataSource, type EntityManager } from "typeorm";
import { getDataSource } from "../../db/data-source.js";
import { PlatformSettings } from "../../infrastructure/persistence/entities/PlatformSettings.js";
import { TenantLoginPolicy } from "../../infrastructure/persistence/entities/TenantLoginPolicy.js";
import { IdentityProvider } from "../../infrastructure/persistence/entities/IdentityProvider.js";
import { Errors } from "../../middleware/errorHandler.js";
import { generateId } from "../../utils/id.js";
import { hashCanonicalConfig } from "./config-bundle-hash.js";
import { secretResolver } from "./SecretResolver.js";
import {
  SsoConnectionSelectionSchema,
  SsoProxyCatalogueSchema,
  type SsoConnectionSelection,
  type SsoProxyCatalogue,
  type SsoConfigurationOwnership,
  type SsoConnectionView,
  type SsoConnectionTestResult,
} from "../../schemas/platform-admin/sso-connection.js";
import {
  fetchSsoHttp,
  withResolvedSsoHttpContext,
  SsoTransportError,
  type ResolvedSsoHttpContext,
} from "./SsoHttpTransport.js";
import {
  readBoundedIdentityProviderJson,
  validateIdentityProviderEndpointUrl,
} from "./IdentityProviderEndpointPolicy.js";

type Store = DataSource | EntityManager;
type Owner = SsoConfigurationOwnership;
interface StoredConnection extends Owner {
  connection: SsoConnectionSelection;
  lastTest: SsoConnectionView["lastTest"];
}
interface Qualification {
  scopeKey: string;
  version: string;
  runtimeKey: string;
  providerKey: string;
  at: number;
}
interface StoredCatalogue extends Owner {
  catalogue: SsoProxyCatalogue;
  qualifications: Qualification[];
}
const manual: Owner = {
  ownershipMode: "manual",
  sourceRef: null,
  driftStatus: null,
};
const empty: StoredCatalogue = {
  ...manual,
  catalogue: { profiles: [] },
  qualifications: [],
};
export const ssoRuntimeKey = () =>
  hashCanonicalConfig({
    release: process.env.EG_TENANT_PLACEMENT_RELEASE_ID || "self-hosted",
    shard: process.env.EG_TENANT_PLACEMENT_V2_SHARD_ID || "local",
  });
const parse = <T>(text: string | null | undefined, fallback: T): T =>
  text ? (JSON.parse(text) as T) : fallback;
const owned = (current: Owner, sourceRef?: string) => {
  if (
    current.ownershipMode === "config_locked" &&
    current.sourceRef !== sourceRef
  )
    throw Errors.conflict(
      "SSO configuration is locked by its configuration source",
    );
  if (sourceRef && current.sourceRef && current.sourceRef !== sourceRef)
    throw Errors.conflict("SSO configuration belongs to another source");
};
export class SsoConnectionService {
  private async store(store?: Store): Promise<Store> {
    return store || getDataSource();
  }
  async readCatalogue(store?: Store): Promise<StoredCatalogue> {
    const row = await (await this.store(store))
      .getRepository(PlatformSettings)
      .findOneBy({ id: "default" });
    const result = parse<StoredCatalogue>(
      row?.ssoProxyCatalogueJson,
      structuredClone(empty),
    );
    SsoProxyCatalogueSchema.parse(result.catalogue);
    Object.defineProperty(result, "_storedAt", {
      value: row?.updatedAt ?? null,
      enumerable: false,
    });
    return result;
  }
  async readConnection(
    tenantId: string | null,
    store?: Store,
  ): Promise<StoredConnection | null> {
    if (config.tenancyMode !== "pooled") tenantId = null;
    const db = await this.store(store);
    const row = tenantId
      ? await runWithTenantDatabaseContext(
          { tenantId, tenantSlug: tenantId },
          () =>
            db
              .getRepository(TenantLoginPolicy)
              .findOneBy({ tenantId: tenantId! }),
        )
      : await db.getRepository(PlatformSettings).findOneBy({ id: "default" });
    const result = parse<StoredConnection | null>(row?.ssoConnectionJson, null);
    if (result) SsoConnectionSelectionSchema.parse(result.connection);
    if (result)
      Object.defineProperty(result, "_storedAt", {
        value: row?.updatedAt ?? null,
        enumerable: false,
      });
    return result;
  }
  private async resolved(
    tenantId: string | null,
    selection: SsoConnectionSelection | null,
    catalogue: StoredCatalogue,
  ): Promise<ResolvedSsoHttpContext> {
    const scope = tenantId || "platform";
    const required = catalogue.catalogue.profiles.find((p) =>
      p.requiredScopeKeys.includes(scope),
    );
    if (
      required &&
      (!required.enabled ||
        selection?.mode !== "proxy" ||
        selection.proxyProfileKey !== required.key)
    )
      throw Errors.forbidden("This scope requires its approved SSO proxy");
    const profile =
      selection?.mode === "proxy"
        ? catalogue.catalogue.profiles.find(
            (p) =>
              p.key === selection.proxyProfileKey &&
              p.enabled &&
              p.scopeKeys.includes(scope),
          )
        : null;
    if (selection?.mode === "proxy" && !profile)
      throw Errors.forbidden("SSO proxy profile is unavailable for this scope");
    const trust = profile?.caCertificateRef
      ? await secretResolver.resolveStored(`ref:${profile.caCertificateRef}`)
      : null;
    if (profile?.caCertificateRef && !trust)
      throw Errors.validation("SSO certificate reference unavailable");
    return {
      profile: profile || null,
      legacy: !selection,
      version: hashCanonicalConfig({
        scope,
        selection,
        profile: profile
          ? {
              key: profile.key,
              host: profile.host,
              port: profile.port,
              enabled: profile.enabled,
              allowedIdentityProviderHosts:
                profile.allowedIdentityProviderHosts,
              allowPrivateProxy: profile.allowPrivateProxy,
              caCertificateRef: profile.caCertificateRef || null,
            }
          : null,
        required: required?.key || null,
        trust: trust ? createHash("sha256").update(trust).digest("hex") : null,
      }),
    };
  }
  async resolve(
    tenantId: string | null,
    store?: Store,
  ): Promise<ResolvedSsoHttpContext> {
    if (config.tenancyMode !== "pooled") tenantId = null;
    const catalogue = await this.readCatalogue(store),
      connection = await this.readConnection(tenantId, store);
    const result = await this.resolved(
      tenantId,
      connection?.connection || null,
      catalogue,
    );
    if (
      result.profile &&
      config.tenancyCloudRequired &&
      !catalogue.qualifications.some(
        (q) =>
          q.scopeKey === (tenantId || "platform") &&
          q.version === result.version &&
          q.runtimeKey === ssoRuntimeKey(),
      )
    )
      throw Errors.serviceUnavailable(
        "SSO proxy connectivity is not qualified on this runtime",
      );
    return result;
  }
  async view(
    tenantId: string | null,
    store?: Store,
  ): Promise<SsoConnectionView> {
    if (config.tenancyMode !== "pooled") tenantId = null;
    const [catalogue, current] = await Promise.all([
      this.readCatalogue(store),
      this.readConnection(tenantId, store),
    ]);
    const scope = tenantId || "platform";
    return {
      connection: current?.connection || null,
      version: hashCanonicalConfig(current),
      ownership: current
        ? {
            ownershipMode: current.ownershipMode,
            sourceRef: current.sourceRef,
            driftStatus: current.driftStatus,
          }
        : manual,
      profiles: catalogue.catalogue.profiles
        .filter((p) => p.scopeKeys.includes(scope))
        .map(({ key, displayName, enabled }) => ({
          key,
          displayName,
          enabled,
        })),
      requiredProxyProfileKey:
        catalogue.catalogue.profiles.find((p) =>
          p.requiredScopeKeys.includes(scope),
        )?.key || null,
      lastTest: current?.lastTest || null,
    };
  }
  async catalogueView(store?: Store) {
    const current = await this.readCatalogue(store);
    return {
      catalogue: current.catalogue,
      version: hashCanonicalConfig(current.catalogue),
      ownership: {
        ownershipMode: current.ownershipMode,
        sourceRef: current.sourceRef,
        driftStatus: current.driftStatus,
      },
    };
  }
  async saveCatalogue(
    catalogue: SsoProxyCatalogue,
    expectedVersion: string | undefined,
    actor: string,
    options: {
      store?: Store;
      sourceRef?: string;
      ownershipMode?: Owner["ownershipMode"];
    } = {},
  ): Promise<void> {
    const db = await this.store(options.store),
      current = await this.readCatalogue(db);
    owned(current, options.sourceRef);
    if (
      expectedVersion &&
      expectedVersion !== hashCanonicalConfig(current.catalogue)
    )
      throw Errors.conflict(
        "SSO proxy catalogue changed; reload before saving",
      );
    const desired = SsoProxyCatalogueSchema.parse(catalogue);
    // Never silently remove an active route or its assignment. Replacing its endpoint is explicit and invalidates qualifications.
    // Explicit per-tenant reads preserve forced RLS while allowing the
    // authorized catalogue owner to check every previously assigned scope.
    const active = [
      { scope: "platform", value: await this.readConnection(null, db) },
    ];
    if (config.tenancyMode === "pooled")
      for (const scope of new Set(
        current.catalogue.profiles.flatMap((profile) => profile.scopeKeys),
      )) {
        if (scope !== "platform")
          active.push({ scope, value: await this.readConnection(scope, db) });
      }
    for (const row of active) {
      if (
        row.value?.connection.mode === "proxy" &&
        !desired.profiles.some(
          (p) =>
            p.key ===
              (row.value!.connection as { proxyProfileKey: string })
                .proxyProfileKey &&
            p.enabled &&
            p.scopeKeys.includes(row.scope),
        )
      )
        throw Errors.conflict(
          "Replace active tenant SSO connections before disabling or unassigning their profile",
        );
    }
    for (const row of active) {
      if (row.value?.connection.mode !== "proxy") continue;
      const proxyKey = row.value.connection.proxyProfileKey;
      const before = current.catalogue.profiles.find((p) => p.key === proxyKey),
        after = desired.profiles.find((p) => p.key === proxyKey);
      const routing = (p: typeof before) =>
        p
          ? {
              host: p.host,
              port: p.port,
              allowPrivateProxy: p.allowPrivateProxy,
              caCertificateRef: p.caCertificateRef || null,
              allowedIdentityProviderHosts: p.allowedIdentityProviderHosts,
            }
          : null;
      if (
        hashCanonicalConfig(routing(before)) !==
        hashCanonicalConfig(routing(after))
      )
        throw Errors.conflict(
          "Create and test a replacement profile before changing an active proxy route or trust configuration",
        );
    }
    const next: StoredCatalogue = {
      catalogue: desired,
      qualifications: current.qualifications,
      ...(options.sourceRef
        ? {
            sourceRef: options.sourceRef,
            ownershipMode: options.ownershipMode || "config_locked",
            driftStatus: "in_sync" as const,
          }
        : {
            ...current,
            catalogue: desired,
            qualifications: current.qualifications,
            driftStatus:
              current.ownershipMode === "config_warn"
                ? ("drifted" as const)
                : current.driftStatus,
          }),
    };
    await this.writePlatform(
      db,
      "ssoProxyCatalogueJson",
      JSON.stringify(next),
      actor,
      (current as unknown as { _storedAt: number | null })._storedAt,
    );
  }
  private async writePlatform(
    db: Store,
    field: "ssoProxyCatalogueJson" | "ssoConnectionJson",
    value: string,
    actor: string,
    expectedStamp?: number | null,
  ) {
    const repo = db.getRepository(PlatformSettings),
      row = await repo.findOneBy({ id: "default" }),
      now = Math.max(Date.now(), Number(row?.updatedAt || 0) + 1);
    if (
      expectedStamp !== undefined &&
      Number(row?.updatedAt || 0) !== Number(expectedStamp || 0)
    )
      throw Errors.conflict("SSO configuration changed concurrently; reload");
    if (!row) {
      await repo.insert({
        id: "default",
        [field]: value,
        updatedAt: now,
        updatedById: actor,
      });
      return;
    }
    const result = await repo.update(
      { id: "default", updatedAt: row.updatedAt },
      { [field]: value, updatedAt: now, updatedById: actor },
    );
    if (result.affected !== 1)
      throw Errors.conflict(
        "SSO configuration changed concurrently; retry after reloading",
      );
  }
  async test(
    tenantId: string | null,
    selection: SsoConnectionSelection,
    providerKey: string,
    store?: Store,
  ): Promise<SsoConnectionTestResult> {
    if (config.tenancyMode !== "pooled") tenantId = null;
    const db = await this.store(store),
      catalogue = await this.readCatalogue(db);
    const lookupProvider = () =>
      db.getRepository(IdentityProvider).findOneBy({
        ...(config.tenancyMode === "pooled"
          ? { tenantId: tenantId || IsNull() }
          : {}),
        key: providerKey,
        protocol: "oidc",
        authenticationMode: "direct",
      });
    const provider =
      config.tenancyMode === "pooled" && !tenantId
        ? await runWithPlatformDatabaseCapability(
            { kind: "provider-discovery" },
            lookupProvider,
          )
        : await lookupProvider();
    if (!provider) throw Errors.notFound("OIDC provider");
    const candidate = await this.resolved(
      tenantId,
      SsoConnectionSelectionSchema.parse(selection),
      catalogue,
    );
    const { genericOidcService } = await import("./GenericOidcService.js");
    const result = await withResolvedSsoHttpContext(
      tenantId,
      candidate,
      async () => {
        const metadata = await genericOidcService
          .testConnection(JSON.parse(provider.configurationJson))
          .catch((cause) => {
            throw Errors.validation("OIDC discovery or TLS check failed", {
              stage:
                cause instanceof SsoTransportError ? cause.stage : "discovery",
            });
          });
        const keys = await fetchSsoHttp(
          validateIdentityProviderEndpointUrl(
            metadata.jwksUri,
            "OIDC JWKS URI",
            ["https:"],
          ),
          { redirect: "error", signal: AbortSignal.timeout(10_000) },
        );
        if (!keys.ok) {
          await keys.body?.cancel();
          throw Errors.validation("SSO signing-key request failed", {
            stage: "signing_keys",
          });
        }
        const jwks = await readBoundedIdentityProviderJson(
          keys,
          "OIDC public signing keys",
        );
        if (!Array.isArray(jwks.keys) || !jwks.keys.length)
          throw Errors.validation("SSO public signing keys are unavailable", {
            stage: "signing_keys",
          });
        return {
          success: true as const,
          version: candidate.version,
          runtimeKey: ssoRuntimeKey(),
          testedAt: Date.now(),
          stages: candidate.profile
            ? ["proxy_dns_tcp", "connect_tls", "discovery", "signing_keys"]
            : ["direct_tls", "discovery", "signing_keys"],
          message:
            "Network checks passed. Complete a real sign-in to verify credentials, MFA and permissions.",
        };
      },
    );
    // Qualifications are server-produced diagnostic state, never accepted in a catalogue payload or exported as desired configuration.
    const latest = await this.readCatalogue(db);
    if (
      (await this.resolved(tenantId, selection, latest)).version !==
      candidate.version
    )
      throw Errors.conflict("SSO connection changed during testing");
    latest.qualifications = latest.qualifications.filter(
      (q) =>
        q.scopeKey !== (tenantId || "platform") ||
        q.runtimeKey !== result.runtimeKey,
    );
    latest.qualifications.push({
      scopeKey: tenantId || "platform",
      version: result.version,
      runtimeKey: result.runtimeKey,
      providerKey,
      at: result.testedAt,
    });
    latest.qualifications = latest.qualifications.slice(-512);
    await this.writePlatform(
      db,
      "ssoProxyCatalogueJson",
      JSON.stringify(latest),
      "sso-connection-test",
      (latest as unknown as { _storedAt: number | null })._storedAt,
    );
    return result;
  }
  async saveConnection(
    tenantId: string | null,
    selection: SsoConnectionSelection,
    expectedVersion: string | undefined,
    actor: string,
    options: {
      store?: Store;
      sourceRef?: string;
      ownershipMode?: Owner["ownershipMode"];
      providerKey?: string;
    } = {},
  ): Promise<void> {
    if (config.tenancyMode !== "pooled") tenantId = null;
    const db = await this.store(options.store),
      current = await this.readConnection(tenantId, db);
    if (current) owned(current, options.sourceRef);
    if (expectedVersion && expectedVersion !== hashCanonicalConfig(current))
      throw Errors.conflict("SSO connection changed; reload before saving");
    const catalogue = await this.readCatalogue(db),
      resolved = await this.resolved(
        tenantId,
        SsoConnectionSelectionSchema.parse(selection),
        catalogue,
      );
    let qualification = catalogue.qualifications.find(
      (q) =>
        q.scopeKey === (tenantId || "platform") &&
        q.version === resolved.version &&
        q.runtimeKey === ssoRuntimeKey() &&
        (!options.providerKey || q.providerKey === options.providerKey),
    );
    if (resolved.profile && !qualification) {
      if (!options.providerKey)
        throw Errors.validation(
          "Test an OIDC provider with this connection before activation",
        );
      const tested = await this.test(
        tenantId,
        selection,
        options.providerKey,
        db,
      );
      qualification = {
        scopeKey: tenantId || "platform",
        version: tested.version,
        runtimeKey: tested.runtimeKey,
        providerKey: options.providerKey,
        at: tested.testedAt,
      };
    }
    const next: StoredConnection = {
      connection: selection,
      lastTest: qualification
        ? {
            at: qualification.at,
            providerKey: qualification.providerKey,
            version: qualification.version,
            runtimeKey: qualification.runtimeKey,
          }
        : null,
      ownershipMode: options.sourceRef
        ? options.ownershipMode || "config_locked"
        : current?.ownershipMode || "manual",
      sourceRef: options.sourceRef || current?.sourceRef || null,
      driftStatus: options.sourceRef
        ? "in_sync"
        : current?.ownershipMode === "config_warn"
          ? "drifted"
          : current?.driftStatus || null,
    };
    // Bind the compared value and write fence to the same snapshot. Reading a
    // fresh timestamp after comparison would permit a lost concurrent update.
    const repo = tenantId
      ? db.getRepository(TenantLoginPolicy)
      : db.getRepository(PlatformSettings);
    const row = await repo.findOneBy(
      tenantId ? { tenantId } : ({ id: "default" } as any),
    );
    const afterTest = parse<StoredConnection | null>(
      row?.ssoConnectionJson,
      null,
    );
    if (hashCanonicalConfig(afterTest) !== hashCanonicalConfig(current))
      throw Errors.conflict("SSO connection changed during activation");
    const latest = await this.resolved(
      tenantId,
      selection,
      await this.readCatalogue(db),
    );
    if (latest.version !== resolved.version)
      throw Errors.conflict("SSO proxy policy changed during activation");
    if (!tenantId) {
      await this.writePlatform(
        db,
        "ssoConnectionJson",
        JSON.stringify(next),
        actor,
        row?.updatedAt ?? null,
      );
      return;
    }
    const now = Math.max(Date.now(), Number(row?.updatedAt || 0) + 1);
    if (!row)
      await db.getRepository(TenantLoginPolicy).insert({
        id: generateId(),
        tenantId,
        localPasswordMode: "auto",
        providerSelectionMode: "chooser",
        ssoConnectionJson: JSON.stringify(next),
        createdAt: now,
        updatedAt: now,
        updatedByUserId: actor,
      });
    else {
      const result = await db.getRepository(TenantLoginPolicy).update(
        { id: row.id, updatedAt: row.updatedAt },
        {
          ssoConnectionJson: JSON.stringify(next),
          updatedAt: now,
          updatedByUserId: actor,
        },
      );
      if (result.affected !== 1)
        throw Errors.conflict("SSO connection changed concurrently");
    }
  }
}
export const ssoConnectionService = new SsoConnectionService();
