#!/usr/bin/env bash
set -euo pipefail

: "${CI:?This script may only run in CI.}"
: "${GH_TOKEN:?GH_TOKEN is required.}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required.}"
: "${RELEASE_PR_NUMBER:?RELEASE_PR_NUMBER is required.}"
: "${RELEASE_PR_HEAD_REF:?RELEASE_PR_HEAD_REF is required.}"
: "${RELEASE_VERSION:?RELEASE_VERSION is required.}"

if [[ ! "$RELEASE_PR_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "Invalid release PR number: $RELEASE_PR_NUMBER" >&2
  exit 1
fi
if [[ ! "$RELEASE_PR_HEAD_REF" =~ ^release-please--branches--[A-Za-z0-9._/-]+$ ]]; then
  echo "Refusing to update unexpected release PR branch: $RELEASE_PR_HEAD_REF" >&2
  exit 1
fi
if [[ ! "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid release version: $RELEASE_VERSION" >&2
  exit 1
fi

git fetch --no-tags origin \
  "+refs/heads/${RELEASE_PR_HEAD_REF}:refs/remotes/origin/${RELEASE_PR_HEAD_REF}"
git checkout -B "$RELEASE_PR_HEAD_REF" "origin/$RELEASE_PR_HEAD_REF"

base_tag="$(git tag --list 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1)"
if [[ -z "$base_tag" ]]; then
  echo "No stable release tag is available for detailed release-note generation." >&2
  exit 1
fi

release_file="docs/releases/v${RELEASE_VERSION}.md"
node scripts/release-notes.mjs assert-version \
  --base-ref "$base_tag" \
  --version "$RELEASE_VERSION"
node scripts/release-notes.mjs render \
  --base-ref "$base_tag" \
  --version "$RELEASE_VERSION" \
  --output "$release_file"

git add "$release_file"
if ! git diff --cached --quiet; then
  git config user.name "enterpriseglue-release-bot"
  git config user.email "release-bot@enterpriseglue.local"
  git commit -m "docs(release): prepare v${RELEASE_VERSION} notes"
  git push origin "HEAD:refs/heads/${RELEASE_PR_HEAD_REF}"
fi

gh api \
  --method PATCH \
  "repos/${GITHUB_REPOSITORY}/pulls/${RELEASE_PR_NUMBER}" \
  -f "body=$(<"$release_file")" >/dev/null

echo "Detailed release notes prepared in ${release_file} and copied to PR #${RELEASE_PR_NUMBER}."
