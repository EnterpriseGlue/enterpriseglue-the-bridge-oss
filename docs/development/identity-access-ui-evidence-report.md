# Identity and access UI evidence report

Original evidence date: 2026-07-31

Carbon login compliance addendum: 2026-08-13

Carbon application-pattern implementation addendum: 2026-08-14

Carbon workflow remediation addendum: 2026-08-14

Environment: local Docker deployment at `http://localhost:5173` and `https://localhost:5443`, with the backend at `http://localhost:8787`, containerized Keycloak, and the Operaton-compatible runtime fixture
Evidence directory: `test/results/manual-ui-screenshots/2026-07-26`

Carbon login evidence environment: the isolated
`fix/carbon-login-pattern-compliance` worktree served at
`http://127.0.0.1:5174`, proxied to the healthy local backend at
`http://localhost:8787`
Carbon login evidence directory:
`test/results/manual-ui-screenshots/2026-08-13-carbon-login-header`

## Carbon login pattern compliance addendum

The login experience was reviewed against the Carbon login pattern updated on
12 August 2026. The implementation now follows the pattern in each applicable
area while retaining EnterpriseGlue's policy-resolved SSO modes.

| Carbon requirement | Result | EnterpriseGlue implementation |
|---|---:|---|
| Use “Log in” consistently | Passed | Page title, H1, form actions, recovery flow, provider transitions, errors, and browser title use “Log in” or “login” rather than “Sign in” |
| Keep product branding in the application shell | Passed | The public login route reuses the authenticated application's Carbon `Header` and `HeaderName`, including configured header logo, title, font, scale, and offset; branding is not repeated inside the login panel |
| Prefer progressive authentication | Passed | Progressive policy begins with work email and `Continue`, then routes to one provider, a same-domain provider choice, or the local password step without disclosing account existence |
| Support separate authentication methods when background selection is unavailable | Passed | Policy-resolved chooser and local-plus-SSO states use Carbon buttons; the preferred or only SSO path has primary hierarchy and alternatives remain secondary |
| Keep the primary action adjacent to its input | Passed | Default Carbon inputs and buttons remain in one column; provider actions never interrupt the email/password pair |
| Validate client input inline | Passed | Required and email-format errors appear below fields on blur or action and disappear as the user corrects the value |
| Recover safely from server errors | Passed | A Carbon inline notification presents the failure, the password is cleared, and focus returns to the email or directory username field |
| Use Carbon components | Passed | `Header`, `HeaderName`, `Theme`, `TextInput`, `PasswordInput`, `Button`, `Link`, `InlineNotification`, `ActionableNotification`, `Loading`, and `InlineLoading` provide native Carbon states and behavior |
| Preserve readable identity information | Passed | Provider display names and organizations wrap in full rather than using configuration keys or truncation |
| Support centered/default-component layout | Passed | The single-column form uses the Carbon grid rhythm in a distraction-free centered panel and becomes a full-width surface at narrow viewports |
| Keyboard and screen-reader access | Passed | A named application banner and `main`, visible H1, ordered headings, decorative logo treatment, native header/link/form tab stops, Enter/Space activation, field focus recovery, and live status/error components cover the login region |
| Zoom, reflow, and motion preferences | Passed | No viewport overflow at 200% zoom or 320 CSS pixels; the key flows remain operable with reduced motion requested |

The chooser mode is intentionally retained because Carbon explicitly permits
separate authentication buttons when the correct path cannot be determined in
the background. Progressive mode remains the preferred policy and does not
expose whether a particular account exists.

### Addendum verification

