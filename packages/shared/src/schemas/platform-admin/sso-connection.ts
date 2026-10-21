import { z } from "zod";

const key = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9._-]*$/);
const host = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/,
    "Use a hostname or IPv4 address without a scheme, path or credentials",
  );
export const SsoConnectionSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("direct") }).strict(),
  z.object({ mode: z.literal("proxy"), proxyProfileKey: key }).strict(),
]);
export const SsoProxyProfileSchema = z
  .object({
    key,
    displayName: z.string().trim().min(1).max(160),
    host,
    port: z.number().int().min(1).max(65535),
    enabled: z.boolean().default(true),
    scopeKeys: z
      .array(z.union([z.literal("platform"), z.string().uuid()]))
      .min(1)
      .max(256),
    requiredScopeKeys: z
      .array(z.union([z.literal("platform"), z.string().uuid()]))
      .max(256)
      .default([]),
    allowedIdentityProviderHosts: z.array(host).min(1).max(32),
    allowPrivateProxy: z.boolean().default(false),
    caCertificateRef: z
      .string()
      .max(512)
      .regex(/^(env|file|docker):\/\/[A-Za-z0-9_.:/-]+$/)
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.requiredScopeKeys.some((scope) => !v.scopeKeys.includes(scope)))
      ctx.addIssue({
        code: "custom",
        path: ["requiredScopeKeys"],
        message: "A required scope must also be assigned to this profile",
      });
  });
export const SsoProxyCatalogueSchema = z
  .object({ profiles: z.array(SsoProxyProfileSchema).max(32) })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.profiles.map((p) => p.key)).size !== v.profiles.length)
      ctx.addIssue({
        code: "custom",
        path: ["profiles"],
        message: "Proxy profile keys must be unique",
      });
    if (new Set(v.profiles.flatMap((profile) => profile.scopeKeys)).size > 256)
      ctx.addIssue({
        code: "custom",
        path: ["profiles"],
        message: "A catalogue supports at most 256 distinct assigned scopes",
      });
    const required = v.profiles.flatMap((p) =>
      p.enabled ? p.requiredScopeKeys : [],
    );
    if (new Set(required).size !== required.length)
      ctx.addIssue({
        code: "custom",
        path: ["profiles"],
        message: "A scope can require only one proxy profile",
      });
  });
export const ConfigSsoConnectionSchema = z
  .object({
    connection: SsoConnectionSelectionSchema,
    providerKey: key.optional(),
    ownershipMode: z
      .enum(["manual", "config_locked", "config_warn"])
      .default("config_locked"),
  })
  .strict();
export const ConfigSsoConnectionFileSchema = z
  .object({ ssoConnection: ConfigSsoConnectionSchema })
  .strict();
export const ConfigSsoProxyCatalogueFileSchema = z
  .object({
    ssoProxyCatalogue: SsoProxyCatalogueSchema.safeExtend({
      ownershipMode: z
        .enum(["manual", "config_locked", "config_warn"])
        .default("config_locked"),
    }),
  })
  .strict();
export const SsoConnectionUpdateSchema = z
  .object({
    connection: SsoConnectionSelectionSchema,
    expectedVersion: z.string().min(1).max(128),
    providerKey: key.optional(),
  })
  .strict();
export const SsoConnectionTestSchema = z
  .object({ connection: SsoConnectionSelectionSchema, providerKey: key })
  .strict();
export const SsoProxyCatalogueUpdateSchema = z
  .object({
    catalogue: SsoProxyCatalogueSchema,
    expectedVersion: z.string().min(1).max(128),
  })
  .strict();
export type SsoConnectionSelection = z.infer<
  typeof SsoConnectionSelectionSchema
>;
export type SsoProxyProfile = z.infer<typeof SsoProxyProfileSchema>;
export type SsoProxyCatalogue = z.infer<typeof SsoProxyCatalogueSchema>;
export type SsoConfigurationOwnership = {
  ownershipMode: "manual" | "config_locked" | "config_warn";
  sourceRef: string | null;
  driftStatus: "in_sync" | "drifted" | null;
};
export type SsoConnectionView = {
  connection: SsoConnectionSelection | null;
  profiles: Array<Pick<SsoProxyProfile, "key" | "displayName" | "enabled">>;
  requiredProxyProfileKey: string | null;
  version: string;
  ownership: SsoConfigurationOwnership;
  lastTest: {
    at: number;
    providerKey: string;
    version: string;
    runtimeKey: string;
  } | null;
};
export type SsoConnectionTestResult = {
  success: true;
  version: string;
  runtimeKey: string;
  testedAt: number;
  stages: string[];
  message: string;
};

export const SsoConfigurationOwnershipSchema = z
  .object({
    ownershipMode: z.enum(["manual", "config_locked", "config_warn"]),
    sourceRef: z.string().nullable(),
    driftStatus: z.enum(["in_sync", "drifted"]).nullable(),
  })
  .strict();
export const SsoConnectionViewSchema = z
  .object({
    connection: SsoConnectionSelectionSchema.nullable(),
    profiles: z.array(
      z.object({ key, displayName: z.string(), enabled: z.boolean() }).strict(),
    ),
    requiredProxyProfileKey: key.nullable(),
    version: z.string(),
    ownership: SsoConfigurationOwnershipSchema,
    lastTest: z
      .object({
        at: z.number(),
        providerKey: z.string(),
        version: z.string(),
        runtimeKey: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const SsoConnectionTestResultSchema = z
  .object({
    success: z.literal(true),
    version: z.string(),
    runtimeKey: z.string(),
    testedAt: z.number(),
    stages: z.array(z.string()),
    message: z.string(),
  })
  .strict();
export const SsoProxyCatalogueViewSchema = z
  .object({
    catalogue: SsoProxyCatalogueSchema,
    version: z.string(),
    ownership: SsoConfigurationOwnershipSchema,
  })
  .strict();
