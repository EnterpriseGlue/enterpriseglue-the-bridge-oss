import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { verifyOciImageMetadata } from './verify-oci-image-metadata.mjs';

const source = 'https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss';
const revision = 'd8a290dd5232d5cbb2f0a6b56859c699ff4c7426';
const version = 'v1.2.3';
const digest = `sha256:${'a'.repeat(64)}`;

function inspectionResult({ amd64 = {}, arm64 = {} } = {}) {
  const labels = {
    'org.opencontainers.image.source': source,
    'org.opencontainers.image.revision': revision,
    'org.opencontainers.image.version': version,
  };
  return {
    manifest: { digest },
    image: {
      'linux/amd64': { config: { Labels: { ...labels, ...amd64 } } },
      'linux/arm64': { config: { Labels: { ...labels, ...arm64 } } },
    },
  };
}

test('returns consistent multi-platform OCI provenance', () => {
  assert.deepEqual(
    verifyOciImageMetadata(inspectionResult(), {
      expectedSource: source,
      expectedRevision: revision,
      expectedVersion: version,
    }),
    {
      digest,
      source,
      revision,
      version,
      platforms: ['linux/amd64', 'linux/arm64'],
    },
  );
});

test('rejects missing required labels and platform drift', () => {
  assert.throws(
    () => verifyOciImageMetadata(inspectionResult({ arm64: {
      'org.opencontainers.image.version': '',
    } })),
    /version label must be a non-empty single-line string/,
  );
  assert.throws(
    () => verifyOciImageMetadata(inspectionResult({ arm64: {
      'org.opencontainers.image.revision': 'b'.repeat(40),
    } })),
    /revision label differs between linux\/amd64 and linux\/arm64/,
  );
});

test('rejects provenance that does not match the publishing context', () => {
  assert.throws(
    () => verifyOciImageMetadata(inspectionResult(), { expectedVersion: 'v9.9.9' }),
    /OCI version label is v1\.2\.3, expected v9\.9\.9/,
  );
});

test('CLI emits safe GitHub step outputs for the requested image prefix', () => {
  const script = fileURLToPath(new URL('./verify-oci-image-metadata.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, 'backend'], {
    encoding: 'utf8',
    input: JSON.stringify(inspectionResult()),
    env: {
      ...process.env,
      EXPECTED_PLATFORMS: 'linux/amd64,linux/arm64',
      EXPECTED_SOURCE: source,
      EXPECTED_REVISION: revision,
      EXPECTED_VERSION: version,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`^backend_digest=${digest}$`, 'm'));
  assert.match(result.stdout, new RegExp(`^backend_revision=${revision}$`, 'm'));
  assert.match(result.stdout, /^backend_platforms=linux\/amd64,linux\/arm64$/m);
});
