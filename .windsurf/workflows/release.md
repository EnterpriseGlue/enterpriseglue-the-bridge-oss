---
description: Publish one explicitly approved batch of merged PRs with generated documents
---

# /release

Use the maintained `enterpriseglue-release` skill at
`plugins/enterpriseglue-dev-workflows/skills/enterpriseglue-release/SKILL.md`.

Resolve all intended merged PRs since the previous stable tag and one final
source revision. Generate the combined versioned release document, verify its
managed PR comment and final candidate evidence, and merge the release PR
through protected checks.

Publication requires the explicit approved batch dispatch documented in the
skill. Automatic PR preparation cannot create releases. Preserve immutable
tags and exact signed payloads; publish one release for the complete batch.