| Gate | Result | Coverage |
|---|---:|---|
| Focused login unit tests | 18/18 passed | Carbon semantics and links, local and LDAP submission, progressive discovery, field validation, branded title, policy failures, password clearing, and focus recovery |
| Chromium login gallery | 12/12 passed | Single/multiple provider, progressive, LDAP, local-plus-SSO, recovery, fail-closed, redirect, long content, 320px reflow, validation/error recovery, keyboard, zoom, and reduced motion |
| Accessibility browser matrix | 6/6 passed | Credential-error recovery and keyboard/zoom/reduced-motion behavior in Chromium, Firefox, and WebKit |
| Frontend-host TypeScript | Passed | Updated component and Carbon polymorphic-link types |
| Release-note preflight | Passed | UI impact and `@enterpriseglue/frontend-host` patch version coverage |
| Screenshot audit | 12/12 passed | Unique `1440 × 900` JPEG captures with no invalid dimensions, duplicates, or suspiciously small artifacts |

The refreshed login evidence is `62`–`72`, plus
`86-login-carbon-error-recovery.jpg`. Every retained image was visually
inspected for clipping, overlap, incomplete loading, unexpected focus,
off-pattern action hierarchy, and stale content.

## Carbon application-pattern implementation addendum

The follow-up implementation extends the login work across the authenticated
shell, Platform Settings, identity administration, and the complete public
authentication route family. Evidence was captured from the isolated
`fix/carbon-login-pattern-compliance` worktree at `http://127.0.0.1:5174`.

| Pattern area | Result | Implemented behavior |
|---|---:|---|
| Responsive global navigation | Passed | The existing Voyager and Admin menu hierarchy remains horizontal on desktop and is mirrored into a Carbon child side navigation below the large breakpoint. Menu visibility uses the same permission and extension data in both renderings, and OSS omits Enterprise when no enterprise extension items exist. |
| Skip navigation and focus entry | Passed | A first-focus Carbon skip link targets `#main-content`. The destination is a programmatically focusable `main`, and client-side route changes close the mobile navigation and focus the new page H1 after lazy route content is available. Programmatic H1 focus is announced without adding a persistent visual outline. |
| Header semantics | Passed | The branded shell is exposed as a named Carbon banner; branding images are decorative, navigation has a distinct accessible name, and changing the semantics does not change the desktop visual composition. |
| Settings information architecture | Passed | Flat tabs were replaced by grouped local navigation: Platform, Identity and access, Operations, Communications, and Audit. Desktop keeps the hierarchy visible; narrow layouts use a labelled section selector. Each section has a stable URL. |
| Complex dialogs | Passed | Identity-provider create and edit use a bounded four-step in-page workflow—Identity, Connection, Membership, and Review—with a clear return action, step focus, an internally scrollable body, and a persistent action bar. Destructive/immediate-effect confirmations remain modal. |
| Multistep creation | Passed | Identity-mapping creation presents Identity, Access, and Review as an explicit Carbon progress sequence with Back, Cancel, Continue, and Create mapping actions. Inactive step content is removed from layout and focus order. |
| Public authentication family | Passed | Login, forgot password, password reset, email verification, resend verification, OSS signup guidance, and invitation onboarding use the shared branded Carbon header, skip link, main landmark, panel hierarchy, and inline status treatment. Password requirements remain visible on reset and invitation forms. |
| Responsive Settings content | Passed | The default project-governance selector and actions stack at 390 px. Creation workflows use a compact current-step label, constrained Carbon fields and notifications, and equal-width action columns with no horizontal overflow. |

### Implementation verification

| Gate | Result | Coverage |
|---|---:|---|
| Focused frontend unit tests | 89/89 passed | Header/navigation semantics, OSS menu visibility, Settings routing, provider/mapping workflows, public authentication states, and public-route boundaries |
| Carbon implementation gallery | 4/4 passed | Three desktop scenarios and one responsive scenario covering all changed pattern families |
| Firefox and WebKit implementation gallery | 8/8 passed | All four implementation scenarios repeated in each browser engine |
| Identity accessibility browser suite | 10/10 passed | Keyboard-only navigation, announced errors, 200% zoom, reduced motion, 390px reflow, configuration ownership, and in-page provider workflows |
| Frontend-host TypeScript and production package build | Passed | Final application source and generated package output |
| Screenshot audit | 16/16 passed | Fourteen `1440 × 900` JPEGs and two `390 × 844` JPEGs; no invalid dimensions or suspicious artifacts |

