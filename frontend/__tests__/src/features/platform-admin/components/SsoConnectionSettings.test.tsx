import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import SsoConnectionSettings from "@src/features/platform-admin/components/SsoConnectionSettings";
import { server } from "../../../../../test/mocks/server";

const tenant = "11111111-1111-4111-8111-111111111111";
let view: any,
  put: ReturnType<typeof vi.fn<(payload: unknown) => void>>,
  test: ReturnType<typeof vi.fn<(payload: unknown) => void>>;
function renderSettings(overrides = {}) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SsoConnectionSettings
        tenantAdminMode
        tenantId={tenant}
        canRead
        canManage
        providers={[
          {
            key: "entra",
            displayName: "Entra ID",
            protocol: "oidc",
            authenticationMode: "direct",
          },
        ]}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  window.history.replaceState({}, "", "/admin/settings/identity-providers");
  view = {
    connection: { mode: "direct" },
    profiles: [
      { key: "corporate", displayName: "Corporate proxy", enabled: true },
    ],
    requiredProxyProfileKey: null,
    version: "v1",
    ownership: { ownershipMode: "manual", sourceRef: null, driftStatus: null },
    lastTest: null,
  };
  put = vi.fn();
  test = vi.fn();
  server.use(
    http.get("/api/identity/sso-connection", () => HttpResponse.json(view)),
    http.put("/api/identity/sso-connection", async ({ request }) => {
      put(await request.json());
      return HttpResponse.json(view);
    }),
    http.post("/api/identity/sso-connection/test", async ({ request }) => {
      test(await request.json());
      return HttpResponse.json({
        success: true,
        version: "v1",
        runtimeKey: "runtime",
        testedAt: Date.now(),
        stages: ["proxy_dns_tcp", "connect_tls", "discovery", "signing_keys"],
        message: "Network checks passed. Complete a real sign-in.",
      });
    }),
  );
});
describe("SSO connection settings", () => {
  it("shows assigned profiles and activates only after a successful draft test", async () => {
    renderSettings();
    fireEvent.change(await screen.findByLabelText("Connection"), {
      target: { value: "proxy:corporate" },
    });
    expect(
      screen.getByRole("button", { name: "Activate connection" }),
    ).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText("OIDC provider for connection test"),
      { target: { value: "entra" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Activate connection" }),
      ).toBeEnabled(),
    );
    expect(put).not.toHaveBeenCalled();
    expect(test).toHaveBeenCalledWith({
      connection: { mode: "proxy", proxyProfileKey: "corporate" },
      providerKey: "entra",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Activate connection" }),
    );
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith({
        connection: { mode: "proxy", proxyProfileKey: "corporate" },
        expectedVersion: "v1",
        providerKey: "entra",
      }),
    );
    expect(screen.queryByLabelText("Proxy hostname")).not.toBeInTheDocument();
  });
  it("keeps an unsuccessful draft inactive and removes old passing evidence", async () => {
    renderSettings();
    fireEvent.change(await screen.findByLabelText("Connection"), {
      target: { value: "proxy:corporate" },
    });
    fireEvent.change(
      screen.getByLabelText("OIDC provider for connection test"),
      { target: { value: "entra" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Activate connection" }),
      ).toBeEnabled(),
    );
    server.use(
      http.post("/api/identity/sso-connection/test", () =>
        HttpResponse.json({ error: "CONNECT/TLS failed" }, { status: 400 }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText("CONNECT/TLS failed");
    expect(
      screen.getByRole("button", { name: "Activate connection" }),
    ).toBeDisabled();
    expect(put).not.toHaveBeenCalled();
  });
  it("distinguishes legacy routing from Direct and allows a deliberate migration", async () => {
    view.connection = null;
    renderSettings();
    await screen.findByText("Existing deployment routing");
    fireEvent.change(screen.getByLabelText("Connection"), {
      target: { value: "direct" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Activate connection" }),
    );
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith({
        connection: { mode: "direct" },
        expectedVersion: "v1",
      }),
    );
  });
  it("renders headless locks and operator-required routing", async () => {
    view.connection = { mode: "proxy", proxyProfileKey: "corporate" };
    view.requiredProxyProfileKey = "corporate";
    view.ownership = {
      ownershipMode: "config_locked",
      sourceRef: "config_bundle:company",
      driftStatus: "in_sync",
    };
    renderSettings();
    expect(await screen.findByLabelText("Connection")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Activate connection" }),
    ).toBeDisabled();
    expect(screen.getByText(/Locked by headless/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Direct" })).toBeDisabled();
  });
  it("does not load or render settings without the read permission", () => {
    renderSettings({ canRead: false, canManage: false });
    expect(screen.queryByText("SSO connection")).not.toBeInTheDocument();
  });
  it("keeps read-only administrator controls disabled", async () => {
    renderSettings({ canManage: false });
    expect(await screen.findByLabelText("Connection")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Test connection" }),
    ).toBeDisabled();
  });
  it('lets a platform operator approve and assign a profile through the UI',async()=>{
    let saved:any;
    server.use(http.get('/api/identity/sso-proxy-catalogue',()=>HttpResponse.json({catalogue:{profiles:[]},version:'catalogue-v1',ownership:{ownershipMode:'manual',sourceRef:null,driftStatus:null}})),http.put('/api/identity/sso-proxy-catalogue',async({request})=>{saved=await request.json();return HttpResponse.json({});}));
    renderSettings({tenantAdminMode:false,tenantId:null});
    const add=await screen.findByRole('button',{name:'Add proxy profile'});
    await waitFor(()=>expect(add).toBeEnabled());fireEvent.click(add);
    fireEvent.change(screen.getByLabelText('Profile key'),{target:{value:'corporate'}});
    fireEvent.change(screen.getByLabelText('Profile name'),{target:{value:'Corporate proxy'}});
    fireEvent.change(screen.getByLabelText('Proxy hostname'),{target:{value:'proxy.example.net'}});
    fireEvent.change(screen.getByLabelText('Assigned organization scopes'),{target:{value:tenant}});
    fireEvent.click(screen.getByRole('button',{name:'Save approved profile'}));
    await waitFor(()=>expect(saved).toMatchObject({expectedVersion:'catalogue-v1',catalogue:{profiles:[{key:'corporate',host:'proxy.example.net',port:8090,scopeKeys:[tenant],allowedIdentityProviderHosts:['login.microsoftonline.com']}]}}));
  });
  it('loads the tenant selection through the canonical scoped URL',async()=>{
    window.history.replaceState({},'','/t/acme/admin/settings/identity-providers');
    const scoped=vi.fn();
    server.use(http.get('/api/t/acme/identity/sso-connection',()=>{scoped();return HttpResponse.json(view);}));
    renderSettings();await screen.findByLabelText('Connection');expect(scoped).toHaveBeenCalledOnce();
  });

});
