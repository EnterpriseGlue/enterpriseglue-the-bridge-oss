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
values after a successful save. Scalar types and serialized Java `Object`
payloads pass through unchanged. This internal adapter does not change the
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
