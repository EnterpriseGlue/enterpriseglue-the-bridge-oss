import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import './release-publication-canary.test.mjs'

const workflow = await readFile(
  new URL('../.github/workflows/release-canary.yml', import.meta.url),
  'utf8',
)
const frontendDockerfile = await readFile(
  new URL('../frontend/Dockerfile.prod', import.meta.url),
  'utf8',
)

test('release canary is scheduled, manual, immutable, and non-cancelling', () => {
  assert.match(workflow, /schedule:\n\s+- cron: "20 2 \* \* 3"/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /source_ref: \$\{\{ github\.sha \}\}/)
  assert.doesNotMatch(workflow, /needs\.resolve\.outputs\.source_ref/)
  assert.match(workflow, /cancel-in-progress: false/)
})

test('release canary reuses the production image workflow in scratch namespaces', () => {
  assert.match(workflow, /uses: \.\/\.github\/workflows\/docker-images-reusable\.yml/)
  assert.match(workflow, /enterpriseglue-release-canary-backend/)
  assert.match(workflow, /enterpriseglue-release-canary-frontend/)
  assert.match(workflow, /image_platforms: linux\/amd64,linux\/arm64/)
  assert.match(workflow, /security_rebuild: false/)
  assert.match(workflow, /enable_dockerhub: false/)
})

test('release drill verifies exact digests and cannot publish public artifacts', () => {
  const drill = workflow.slice(workflow.indexOf('  non-publishing-release-drill:\n'))
  assert.match(drill, /packages: read/)
  assert.doesNotMatch(drill, /packages: write/)
  assert.match(drill, /ref: \$\{\{ github\.sha \}\}\n\s+fetch-depth: 0/)
  assert.match(drill, /oras resolve/)
  assert.match(drill, /cosign verify/)
  assert.match(
    drill,
    /CERTIFICATE_IDENTITY: \$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}\/\.github\/workflows\/docker-images-reusable\.yml@\$\{\{ github\.ref \}\}/,
  )
  assert.doesNotMatch(drill, /CERTIFICATE_IDENTITY: .*release-canary\.yml/)
  assert.match(drill, /pnpm run test:release-readiness/)
  assert.match(drill, /publicationPerformed == false/)
  assert.match(drill, /publication-dry-run\.json/)
  assert.doesNotMatch(drill, /npm publish(?! --dry-run)/)
  assert.doesNotMatch(drill, /oras (?:push|cp)/)
  assert.doesNotMatch(drill, /docker buildx imagetools create/)
})

test('recovery drill detects a partial update and restores only scratch aliases', () => {
  const recovery = workflow.slice(
    workflow.indexOf('  scratch-alias-recovery-drill:\n'),
    workflow.indexOf('  non-publishing-release-drill:\n'),
  )
  assert.match(recovery, /packages: write/)
  assert.match(recovery, /enterpriseglue-release-canary-backend/)
  assert.match(recovery, /enterpriseglue-release-canary-frontend/)
  assert.match(recovery, /recovery-baseline/)
  assert.match(recovery, /recovery-active/)
  assert.match(recovery, /active_frontend.*!=.*CANDIDATE_FRONTEND_DIGEST/)
  assert.match(recovery, /fetch-release-candidate\.sh/)
  assert.match(recovery, /Missing candidate unexpectedly passed verification/)
  assert.match(recovery, /Production aliases changed: no/)
  assert.doesNotMatch(recovery, /--tag "\$PUBLIC_(?:BACKEND|FRONTEND):/)
})

test('first-party PR canaries require an explicit dispatch and exact head before obtaining scratch write permissions', () => {
  const resolver=workflow.slice(workflow.indexOf('  resolve-canary-source:'),workflow.indexOf('  scratch-images:'))
  assert.match(resolver,/context\.eventName !== 'workflow_dispatch'/)
  assert.match(resolver,/pull\.head\.sha === context\.sha/)
  assert.match(resolver,/pull\.head\.repo\?\.full_name/)
  assert.match(workflow,/scratch-images:[\s\S]*?needs: resolve-canary-source/)
})

test('the ledger canary exercises the production store only in a marked scratch namespace', () => {
  const ledger=workflow.slice(workflow.indexOf('  publication-ledger-canary:'),workflow.indexOf('  non-publishing-release-drill:'))
  assert.match(ledger,/enterpriseglue-release-canary-publication/)
  assert.match(ledger,/EG_PUBLICATION_CANARY: 'true'/)
  assert.match(ledger,/node scripts\/release-publication-ledger-canary\.mjs/)
  assert.match(ledger,/node --test scripts\/release-publication-record\.test\.mjs/)
  assert.doesNotMatch(ledger,/npm publish|docker buildx imagetools create|gh release create/)
})

test('frontend assets build natively while runtime tools match the target platform', () => {
  assert.match(
    frontendDockerfile,
    /^FROM --platform=\$BUILDPLATFORM node:24-alpine@sha256:[0-9a-f]{64} AS build$/m,
  )
  assert.doesNotMatch(frontendDockerfile, /FROM --platform=\$TARGETPLATFORM node:/)

  const runtimeStage = frontendDockerfile.slice(frontendDockerfile.lastIndexOf('\nFROM '))
  assert.match(runtimeStage, /apk add --no-cache busybox-static/)
  assert.match(runtimeStage, /cp \/bin\/busybox \/busybox\/busybox/)
  assert.doesNotMatch(
    frontendDockerfile.slice(0, frontendDockerfile.lastIndexOf('\nFROM ')),
    /busybox-static/,
  )
})
