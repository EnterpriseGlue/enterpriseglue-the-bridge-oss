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

## Browser coverage

The process-instance smoke test deliberately removes the persisted
`engine-selector` value before navigating directly to a detail URL. It then
requires successful responses for the accessible-engine inventory, historic
instance, variables, activity history, and process-definition XML. Keep this
fresh-session condition when adding or refactoring Mission Control routes so a
passing test cannot depend on visiting another page first.