The implementation gallery is stored at
`test/results/manual-ui-screenshots/2026-08-14-carbon-pattern-implementation`.
The desktop set contains `100`–`106` and `110`–`116`; the responsive set
contains `120`–`121`. All 16 retained screenshots were visually inspected for
clipping, overflow, action hierarchy, navigation parity, loading residue,
focus visibility, and stale content.

## Carbon workflow remediation follow-up

The detailed visual follow-up was captured from the isolated
`fix/carbon-login-pattern-compliance` worktree served at
`http://127.0.0.1:5187`. The browser-local identity stack provided
deterministic authentication, permissions, providers, mappings, and groups
without changing the local database. Evidence is stored at
`test/results/manual-ui-screenshots/2026-08-14-carbon-pattern-remediation`.

| Review finding | Result | Remediation |
|---|---:|---|
| Provider fields extended beyond the visible workflow | Fixed | The flat two-column form is now four focused steps in a single 40rem reading column. The workflow uses an explicit `minmax(0, 1fr)` grid column, scroll-safe body, persistent desktop/mobile action bar, and page-level scrolling for short 200% reflow viewports. |
| Completed mapping steps remained in layout | Fixed | Inactive `[hidden]` panels are forced out of layout, each step heading has a unique ID, and focus moves to the active Identity, Access, or Review heading. |
| Narrow screens clipped headings, fields, notifications, and actions | Fixed | Mobile progress collapses to “Step N of M: label”; intrinsic grid widths, Carbon notifications, and form columns are constrained to the workflow; action buttons use equal columns. Browser evidence asserts that no rendered workflow descendant crosses its boundary. |
| Route focus could occur before a lazy page heading mounted | Fixed | Route changes observe the new main content until its H1 exists, then focus it and close the responsive navigation. |
| Header branding could briefly inherit a light-theme foreground | Fixed | Authenticated and public shell brand titles use the dark Carbon header foreground from first paint; the logo and title remain in the header and are not repeated in the authentication panel. |
| Password creation guidance appeared only after failure | Fixed | Reset and invitation flows show persistent requirements and field-specific validation for password strength and confirmation. |
| Review messaging implied success before submission | Fixed | Provider and mapping review steps use low-contrast informational review notices; success is reserved for completed mutations. |

### Remediation verification

| Gate | Result | Coverage |
|---|---:|---|
| Focused frontend regression set | 91/91 passed | Authentication, header/navigation, Settings ownership and routing, provider/mapping workflows, and protected-route boundaries |
| Final provider, mapping, and shell rechecks | 48/48 passed | Four provider steps, three mapping steps, step focus, hidden-panel behavior, public branding, and route focus entry |
| Frontend-host production package build | Passed | Shared package build, TypeScript emit, and copied Carbon assets/styles |
| Chromium remediation gallery | 5/5 passed | Three desktop scenarios, one 390px responsive scenario, and one 200% reflow proxy scenario |
| Narrow workflow overflow assertions | Passed | Identity-provider Identity and Connection steps plus identity-mapping Access step have no rendered descendants outside the workflow boundary |
| Screenshot audit | 24/24 passed | Seventeen `1440 × 900`, five `390 × 844`, and two `720 × 450` JPEGs; no invalid dimensions or suspiciously small files |
| Visual inspection | 24/24 passed | Every retained image checked for clipping, overflow, field/action reachability, stale branding, focus residue, loading residue, and action hierarchy |

The remediation gallery contains:

- `100`–`106`: the complete public-authentication family;
- `110`–`112`: desktop global navigation, skip navigation, and Settings IA;
- `113`–`116`: provider Identity, Connection, Membership, and Review;
- `117`–`119`: mapping Identity, Access, and Review;
- `120`–`124`: 390px navigation, Settings, provider, and mapping evidence;
- `130`–`131`: validation and short-viewport 200% reflow proxies.

### Final Carbon enterprise-pattern evidence

