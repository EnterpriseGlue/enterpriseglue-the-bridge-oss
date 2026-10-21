import React, { useEffect, useState } from "react";
import {
  Button,
  InlineNotification,
  Select,
  SelectItem,
  SkeletonText,
  TextInput,
  NumberInput,
  Toggle,
  Tile,
} from "@carbon/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../../shared/api/client";
import { parseApiError } from "../../../shared/api/apiErrorUtils";
import type {
  SsoConnectionView,
  SsoConnectionSelection,
  SsoConnectionTestResult,
  SsoProxyProfile,
  SsoProxyCatalogue,
  SsoConfigurationOwnership,
} from "@enterpriseglue/shared/schemas/platform-admin/sso-connection.js";

type CatalogueView = {
  catalogue: SsoProxyCatalogue;
  version: string;
  ownership: SsoConfigurationOwnership;
};
interface Props {
  tenantAdminMode: boolean;
  tenantId: string | null;
  canRead: boolean;
  canManage: boolean;
  providers: Array<{
    key: string;
    displayName: string;
    protocol: string;
    authenticationMode: string;
  }>;
}
const blankProfile = (): SsoProxyProfile => ({
  key: "",
  displayName: "",
  host: "",
  port: 8090,
  enabled: true,
  scopeKeys: ["platform"],
  requiredScopeKeys: [],
  allowedIdentityProviderHosts: ["login.microsoftonline.com"],
  allowPrivateProxy: false,
});

