# Mission Control engine selection

Mission Control runtime routes require an engine identifier. The frontend
resolves that identifier from the authorization-filtered
`GET /engines-api/engines` inventory before enabling engine-dependent queries.
The visible engine dropdown is a control for changing the resolved selection;
it is not responsible for bootstrapping application state.

## Resolution rules

On a cold application load or direct deep link, the frontend:

1. loads the accessible engine inventory;
2. retains the persisted engine only when it is still present in that
   inventory;
3. otherwise selects the first engine in the stable name, URL, and identifier
   ordering; and
4. clears a stale persisted selection when no accessible engines remain.

Until this resolution completes, runtime queries remain disabled and the page
shows its loading state. An empty inventory or failed inventory request is
shown explicitly rather than leaving an empty runtime shell. This behavior is
shared by the dashboard, Mission Control overview pages, detail routes, and
other consumers of `useSelectedEngine`.

## Variable transport

The shared engine client requests `deserializeValues=false` for runtime, task,
and historic variable reads. Native `Json` values are parsed from their serialized
JSON representation before response presentation and permission-based redaction.
The shared frontend variable-write adapter serializes native JSON exactly once
for edits, creation and bulk uploads. Its callers pass parsed JSON values,
including JSON strings, numbers, booleans and null; UI state keeps those parsed
values after a successful save. Numeric writes reject non-finite values, fractional
integers, integers outside the signed 32-bit range, and `Long` values outside
JavaScript's exact integer range (±9007199254740991). Integer editors accept
whole decimal text. Add and edit use the same parser; typed bulk integers are
checked against their original JSON number text before it can be rounded.
Browsers without JSON source-text reviver support must provide typed bulk
integers as strings so they can be validated exactly. Nullable values remain
supported. Native JSON also rejects non-finite numbers before serialization can
turn them into null. Serialized Java `Object` payloads pass through unchanged. This internal adapter does not change the
engine-compatible external HTTP API.
Variable maps retain supported names such as `constructor` and `toString` as
own fields, including bulk writes and completed-history snapshots. The write
adapter rejects `__proto__` before submitting the entire request because the API
record parser excludes that reserved key; a bulk write must not report success
after silently omitting an input. Historical name fields remain readable.
Navigating to another
process instance remounts its detail page so pending action drafts cannot be
applied to the new instance on the same engine. Unmounting invalidates local
completion callbacks for edits, retries and modifications. Already issued
operations still settle against their original target; their late responses
cannot refetch data or show action notifications under a different route.
Java `Object` values remain serialized; the client does not instantiate engine
classes. Malformed JSON rejects with a sanitized engine-response error. Other
engine endpoints retain their existing query parameters and response values.
This follows the [Operaton REST variable contract](https://docs.operaton.org/docs/documentation/reference/rest/overview/variables/).

The focused real-engine check requires an independently started disposable,
loopback Operaton fixture and removes only its own deployment:

```bash
OPERATON_VARIABLE_FIXTURE_URL=http://127.0.0.1:18080/engine-rest \
  pnpm run test:operaton-variable-values
```

The required release-candidate Operaton browser job runs the same check against
its existing pinned loopback fixture before browser acceptance. It exercises
the actual frontend write adapter and shared read transport against real engine
persistence; the host HTTP hop is stubbed, so API authorization and live tenant
isolation still require their own gates. Failure blocks candidate qualification.

## Browser coverage

The process-instance smoke test deliberately removes the persisted
`engine-selector` value before navigating directly to a detail URL. It then
requires successful responses for the accessible-engine inventory, historic
instance, variables, activity history, and process-definition XML. Keep this
fresh-session condition when adding or refactoring Mission Control routes so a
passing test cannot depend on visiting another page first.

## Authentication and deployment response lifetime

`AuthProvider` invalidates asynchronous authentication work when a session is
replaced or cleared, including storage events and logout. User and permission
refreshes only apply their latest result for the current session. Late success,
unauthorized, unverified-user and failure responses cannot restore the earlier
browser identity or replace a newer permission snapshot. The optional
`sessionRevision` context field exposes the current lifetime to action views;
server cookies and authorization remain authoritative.

Browser continuations also use a monotonic in-memory session revision. Explicit
sign-in replacement, logout, cross-tab storage changes, changed permission or
action-availability snapshots and provider teardown invalidate older work,
including A-to-B-to-A transitions. Permission observations that change only
`generatedAt` retain their cache and view state. Private query caches are
cancelled and cleared when authority changes or becomes unavailable, including
same-account sign-in replacement.

Process-detail drafts and the save-version/deploy flow bind the session and
permission snapshot as well as their resource target. Engine-task callbacks
check their render and effect lifetime before dispatch and again on settlement;
unmounted callbacks cannot start a new task. Effect replay under React
StrictMode still permits a current task.

Automatic 401 refresh/replay belongs to the session and tenant that started the
request. Only matching callers share one pending refresh. A replacement session
cannot adopt its result; a stale refresh cannot clear or redirect the newer
login, and stale callers receive `BrowserSessionChangedError` before replay.
An aborted caller does not replay, while an uncancelled caller may finish the
same-session shared refresh. Current-cookie XSRF handling remains unchanged.
Session bootstrap uses that same local session/tenant binding before accepting
a user response or starting its next request. Protected session reads use only
the interceptor's single refresh/replay. Public authentication pages restore an
expired cookie with one explicit refresh after HTTP 401; HTTP 403, service
failures and invalid responses do not initiate refresh. A failed replay stops
bootstrap instead of starting another refresh cycle.
These are client continuation fences, not server credentials or authorization.
They cannot undo already-issued requests or HTTP-only cookie response effects.
Review the current session before resubmitting; stale work is not automatically
replayed under a replacement identity.

The save-version/deploy dialog captures project, file selection, engine and
mode at submission. Project/file/session changes, closing the dialog and
unmounting invalidate later dispatch and completion handling, including an
A-to-B-to-A change. Mutation variables carry the original target, and a save
receipt must identify a commit before the second stage starts. Already-issued
requests may still take effect; stale completion suppression is not cancellation
or authorization to retry a deployment.

For engine proxy deployments, `options.vcsCommitId` is checked before any engine
call. The commit must belong to the authorized project. Every selected file
must have one non-deleted snapshot with the exact file ID, name, type, folder,
source content and valid existing VCS hash. Whole-project deployment also requires
the complete saved BPMN/DMN file set, so deleting a file after saving cannot
silently deploy a smaller project. Explicit file subsets remain supported. Content drift or an absent,
foreign-project, corrupt or ambiguous snapshot returns HTTP 409 before engine
side effects. Save and review a new version before submitting again. Successful
receipts link only this verified revision; a legacy request without a revision
retains captured file/content lineage with no inferred VCS commit ID. No database
schema change or historical receipt rewrite is required.

The focused PostgreSQL revision test uses its own disposable database:

```bash
bash scripts/run-native-tenancy-postgres-rls.sh --deployment-revision
```

It is also included in the default PostgreSQL regression lane. The test verifies
actual TypeORM reads and rejection of drift and sibling-project revisions; it
does not establish live tenant routing, runtime-role/RLS or engine acceptance.

## Saved diagram revision reads

The editor's deployed-version view and Git version preview use
`GET /vcs-api/projects/:projectId/commits/:commitId/files`. The shared response
schema includes stable `mainFileId`, folder, name, format, change type and content.
The service joins the commit to the requested project in SQL after the route's
existing project authorization. Restore reads use the same project binding, and
updates require the target file to belong to that project and affect one row
before recording a checkpoint. Restore remains a multi-file operation; these
checks do not make it an atomic transaction.

Local file-version preview caches include the project, file and version identity
and use a separate namespace from Git commit snapshots. Equal version/commit IDs
cannot supply one another's preview or restore readiness.

Browser snapshot selection prefers the exact stable file ID, including after a
rename. Only older rows without a stable ID may use a unique exact name, format
and folder match. Missing, deleted, ambiguous or empty snapshots never fall back
to another file in the commit. The deployed-version view uses dedicated BPMN/DMN
viewers, separate from the editable draft and autosave. The DMN viewer uses the
bundled WOFF icon font under a distinct family so modern browsers do not attempt
the vendor stylesheet's legacy EOT fallback. A missing commit identity
or unavailable snapshot produces an explicit unavailable state; a version number
alone does not infer a commit or display the current draft as deployed content.

The PostgreSQL deployment-revision lane also checks snapshot reads with actual
TypeORM queries: own-project reads succeed and sibling-project commit IDs return
no snapshots. Local component, transport and database tests remain distinct from
the authenticated editor journey and live tenant-isolation acceptance.