The final pass adds unsaved-change protection, persisted-result evidence,
configuration-owned views, every narrow provider and mapping step, public
password-validation states, atomic header branding, and Carbon sentence case.
It was captured from the active worktree at `http://127.0.0.1:5174` and is
stored in
`test/results/manual-ui-screenshots/2026-08-14-carbon-enterprise-remediation`.

| Gate | Result | Coverage |
|---|---:|---|
| Chromium enterprise-pattern gallery | 7/7 passed | Complete public authentication family, OSS onboarding, password validation, desktop and responsive navigation, Settings IA, provider/mapping workflows, saved results, unsaved exits, configuration ownership, and 200% reflow |
| Identity accessibility suite | 10/10 passed | Announced errors, heading focus entry, validation focus, keyboard operation, reduced motion, narrow overflow prevention, configuration ownership, destructive-action safety, redaction, and sticky-action reachability |
| Provider and mapping unit suite | 36/36 passed | Four-step provider and three-step mapping workflows, local and global unsaved exits, validation, saving, editing, ownership, and mutations |
| Frontend-host TypeScript and package build | Passed | Shared build, strict TypeScript check, production emit, and copied styles/assets |
| Screenshot audit | 36/36 passed | Twenty-three `1440 × 900`, eleven `390 × 844`, and two `720 × 450` JPEGs with valid dimensions and unique content |
| Visual inspection | 36/36 passed | Every image checked for clipping, page or workflow horizontal overflow, field and action reachability, hierarchy, stale loading, branding, focus residue, ownership messaging, and persisted outcomes |

The evidence set contains:

- `100`–`106`: all desktop public-authentication and OSS-onboarding pages;
- `107`–`108`: narrow password-reset and invitation validation;
- `110`–`112`: desktop global navigation, skip focus, and Settings IA;
- `113`–`116a`: all provider steps and the persisted provider result;
- `117`–`119a`: all mapping steps and the persisted mapping result;
- `120`–`124b`: responsive global navigation, Settings selection, and every
  narrow provider and mapping step;
- `125`–`125a`: provider and mapping unsaved-exit confirmation;
- `126`–`127`: configuration-owned provider and mapping views; and
- `130`–`131`: provider validation and mapping access at the 200% reflow
  proxy viewport.

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

## Enterprise identity lifecycle addendum (incremental; superseded below)

The source-aware User management and SCIM provisioning administration pass is
stored at
`test/results/manual-ui-screenshots/2026-08-14-enterprise-identity-lifecycle`.
The final recapture was produced from the rebuilt frontend-host package at
`http://127.0.0.1:5174` after verifying the capture server had reloaded the
compiled package.

| Gate | Result | Coverage |
|---|---:|---|
| Local identity aggregate | 571/571 passed | Identity schemas, auth sessions, providers, routes, entitlement mapping matrix, OIDC/SAML/LDAP protocol harnesses, provisioning contracts, SCIM routes/services, HTTP-to-relational-database E2E, documentation, and Carbon UI |
| Containerized identity rehearsal | 10/10 passed | SCIM HTTP/database (1), OIDC (3), Entra-compatible OIDC (3), signed SAML (1), and direct LDAP reconciliation/login (2) against disposable PostgreSQL, Keycloak, and OpenLDAP services |
| Cross-browser accessibility | 51/51 passed | The same 17 Access Control and Identity Administration scenarios in Chromium, Firefox, and WebKit |
| Authorization layout browser gate | 1/1 passed | Long permission labels remain within the tablet viewport |
| Database adapter matrix | 5/5 passed | PostgreSQL, MySQL, SQL Server, Oracle, and Spanner clean install, upgrade baselines, interrupted retry, schema equivalence, service behavior, rollback, and cleanup |
| Source-aware/provisioning gallery | 2/2 passed | Desktop User directory/detail/lifecycle and provisioning directory/credential/diagnostic states, plus narrow global navigation, Settings, provider, mapping, User, and provisioning states |
| Narrow accessibility recheck | 2/2 passed | Keyboard-reachable user lifecycle and tabs, credential disclosure, diagnostics, and no page/workflow horizontal overflow |
| Focused changed-page unit suite | 24/24 passed | Provisioning settings, User directory/detail, lifecycle audit reason, and confirmation behavior |
| Production package build | Passed | Shared package build, TypeScript emit, and final frontend-host assets |
| Screenshot audit | 23/23 passed | Eleven `1440 × 900` desktop and twelve `390 × 844` narrow JPEGs; correct dimensions, unique content, and no audit issues |
| Visual inspection | 23/23 passed | Navigation/brand stability, source labels, field and action reachability, tab state, audit reason, credential reveal-once state, diagnostics, narrow reflow, clipping, and stale/loading residue |

