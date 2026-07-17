# Legacy Identity Provider Cutover Test Plan Template

Copy this template into the approved change record before a deployed
non-production cutover. It organizes the inputs and evidence required by the
[legacy identity-provider cutover runbook](./legacy-identity-provider-cutover-runbook.md).
Do not commit a completed copy: it can contain internal environment names,
change-ticket references, and pseudonymous test-user labels.

This is a coordination worksheet, not an authorization override. The runbook's
readiness, sign-in, Effective Access, mapping-verification, retirement, and
rollback gates remain mandatory.

## 1. Change record

| Field | Value |
| --- | --- |
| Change ticket | `<ticket>` |
| Target tenant / environment | `<non-production tenant>` |
| Planned window and timezone | `<start>–<end>` |
| Protocol | `<OIDC or SAML>` |
| Legacy provider id | `<persisted id>` |
| Replacement direct provider key | `<key>` |
| Change owner | `<role or team>` |
| Platform administrator / break-glass owner | `<role or team>` |
| IdP owner | `<role or team>` |
| Authorization reviewer | `<role or team>` |
| Evidence location | `<approved internal location>` |

Do not put an access token, client secret, SAML assertion, raw JWT, raw claim,
email address, or a real user identifier in this worksheet.

## 2. Preflight gate

Complete every item before the change window. A **No** or **Unknown** is a stop
condition; resolve it and repeat the baseline.

| Check | Owner | Result (Yes/No) | Evidence reference |
| --- | --- | --- | --- |
| A local break-glass Platform Administrator session is active and tested. | `<owner>` | `<result>` | `<reference>` |
| The legacy provider is persisted, not environment-managed. | `<owner>` | `<result>` | `<reference>` |
| The replacement is enabled and uses the matching direct-login protocol. | `<owner>` | `<result>` | `<reference>` |
| Required secret/certificate references are available without revealing values. | `<owner>` | `<result>` | `<reference>` |
| Baseline provider migration readiness is `ready: true`. | `<owner>` | `<result>` | `provider-migration-readiness-before.json` |
| Baseline mapping coverage has no affected `manual_redesign_required` or `no_replacement_candidate` rows. | `<owner>` | `<result>` | `legacy-mapping-coverage-before.json` |
| At least one active replacement mapping exists for every row in scope. | `<owner>` | `<result>` | `<reference>` |
| Scoped retirement is approved; global retirement is approved if applicable. | `<owner>` | `<result>` | `<ticket approval>` |

## 3. Representative-test matrix

Use anonymous labels only. Add one row per mapping and resource/action pair;
include a deliberate denied-resource check for every scoped engine assignment.

| Mapping id | Family | Test-user label | Target-provider sign-in | Resource and action | Expected decision | Actual decision | Effective Access evidence | Visibility / product evidence | Verification status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<coverage id>` | `platform_role` | `role-allow-01` | `pass` | `<platform action>` | `allow` | `<pending>` | `<reference>` | `<reference>` | `<pending>` |
| `<coverage id>` | `group` | `group-allow-01` | `pass` | `<group-scoped action>` | `allow` | `<pending>` | `<reference>` | `<reference>` | `<pending>` |
| `<coverage id>` | `engine_assignment` | `engine-allow-01` | `pass` | `<assigned engine/action>` | `allow` | `<pending>` | `<reference>` | `<reference>` | `<pending>` |
| `<coverage id>` | `engine_assignment` | `engine-deny-01` | `pass` | `<unassigned engine/action>` | `deny` | `<pending>` | `<reference>` | `<reference>` | `<pending>` |

The **actual decision** must match the expected decision exactly. Any unexpected
allow, missing allow, wrong tenant redirect, or selected legacy login route is
a stop condition. Record the candidate identity-mapping id beside each mapping
in the approved evidence system; use it for the `verify` request in the
runbook.

## 4. Execution order and approvals

| Step | Operator | Reviewer / approval | Completion evidence |
| --- | --- | --- | --- |
| Capture baseline coverage, retirement readiness, and provider readiness. | `<owner>` | `<reviewer>` | Three `*-before.json` files |
| Execute and record every row in the representative-test matrix. | `<owner>` | `<reviewer>` | Sanitized screenshots/exports and test notes |
| Verify each replacement mapping through the API. | `<owner>` | `<reviewer>` | `204` status per mapping |
| Re-check retirement readiness. | `<owner>` | `<reviewer>` | `*-after-verification.json`, `ready: true` |
| Retire tenant scope, if approved. | `<owner>` | `<approver>` | `tenant-retirement-result.json` |
| Retire global scope, if explicitly approved. | `<owner>` | `<approver>` | `global-retirement-result.json` |
| Repeat representative checks after retirement. | `<owner>` | `<reviewer>` | Matrix updated with post-retirement evidence |
| Cut over the persisted legacy provider. | `<owner>` | `<approver>` | `legacy-provider-cutover-result.json` |
| Confirm target sign-in and negative access check after provider cutover. | `<owner>` | `<reviewer>` | Final evidence references |

Do not combine a global retirement approval with a tenant-scoped approval. If
global scope is not explicitly approved, leave its rows and its compatibility
path intact.

## 5. Sanitized evidence index

Create an evidence directory outside the repository. The names below align
with the runbook commands and make review straightforward:

```text
legacy-cutover-YYYYMMDD-HHMMSS/
├── legacy-mapping-coverage-before.json
├── legacy-mapping-retirement-readiness-before.json
├── provider-migration-readiness-before.json
├── verified-mappings-status.txt
├── legacy-mapping-coverage-after-verification.json
├── legacy-mapping-retirement-readiness-after-verification.json
├── tenant-retirement-result.json                 # only when used
├── global-retirement-result.json                  # only when used
├── legacy-provider-cutover-result.json
└── evidence-index.md                              # links to approved UI captures/exports
```

In `evidence-index.md`, record only: change ticket, timestamp, anonymous
test-user label, mapping id, candidate mapping id, resource/action, expected
and actual decision, audit-event id, and a link to the approved protected
artifact. Do not copy protected screenshots or raw identity data into this
directory.

## 6. Completion decision

| Gate | Result | Reviewer | Timestamp |
| --- | --- | --- | --- |
| All in-scope mappings have a verified replacement. | `<pass/fail>` | `<reviewer>` | `<timestamp>` |
| Readiness was true immediately before each retirement. | `<pass/fail>` | `<reviewer>` | `<timestamp>` |
| All intended target-provider accesses remain allowed. | `<pass/fail>` | `<reviewer>` | `<timestamp>` |
| All deliberate negative checks remain denied. | `<pass/fail>` | `<reviewer>` | `<timestamp>` |
| The legacy provider was disabled only after the above gates passed. | `<pass/fail/not attempted>` | `<reviewer>` | `<timestamp>` |

Mark the deployed-evidence checklist item complete only after a reviewer has
accepted this record and its protected evidence. A completed worksheet never
by itself authorizes removal of a compatibility path or legacy evaluator code.

## 7. Rollback decision log

| Trigger | Decision | Operator | Timestamp | Follow-up |
| --- | --- | --- | --- | --- |
| `<failed sign-in / access mismatch / readiness blocker / audit discrepancy>` | `<stopped / rolled back>` | `<owner>` | `<timestamp>` | `<reference>` |

Use the rollback procedure in the runbook. Record whether a mapping was
re-enabled or the selected persisted legacy provider was re-enabled, then
repeat Effective Access before closing the incident or change.
