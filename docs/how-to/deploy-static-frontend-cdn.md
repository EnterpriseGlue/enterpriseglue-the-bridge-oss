---
doc_class: technical
audience: operator
publication: github
lifecycle: reference
---

# Deploy a static frontend with a CDN

Summary: Serve the EnterpriseGlue frontend from static hosting while keeping authenticated APIs
and installed plugin assets on the containerized backend under one public origin.

Audience: Deployment administrators and platform operators.

The browser uses relative URLs. The CDN or edge router must therefore present one public origin and
send `/_enterpriseglue/plugins/*`, `/t/*/_enterpriseglue/plugins/*`, APIs, health endpoints, cookies, query strings, and required
forwarding headers to the backend. All other paths use the static frontend, with `/index.html` as
the final client-side-routing fallback.

## Routing contract

Install the ordered contract in `infra/cdn/plugin-routing/routing-contract.json`. Provider examples
for Nginx, CloudFront, Azure Front Door, and Cloudflare Workers live beside it. They are fragments:
replace origin identifiers and policy IDs, retain HTTPS, and merge them into the customer-owned
distribution.

The important order is:

1. `/_enterpriseglue/plugins/*` to the backend. Honor immutable success headers but use zero
   negative/error caching. Route `/t/*/_enterpriseglue/plugins/*` to the backend
   with caching disabled, preserving the entire tenant prefix.
2. Plugin operation routes to the backend with buffering disabled and a timeout suitable for SSE.
3. Tenant and non-tenant API, engine, Mission Control, Git, and public health routes to the backend
   with caching disabled. Keep readiness and metrics on the private operator network.
4. Hashed `/assets/*` to static storage with immutable caching.
5. Every remaining browser route to static storage, falling back to `/index.html` with revalidation.

Do not rewrite a missing plugin asset to `/index.html`. The plugin loader requires the backend's
JSON 404 to distinguish an unavailable or disabled plugin from a valid JavaScript module.

On a canonical tenant page, the host first validates the bootstrap's root entry
URL against the plugin manifest and then imports through `/t/{slug}`. A
placement-aware edge can select that tenant's current assigned release instead
of its default static shard. Self-hosted Nginx/Vite and the backend accept the
same alias. Both asset routes expose only the existing public, digest-verified
installed entry file; neither authorizes tenant data, plugin operations or
activation. The bootstrap protocol and signed manifest do not change.

The tenant alias uses `Cache-Control: no-store`, including missing-asset
responses. Its release assignment can change, so it is not an immutable URL or
a per-page release pin. Relative URLs retain the tenant prefix, but the host's
existing entry-file allowlist still applies: this routing change does not add
arbitrary or code-split chunk serving. Qualify simultaneous release transitions
separately and keep plugin output within the supported manifest asset contract.

## Preflight

After deploying the route, run the packaged probe against the same public origin customers use:

```bash
./scripts/plugin-deployment-doctor.sh \
  /opt/enterpriseglue/plugin-deployment \
  --route-origin https://enterpriseglue.customer.example
```

The probe requests a deliberately nonexistent plugin asset. Success means the request reached the
backend and returned HTTP 404, `application/json`, and the bounded EnterpriseGlue error contract.
HTTP 200 HTML indicates the CDN applied the SPA fallback too early; a CDN-branded error indicates
the backend origin, TLS, or forwarding policy is incorrect.
This legacy root-path probe alone does not qualify tenant alias or fleet release
routing. Also exercise the actual tenant plugin page, verify a JavaScript
response from its tenant-prefixed asset URL, and check the plugin gateway result
and browser diagnostics. A neutral fleet hostname may intentionally reject root
asset requests that have no tenant routing context.

## Cache and rollback

- Invalidate `/index.html` and any non-hashed shell files on frontend promotion. Hashed `/assets/*`
  may remain immutable.
- Plugin assets are versioned and digest-verified by the backend. Preserve their origin cache
  headers and do not cache authorization or backend error responses.
- Keep the prior static frontend artifact and routing configuration. Roll back both together when a
  frontend release changes its expected host API or plugin SDK compatibility.
- Run the route preflight after every CDN policy, origin, path-order, or SPA rewrite change.