The desktop evidence contains:

- `140`: source-aware User directory with authentication, provisioning,
  access, sign-in, provisioning-time, and health context;
- `141`–`144`: directory-owned overview, required lifecycle reason, effective
  access lineage, redacted sessions, and audit history;
- `145`–`148`: provisioning overview, create flow, credential inventory,
  reveal-once token, and sanitized diagnostics.

The narrow evidence contains:

- `120`–`124b`: responsive global navigation, Settings selection, and all
  provider/mapping workflow steps; and
- `149`–`150`: responsive User directory/detail and provisioning
  administration without horizontal clipping.

The visual inspection also confirms Carbon sentence case (`User management`,
`Create directory`) and the informational lifecycle callout no longer creates
an alert-dialog focus trap.

### User directory grid and spacing correction

The final User management recapture applies the Carbon 16-column grid to the
page header, lifecycle notice, filter toolbar, and data table. Those regions
now share the same horizontal edges and use a deliberate vertical rhythm:
24 px between the page header, notice, and toolbar; 16 px between the toolbar
and table; and 8 px between stacked authentication tags or a provisioning tag
and its directory key. Every table body cell now has 12 px block padding and is
top-aligned, so both single tags and multi-line stacks remain clear of the row
dividers.

The correction is covered by rendered layout assertions in the Carbon pattern
gallery, including measured edge alignment and spacing for the `Local password`
plus `Recovery` tags and the `SCIM 2.0` plus directory-key presentation.
The same rendered test measures every tag and provisioning label against its
row bounds and requires at least 12 px of clearance above and below.
`140-user-directory-source-aware.jpg` and `149-user-directory-narrow.jpg` were
recaptured from the rebuilt package and passed the screenshot integrity audit
at `1440 × 900` and `390 × 844`. The focused source-aware accessibility case
also passed in Chromium, Firefox, and WebKit (3/3).

The responsive user-detail action group was also corrected so its two-column
Carbon buttons stretch to the same grid-row height. The recaptured
`149a-user-detail-narrow.jpg` proves equal-width, equal-height `Revoke sessions`
and `Deactivate` actions with a minimum 64 px touch target even when one label
wraps. A rendered geometry assertion now guards those dimensions; the focused
cross-browser accessibility case remains green in Chromium, Firefox, and
WebKit (3/3), and the `390 × 844` screenshot audit reports no issues.

## Final consolidated Carbon and identity evidence (2026-08-15)

This section supersedes the earlier incremental screenshot counts. The
canonical final evidence directory is
`test/results/manual-ui-screenshots-carbon-sso-final-20260815`; the derived
review sheets are in
`test/results/ui-contact-sheets-carbon-sso-final-20260815`.

