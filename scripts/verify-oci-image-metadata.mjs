import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REQUIRED_LABELS = {
  source: 'org.opencontainers.image.source',
  revision: 'org.opencontainers.image.revision',
  version: 'org.opencontainers.image.version',
};

function requireSafeValue(value, description) {
  if (typeof value !== 'string' || value.length === 0 || /[\r\n]/.test(value)) {
    throw new Error(`${description} must be a non-empty single-line string`);
  }
  return value;
}

function labelsForPlatform(inspectResult, platform) {
  const config = inspectResult?.image?.[platform]?.config;
  const labels = config?.Labels ?? config?.labels;
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) {
    throw new Error(`Image metadata for ${platform} does not contain OCI labels`);
  }
  return labels;
}

export function verifyOciImageMetadata(inspectResult, {
  expectedPlatforms = ['linux/amd64', 'linux/arm64'],
  expectedSource,
  expectedRevision,
  expectedVersion,
} = {}) {
  if (!inspectResult || typeof inspectResult !== 'object' || Array.isArray(inspectResult)) {
    throw new Error('Image inspection result must be an object');
  }

  const digest = requireSafeValue(inspectResult.manifest?.digest, 'Manifest digest');
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`Manifest digest is not a canonical sha256 digest: ${digest}`);
  }

  if (!Array.isArray(expectedPlatforms) || expectedPlatforms.length === 0) {
    throw new Error('At least one expected image platform is required');
  }

  const platformMetadata = expectedPlatforms.map((platform) => {
    const safePlatform = requireSafeValue(platform, 'Image platform');
    const labels = labelsForPlatform(inspectResult, safePlatform);
    return {
      platform: safePlatform,
      source: requireSafeValue(labels[REQUIRED_LABELS.source], `${safePlatform} source label`),
      revision: requireSafeValue(labels[REQUIRED_LABELS.revision], `${safePlatform} revision label`),
      version: requireSafeValue(labels[REQUIRED_LABELS.version], `${safePlatform} version label`),
    };
  });

  const [canonical] = platformMetadata;
  for (const metadata of platformMetadata.slice(1)) {
    for (const field of ['source', 'revision', 'version']) {
      if (metadata[field] !== canonical[field]) {
        throw new Error(
          `OCI ${field} label differs between ${canonical.platform} and ${metadata.platform}`,
        );
      }
    }
  }

  if (!/^https:\/\/[^\s]+$/.test(canonical.source)) {
    throw new Error(`OCI source label must be an HTTPS URL: ${canonical.source}`);
  }
  if (!/^[a-f0-9]{40}$/.test(canonical.revision)) {
    throw new Error(`OCI revision label must be a full 40-character Git SHA: ${canonical.revision}`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(canonical.version)) {
    throw new Error(`OCI version label must be a valid container tag: ${canonical.version}`);
  }

  const expectations = {
    source: expectedSource,
    revision: expectedRevision,
    version: expectedVersion,
  };
  for (const [field, expected] of Object.entries(expectations)) {
    if (expected !== undefined && canonical[field] !== expected) {
      throw new Error(`OCI ${field} label is ${canonical[field]}, expected ${expected}`);
    }
  }

  return {
    digest,
    source: canonical.source,
    revision: canonical.revision,
    version: canonical.version,
    platforms: platformMetadata.map(({ platform }) => platform),
  };
}

function parseExpectedPlatforms(value) {
  return requireSafeValue(value, 'EXPECTED_PLATFORMS')
    .split(',')
    .map((platform) => platform.trim())
    .filter(Boolean);
}

function renderGitHubOutputs(prefix, metadata) {
  if (!/^(backend|frontend)$/.test(prefix)) {
    throw new Error('Output prefix must be backend or frontend');
  }
  return [
    `${prefix}_digest=${metadata.digest}`,
    `${prefix}_source=${metadata.source}`,
    `${prefix}_revision=${metadata.revision}`,
    `${prefix}_version=${metadata.version}`,
    `${prefix}_platforms=${metadata.platforms.join(',')}`,
  ].join('\n');
}

function main() {
  const prefix = process.argv[2];
  const inspectResult = JSON.parse(readFileSync(0, 'utf8'));
  const metadata = verifyOciImageMetadata(inspectResult, {
    expectedPlatforms: parseExpectedPlatforms(
      process.env.EXPECTED_PLATFORMS ?? 'linux/amd64,linux/arm64',
    ),
    expectedSource: process.env.EXPECTED_SOURCE,
    expectedRevision: process.env.EXPECTED_REVISION,
    expectedVersion: process.env.EXPECTED_VERSION,
  });
  process.stdout.write(`${renderGitHubOutputs(prefix, metadata)}\n`);
  process.stderr.write(
    `Verified ${prefix} OCI provenance: ${metadata.version} ${metadata.revision} ${metadata.digest}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
