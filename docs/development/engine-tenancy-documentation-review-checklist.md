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
6. preview/apply/roll back a topology or mapping change;
7. rotate a credential reference and decommission an external engine; and
8. identify the compatibility warning, metrics, and rollback conditions.

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

## Related Documentation

- [Centralized and Decentralized Engine Tenancy Implementation Plan](../architecture/12-engine-tenancy-and-external-provisioning-plan.md)
- [Test Engine Tenancy and Fine-Grained Access Control](./testing-engine-tenancy-and-access-control.md)
- [Upgrade to Explicit Engine Tenancy](../how-to/upgrade-engine-tenancy.md)