| Evidence | Result | Scope |
|---|---:|---|
| Carbon implementation gallery | 8/8 passed | Public authentication, global navigation, settings information architecture, provider and mapping multistep workflows, source-aware users, provisioning administration, narrow layouts, and 200% reflow |
| Screenshot audit and visual review | 52/52 passed | 36 desktop `1440 × 900`, 14 narrow `390 × 844`, and two 200%-reflow `720 × 450` captures; no wrong dimensions or duplicate content |
| Local identity aggregate | 571/571 passed | Contracts 165, routes 112, mapping matrix 91, protocol mocks 68, documentation 5, provisioning/SCIM/database E2E 70, and Carbon UI 60 |
| Containerized protocol rehearsal | 10/10 passed | Relational SCIM journey, local Keycloak OIDC, Entra-compatible OIDC, signed SAML, and TLS/nested-group LDAP |
| Cross-browser accessibility | 51/51 passed | Seventeen scenarios in each of Chromium, Firefox, and WebKit against the locally deployed source stack |
| Focused identity-administration accessibility | 36/36 passed | Twelve scenarios in each browser, including keyboard access to the true form bottom, action-footer separation, and narrow-layout overflow protection |
| Authorization PR suite | 125/125 passed | Includes clean disposable-PostgreSQL randomized authorization, custom-role scope, and machine-principal parity |
| Database portability | 35/35 stages passed | Seven lifecycle stages on PostgreSQL, MySQL, SQL Server, Oracle, and the Spanner emulator |
| Local source-image deployment | Passed | Exact changed worktree built and served through nginx at `http://127.0.0.1:18080`; health, OpenAPI, login methods, real login/refresh/logout, browser, and accessibility checks passed |
| Published-image deployment | Passed | Docker Hub backend and frontend images were actually pulled, inherited builds were disabled, and the same-origin login smoke passed |

The final 52-screen set includes:

- `100`–`108`: login, recovery, reset, verification, signup, invitation, and
  narrow validation states using the shared public authentication shell;
- `110`–`131`: desktop/narrow global navigation, skip-link focus, Settings,
  provider and mapping workflows, explicit provider/mapping scroll-end states,
  saved/configuration-owned/unsaved states, and 200% reflow;
- `140`–`144`: User directory and detail, lifecycle reason, effective access,
  sessions, and audit;
- `145`–`148`: provisioning overview, creation, credential inventory,
  reveal-once OAuth client credentials, and sanitized diagnostics; and
- `149`–`150`: narrow User directory/detail and provisioning administration.

Visual inspection confirms the reported regressions are resolved: the User
table follows the Carbon grid, every tag has vertical row clearance, stacked
tags have an explicit gap, mobile lifecycle actions have equal dimensions,
provider controls remain within the viewport, and no final capture contains
clipping, duplicate branding, stale loading state, or an `undefined` value.
The provider and mapping workflow bodies expose a stable scrollbar gutter,
accept keyboard focus, reach their exact scroll endpoint, retain at least 32 px
of clearance beneath the final control, and never overlap the persistent
action footer. The User detail Field ownership section now has its own layer,
24 px interior card padding, 12 px inter-card gutters, aligned heading and card
edges, and no phantom empty grid cell.

The User detail productive header now also reserves a dedicated 16 px Carbon
spacing step after the email subtitle. Rendered geometry checks enforce at
least 15 px between the subtitle and the following directory-management
callout at both `1440 × 900` and `390 × 844`; refreshed captures `141` and
`149a` passed dimension audit and visual review.

The Docker Hub smoke verifies the released-image consumption path, not that
uncommitted source changes are already published. The exact implementation is
verified by the separate source-image deployment. Real customer IdP validation
and Microsoft Entra gallery certification remain external qualification work;
the local evidence is deliberately labelled as emulator or protocol-rehearsal
evidence. The accepted OSS limitation remains one active authoritative
provisioning directory per tenant.

## P1 Carbon UX closeout (2026-08-15)

The remaining P1 findings from the final Carbon review are closed in the
canonical 52-screen evidence set:

- Public invitation onboarding now constrains its wide authentication panel
  with border-box sizing and `min(40rem, 100%)` behavior. Long invitation,
  notification, and account text can wrap without increasing the document
  width. The narrow evidence test measures the panel and heading against the
  `390 × 844` viewport and rejects any page-level horizontal overflow.
- At Carbon's small breakpoint, provider and identity-mapping creation now
  become a full-height mobile creation surface beneath the 48 px application
  header. The redundant Platform settings header, section selector, border,
  and duplicate back action are covered or removed from that surface. The
  workflow uses one vertical scroll container; its body no longer creates a
  second short scroll area. Step focus resets both desktop and mobile scroll
  origins without causing the workflow title to leave the viewport.
