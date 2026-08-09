# Collect Access-Governance Deployment Evidence

Summary: Run the machine-readable local evidence matrix and record the
separate real-OpenShift rollout gate without overstating emulator results.

Audience: Release engineers, platform operators, security reviewers, and CI
maintainers.

## Evidence Contract

The canonical matrix is
`test/authz/deployment-evidence-matrix.json`. Every lane declares:

- a stable lane ID;
- an environment classification;
- prerequisites and an executable package script, or an external procedure;
- retained artifact descriptions;
- observable success criteria;
- the required scenarios it covers; and
- the pull-request, local-release, release, or external-acceptance gates it participates in.

The validator rejects missing scripts, duplicate lanes, unknown or uncovered
scenario IDs, a local lane claiming external OpenShift evidence, and a
pull-request lane that requires an emulator or container.

## Local Commands

Validate the manifest and its anti-skip contracts:

```bash
pnpm run test:deployment-evidence:contracts
```

Run the fast pull-request contract profile:

```bash
pnpm run test:deployment-evidence:pr
```

Run the disposable identity emulators:

```bash
pnpm run test:deployment-evidence:emulators
```

Run the Docker and real-Operaton container lanes:

```bash
pnpm run test:deployment-evidence:containers
```

Run every locally reproducible lane:

```bash
pnpm run test:deployment-evidence:local
```

Each successful command writes only bounded receipts and
`test/results/access-governance-deployment/index.json`. Raw credentials,
environment variables, identity claims, request/response bodies, and service
logs are not copied into the retained evidence index. A local run leaves the
external OpenShift lane `pending`; it never converts that lane to passed.

Receipts from another commit, another matrix hash, an unknown lane, or a
receipt that does not explicitly declare `containsCredentials: false` and
`containsTokens: false` are treated as invalid.

## CI Profiles

The Access Governance Deployment Evidence workflow runs:

- the local-contract profile on pull requests;
- the identity-emulator and Operaton-container profiles on scheduled and
  manually dispatched runs; and
- each chained job rebuilding the same sanitized index before it uploads only
  the bounded matrix receipts.

The workflow's OpenShift job is an explicit environment gate. It must not run
against a customer or production namespace. A missing OpenShift environment
is reported as pending evidence, not a pass and not a generic skipped test.

## Real OpenShift Gate

### Required environment

Use a dedicated, disposable, non-production OpenShift namespace with:

- a healthy known-good EnterpriseGlue deployment;
- immutable candidate backend and frontend images;
- permission to update the bundle ConfigMap and observe Deployments,
  ReplicaSets, and Pods;
- configuration fail-closed readiness enabled;
- `maxUnavailable: 0`, `maxSurge: 1`, and the published readiness probe; and
- a cluster-side evidence store whose objects can be referenced by SHA-256
  without copying cluster names, routes, namespaces, logs, or secrets into the
  repository artifact.

The gate is not satisfied by Kustomize rendering, a mocked `oc` command, a
local Kubernetes cluster, or a Docker emulator.

### Test procedure

1. Check out the exact clean release-candidate commit.
2. Deploy the candidate images with a valid reviewed ConfigMap bundle and
   secret references. Wait for readiness.
3. Record a cluster-side digest of the healthy Deployment/ReplicaSet summary.
4. Change only the bundle input to a syntactically readable but semantically
   invalid bundle and retain fail-closed mode.
5. Wait for the new rollout to exceed its progress deadline. It must not
   become ready.
6. Prove at least one pod from the previously healthy ReplicaSet remains ready
   and serving the internal health check.
7. Restore the known-good reviewed bundle, trigger a new rollout, and wait for
   readiness.
8. Record cluster-side SHA-256 digests for the valid projection, failed
   rollout, retained prior ReplicaSet, sanitized readiness issue, and recovery
   rollout.
9. Create the bounded input below. Do not include artifact names derived from
   namespaces, URLs, cluster identities, usernames, logs, paths, or secret
   references.

```text
{
  "schemaVersion": 1,
  "laneId": "external-openshift-rollout",
  "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "executedAt": "2026-07-29T10:00:00.000Z",
  "environmentClass": "external_openshift",
  "checks": {
    "configmap_secret_rendered": true,
    "new_rollout_failed_closed": true,
    "previous_replica_set_available": true,
    "recovery_rollout_succeeded": true,
    "sanitized_readiness_retained": true
  },
  "artifacts": [
    {
      "id": "rollout-summary",
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  ]
}
```

Record the external lane only inside the protected evidence environment:

```bash
export DEPLOYMENT_EVIDENCE_EXTERNAL_GATE=openshift
pnpm run test:deployment-evidence:record-openshift -- \
  --input ./sanitized-openshift-evidence.json
pnpm run test:deployment-evidence:index
```

The recorder requires the exact clean candidate commit, all five checks, and
artifact references containing only stable IDs and SHA-256 digests. It rejects
sensitive-looking fields and values.

### Success criteria

The external lane passes only when:

- the candidate reads the valid ConfigMap and Secret projection and becomes
  ready;
- the invalid fail-closed rollout does not replace the healthy ReplicaSet;
- prior ready pods remain available during the failed rollout;
- restoring known-good configuration completes a healthy rollout;
- every retained external artifact has a SHA-256 reference; and
- the recorder accepts the bounded input without credentials or environment
  identity.

### Rollback conditions

Stop the rehearsal and restore the known-good bundle immediately when:

- prior ready replicas drop below the environment's safe minimum;
- the invalid candidate becomes ready;
- a secret value appears in output intended for retention;
- the tested namespace is not dedicated to evidence; or
- the candidate commit or images do not match the release input.

Do not automatically delete the prior ReplicaSet. Restore the reviewed
ConfigMap, trigger the recovery rollout, verify readiness, and retain the
failed external lane as failed until the entire procedure is rerun.

## Release Decision

`index.json` is release-qualified when every `release` lane has a valid
same-commit receipt and the worktree is clean. For 0.11.0, the protected real
OpenShift rehearsal is an explicitly deferred `external_acceptance` gate: its
absence is reported as pending and cannot be mistaken for passed evidence, but
it does not block the release decision. Local rendering proves the manifests;
it never substitutes for a later real-cluster acceptance receipt.
