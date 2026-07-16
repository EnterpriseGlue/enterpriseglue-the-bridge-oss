# Legacy Identity Provider Cutover Runbook

Use this runbook in a deployed non-production environment first, then in the
approved target tenant. It is the required evidence gate before retiring the
legacy SSO mapping evaluator or removing a legacy provider compatibility path.
It intentionally preserves every legacy mapping and provider until the
representative sign-in and Effective Access evidence is recorded.

Before the change window, copy the
[cutover test-plan template](./legacy-identity-provider-cutover-test-plan-template.md)
to the approved change record and fill it in. The template separates the
operator inputs, representative-user matrix, execution ownership, and evidence
index from this procedure. Do not commit a completed copy to this repository.

Before using a deployed environment, run the repository-local identity gate:

```bash
pnpm run test:identity:verify
```

It covers the local contract, route, protocol, UI, and disposable LDAPS
boundaries. It is necessary regression evidence, but it does not substitute
for the real provider sign-in and Effective Access evidence required below.

## Required environment and inputs

Use an environment with the same identity-provider protocol, claim shape,
tenant configuration, and authorization data model as the intended cutover.
Do not use a mock assertion or a locally forged session as representative
evidence. Schedule a change window and retain a separate active local
break-glass Platform Administrator throughout the procedure.

The operator needs these inputs:

- an authenticated administrator session for the target tenant, with
  `platform.sso.providers.manage`, `platform.sso.group-mappings.read`, and
  `platform.sso.group-mappings.manage`; global retirement also requires
  `platform.sso.platform-role-mappings.manage`;
- the persisted `LEGACY_PROVIDER_ID` and the replacement direct-login
  `TARGET_PROVIDER_KEY` (direct OIDC for Microsoft, Google, or legacy OIDC;
  direct SAML for legacy SAML; never a legacy environment-provider setting);
- at least one active replacement identity mapping for each safe legacy
  mapping being retired, plus its candidate identity-mapping id;
- representative, least-privileged test users covering every affected mapping
  family (`platform_role`, `group`, and `engine_assignment`), including an
  engine/project/runtime resource where that mapping grants scoped access;
- a ticket location for sanitized evidence. Never store bearer tokens, client
  secrets, SAML assertions, raw JWTs, raw claims, or user PII in the evidence.

Set only local shell variables; do not commit their values:

```bash
export EG_BASE_URL='https://enterpriseglue.example.com'
export EG_AUTH_HEADER="Authorization: Bearer <short-lived-admin-token>"
export LEGACY_PROVIDER_ID='<persisted-legacy-provider-id>'
export TARGET_PROVIDER_KEY='<direct-provider-key>'
export EVIDENCE_DIR="./legacy-cutover-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$EVIDENCE_DIR"
```

If the deployment uses browser cookie authentication, run the same requests
from the authenticated browser session or use the Platform Settings UI; do not
copy a production cookie into a shell or ticket.

## 1. Establish the pre-cutover baseline

Capture the current mapping coverage, mapping-retirement readiness, and
provider readiness. The provider readiness request must include the selected
legacy provider so the default-group mapping is checked for that exact source.

```bash
curl --fail-with-body -sS -H "$EG_AUTH_HEADER" \
  "$EG_BASE_URL/api/authz/legacy-mapping-coverage" \
  > "$EVIDENCE_DIR/legacy-mapping-coverage-before.json"

curl --fail-with-body -sS -H "$EG_AUTH_HEADER" \
  "$EG_BASE_URL/api/authz/legacy-mapping-retirement-readiness" \
  > "$EVIDENCE_DIR/legacy-mapping-retirement-readiness-before.json"

curl --fail-with-body -sS -H "$EG_AUTH_HEADER" \
  --get "$EG_BASE_URL/api/identity/providers/migration-readiness" \
  --data-urlencode "targetProviderKey=$TARGET_PROVIDER_KEY" \
  --data-urlencode "legacyProviderId=$LEGACY_PROVIDER_ID" \
  > "$EVIDENCE_DIR/provider-migration-readiness-before.json"
```

Stop before changing anything unless provider readiness is `ready: true`. Its
checks must confirm an existing, enabled replacement whose direct-login protocol
matches the selected legacy provider, with an available client-secret reference
for OIDC or signing-certificate reference for SAML, active identity mappings,
and (when applicable) the exact default group mapping. A missing or unavailable
secret reference is a deployment/configuration problem, not an authorization
bypass.

Review every coverage row. Only rows with `status: "replacement_candidate"`
can be verified and retired. `manual_redesign_required` and
`no_replacement_candidate` are blockers: redesign the mapping through normal
groups, Engine Sets, or scoped canonical assignments and repeat the baseline.

## 2. Produce representative sign-in and Effective Access evidence

For each legacy mapping row that will be retired:

1. Start a fresh browser session and sign in through
   `/api/auth/identity/<TARGET_PROVIDER_KEY>/start` as its representative test
   user. Confirm the expected tenant redirect and that the legacy provider was
   not selected.
2. In **Access Control -> Effective Access**, evaluate the user against each
   affected platform, project, engine, and runtime resource action. Capture the
   decision explanation and source chain. The replacement must grant all
   intended access and no additional privileged access.
3. Confirm the expected group membership and the affected engine/project
   visibility in Mission Control or the relevant product screen. For an engine
   assignment, include a deliberately unauthorized engine in the test and show
   that it remains hidden or denied.
4. Record a sanitized note containing the change ticket, anonymized test-user
   label, tested resource/action, timestamp, and the outcome. Keep the detailed
   screenshots/exports in the approved evidence location rather than this repo.

Then record the replacement verification. Substitute the ids and family from
the coverage response; the request returns `204 No Content` on success.

