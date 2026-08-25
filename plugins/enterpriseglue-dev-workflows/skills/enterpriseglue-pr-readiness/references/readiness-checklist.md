# Pull-request readiness checklist

Use only the rows selected by the diff.

| Area | Required evidence |
|---|---|
| Release impact | Valid changed fragment or permitted documented exemption; title, label, package versions, and expected release version agree |
| API and configuration | OpenAPI, public schemas, JSON configuration, examples, portal controls, and compatibility notes agree |
| Persistence | TypeORM migration, entity registration, upgrade/rollback notes, and supported database qualification agree |
| Security | Authentication, authorization, tenant isolation, secrets, audit behavior, denials, and revocation are tested |
| UI | Unit/browser/accessibility coverage and current visual evidence at the standard viewport |
| Operations | Deployment configuration, health/smoke evidence, observability, limitations, and rollback are documented |
| Documentation boundary | Repository docs are technical and public; internal product material and customer drafts remain outside Git; transient evidence uses CI or release artifacts |
| Packages | Published-package versions and plugin compatibility are validated |
| CI | Required checks pass; advisory, skipped, cancelled, and deferred evidence are explicitly classified |

Readiness rules:

- `Ready`: no unresolved required evidence or failing checks.
- `Conditional`: implementation is locally complete but named external or
  advisory evidence remains and the release decision records it.
- `Blocked`: a required gate fails, a contract is incomplete, or rollback and
  migration safety cannot be established.
