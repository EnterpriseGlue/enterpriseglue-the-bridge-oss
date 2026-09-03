---
name: enterpriseglue-post-ship-watch
description: Use when the user says /post-ship-watch, watch after ship, monitor a shipped EnterpriseGlue PR, keep an eye on merge queue, verify OSS package publication, follow Release Please creation, or inspect plugin-consumer compatibility after a merge.
---

# EnterpriseGlue /post-ship-watch

1. Monitor the shipped PR, merge queue, package publication, Release Please
   run, and resulting release PR with `gh`.
2. Confirm the release PR generator committed `docs/releases/vX.Y.Z.md` and
   copied it into the PR body. Treat missing or stale detailed notes as a
   release blocker.
3. Confirm package versions in the generated document match the exact tarballs
   retained in the signed release candidate. Do not accept a package rebuilt
   from a later `main` checkout.
4. For plugin-platform changes, verify the five plugin/API packages before the
   three host packages, their registry payload receipts, the signed toolchain
   artifacts, and supported plugin-consumer compatibility lanes. Do not wait
   for or create an EE synchronization follow-up.
5. Report concrete failed job names and log excerpts. Do not mutate PRs, rerun
   jobs, or close follow-up PRs unless the user requested automatic recovery or
   the safe action is explicit.
6. If asked to keep watching later, use a thread heartbeat automation rather
   than a permanent cron.