```bash
export LEGACY_MAPPING_ID='<coverage-row-id>'
export MAPPING_FAMILY='<platform_role|group|engine_assignment>'
export CANDIDATE_IDENTITY_MAPPING_ID='<coverage-row-candidate-id>'

curl --fail-with-body -sS -o /dev/null -w '%{http_code}\n' \
  -X POST -H "$EG_AUTH_HEADER" -H 'Content-Type: application/json' \
  "$EG_BASE_URL/api/authz/legacy-mapping-coverage/$LEGACY_MAPPING_ID/verify" \
  --data "{\"family\":\"$MAPPING_FAMILY\",\"candidateIdentityMappingId\":\"$CANDIDATE_IDENTITY_MAPPING_ID\",\"note\":\"CHG-1234: representative target-provider sign-in and Effective Access verified; sanitized evidence stored in approved change record\"}" \
  | tee -a "$EVIDENCE_DIR/verified-mappings-status.txt"
```

Repeat this request once for every mapping row being retired. A `400` means the
selected candidate is not current or the note is invalid; refresh coverage and
resolve the mismatch rather than forcing retirement.

## 3. Re-check the fail-closed retirement gate

```bash
curl --fail-with-body -sS -H "$EG_AUTH_HEADER" \
  "$EG_BASE_URL/api/authz/legacy-mapping-retirement-readiness" \
  > "$EVIDENCE_DIR/legacy-mapping-retirement-readiness-after-verification.json"
```

Proceed only when `ready: true` and `blockers` is empty. The response provides
the active legacy count and verified-replacement count; save it with the change
record. A non-ready response is a stop condition, even if a manual sign-in
appeared to succeed.

## 4. Retire mappings at the intended scope

Use the tenant-scoped operation first. It disables covered legacy platform-role,
group, and engine-assignment mapping rows only after the readiness gate passes:

```bash
curl --fail-with-body -sS -X POST -H "$EG_AUTH_HEADER" -H 'Content-Type: application/json' \
  "$EG_BASE_URL/api/authz/legacy-mapping-retirement/disable" \
  --data '{"confirmation":"RETIRE_LEGACY_MAPPINGS"}' \
  | tee "$EVIDENCE_DIR/tenant-retirement-result.json"
```

Use the global operation only with an approved global change and an operator
holding both mapping-management permissions described above. It has a distinct
confirmation value and affects globally scoped legacy rows:

```bash
curl --fail-with-body -sS -X POST -H "$EG_AUTH_HEADER" -H 'Content-Type: application/json' \
  "$EG_BASE_URL/api/authz/legacy-mapping-retirement/disable-global" \
  --data '{"confirmation":"RETIRE_GLOBAL_LEGACY_MAPPINGS"}' \
  | tee "$EVIDENCE_DIR/global-retirement-result.json"
```

Immediately repeat the sign-in and Effective Access checks from step 2, then
save fresh coverage and readiness responses. The expected result is no active
legacy rows in the retired scope, continued target-provider access for the
representative users, and no increase in access on the deliberately denied
resource.

## 5. Cut over the persisted legacy provider

Mapping retirement and provider cutover are independent gates. After the
replacement sign-in evidence and current provider-readiness response both pass,
disable the persisted legacy provider with its exact id and target key:

```bash
curl --fail-with-body -sS -X POST -H "$EG_AUTH_HEADER" -H 'Content-Type: application/json' \
  "$EG_BASE_URL/api/identity/providers/legacy-cutover" \
  --data "{\"legacyProviderId\":\"$LEGACY_PROVIDER_ID\",\"targetProviderKey\":\"$TARGET_PROVIDER_KEY\"}" \
  | tee "$EVIDENCE_DIR/legacy-provider-cutover-result.json"
```

Success requires `legacyProviderDisabled: true` (or `alreadyDisabled: true`
when a reviewed retry is expected), the expected `targetProviderKey`, a fresh
successful replacement-provider sign-in, and no unexpected legacy login route.
The request refuses an environment-managed legacy provider; keep that provider
and its environment secret intact while its separately planned migration is
completed.

## Evidence, success, and rollback

Attach these sanitized artifacts to the approved change record:

- baseline and post-verification coverage/readiness JSON responses;
- each `204` mapping-verification status plus its mapping id, candidate id, and
  sanitized test note;
- tenant/global retirement response counts, when those operations were used;
- provider cutover response and the relevant audit event identifiers;
- representative sign-in, group/visibility, Effective Access allow, and
  deliberately denied-access evidence for each mapping family.

The change is successful only when all intended mappings have verified
replacements, readiness is true before each retirement, each representative
target-provider user retains precisely the intended access, the negative check
remains denied, and the selected persisted legacy provider is disabled only
after that evidence exists.

Stop and roll back immediately for a failed target sign-in, a different tenant
redirect, missing expected access, unexpected elevated access, a non-empty
readiness blocker, or an audit/evidence discrepancy. Before provider cutover,
make no destructive change: leave the legacy rows and provider active. After a
mapping retirement, re-enable only the affected legacy mappings through the
SSO mapping administration UI, capture the action in the change record, and
re-run Effective Access. After provider cutover, disable the new target
provider if it is unsafe, re-enable the selected persisted legacy provider in
Platform Settings, and investigate the target provider's secret reference or
identity mappings. Do not delete either provider, remove secret references, or
purge evidence as part of rollback.

## Checklist closure boundary

This runbook is the executable handoff for the unchecked deployed-evidence
item in the authorization-refactor implementation checklist: representative
mapping conversion, Effective Access verification, and scoped/global retirement.
It does **not** authorize removal of legacy evaluator code or compatibility
records. Those code/checklist items can be closed only after the recorded
evidence above has been reviewed and the deployed change has met its success
criteria.
