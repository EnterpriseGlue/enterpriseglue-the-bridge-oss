---
name: enterpriseglue-changelog
description: Use when the user says /changelog, preview the next release, show a pending Release Please changelog, categorize commits since the last release, or estimate OSS host and plugin-platform release contents.
---

# EnterpriseGlue /changelog

This workflow is read-only. Do not create, edit, or merge release pull requests.

1. Read `../../references/repository-lifecycle.json` and exclude retired
   repositories. Only an explicitly requested historical audit may read their
   old tags or changelog; they have no pending or next release.
2. Resolve the repository and fetch tags plus the default branch.
3. Run `node scripts/release-notes.mjs baseline` when the repository provides
   it. Report manifest/tag/changelog drift before estimating a version.
4. Find an open Release Please PR. If present, read its machine-readable body,
   the managed `<!-- enterpriseglue-detailed-release-notes -->` issue comment,
   `CHANGELOG.md` change, version manifest change, and
   `docs/releases/vX.Y.Z.md`. Report omissions, stale comment content, or
   contradictions without replacing the Release Please body.
5. If no release PR exists, run the detailed preview from the latest stable tag:

   ```bash
   node scripts/release-notes.mjs preview \
     --base-ref "$(git tag --list 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1)"
   ```

6. Supplement the preview with conventional commits not represented by a
   fragment and clearly mark the result as an estimate.
7. Summarize highlights, audiences, compatibility, upgrade actions, API and
   configuration changes, migrations, package versions, security, known
   limitations, rollback, and validation evidence.
