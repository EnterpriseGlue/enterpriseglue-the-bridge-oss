---
name: enterpriseglue-release-publish-watch
description: Use when the user says /release-publish-watch, watch release publish, monitor Docker Images after Release Please, verify EnterpriseGlue GHCR images, check partial release publish, or monitor OSS package publish after a release.
---

# EnterpriseGlue /release-publish-watch

1. Resolve the exact `vX.Y.Z` GitHub release and release commit.
2. Verify the GitHub release body matches `docs/releases/vX.Y.Z.md` from that
   commit and that the changelog and manifest record the same version.
3. Verify Docker Images status plus actual GHCR and configured Docker Hub image
   presence. Check immutable version tags, `latest`, architectures, source
   revision, and backend/frontend digests.
4. Confirm release smoke tests and vulnerability scans evaluated those exact
   digests. Do not treat a scan of an older `latest` image as release evidence.
5. Verify all package versions listed in the detailed notes came from the
   signed candidate: five plugin/API packages publish first, then shared,
   backend-host, and frontend-host publish in dependency order after their
   exact plugin/API dependencies are visible. Compare retained publication and
   registry-verification receipts; a matching version with different canonical
   payload is a release blocker. Confirm supported plugin consumers can install
   the set. Do not require or create an EE synchronization follow-up.
6. Never delete, recreate, or repoint a published tag. Rerun jobs only for a
   clearly transient failure or when the user authorizes automatic recovery.
7. If asked to keep watching later, use a thread heartbeat automation rather
   than a permanent cron.
8. Report the current rolling SLO assessment, tagged-release rebuild count,
   image retry count, and recovery-canary status when diagnosing slow or
   partial publication.
