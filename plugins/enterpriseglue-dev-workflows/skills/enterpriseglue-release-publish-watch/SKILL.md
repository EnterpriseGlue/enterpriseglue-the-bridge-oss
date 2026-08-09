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
5. Verify listed OSS packages exist at the versions recorded in the detailed
   release notes and identify required EE synchronization.
6. Never delete, recreate, or repoint a published tag. Rerun jobs only for a
   clearly transient failure or when the user authorizes automatic recovery.
7. If asked to keep watching later, use a thread heartbeat automation rather
   than a permanent cron.
