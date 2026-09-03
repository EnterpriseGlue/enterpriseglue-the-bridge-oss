import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflow = await readFile(
  new URL('../.github/workflows/release-canary.yml', import.meta.url),
  'utf8',
)
const frontendDockerfile = await readFile(
  new URL('../frontend/Dockerfile.prod', import.meta.url),
  'utf8',
)

test('release canary is scheduled, manual, immutable, and non-cancelling', () => {
  assert.match(workflow, /schedule:/)
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
