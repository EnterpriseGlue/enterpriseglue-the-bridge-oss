---
name: enterpriseglue-post-ship-watch
description: Use when the user says /post-ship-watch, watch after ship, monitor a shipped EnterpriseGlue PR, keep an eye on merge queue, verify OSS package publish, follow Release Please creation, or inspect EE sync follow-up after a merge.
---

# EnterpriseGlue /post-ship-watch

1. Monitor the shipped PR, merge queue, package publication, Release Please
   run, and resulting release PR with `gh`.
2. Confirm the release PR generator committed `docs/releases/vX.Y.Z.md` and
   copied it into the PR body. Treat missing or stale detailed notes as a
   release blocker.
3. Confirm package versions in the generated document match the packages
   actually published from `main`.
4. Report concrete failed job names and log excerpts. Do not mutate PRs, rerun
   jobs, or close follow-up PRs unless the user requested automatic recovery or
   the safe action is explicit.
5. If asked to keep watching later, use a thread heartbeat automation rather
   than a permanent cron.