- The mobile action footer remains sticky and ends exactly at the viewport.
  Two-action steps use equal columns. Three-action steps place the primary
  Continue/Create action on a full-width first row and equal Cancel/Back
  actions beneath it, preventing labels from wrapping or producing unequal
  targets. Rendered tests also scroll the longest provider steps to their true
  final controls and require at least 32 px of clearance above the footer.
- Reveal-once provisioning credentials cannot be dismissed accidentally.
  Close, Escape, and outside-click dismissal remain guarded until the operator
  confirms that the client secret was stored in the approved secret manager.
  The explicit `I've stored the credential` action is disabled before that
  acknowledgement, then becomes the only completion path.

The exact changed frontend package was rebuilt and served at
`http://127.0.0.1:4173` for deterministic mocked-browser evidence. The Carbon
implementation gallery passed 8/8, the focused identity component suites
passed 39/39, and the identity-administration accessibility suite passed 36/36
across Chromium, Firefox, and WebKit. Screenshot integrity passed for all 36
desktop, 14 narrow, and two 200%-reflow images with no dimension or duplicate
content findings. The directly affected review captures are `108`, `122`–
`124b`, and `147`.

## P2 and P3 Carbon UX closeout (2026-08-15)

All remaining P2 and P3 findings from the Carbon review are closed. This
focused addendum does not replace the consolidated 52-screen evidence above;
it records the later P2/P3 implementation and its changed-state review set in
`test/results/manual-ui-screenshots-carbon-p2-p3-final-20260815-v3`.

| Finding | Resolution | Direct evidence |
|---|---|---|
| Provider steps allowed premature progression | Continue/Create is derived from current-step validity and remains disabled until required inputs are complete; inline validation remains available. | `113`–`116`, `130` |
| Provider creation lacked completion feedback | The saved result now shows a success notification, moves focus to it, and exposes the message to assistive technology. | `116a` |
| Unsaved-exit action hierarchy was unsafe | Discard uses Carbon's danger action; Keep editing is the safe initial focus target. Provider, mapping, and provisioning creation use the same guarded behavior. | `125`, `125a` |
| Configuration-owned records looked editable | Provider and mapping detail views now use static key/value content instead of low-contrast disabled form controls. | `126`, `127` |
| Provisioning creation used a disconnected wide form | Directory creation now uses the shared single-column creation workflow, one documented scroll region, persistent actions, sufficient bottom clearance, and the common unsaved-change guard. | `145a`, `150a` |
| Operational detail lists were difficult to scan | Effective access, sessions, audit, credentials, and diagnostics use one responsive structured-list primitive with table/row/header/cell semantics and stacked narrow rendering. | `142`–`144`, `146`, `148`, `149b`, `150b` |
| Narrow User directory obscured later columns | The inner table is the horizontal scroll container, the User identity column stays pinned, a scroll hint is announced and shown, and scrollbar styling remains available. | `149`, `149c` |

The focused identity component suite passes 62/62. The complete Chromium
Carbon implementation gallery passes 8/8, and the focused
identity-administration accessibility suite passes 12/12. The
frontend-host typecheck and both frontend production builds pass. Screenshot
integrity passes for all 47 P2/P3 captures: 29 desktop `1440 × 900`, 16 narrow
`390 × 844`, and two 200%-reflow `720 × 450` images, with no dimension or
duplicate-content findings. The screenshots were captured against the exact
rebuilt frontend package with the deterministic identity mock stack; they are
UI and accessibility evidence, not a claim of live customer-IdP certification.

## Access Model real-API E2E evidence (2026-08-15)

