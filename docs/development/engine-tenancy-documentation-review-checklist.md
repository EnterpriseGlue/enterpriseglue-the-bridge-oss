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

An operator who did not implement the feature must use only the published
Markdown guides to:

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
9. identify the compatibility warning, metrics, and rollback conditions.

Use local placeholder engines and identities. No deployed customer identity
provider or credential is required.

## Acceptance Record

| Review | Reviewer | Commit | Evidence location | Result/date |
| --- | --- | --- | --- | --- |
| Engineering | Pending | Pending | Pending | Pending |
| Security | Pending | Pending | Pending | Pending |
| Independent operator | Pending | Pending | Pending | Pending |

Release approval requires all three rows, zero unresolved high-risk findings,
and an expiring waiver for any non-security documentation defect. A failed
security boundary cannot be waived through documentation review.

After approval, retain
`test/results/engine-tenancy-release/documentation-review.json` with:

- `schemaVersion`, `evidenceKind`, `generatedAt`, and the exact `commit`;
- `status: "passed"` and `releaseCommitQualified: true`;
- `reviews.engineering.status`, `reviews.security.status`, and
  `reviews.independentOperator.status`, each set to `approved`;
- reviewer identity, review date, and tenant-safe evidence location for each
  review; and
- a sanitization declaration confirming that no credentials, tokens, private
  endpoints, raw claims, or customer identifiers are present.

The release evidence index rejects a missing, dirty, different-commit, or
partially approved review artifact.

## Related Documentation

- [Centralized and Decentralized Engine Tenancy Implementation Plan](../architecture/12-engine-tenancy-and-external-provisioning-plan.md)
- [Test Engine Tenancy and Fine-Grained Access Control](./testing-engine-tenancy-and-access-control.md)
- [Engine Tenancy Functional Test Report](./engine-tenancy-functional-test-report.md)
- [Upgrade to Explicit Engine Tenancy](../how-to/upgrade-engine-tenancy.md)
