# Customer-sidecar mirrored-backstop test report

This report records the executable coverage for the
`mirrored_engine_backstop` behavior when a Camunda 7-compatible Operaton engine
is registered through a customer-owned sidecar. It covers the implemented
feature boundary; it is not a claim of 100% line coverage for the entire
EnterpriseGlue repository.

Run the full local lane with:

```bash
pnpm run test:sidecar-backstop
```

| Area | What is verified | Evidence |
| --- | --- | --- |
| Engine eligibility | Active Camunda 7 and Operaton engines are accepted; unsupported/inactive engines remain rejected. Direct and `customer_sidecar` connection modes share the encrypted mapping boundary. | `engineBackstopGroupMappingService.test.ts` |
| Transport selection | Preview receipts persist `customerSidecarTransport`; apply selects the sidecar client only when that receipt capability is set. Direct receipts select the direct client. | `engineBackstopSyncService.test.ts` |
| Bounded native API | The adapter can create only exact group `READ` grants and read/delete only an ID-addressed authorization. A native 404 becomes an absent owned grant. | `engineBackstopSyncService.test.ts` |
| Proxy request contract | Sidecar calls carry the sanitized engine and operation metadata class `engine.native_authorization.backstop`; no downstream engine `Authorization` header is sent for credentialless sidecars. The reference adapter refuses every non-authorization route and strips arbitrary inbound headers before its downstream hop. | `bpmn-engine-client.test.ts`, `customer-sidecar-backstop.test.mjs` |
| Reference sidecar image | The reusable bounded sidecar adapter is packaged as a minimal Docker image and built in the repeatable coverage lane. | `test:customer-sidecar-reference-container` |
| Config lifecycle | Config-bundle preview, diff, and apply accept customer-sidecar Operaton mappings, resolve the native group reference only during apply, and redact its value from audit/diff output. | `configBundlePreviewService.test.ts`, `configBundleDiffService.test.ts`, `configBundleApplyService.test.ts` |
| Operator UI | Direct and customer-sidecar panels support mapping, preview, hash-bound apply, and acknowledged rollback. The sidecar panel explains the customer-managed downstream authentication boundary. | `EngineBackstopPanel.test.tsx` |
| Shared-tenant isolation | A shared engine blocks a mirrored process/decision grant when its native resource key is active in another tenant, because Camunda-compatible native authorizations have no EnterpriseGlue tenant dimension. | `engineBackstopProjectionService.test.ts`, `engineBackstopSyncService.test.ts` |
| API, persistence, redaction | Portable receipt/mapping persistence, action-guarded API routes, secret preflight/export, ownership-only rollback, and tracked-ID drift behavior remain covered in the focused backstop lane. A durable lifecycle integration runs the real run and task services together through preview, concurrent apply, and rollback. | `pnpm run test:engine-backstop` |
| Durable recovery | Concurrent enqueue requests collapse to one `run_id` task; only one worker receives the lease; expired leases recover and failed tasks use bounded retry scheduling. | `engineBackstopSyncTaskService.test.ts` |
| Real Operaton lifecycle | A disposable Docker Operaton engine behind a bounded local sidecar completes preview, apply, drift check, and rollback for both supported native resource types: process definition (`6`) and decision definition (`10`). It observes only create/read/delete authorization calls. | `test:operaton-sidecar-backstop-container` |
| Live authorization enforcement | A second disposable Operaton fixture enables HTTP Basic authentication and native authorization checks. A member of the synchronized group can read and list the deployed process and decision definitions; a non-member cannot. `READ` does not permit decision evaluation or process-instance creation. After owned-grant rollback, the former member is denied again. | `test:operaton-sidecar-backstop-container` |
| Fail-closed rejection | A sidecar policy rejection and an invalid sidecar-owned downstream bearer-token rejection both fail the run and prove no direct-adapter fallback occurs. | `test:operaton-sidecar-backstop-container` |
| Documentation contract | Configuration documentation schemas and deployment contract remain valid. | `pnpm run test:documentation-contracts` |

The Docker fixture temporarily permits loopback HTTP only inside its disposable
test process. Production endpoint allow-listing, HTTPS, and customer-sidecar
readiness requirements remain enforced as documented in the customer-sidecar
runbook.
