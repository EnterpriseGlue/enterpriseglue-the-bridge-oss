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

## File-scoped checkpoint restore

The file version panel uses
`POST /vcs-api/projects/:projectId/commits/:commitId/files/:fileId/restore`.
An older host has no such route and returns 404 without running whole-project
restore. The client does not fall back to the project restore endpoint. The strict request contract is illustrated in
[`vcs-file-restore.json`](../examples/vcs-file-restore.json). Snapshot selection
uses the same shared stable-ID/unique-legacy matcher as preview. Reads retain
duplicate identities so ambiguity reaches the matcher instead of being resolved
by current working-file timestamps. Missing, deleted, empty, wrong-format and
ambiguous selected snapshots stop before a file update.

The update and working-file synchronization are restricted to the selected file
and authorized project. The checkpoint keeps the existing `source=file-save` marker with an
explicit file-version scope, which older hosts already recognize. Its message
identifies the restore. File-scoped saves and restore checkpoints copy unselected
entries from the previous saved tree, including deletion markers. They never
snapshot sibling working drafts: those drafts remain dirty until explicitly
saved. An explicit file scope must contain distinct, existing files from the
authorized project; an empty, missing-member or ambiguous scope is rejected
before a checkpoint is written. The OpenAPI request uses the same validation
schema as the route. File history and legacy history backfill exclude incidental
sibling snapshots.
The original `/commits/:commitId/restore` endpoint retains whole-project scope.
These operations do not form an atomic multi-step transaction. A failed or lost
response may require reconciliation; it is not permission to retry automatically.

Browser restore captures project, file, revision, save mode and session/permission
lifetime. It verifies the preceding save acknowledgement, then rechecks that
lifetime before restore and completion handling. Switching away and back, closing
the preview, unmounting or replacing authority stops a pending continuation.
Already-issued writes may take effect; a late response cannot clear the new
view's draft state or reload it.

Create Version captures its target, mode, description and authority before
preparation. It rechecks the mount, view and browser-session lifetime before
sending a request and handling its result. Cancellation invalidates a pending
continuation; an already-issued write may still settle. Success requires the
expected version identifier in the response. A late response cannot close a
replacement modal or invalidate its queries.

## Saved-tree publication and dirty status

Publishing a draft uses its saved head snapshots, including file metadata and
deleted-file markers. It does not use the draft working rows. The service binds
the draft and saved head to the requested project and owner, rejects missing or
ambiguous identities and content/hash drift, and checks both branch heads again
before changing main. Repeated publication reuses main file identities rather
than appending duplicate active/deleted rows. A new user draft copies the saved
main tree; publishing leaves existing working drafts and main application files
unchanged. File folder IDs are retained, and known cross-project file or folder
references are rejected. This is file-tree publication; folder metadata does not
have a versioned snapshot representation.

A publish conflict returns HTTP 409. A draft must first have an owned saved
commit; an inherited main head alone is not a new draft version. Existing Git
push/import paths already save a complete draft before publishing. Publication
remains a non-atomic multi-step operation: the final head checks do not establish
a database lease, and a failed/lost response still requires reconciliation.

Dirty status compares one exact stable identity, or one unique legacy path,
with saved content, hash, name, type and folder. A deleted or ambiguous baseline
never makes a current file clean. Missing/foreign project baselines reject before
snapshot reads. Folder ancestor traversal terminates even when retained folder
rows contain a cycle. Empty file content can match an exact valid baseline; a
viewer still requires displayable diagram content.

The deployment revision guard independently compares the published snapshots
with the captured deployment source. An unsaved sibling cannot claim the
published commit identifier, including in a whole-project deployment.

## Version-bound Git deployment

The deploy dialog forwards the saved version ID to
`POST /git-api/deploy-from-version`. That route requires both the saved UUID and
an engine target and applies the existing project permission and CI target
eligibility checks. It shares the deployment handler with the legacy route.
An older host returns 404 before a Git push; the client never falls back to
`/git-api/deploy`. Legacy callers of the old route remain supported: the updated
server creates a complete owned checkpoint and stops if that checkpoint fails.

Git and engine deployment share the same exact project/revision/file verifier.
Git capture reads the current BPMN/DMN export once, verifies the complete saved
diagram set, then owns the captured file content and folder metadata across
provider awaits. A later draft edit cannot change the outgoing payload. Hashing
a versioned export does not reuse file timestamps to infer unchanged content.
Paths reject missing/cyclic folders, traversal components and duplicate exported
names. Folder names are captured at dispatch; VCS does not store historical folder
names. Direct unversioned Git synchronization remains its existing current-state
operation.

A versioned deployment never creates a replacement checkpoint after pushing.
Its receipt and deployment record retain the reviewed ID. The client validates
receipt identity, counters, revision and any requested tag before announcing
success. An unknown unchanged-remote head, missing commit SHA or failed requested
tag stops acknowledgement. A provider may have acted before a failed response;
there is no automatic retry or claim of atomic Git/database settlement. Reconcile
uncertain effects before repeating the operation. Browser-session changes also
stop the continuation between save and push, before a React rerender is required.

## Manual and bulk Git sync continuations

The project sync dialog and project-list batch use the same request/receipt
adapter. It owns the project, direction and description before transport and
requires the canonical successful receipt, consistent effect counts/direction,
and a nonempty commit SHA for a pushed change. A resolved response containing
an error or missing receipt fields is not reported as success. A valid unchanged
acknowledgement remains supported.

The dialog binds pending work to its mount, open lifetime, selected project,
repository, current authority and browser session. Personal credential validation
and repository queries include authority in their keys; a previous user's result
cannot enable a new user's action. Closing or replacing the view suppresses late
callbacks and cache updates. Inputs are disabled for the owned pending attempt.

The project-list batch snapshots its selected projects and request fields before
the first call, rejects malformed/duplicate connected selections before any call,
and checks its lifetime/session before each project and on settlement. Closing,
reopening, changing selection/direction or changing authority stops the old queue.
A replacement view does not inherit the old attempt's busy state or result. Each
owned failed project is reported once, disconnected projects are skipped, and
only verified acknowledgements clear the confirmed selection. No failed project
is retried automatically.

These are continuation and acknowledgement checks. Already-issued HTTP requests
may act after cancellation; an uncertain response requires reconciliation. The
server remains authoritative for permissions, credentials and provider effects.
The existing local sync-status read is not a remote-provider verification gate.

Sync permission checks remain directional: an allowed push action does not grant
pull permission. Explicit sync restrictions prevent confirmation even while
membership presentation is loading. UI permission fallbacks cannot override a
server-supplied restriction; independently permitted pull-only users remain
supported.
