# Engine Tenancy Documentation Review Checklist

Summary: Executable handoff for the engineering, security, and independent
operator review required before release.

Audience: Reviewers and release managers.

## Automated Baseline

Review the exact release candidate commit, then run:

```bash
pnpm run test:engine-tenancy:documentation
pnpm run test:engine-tenancy:foundation
pnpm run test:engine-tenancy:provisioning
pnpm run test:engine-tenancy:mappings
pnpm run test:engine-tenancy:authorization
pnpm run test:engine-tenancy:runtime
pnpm run test:engine-tenancy:transitions
pnpm run test:engine-tenancy:operations
pnpm run test:engine-tenancy:source-coverage
ENGINE_TENANCY_APPLY_READY=true pnpm run test:engine-tenancy:local-evidence
pnpm run test:authz:local-smoke:cross-browser
pnpm run test:engine-tenancy:evidence-index
```

All commands must pass without skipped/quarantined tests. Attach the commit,
Node/pnpm versions, database adapter, operating system, and command output.

## Engineering Review

- canonical Zod schemas, runtime validators, OpenAPI, examples, and typed
  clients agree;
- manual, external, and configuration ownership/lifecycle are accurate;
- migration ordering, adapter portability, idempotency, retry, and rollback are
  reproducible;
- the authorization generator takes all dimensions from canonical production
  registries, every exclusion has a stable applicability rule and executed
  witness, and equivalence compression reports its full expansion count;
- `authorization-matrix.json` reports zero unknown, missing, skipped,
  quarantined, or unexpected cells;
- every functional requirement ID resolves to the exact test and documentation
  named in the manifest; and
- no guide describes an unavailable endpoint or UI action.

## Security Review

- default fallback is provisioning-only and never shared/runtime authority;
- shared unresolved/conflicting/stale/unknown resources fail closed;
- broad engine/Engine Set grants do not bypass resolved same-tenant inventory;
- denied requests make no engine transport call;
- examples, errors, metrics, logs, audits, and retained evidence contain no
  credentials, raw claims, private URLs, or cross-tenant identifiers; and
- compatibility removal gates cannot be satisfied by elapsed time alone.

## Independent Operator Review

A designated independent operator reviewer must use only the published Markdown
guides to:

1. provision one dedicated engine through UI, API, and configuration;
2. provision one shared engine and two disjoint tenant mappings through the
   supported channels;
3. reconcile and diagnose one intentionally unmapped resource;
4. assign a predefined and custom tenant role;
5. verify same-tenant allow and sibling/unmapped deny;
6. revoke a role or membership and verify an active tab, stale second tab,
   refresh, direct URL, and browser history cannot restore access;
7. preview/apply/roll back a topology or mapping change;
8. rotate a credential reference and decommission an external engine; and
9. complete the
   [production enablement checklist](../how-to/configure-engine-tenancy.md#production-enablement-checklist)
   once for a decentralized dedicated engine and once for a centralized shared
   engine; and
10. prove omitted external tenancy receives HTTP 400 before persistence, no
    warning/default behavior remains, and identify the database/application
    restore conditions for the irreversible 0.11.0 boundary.

Use local placeholder engines and identities. No deployed customer identity
provider or credential is required.

## Reviewer Independence and Mode

Each review role may be fulfilled by either a human reviewer or a delegated
automated review agent when the release policy explicitly permits it. The
reviewer must be independent of the feature implementation agent and must
perform the role-specific procedure against the exact candidate commit. A
delegated agent is not represented as a human: its retained note and approval
record must identify it as `delegated-agent`, name its assigned role, and state
the commands and observations it made. This maintains accountable, reproducible
review evidence while allowing the designated release policy to choose the
review mode.

## Acceptance Record

| Review | Reviewer | Mode | Commit | Evidence location | Result/date |
| --- | --- | --- | --- | --- | --- |
| Engineering | Pending | Pending | Pending | Pending | Pending |
| Security | Pending | Pending | Pending | Pending | Pending |
| Independent operator | Pending | Pending | Pending | Pending | Pending |

Release approval requires all three rows, zero unresolved high-risk findings,
and an expiring waiver for any non-security documentation defect. A failed
security boundary cannot be waived through documentation review.

Generate the automated portion first:

```bash
pnpm run test:engine-tenancy:documentation-review-evidence
```

This executes the documentation contracts and validates every internal file
link in all tracked `docs/**/*.md` files. The generated artifact deliberately
keeps engineering, security, and independent-operator reviews `pending`; the
automation cannot approve its own documentation. Each designated independent
reviewer or agent must execute this checklist against the exact artifact commit
before those statuses can be changed to `approved`.

Each reviewer writes sanitized Markdown notes under
`test/results/engine-tenancy-review/`. The notes must identify the commands and
procedures executed, actual results, findings and resolutions, reviewer
identity, review mode, review time, and exact commit. Do not include
credentials, tokens, private endpoints, raw claims, or customer identifiers.

Record each approval with the guarded recorder; do not edit the JSON artifact
by hand:

```bash
pnpm run record:engine-tenancy:documentation-review -- \
  --review engineering \
  --reviewer "Engineering reviewer identity" \
  --review-mode delegated-agent \
  --evidence test/results/engine-tenancy-review/engineering.md

pnpm run record:engine-tenancy:documentation-review -- \
  --review security \
  --reviewer "Security reviewer identity" \
  --review-mode delegated-agent \
  --evidence test/results/engine-tenancy-review/security.md

pnpm run record:engine-tenancy:documentation-review -- \
  --review independent-operator \
  --reviewer "Independent operator identity" \
  --review-mode delegated-agent \
  --evidence test/results/engine-tenancy-review/independent-operator.md
```

The recorder refuses a dirty worktree, stale or failed automated evidence,
unknown review roles or modes, missing reviewer identity, invalid time, unsafe
or missing evidence paths, and any artifact with unresolved high-risk findings.
It records the exact current commit, reviewer, review mode, ISO timestamp, and
evidence location. Regenerating automated documentation evidence on the same
unchanged commit preserves valid approvals and drops stale, incomplete, or
missing approval evidence.

After approval, retain
`test/results/engine-tenancy-release/documentation-review.json` with:

- `schemaVersion`, `evidenceKind`, `generatedAt`, and the exact `commit`;
- `status: "passed"` and `releaseCommitQualified: true`;
- `reviews.engineering.status`, `reviews.security.status`, and
  `reviews.independentOperator.status`, each set to `approved`;
- `unresolvedHighRiskFindings: 0`;
- non-zero `executableExamples.total` and `markdownLinks.total`, with each
  matching its corresponding `passed` count;
- reviewer identity, review mode, review date, and tenant-safe evidence
  location for each review; and
- a sanitization declaration confirming that no credentials, tokens, private
  endpoints, raw claims, or customer identifiers are present.

The release evidence index rejects a missing, dirty, different-commit, or
partially approved review artifact. It also rejects an approval whose
`approvedCommit` differs, whose reviewer/mode/date/evidence fields are
incomplete, whose evidence is missing, or whose evidence location is outside
`test/results/engine-tenancy-review/`.

## Related Documentation

- [Centralized and Decentralized Engine Tenancy Implementation Plan](../architecture/12-engine-tenancy-and-external-provisioning-plan.md)
- [Test Engine Tenancy and Fine-Grained Access Control](./testing-engine-tenancy-and-access-control.md)
- [Engine Tenancy Functional Test Report](./engine-tenancy-functional-test-report.md)
- [Upgrade to Explicit Engine Tenancy](../how-to/upgrade-engine-tenancy.md)
