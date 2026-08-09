# Identity and access UI evidence report

Date: 2026-07-31

Environment: local Docker deployment at `http://localhost:5173` and `https://localhost:5443`, with the backend at `http://localhost:8787`, containerized Keycloak, and the Operaton-compatible runtime fixture
Evidence directory: `test/results/manual-ui-screenshots/2026-07-26`

## Outcome

The reviewed sign-in, identity-provider, identity-mapping, access-control, engine-governance, configuration-ownership, and responsive flows are implemented and green in the local browser suite.

The final content and visual pass also corrected:

- repeated outcome wording in Effective Access notifications;
- raw `config_bundle:` prefixes in configuration-owned provider and mapping instructions;
- technical-only identities in the manual group-member removal confirmation;
- ambiguous provider disable, saved-membership application, and mapping-removal consequences;
- technical labels for membership-update modes, provider refresh, engine governance, and sidecar peer authentication;
- config-managed menus that appeared editable;
- truncated identity-provider action labels caused by Carbon's default menu-item width;
- technical-only provider, group, engine, and assignment labels where friendly names should be primary;
- incompatible Effective Access resource-type and permission combinations;
- stale and duplicate screenshot artifacts.

## Verification results

| Gate | Result | Coverage |
|---|---:|---|
| Full-gallery copy review | 87/87 passed | Headings, helper text, statuses, notifications, actions, terminology, and friendly-name hierarchy |
| Full-gallery Carbon UX review | 87/87 passed | Alignment, spacing, hierarchy, action placement, menus, focus, responsive behavior, ownership states, and flow coherence |
| Final Chromium gallery and flow suite | 35/35 passed | Direct grants, resource-type policies, principal variants, Carbon gallery, keyboard/zoom/narrow behavior, configuration ownership, membership modes, saved-data partial application, redacted failures, identity configuration lifecycle, all four mapping access targets, recovery, and sign-in chooser states |
| Live local OIDC and scoped-access rehearsal | 3/3 passed | Configuration-managed OIDC, real Keycloak redirect/callback, sign-in reconciliation, independent add/revoke/restore rights, conflict unlink/relink, sibling denial, and Operaton-scoped engine access |
| Focused frontend unit tests | 140/140 passed | Identity providers, identity mappings, login policy, groups, role assignments, resource policies, role library, engine governance, and scoped engine inventory |
| Final identity-provider unit recheck | 20/20 passed | Provider display copy, sign-in policy, configuration ownership, membership refresh actions, and complete overflow-menu labels |
| Authorization lane structure tests | 32/32 passed | Local OIDC/SAML/LDAP runners, recovery-login setup, CI wiring, local-only guards, and focused authorization lane composition |
| Operaton-compatible runtime fixture tests | 4/4 passed | Version/health metadata, authorization grants, deployments, and variable round-trip behavior |
| Frontend and frontend-host TypeScript checks | Passed | Final source state |
| Documentation contract tests | 14/14 passed | SSO, authorization, engine registration, and headless configuration contracts |
| Production frontend build | Passed | Optimized application bundle |
| Production frontend Docker image | Passed | Image used by the local evidence deployment |
| Integrity and local readiness | Passed | Shell syntax, `git diff --check`, 87 unique screenshots, frontend reachability, backend health, and local Keycloak discovery |

The production build reports the existing Vite large-chunk advisory for the shared vendor bundle. It is non-blocking and unrelated to these identity/access changes.

## Evidence coverage

| Area | Representative screenshots | What the evidence proves |
|---|---|---|
| User and role administration | `02`–`17`, `31`, `38`, `39`, `58`, `76`, `82`, `83` | Platform versus scoped access, custom/system roles, variable permissions, direct assignments, groups, policies, compatible Effective Access selection, human-readable removal confirmation |
| Sign-in behavior | `62`–`72` | One-provider redirect, multiple-provider chooser, local-plus-SSO policy, administrator recovery, no-method and fail-closed states, redirect transition, long-label handling |
| Provider administration | `18`–`21`, `42`, `42a`, `44`–`52`, `55`, `57`, `77`, `79`, `80`, `85` | OIDC/SAML/LDAP forms, display names, connection results, redaction, refresh history, saved-data preview/application, conflict unlink, disable consequences, configuration ownership, partial continuation |
| Identity mappings | `22`–`28`, `32`–`37`, `41`, `43`, `43a`, `54`, `56`, `78`, `81`, `84` | Three-step flow, existing/new group choices, group-only versus scoped access, engine/engine-set/runtime-resource/runtime-resource-set targets, previews, delete/disable effects, config ownership, match-provider versus add-only |
| Engine governance | `29`, `30`, `40`, `74`, `75` | Registration ownership, access ownership, runtime enforcement, EnterpriseGlue-only and mirrored-backstop modes, peer-authenticated customer sidecars, engine-name presentation, zoom and narrow reflow |
| Accessibility and responsive behavior | `60`, `73`–`76` | 200% zoom, reduced motion, keyboard operation, narrow viewport behavior, permission dependency wrapping |
| Local lifecycle proof | `48`, `61`, `61a` | Configuration apply in context, containerized Keycloak OIDC sign-in/configuration, mandatory sign-in reconciliation, and connected Operaton-scoped mapping setup |

## Newly gathered evidence

| File | Scenario |
|---|---|
| `77-apply-saved-membership-data-confirmation.jpg` | Explicit confirmation that saved provider data changes access immediately without contacting the provider |
| `78-mapping-delete-access-impact.jpg` | Mapping-only membership removal while manual and other-provider membership remains |
| `79-provider-disabled.jpg` | Provider sign-in status is Disabled rather than incorrectly described as Archived |
| `80-provider-configuration-linked.jpg` | Locally editable, configuration-linked provider state |
| `81-mapping-configuration-linked.jpg` | Locally editable, configuration-linked mapping state |
| `82-effective-access-no-compatible-permissions.jpg` | Resource type and permission compatibility is enforced |
| `83-group-member-removal-human-labels.jpg` | Name and email are primary; immutable user ID is secondary |
| `84-mapping-membership-update-modes.jpg` | Match-provider and add-only behavior shown together |
| `85-saved-membership-application-partial.jpg` | Partial saved-data application reports counts, failure, immediate effect, and continuation |

The final screenshot refresh also verifies that identity-provider menus open
within the viewport and show every applicable action label in full.
Configuration-owned rows omit local disable actions, while partial saved-data
states use a clear continuation action.

## Screenshot integrity

- 87 screenshot files are present and have unique SHA-256 content.
- 82 normal desktop captures use the agreed MacBook-style `1440 × 900` viewport.
- Two `1280 × 900` captures intentionally show 200% zoom.
- Two `768 × 900` captures and one `390 × 844` capture intentionally show narrow responsive behavior.
- The stale `53-provider-connection-failure.jpg` duplicate was removed.
- The obsolete `57-provider-archive-confirmation.jpg` was replaced by `57-provider-disable-confirmation.jpg`.

## Scope boundary

The browser-local identity stack proves deterministic UI states, while the containerized Keycloak lane proves the redirect, callback, mandatory sign-in reconciliation, access changes, and scoped authorization against the real local backend. Real customer tenant credentials and production IdP availability remain deployment evidence, not a prerequisite for the local implementation gates documented here.

No branch was pushed or merged as part of this evidence pass.