export default function SsoConnectionSettings({
  tenantAdminMode,
  tenantId,
  canRead,
  canManage,
  providers,
}: Props) {
  const client = useQueryClient();
  const queryKey = ["sso-connection", tenantAdminMode, tenantId];
  const query = useQuery({
    queryKey,
    queryFn: () =>
      apiClient.get<SsoConnectionView>("/api/identity/sso-connection"),
    enabled: canRead,
    retry: false,
  });
  const [choice, setChoice] = useState(""),
    [providerKey, setProviderKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null),
    [test, setTest] = useState<SsoConnectionTestResult | null>(null);
  const current = query.data,
    oidcProviders = providers.filter(
      (p) => p.protocol === "oidc" && p.authenticationMode === "direct",
    );
  useEffect(() => {
    setChoice(
      current?.connection?.mode === "proxy"
        ? `proxy:${current.connection.proxyProfileKey}`
        : current?.connection?.mode === "direct"
          ? "direct"
          : "",
    );
    setTest(null);
  }, [current?.version]);
  const selection: SsoConnectionSelection =
    choice === "direct"
      ? { mode: "direct" }
      : { mode: "proxy", proxyProfileKey: choice.replace(/^proxy:/, "") };
  const locked =
    !canManage || current?.ownership.ownershipMode === "config_locked";
  const required = current?.requiredProxyProfileKey;
  async function run(save: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (save) {
        await apiClient.put("/api/identity/sso-connection", {
          connection: selection,
          expectedVersion: current!.version,
          ...(providerKey ? { providerKey } : {}),
        });
        await client.invalidateQueries({ queryKey });
        setMessage(
          "SSO connection activated. Complete a real sign-in to verify MFA and permissions.",
        );
      } else {
        setTest(null);
        const result = await apiClient.post<SsoConnectionTestResult>(
          "/api/identity/sso-connection/test",
          { connection: selection, providerKey },
        );
        setTest(result);
        setMessage(result.message);
      }
    } catch (e) {
      setError(
        parseApiError(e).message || "The SSO connection could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!canRead) return null;
  return (
    <Tile style={{ marginBottom: "var(--spacing-5)" }}>
      <h3>SSO connection</h3>
      <p>
        Choose how EnterpriseGlue reaches your identity provider. This affects
        backend OIDC requests only. Engine, Git and browser traffic keep their
        own connections.
      </p>
      {query.isPending ? (
        <SkeletonText />
      ) : query.isError ? (
        <InlineNotification
          kind="error"
          title="SSO connection unavailable"
          subtitle="Reload to try again."
          hideCloseButton
        />
      ) : (
        <>
          {!current?.connection && (
            <InlineNotification
              kind="info"
              title="Existing deployment routing"
              subtitle="This organization has not migrated to an explicit SSO connection. Existing runtime settings still apply."
              hideCloseButton
            />
          )}
          {current?.ownership.sourceRef && (
            <p>
              Configuration source: {current.ownership.sourceRef}.{" "}
              {current.ownership.ownershipMode === "config_locked"
                ? "Locked by headless configuration."
                : current.ownership.driftStatus === "drifted"
                  ? "The portal value differs from its configuration source."
                  : "Portal edits are tracked as configuration drift."}
            </p>
          )}
          {required && (
            <p>
              Operations requires proxy profile:{" "}
              {current?.profiles.find((p) => p.key === required)?.displayName ||
                required}
              .
            </p>
          )}
          <Select
            id="sso-connection-choice"
            labelText="Connection"
            value={choice}
            disabled={locked || busy}
            onChange={(e) => {
              setChoice(e.target.value);
              setTest(null);
              setMessage(null);
            }}
          >
            <SelectItem value="" text="Select a connection" disabled />
            <SelectItem
              value="direct"
              text="Direct"
              disabled={Boolean(required)}
            />
            {current?.profiles.map((p) => (
              <SelectItem
                key={p.key}
                value={`proxy:${p.key}`}
                text={`Use proxy: ${p.displayName}${p.enabled ? "" : " (disabled)"}`}
                disabled={!p.enabled || Boolean(required && required !== p.key)}
              />
            ))}
          </Select>
          <Select
            id="sso-connection-provider"
            labelText="OIDC provider for connection test"
            value={providerKey}
            disabled={busy}
            onChange={(e) => {
              setProviderKey(e.target.value);
              setTest(null);
            }}
          >
            <SelectItem value="" text="Select an OIDC provider" />
            {oidcProviders.map((p) => (
              <SelectItem key={p.key} value={p.key} text={p.displayName} />
            ))}
          </Select>
          {!oidcProviders.length && (
            <p>Add a direct OIDC provider before testing a proxy connection.</p>
          )}
          <div
            style={{
              display: "flex",
              gap: "var(--spacing-3)",
              marginTop: "var(--spacing-4)",
            }}
          >
            <Button
              kind="secondary"
              disabled={!canManage || busy || !choice || !providerKey}
              onClick={() => void run(false)}
            >
              Test connection
            </Button>
            <Button
              disabled={
                locked ||
                busy ||
                !choice ||
                (choice !== "direct" && (!test || !providerKey))
              }
              onClick={() => void run(true)}
            >
              Activate connection
            </Button>
          </div>
          {test && (
            <p>
              Passed: {test.stages.join(", ")}. Tested{" "}
              {new Date(test.testedAt).toLocaleString()}.
            </p>
          )}
          {current?.lastTest && (
            <p>
              Active connection last tested{" "}
              {new Date(current.lastTest.at).toLocaleString()} with{" "}
              {current.lastTest.providerKey}.
            </p>
          )}
        </>
      )}
      {error && (
        <InlineNotification
          kind="error"
          title="SSO connection failed"
          subtitle={error}
          hideCloseButton
        />
      )}
      {message && (
        <InlineNotification
          kind="success"
          title="SSO connection"
          subtitle={message}
          hideCloseButton
        />
      )}
      {!tenantAdminMode && canManage && <ProxyCatalogueEditor />}
    </Tile>
  );
}

function ProxyCatalogueEditor() {
  const query = useQuery({
    queryKey: ["sso-proxy-catalogue"],
    queryFn: () =>
      apiClient.get<CatalogueView>("/api/identity/sso-proxy-catalogue"),
    retry: false,
  });
  const client = useQueryClient();
  const [editing, setEditing] = useState<SsoProxyProfile | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const locked = query.data?.ownership.ownershipMode === "config_locked";
  async function save() {
    if (!editing || !query.data) return;
    setBusy(true);
    setError(null);
    try {
      const existing = query.data.catalogue.profiles;
      const profiles = existing.some((p) => p.key === editing.key)
        ? existing.map((p) => (p.key === editing.key ? editing : p))
        : [...existing, editing];
      await apiClient.put("/api/identity/sso-proxy-catalogue", {
        catalogue: { profiles },
        expectedVersion: query.data.version,
      });
      setEditing(null);
      await client.invalidateQueries({ queryKey: ["sso-proxy-catalogue"] });
      await client.invalidateQueries({ queryKey: ["sso-connection"] });
    } catch (e) {
      setError(parseApiError(e).message || "Proxy profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  if (query.isError)
    return (
      <p>
        Proxy profiles are approved through platform-scoped administration.
        Tenant administrators can select only assigned profiles.
      </p>
    );
  return (
    <section style={{ marginTop: "var(--spacing-6)" }}>
      <h4>Approved SSO proxy profiles</h4>
      <p>
        Platform operators approve endpoints and assign profiles to
        organizations. A private proxy also needs network access from the
        serving runtime. Proxy failure never falls back to Direct.
      </p>
      {locked && <p>These profiles are locked by headless configuration.</p>}
      {query.data?.catalogue.profiles.map((p) => (
        <div key={p.key} style={{ marginBlock: "var(--spacing-3)" }}>
          <strong>{p.displayName}</strong> — {p.host}:{p.port}{" "}
          <Button
            kind="ghost"
            size="sm"
            disabled={locked || busy}
            onClick={() => setEditing(p)}
          >
            Edit {p.displayName}
          </Button>
        </div>
      ))}
      {!editing ? (
        <Button
          kind="tertiary"
          disabled={locked || busy || !query.data}
          onClick={() => setEditing(blankProfile())}
        >
          Add proxy profile
        </Button>
      ) : (
        <div>
          <TextInput
            id="sso-proxy-key"
            labelText="Profile key"
            value={editing.key}
            disabled={
              locked ||
              query.data?.catalogue.profiles.some((p) => p.key === editing.key)
            }
            onChange={(e) => setEditing({ ...editing, key: e.target.value })}
          />
          <TextInput
            id="sso-proxy-name"
            labelText="Profile name"
            value={editing.displayName}
            onChange={(e) =>
              setEditing({ ...editing, displayName: e.target.value })
            }
          />
          <TextInput
            id="sso-proxy-host"
            labelText="Proxy hostname"
            helperText="Enter the approved hostname without a scheme or path."
            value={editing.host}
            onChange={(e) => setEditing({ ...editing, host: e.target.value })}
          />
          <NumberInput
            id="sso-proxy-port"
            label="Proxy port"
            min={1}
            max={65535}
            value={editing.port}
            onChange={(_e, { value }) =>
              setEditing({ ...editing, port: Number(value) })
            }
          />
          <TextInput
            id="sso-proxy-scopes"
            labelText="Assigned organization scopes"
            helperText="Comma-separated tenant IDs, or platform for platform sign-in and a single-tenant installation."
            value={editing.scopeKeys.join(",")}
            onChange={(e) =>
              setEditing({
                ...editing,
                scopeKeys: e.target.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          />
          <TextInput
            id="sso-proxy-required"
            labelText="Scopes required to use this proxy"
            helperText="Optional subset of assigned scopes. Requiring a proxy affects sign-in immediately; configure and test the connection first."
            value={editing.requiredScopeKeys.join(",")}
            onChange={(e) =>
              setEditing({
                ...editing,
                requiredScopeKeys: e.target.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          />
          <TextInput
            id="sso-proxy-targets"
            labelText="Approved identity-provider hostnames"
            value={editing.allowedIdentityProviderHosts.join(",")}
            onChange={(e) =>
              setEditing({
                ...editing,
                allowedIdentityProviderHosts: e.target.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          />
          <Toggle
            id="sso-proxy-private"
            labelText="Private proxy address approval"
            labelA="Public addresses only"
            labelB="Approved private network"
            toggled={editing.allowPrivateProxy}
            onToggle={(value) =>
              setEditing({ ...editing, allowPrivateProxy: value })
            }
          />
          <TextInput
            id="sso-proxy-ca"
            labelText="Additional trusted CA reference (optional)"
            helperText="An approved env://, file:// or docker:// certificate reference for this SSO connection."
            value={editing.caCertificateRef || ""}
            onChange={(e) =>
              setEditing({
                ...editing,
                caCertificateRef: e.target.value || undefined,
              })
            }
          />
          <Toggle
            id="sso-proxy-enabled"
            labelText="Profile status"
            labelA="Disabled"
            labelB="Enabled"
            toggled={editing.enabled}
            onToggle={(value) => setEditing({ ...editing, enabled: value })}
          />
          <Button disabled={busy || locked} onClick={() => void save()}>
            Save approved profile
          </Button>
          <Button kind="ghost" disabled={busy} onClick={() => setEditing(null)}>
            Cancel
          </Button>
        </div>
      )}
      {error && (
        <InlineNotification
          kind="error"
          title="Proxy profile not saved"
          subtitle={error}
          hideCloseButton
        />
      )}
    </section>
  );
}