The Roles, Permissions, Assignments, and Groups pages now share a repeatable
real-backend Playwright journey in
`test/e2e/smoke/access-model-pages-local.spec.ts`. The journey signs in as a
disposable seeded administrator, creates a custom permission, creates a custom
platform role that includes it, assigns that role to the seeded user, creates a
manual group, and adds the user as a member. Each mutation must return the
expected HTTP status, survive a browser reload, and match an authenticated API
read before evidence is captured. The same test then removes the assignment
and membership, archives the group and role, verifies the final archived role
state, and relies on targeted global teardown for repeatable database cleanup.
The journey is included in the seeded local authorization smoke runner.

The final source-built container evidence is in
`test/results/manual-ui-access-model-e2e-20260815`:

- `230`–`233` prove persisted custom permission, role, assignment, and manual
  group membership at `1440 × 900`;
- `234`–`237` prove responsive access to all four Access Model pages at
  `390 × 844`; and
- `238` proves the role's non-assignable archived result at `1440 × 900`.

The real-API journey passes 1/1. The real local Access Control and effective
access smokes pass 2/2. The mocked cross-page navigation journey passes 1/1,
the tablet long-label layout check passes 1/1, and the focused Chromium
accessibility lane passes 5/5, including error announcement, rendered WCAG AA
text contrast, 200% reflow, reduced motion, and toolbar alignment. The
authorization structure gate reports all 218 registered actions directly
covered and the guarded machine-principal, policy, API-client, and shared
authorization middleware sources at literal 100% coverage. Screenshot audit
passes for all five desktop and four narrow images with correct dimensions,
unique content, and no integrity findings.

## Resource Administration real-API E2E evidence (2026-08-16)

The three Access Control Resource sections now share a real-backend Chromium
journey in `test/e2e/smoke/resource-administration-local.spec.ts`. The journey
uses the source-built production frontend and backend containers, PostgreSQL,
and the deterministic Camunda REST mock. It does not intercept the Resource
Administration APIs in the browser.

The journey proves the following persisted lifecycle:

- create an Engine Set from an explicit engine selector, preview its match,
  require HTTP `201`, reload it from the API, edit it, refresh matching engines,
  and archive it through a Carbon danger confirmation;
- load the seeded runtime process inventory and refresh it through the backend
  to the Docker Camunda mock, require HTTP `200`, and render bigint observation
  timestamps as readable dates rather than `Invalid Date`;
- create a Project Target from real project and engine catalogs, enable manual,
  CI, and import paths, require HTTP `201`, reload and verify the stored
  contract, add API deployment by edit, evaluate both an allowed owner and a
  denied persona, and archive the target through a danger confirmation; and
- revisit all three sections at `390 × 844`, reject document-level horizontal
  overflow, keep mobile actions reachable, expose explicit horizontal-table
  guidance, and retain the first table column as scroll context.

The companion
`test/e2e/smoke/resource-scope-assignments-local.spec.ts` creates Engine Set,
single Runtime Resource, and Runtime Resource Set assignments through the
redesigned Assignments page. Separate authenticated browser sessions then
prove the permitted engine/resource is returned and its sibling is denied.
Both journeys are included in `scripts/run-authz-local-seeded-smoke.sh`, with a
fresh disposable fixture and direct cleanup for every spec.

The final screenshot set is
`test/results/manual-ui-resource-administration-e2e-20260816`:

- `240`–`242`: Engine Set preview, persisted detail, and refreshed matches;
- `243`–`244`: runtime inventory before and after live reconciliation;
- `245`–`248`: Project Target creation, persistence, allowed evaluation, and
  denied evaluation;
- `249`–`251`: the three Resource sections at `390 × 844`; and
- `252`–`253`: guarded Engine Set and Project Target archive confirmations.

The source-built Docker journey passes 1/1 and the live scope-enforcement
journey passes 1/1. Focused frontend coverage passes 29/29, focused backend
resource and route coverage passes 123/123, and frontend-host typecheck passes.
All 14 retained files are unique and dimension-valid: 11 desktop captures are
`1440 × 900`, and three narrow captures are `390 × 844`.
The Compose E2E overlay permits only the named `camunda-mock` HTTP/private
endpoint so the backend container can exercise reconciliation. Production
endpoint-policy defaults remain unchanged.
