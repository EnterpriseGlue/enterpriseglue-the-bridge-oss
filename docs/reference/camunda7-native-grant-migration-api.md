# Camunda 7 Native-Grant Migration API

All endpoints are tenant-scoped and engine-scoped. They require authenticated
platform permissions in addition to normal engine visibility. The ordinary
history response is sanitized; only the detail endpoint returns native source
identifiers.

## Read-only inventory

`POST /engines-api/engines/{id}/camunda-native-grants/imports/preview`

```json
{ "sourceKind": "live_api" }
```

For an offline source, use `customer_export` with the versioned schema shown in
[the sanitized example](camunda7-native-grant-export.example.json). The server
rejects a truncated inventory or any snapshot/classification record that cannot
fit within the cross-adapter secure-evidence limit. Those validation failures
write no import row; split the scope and make a new read-only preview. Response:
`{ "run": { ...sanitized receipt } }`.

## Sanitized migration history

`GET /engines-api/engines/{id}/camunda-native-grants/imports`

Requires the grantable permission
`platform:camunda-native-grants:history-view`. Its OpenAPI/action identifier is
`platform.camunda-native-grants.history.read`; action identifiers are route
metadata, not custom-role permission keys. The response returns at most the 50
newest receipts for that exact engine and tenant, newest first:

```json
{ "runs": [{ "id": "import-run-id", "status": "applied", "normalizedCounts": { "total": 2 } }] }
```

This endpoint intentionally returns the same opaque receipt shape as the
single-run history endpoint. It never returns native group names, native
resource keys, user identifiers, or encrypted detail. An `applied` receipt can
be reopened in the UI to preview its hash-bound rollback after a page reload.

## Protected detail and draft

`GET /engines-api/engines/{id}/camunda-native-grants/imports/{runId}/detail`

Requires the sensitive-detail permission and returns the encrypted snapshot
while it is retained. Treat the response as sensitive operational data.

`POST /engines-api/engines/{id}/camunda-native-grants/imports/{runId}/draft`

The initial safe route accepts only a new, empty additive migration bundle with
`metadata.key` beginning `migration.camunda-native-`, an empty
`./groups.json`, and new target groups. The response contains a deterministic
`draft.canonicalHash`; the server also persists the full draft encrypted with
the source snapshot.

## Apply

`POST /engines-api/engines/{id}/camunda-native-grants/imports/{runId}/apply`

```json
{ "expectedDraftHash": "64-lowercase-sha256-hex-characters" }
```

The server applies the stored exact draft, not a browser-supplied bundle. It
requires configuration-bundle apply permission, uses an idempotency key derived
from the import run and hash, and returns `{ run, result }`. `result.applyRunId`
is stored on the sanitized run receipt.

## Rollback preview and apply

`POST /engines-api/engines/{id}/camunda-native-grants/imports/{runId}/rollback/preview`

```json
{}
```

Returns a hash-bound authoritative rollback preview with `changes`, `warnings`,
and `requiredAcknowledgements`.

`POST /engines-api/engines/{id}/camunda-native-grants/imports/{runId}/rollback`

```json
{
  "expectedRollbackHash": "64-lowercase-sha256-hex-characters",
  "acknowledgements": ["config.authoritative_archive:group:group.example"]
}
```

Only an applied, unexpired run can be rolled back. The rollback archives records
owned by the dedicated migration bundle and records its configuration apply id;
it cannot write to Camunda or alter the engine registration.
