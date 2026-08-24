#!/usr/bin/env node

import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function argumentsMap(argv) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv;
  const result = {};
  for (let index = 0; index < normalized.length; index += 2) {
    const name = normalized[index];
    const value = normalized[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error('Expected --name value arguments');
    }
    result[name.slice(2)] = value;
  }
  return result;
}

function integer(values, name, fallback) {
  const value = Number(values[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`--${name} must be a valid port`);
  }
  return value;
}

async function privateWrite(path, value) {
  await writeFile(path, `${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

const values = argumentsMap(process.argv.slice(2));
const repository = resolve(values.repository ?? process.cwd());
const output = resolve(values.output ?? resolve(repository, '.local/plugin-manager-evidence'));
const backendPort = integer(values, 'backend-port', 28787);
const managerPort = integer(values, 'manager-port', 28788);
await mkdir(output, { recursive: true, mode: 0o700 });
await mkdir(resolve(output, 'releases'), { recursive: true, mode: 0o700 });
await mkdir(resolve(output, 'executions'), { recursive: true, mode: 0o700 });
await mkdir(resolve(output, 'installer'), { recursive: true, mode: 0o700 });

const generatedAt = new Date(Date.now() - 60_000).toISOString();
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
const hash = (character) => character.repeat(64);
const release = `registry.example/enterpriseglue/example-support-release@sha256:${hash('1')}`;
const packageSubject = `registry.example/enterpriseglue/example-support-package@sha256:${hash('4')}`;
const evidenceSubject = (name, character) =>
  `registry.example/enterpriseglue/example-support-${name}@sha256:${hash(character)}`;
const catalog = {
  apiVersion: 'catalog.plugin.enterpriseglue.io/v2',
  kind: 'EnterpriseGluePluginCatalog',
  metadata: { revision: '1.0.0', generatedAt, expiresAt },
  products: [
    {
      descriptor: {
        apiVersion: 'product.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginProduct',
        productId: 'io.enterpriseglue.example-support',
        pluginId: 'io.enterpriseglue.example-support',
        publisher: {
          id: 'io.enterpriseglue',
          displayName: 'EnterpriseGlue',
          verification: 'first_party',
        },
        displayName: 'Example Support',
        summary: 'Contextual Operaton and EnterpriseGlue support with customer-side diagnostic filtering.',
        categories: ['operations', 'support'],
        documentationUrl: 'https://docs.example.invalid/plugins/example-support',
        supportUrl: 'https://enterpriseglue.ai/support',
        securityUrl: 'https://enterpriseglue.ai/security',
        privacyUrl: 'https://enterpriseglue.ai/privacy',
        dataFlowUrl: 'https://enterpriseglue.ai/data-flow',
        retentionUrl: 'https://enterpriseglue.ai/retention',
        subprocessorsUrl: 'https://enterpriseglue.ai/subprocessors',
        deploymentModes: ['compose_planner', 'compose_managed', 'kubernetes', 'openshift'],
        architectures: ['amd64', 'arm64'],
        commercialAction: 'entitled',
      },
      releases: [
        {
          version: '1.1.0',
          channel: 'stable',
          state: 'available',
          release,
        },
      ],
    },
  ],
};
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
// privateWrite terminates text files with exactly one newline. Sign those
// canonical on-disk bytes so local evidence exercises the production verifier
// rather than relying on a fixture-only byte representation.
const payloadText = JSON.stringify(catalog);
const signedPayload = Buffer.from(`${payloadText}\n`, 'utf8');
const envelope = {
  apiVersion: 'signature.plugin.enterpriseglue.io/v1',
  algorithm: 'Ed25519',
  publisher: 'io.enterpriseglue',
  keyId: 'local-evidence-key-1',
  payloadSha256: createHash('sha256').update(signedPayload).digest('hex'),
  signature: sign(null, signedPayload, privateKey).toString('base64url'),
};
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const trust = {
  signers: [
    {
      publisher: 'io.enterpriseglue',
      keyId: 'local-evidence-key-1',
      publicKeyPem,
      status: 'active',
    },
  ],
};

const releaseDocument = {
  apiVersion: 'release.plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePluginRelease',
  pluginId: 'io.enterpriseglue.example-support',
  publisher: 'io.enterpriseglue',
  version: '1.1.0',
  channel: 'stable',
  releaseState: 'available',
  package: packageSubject,
  artifacts: [
    {
      role: 'package',
      subject: packageSubject,
      mediaType: 'application/vnd.enterpriseglue.plugin.package.v1+tar',
      platforms: [{ os: 'linux', architecture: 'amd64' }],
    },
  ],
  compatibility: {
    hostRange: '^0.15.0',
    hostApiRange: '^1.0.0',
    sdkRange: '^0.3.0',
    deploymentModes: ['compose_planner'],
    architectures: ['amd64'],
    evidence: [
      {
        hostVersion: '0.15.0',
        hostArtifact: `ghcr.io/enterpriseglue/backend@sha256:${hash('2')}`,
        deploymentMode: 'compose_planner',
        platform: 'docker',
        architecture: 'amd64',
        database: 'postgres',
        suiteRevision: 'example-support-local-evidence-v1',
        testedAt: generatedAt,
        evidenceSha256: hash('5'),
      },
    ],
  },
  dependencies: [],
  conflicts: [],
  requiredCapabilities: [],
  permissions: [],
  data: {
    reads: ['io.enterpriseglue.sanitized-diagnostics'],
    generates: ['io.enterpriseglue.support-cases'],
    retentionClass: 'customer_policy',
    leavesDeployment: true,
  },
  infrastructure: {
    storageMiB: 256,
    cpuLimit: '500m',
    memoryLimitMiB: 512,
    egressPolicy: 'io.enterpriseglue.support-api-only',
    secretReferences: ['io.enterpriseglue.example-support-api-token'],
  },
  schemaTransition: {
    from: 0,
    to: 0,
    rollbackClass: 'stateless',
    backupRequired: false,
    downtimeExpected: false,
  },
  support: {
    startsAt: generatedAt,
    endsAt: new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString(),
    reasonCode: 'none',
  },
  evidence: {
    signature: evidenceSubject('signature', '6'),
    provenance: evidenceSubject('provenance', '7'),
    sbom: evidenceSubject('sbom', '8'),
    scan: evidenceSubject('scan', '9'),
    license: evidenceSubject('license', 'a'),
  },
  entitlementSku: 'io.enterpriseglue.example-support',
  updateEdges: [],
};

const releasePayload = Buffer.from(`${JSON.stringify(releaseDocument)}\n`, 'utf8');
const releaseSignature = {
  apiVersion: 'signature.plugin.enterpriseglue.io/v1',
  algorithm: 'Ed25519',
  publisher: 'io.enterpriseglue',
  keyId: 'local-evidence-key-1',
  payloadSha256: createHash('sha256').update(releasePayload).digest('hex'),
  signature: sign(null, releasePayload, privateKey).toString('base64url'),
};
const releaseSignatureBytes = Buffer.from(
  `${JSON.stringify(releaseSignature, null, 2)}\n`,
  'utf8',
);
const releaseDigest = release.slice(release.lastIndexOf(':') + 1);
const releaseDirectory = resolve(output, 'releases', `sha256-${releaseDigest}`);
await mkdir(releaseDirectory, { recursive: true, mode: 0o700 });
await writeFile(resolve(releaseDirectory, 'release.json'), releasePayload, {
  mode: 0o600,
});
await writeFile(
  resolve(releaseDirectory, 'release.signature.json'),
  releaseSignatureBytes,
  { mode: 0o600 },
);
await privateWrite(resolve(releaseDirectory, 'release.acquisition.json'), {
  apiVersion: 'release-acquisition.plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePluginReleaseAcquisition',
  subject: release,
  artifactType: 'application/vnd.enterpriseglue.plugin.release.v1+json',
  source: 'offline_import',
  payloadSha256: createHash('sha256').update(releasePayload).digest('hex'),
  signatureSha256: createHash('sha256')
    .update(releaseSignatureBytes)
    .digest('hex'),
  verifiedAt: generatedAt,
});

await privateWrite(resolve(output, 'catalog.json'), payloadText);
await privateWrite(resolve(output, 'catalog.signature.json'), envelope);
await privateWrite(resolve(output, 'trust.json'), trust);
await privateWrite(resolve(output, 'cosign-public.pem'), publicKeyPem.trim());
await privateWrite(resolve(output, 'cosign-policy.json'), {
  mode: 'public_key',
  publicKeyFile: resolve(output, 'cosign-public.pem'),
});
await privateWrite(resolve(output, 'workload-token'), randomBytes(32).toString('hex'));

const managerConfig = {
  apiVersion: 'manager-config.plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePluginManagerConfig',
  capability: {
    apiVersion: 'manager-capability.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginManagerCapability',
    managerId: 'enterpriseglue-plugin-manager-local-evidence',
    managerVersion: '0.1.0',
    protocolVersions: ['v1'],
    deploymentModes: ['compose_planner'],
    architectures: ['amd64'],
    operations: ['plan', 'install', 'upgrade', 'offline_import'],
    state: 'planner_only',
    observedAt: new Date(0).toISOString(),
  },
  host: {
    baseUrl: `http://127.0.0.1:${backendPort}`,
    workloadTokenFile: resolve(output, 'workload-token'),
    version: '0.15.0',
    artifact: `ghcr.io/enterpriseglue/backend@sha256:${hash('2')}`,
    apiVersion: '1.0.0',
    sdkVersion: '0.3.0',
    platformRevision: 0,
    database: 'postgres',
    entitlementState: 'active',
  },
  deployment: {
    mode: 'compose_planner',
    platform: 'docker',
    architecture: 'amd64',
  },
  storage: {
    releaseRoot: resolve(output, 'releases'),
    executionRoot: resolve(output, 'executions'),
    installerOutput: resolve(output, 'installer'),
  },
  connectedRegistry: {
    trustFile: resolve(output, 'trust.json'),
    cosignPolicyFile: resolve(output, 'cosign-policy.json'),
  },
  offlineDelivery: {
    intakeRoot: resolve(output, 'releases'),
  },
  adapter: {
    type: 'compose',
    projectDirectory: repository,
    composeFiles: [resolve(repository, 'infra/docker/compose/docker-compose.yml')],
    projectName: 'enterpriseglue-plugin-evidence',
    utilityImage: `ghcr.io/enterpriseglue/plugin-manager@sha256:${hash('3')}`,
    imageMode: 'pull',
  },
  service: {
    host: '127.0.0.1',
    port: managerPort,
    pollIntervalMs: 5000,
  },
};
await privateWrite(resolve(output, 'manager-config.json'), managerConfig);

console.log(
  JSON.stringify({
    status: 'prepared',
    output,
    catalog: resolve(output, 'catalog.json'),
    catalogSignature: resolve(output, 'catalog.signature.json'),
    trust: resolve(output, 'trust.json'),
    workloadToken: resolve(output, 'workload-token'),
    managerConfig: resolve(output, 'manager-config.json'),
    offlineRelease: release,
    offlineReleaseDirectory: releaseDirectory,
    backendPort,
    managerPort,
  }),
);
