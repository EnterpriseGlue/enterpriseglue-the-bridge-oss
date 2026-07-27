import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import {
  ociDigestReferenceSchema,
  pluginPackageIndexV1Schema,
  type PluginPackageIndexV1,
} from '@enterpriseglue/plugin-sdk';

const packageArtifactType =
  'application/vnd.enterpriseglue.plugin.package.v1';
const catalogArtifactType =
  'application/vnd.enterpriseglue.plugin.catalog.v1';
const distributionSpec = 'v1.1-referrers-api';
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const defaultMaximumDownloadBytes = 5 * 1024 ** 3;
const maximumAllowedDownloadBytes = 20 * 1024 ** 3;
const maximumReferrerCount = 512;
const maximumToolOutputBytes = 4 * 1024 ** 2;
const maximumRegistryReadAttempts = 3;
const registryRetryBaseDelayMs = 250;

const evidenceArtifactTypeByRole = {
  sbom: 'application/vnd.cyclonedx+json',
  provenance: 'application/vnd.in-toto+json',
  vulnerability_report:
    'application/vnd.enterpriseglue.plugin.vulnerability-report.v1+json',
  license_report:
    'application/vnd.enterpriseglue.plugin.license-report.v1+json',
  malware_report:
    'application/vnd.enterpriseglue.plugin.malware-report.v1+json',
  secret_scan_report:
    'application/vnd.enterpriseglue.plugin.secret-scan-report.v1+json',
} as const;

type EvidenceRole = keyof typeof evidenceArtifactTypeByRole;
type OciTool = 'oras' | 'cosign';

export interface OciAcquisitionCommandResultV1 {
  stdout: string;
  stderr: string;
}

export interface OciAcquisitionCommandPortV1 {
  run(
    tool: OciTool,
    args: readonly string[],
    options?: {
      cwd?: string;
      env?: Readonly<Record<string, string>>;
      timeoutMs?: number;
    },
  ): Promise<OciAcquisitionCommandResultV1>;
}

export class SpawnOciAcquisitionCommandPortV1
  implements OciAcquisitionCommandPortV1
{
  async run(
    tool: OciTool,
    args: readonly string[],
    options: {
      cwd?: string;
      env?: Readonly<Record<string, string>>;
      timeoutMs?: number;
    } = {},
  ): Promise<OciAcquisitionCommandResultV1> {
    return new Promise((fulfill, reject) => {
      const child = spawn(tool, [...args], {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env,
        },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let outputExceeded = false;
      let timedOut = false;
      const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
        if (outputExceeded) return;
        if (
          Buffer.byteLength(stdout) +
            Buffer.byteLength(stderr) +
            chunk.byteLength >
          maximumToolOutputBytes
        ) {
          outputExceeded = true;
          child.kill('SIGKILL');
          return;
        }
        if (target === 'stdout') stdout += chunk.toString('utf8');
        else stderr += chunk.toString('utf8');
      };
      child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
      child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, options.timeoutMs ?? 180_000);
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('close', (status, signal) => {
        clearTimeout(timeout);
        if (outputExceeded) {
          reject(new Error(`${tool} exceeded the bounded output limit`));
          return;
        }
        if (timedOut) {
          reject(new Error(`${tool} exceeded the configured timeout`));
          return;
        }
        if (status !== 0) {
          const boundedError = stderr.trim().slice(-2_000);
          reject(
            new Error(
              `${tool} failed with exit status ${status ?? signal ?? 'unknown'}${
                boundedError ? `: ${boundedError}` : ''
              }`,
            ),
          );
          return;
        }
        fulfill({ stdout, stderr });
      });
    });
  }
}

interface CosignPolicyV1 {
  mode: 'public-key' | 'keyless';
  publicKeyFile?: string;
  certificateIdentity?: string;
  certificateOidcIssuer?: string;
  githubWorkflowRepository?: string;
  githubWorkflowRef?: string;
  githubWorkflowName?: string;
  ignoreTransparencyLog: boolean;
}

export interface AcquirePluginOciPackageInputV1 {
  subject: string;
  cosignPolicyFile: string;
  registryConfigFile?: string;
  registryCaFile?: string;
  allowPlainHttp?: boolean;
  allowInsecureTls?: boolean;
  maximumDownloadBytes?: number;
  command?: OciAcquisitionCommandPortV1;
}

export interface PluginOciAcquisitionReceiptV1 {
  subject: string;
  subjectDigest: string;
  catalogReferrerDigest: string;
  evidenceReferrerCount: number;
  cosignMode: CosignPolicyV1['mode'];
  maximumDownloadBytes: number;
  registryRetryCount: number;
  maximumRegistryReadAttempts: number;
}

export interface AcquiredPluginOciPackageV1 {
  packageRoot: string;
  receipt: PluginOciAcquisitionReceiptV1;
  cleanup(): Promise<void>;
}

export function assertPluginOciCatalogSubjectV1(
  signedCatalogBundle: string,
  requestedSubject: string,
): void {
  const catalogSubject = ociDigestReferenceSchema.parse(signedCatalogBundle);
  const subject = ociDigestReferenceSchema.parse(requestedSubject);
  if (catalogSubject !== subject) {
    throw new Error(
      'Signed catalog bundle does not match the requested OCI subject digest',
    );
  }
}

function object(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function closed(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unknown.join(', ')}`);
  }
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const input = value[key];
  if (
    typeof input !== 'string' ||
    input.trim().length === 0 ||
    input.length > 2_048
  ) {
    throw new Error(`${label}.${key} must be a bounded non-empty string`);
  }
  return input.trim();
}

async function regularFile(pathInput: string, label: string): Promise<string> {
  const path = resolve(pathInput);
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must identify a regular non-symlink file`);
  }
  return realpath(path);
}

async function loadCosignPolicy(pathInput: string): Promise<{
  policy: CosignPolicyV1;
  policyPath: string;
}> {
  const policyPath = await regularFile(pathInput, 'Cosign policy');
  const input = object(
    JSON.parse(await readFile(policyPath, 'utf8')),
    'Cosign policy',
  );
  closed(
    input,
    [
      'apiVersion',
      'kind',
      'mode',
      'publicKeyFile',
      'certificateIdentity',
      'certificateOidcIssuer',
      'githubWorkflowRepository',
      'githubWorkflowRef',
      'githubWorkflowName',
      'ignoreTransparencyLog',
    ],
    'Cosign policy',
  );
  if (
    input.apiVersion !== 'cosign-policy.plugin.enterpriseglue.io/v1' ||
    input.kind !== 'EnterpriseGluePluginCosignPolicy'
  ) {
    throw new Error('Cosign policy identity is invalid');
  }
  if (input.mode !== 'public-key' && input.mode !== 'keyless') {
    throw new Error('Cosign policy mode must be public-key or keyless');
  }
  const ignoreTransparencyLog = input.ignoreTransparencyLog ?? false;
  if (typeof ignoreTransparencyLog !== 'boolean') {
    throw new Error('Cosign policy ignoreTransparencyLog must be boolean');
  }
  if (input.mode === 'public-key') {
    if (
      input.certificateIdentity !== undefined ||
      input.certificateOidcIssuer !== undefined ||
      input.githubWorkflowRepository !== undefined ||
      input.githubWorkflowRef !== undefined ||
      input.githubWorkflowName !== undefined
    ) {
      throw new Error('Public-key Cosign policy must not contain keyless claims');
    }
    const publicKeyFile = await regularFile(
      resolve(
        dirname(policyPath),
        requiredString(input, 'publicKeyFile', 'Cosign policy'),
      ),
      'Cosign public key',
    );
    return {
      policyPath,
      policy: {
        mode: 'public-key',
        publicKeyFile,
        ignoreTransparencyLog,
      },
    };
  }
  if (input.publicKeyFile !== undefined || ignoreTransparencyLog) {
    throw new Error(
      'Keyless Cosign policy requires transparency-log verification and no public key file',
    );
  }
  const optionalClaim = (key: string): string | undefined =>
    input[key] === undefined
      ? undefined
      : requiredString(input, key, 'Cosign policy');
  return {
    policyPath,
    policy: {
      mode: 'keyless',
      certificateIdentity: requiredString(
        input,
        'certificateIdentity',
        'Cosign policy',
      ),
      certificateOidcIssuer: requiredString(
        input,
        'certificateOidcIssuer',
        'Cosign policy',
      ),
      githubWorkflowRepository: optionalClaim('githubWorkflowRepository'),
      githubWorkflowRef: optionalClaim('githubWorkflowRef'),
      githubWorkflowName: optionalClaim('githubWorkflowName'),
      ignoreTransparencyLog: false,
    },
  };
}

async function inventory(root: string, directory = root): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name);
    const path = relative(root, target).replaceAll('\\', '/');
    if (entry.isSymbolicLink()) {
      throw new Error(`OCI acquisition produced a symbolic link: ${path}`);
    }
    if (entry.isDirectory()) {
      paths.push(...(await inventory(root, target)));
    } else if (entry.isFile()) {
      paths.push(path);
    } else {
      throw new Error(
        `OCI acquisition produced an unsupported file type: ${path}`,
      );
    }
  }
  return paths.sort();
}

function exactInventory(
  actual: readonly string[],
  expected: ReadonlySet<string>,
  label: string,
): void {
  const actualSet = new Set(actual);
  if (
    actualSet.size !== expected.size ||
    [...expected].some((path) => !actualSet.has(path))
  ) {
    throw new Error(`${label} contains a missing, duplicate, or unexpected file`);
  }
}

async function fileDigest(path: string): Promise<{
  sizeBytes: number;
  sha256: string;
}> {
  const bytes = await readFile(path);
  return {
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function parseMaximumDownloadBytes(input?: number): number {
  const value = input ?? defaultMaximumDownloadBytes;
  if (
    !Number.isSafeInteger(value) ||
    value < 1024 ** 2 ||
    value > maximumAllowedDownloadBytes
  ) {
    throw new Error(
      'Maximum OCI download bytes must be an integer from 1 MiB through 20 GiB',
    );
  }
  return value;
}

function manifestSize(
  input: unknown,
  expectedArtifactType: string,
  label: string,
): number {
  const manifest = object(input, `${label} manifest`);
  if (
    manifest.schemaVersion !== 2 ||
    manifest.artifactType !== expectedArtifactType
  ) {
    throw new Error(`${label} has an unexpected OCI artifact type`);
  }
  if (!Array.isArray(manifest.layers) || manifest.layers.length === 0) {
    throw new Error(`${label} must contain at least one OCI layer`);
  }
  if (manifest.layers.length > 10_002) {
    throw new Error(`${label} contains too many OCI layers`);
  }
  let size = 0;
  const descriptors = [
    ...(manifest.config === undefined ? [] : [manifest.config]),
    ...manifest.layers,
  ];
  for (const [index, descriptorInput] of descriptors.entries()) {
    const descriptor = object(
      descriptorInput,
      `${label} descriptor ${index}`,
    );
    if (
      typeof descriptor.mediaType !== 'string' ||
      !digestPattern.test(String(descriptor.digest)) ||
      !Number.isSafeInteger(descriptor.size) ||
      Number(descriptor.size) < 0 ||
      Number(descriptor.size) > maximumAllowedDownloadBytes
    ) {
      throw new Error(`${label} contains an invalid OCI descriptor`);
    }
    size += Number(descriptor.size);
  }
  return size;
}

function discoveryDescriptors(input: unknown): Array<{
  artifactType: string;
  digest: string;
}> {
  const discovery = object(input, 'OCI referrer discovery');
  if (!Array.isArray(discovery.referrers)) {
    throw new Error('OCI registry did not return a referrers array');
  }
  if (discovery.referrers.length > maximumReferrerCount) {
    throw new Error('OCI subject has too many direct referrers');
  }
  return discovery.referrers.map((descriptorInput, index) => {
    const descriptor = object(
      descriptorInput,
      `OCI referrer ${index}`,
    );
    if (
      typeof descriptor.artifactType !== 'string' ||
      !digestPattern.test(String(descriptor.digest))
    ) {
      throw new Error('OCI referrer descriptor is invalid');
    }
    return {
      artifactType: descriptor.artifactType,
      digest: String(descriptor.digest),
    };
  });
}

function parseJsonOutput(output: string, label: string): unknown {
  if (Buffer.byteLength(output) > maximumToolOutputBytes) {
    throw new Error(`${label} exceeded the bounded JSON limit`);
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function isRetryableRegistryReadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  if (
    /\b(401|403)\b|unauthori[sz]ed|authentication required|denied|forbidden|x509|certificate|signature|digest|manifest unknown|name unknown/.test(
      message,
    )
  ) {
    return false;
  }
  return /\b(408|425|429|500|502|503|504)\b|too many requests|rate.?limit|temporar(?:y|ily) unavailable|unexpected eof|connection (?:reset|refused|aborted|closed|timed out)|network is unreachable|no route to host|i\/o timeout|context deadline exceeded|tls handshake timeout|exceeded the configured timeout/.test(
    message,
  );
}

export async function acquirePluginOciPackageV1(
  input: AcquirePluginOciPackageInputV1,
): Promise<AcquiredPluginOciPackageV1> {
  const subject = ociDigestReferenceSchema.parse(input.subject);
  if (input.allowPlainHttp && input.allowInsecureTls) {
    throw new Error('Plain HTTP and insecure TLS modes are mutually exclusive');
  }
  const maximumDownloadBytes = parseMaximumDownloadBytes(
    input.maximumDownloadBytes,
  );
  const command =
    input.command ?? new SpawnOciAcquisitionCommandPortV1();
  const { policy } = await loadCosignPolicy(input.cosignPolicyFile);
  const work = await mkdtemp(resolve(tmpdir(), 'eg-plugin-oci-'));
  await chmod(work, 0o700);
  const packageRoot = resolve(work, 'package');
  const catalogRoot = resolve(work, 'catalog');
  await Promise.all([
    mkdir(packageRoot, { recursive: true, mode: 0o700 }),
    mkdir(catalogRoot, { recursive: true, mode: 0o700 }),
  ]);
  let disposed = false;
  let registryRetryCount = 0;
  const cleanup = async () => {
    if (disposed) return;
    disposed = true;
    await rm(work, { recursive: true, force: true });
  };
  const resetDownloadRoot = async (path: string) => {
    await rm(path, { recursive: true, force: true });
    await mkdir(path, { recursive: true, mode: 0o700 });
  };
  const runRegistryRead = async (
    tool: OciTool,
    args: readonly string[],
    options: {
      cwd?: string;
      env?: Readonly<Record<string, string>>;
      timeoutMs?: number;
    },
    beforeRetry?: () => Promise<void>,
  ): Promise<OciAcquisitionCommandResultV1> => {
    for (
      let attempt = 1;
      attempt <= maximumRegistryReadAttempts;
      attempt += 1
    ) {
      try {
        return await command.run(tool, args, options);
      } catch (error) {
        if (
          attempt === maximumRegistryReadAttempts ||
          !isRetryableRegistryReadError(error)
        ) {
          throw error;
        }
        registryRetryCount += 1;
        await beforeRetry?.();
        await new Promise((resolvePromise) =>
          setTimeout(
            resolvePromise,
            registryRetryBaseDelayMs * 2 ** (attempt - 1),
          ),
        );
      }
    }
    throw new Error('OCI registry retry state is unreachable');
  };

  try {
    let registryConfigFile: string | undefined;
    if (input.registryConfigFile) {
      const source = await regularFile(
        input.registryConfigFile,
        'OCI registry configuration',
      );
      const authRoot = resolve(work, 'registry-auth');
      registryConfigFile = resolve(authRoot, 'config.json');
      await mkdir(authRoot, { recursive: true, mode: 0o700 });
      await copyFile(source, registryConfigFile, constants.COPYFILE_EXCL);
      await chmod(registryConfigFile, 0o600);
    }
    const registryCaFile = input.registryCaFile
      ? await regularFile(input.registryCaFile, 'OCI registry CA')
      : undefined;
    const orasRegistryArgs = [
      ...(registryConfigFile
        ? ['--registry-config', registryConfigFile]
        : []),
      ...(registryCaFile ? ['--ca-file', registryCaFile] : []),
      ...(input.allowPlainHttp ? ['--plain-http'] : []),
      ...(input.allowInsecureTls ? ['--insecure'] : []),
    ];
    const cosignRegistryArgs = [
      ...(registryCaFile ? ['--registry-cacert', registryCaFile] : []),
      ...(input.allowPlainHttp ? ['--allow-http-registry'] : []),
      ...(input.allowInsecureTls ? ['--allow-insecure-registry'] : []),
    ];
    const commandEnv = {
      COSIGN_EXPERIMENTAL: '1',
      ...(registryConfigFile
        ? { DOCKER_CONFIG: dirname(registryConfigFile) }
        : {}),
    };
    const repository = subject.slice(0, subject.lastIndexOf('@sha256:'));
    const subjectDigest = subject.slice(subject.lastIndexOf('@') + 1);
    let plannedDownloadBytes = 0;
    const reserve = (bytes: number, label: string) => {
      plannedDownloadBytes += bytes;
      if (plannedDownloadBytes > maximumDownloadBytes) {
        throw new Error(
          `${label} exceeds the configured cumulative OCI download limit`,
        );
      }
    };
    const fetchManifest = async (
      reference: string,
      artifactType: string,
      label: string,
    ) => {
      const result = await runRegistryRead(
        'oras',
        [
          'manifest',
          'fetch',
          ...orasRegistryArgs,
          '--pretty',
          reference,
        ],
        { env: commandEnv },
      );
      reserve(
        manifestSize(
          parseJsonOutput(result.stdout, `${label} manifest`),
          artifactType,
          label,
        ),
        label,
      );
    };
    await fetchManifest(subject, packageArtifactType, 'Plugin package subject');

    const cosignArgs = [
      'verify',
      '--output',
      'json',
      ...cosignRegistryArgs,
      ...(policy.mode === 'public-key'
        ? [
            '--key',
            policy.publicKeyFile!,
            ...(policy.ignoreTransparencyLog
              ? ['--insecure-ignore-tlog=true']
              : []),
          ]
        : [
            '--certificate-identity',
            policy.certificateIdentity!,
            '--certificate-oidc-issuer',
            policy.certificateOidcIssuer!,
            ...(policy.githubWorkflowRepository
              ? [
                  '--certificate-github-workflow-repository',
                  policy.githubWorkflowRepository,
                ]
              : []),
            ...(policy.githubWorkflowRef
              ? [
                  '--certificate-github-workflow-ref',
                  policy.githubWorkflowRef,
                ]
              : []),
            ...(policy.githubWorkflowName
              ? [
                  '--certificate-github-workflow-name',
                  policy.githubWorkflowName,
                ]
              : []),
          ]),
      subject,
    ];
    const cosignResult = await runRegistryRead('cosign', cosignArgs, {
      env: commandEnv,
    });
    const signatures = parseJsonOutput(
      cosignResult.stdout,
      'Cosign verification',
    );
    if (!Array.isArray(signatures) || signatures.length === 0) {
      throw new Error('Cosign verification returned no verified signatures');
    }

    await runRegistryRead(
      'oras',
      [
        'pull',
        ...orasRegistryArgs,
        '--no-tty',
        '--keep-old-files',
        '--output',
        packageRoot,
        subject,
      ],
      { env: commandEnv },
      () => resetDownloadRoot(packageRoot),
    );
    const packagePaths = await inventory(packageRoot);
    exactInventory(
      packagePaths,
      new Set([
        'package-index.json',
        'package-index.signature.json',
        ...pluginPackageIndexV1Schema.parse(
          JSON.parse(
            await readFile(
              resolve(packageRoot, 'package-index.json'),
              'utf8',
            ),
          ),
        ).files.map((file) => file.path),
      ]),
      'OCI package subject',
    );
    const packageIndex: PluginPackageIndexV1 =
      pluginPackageIndexV1Schema.parse(
        JSON.parse(
          await readFile(resolve(packageRoot, 'package-index.json'), 'utf8'),
        ),
      );

    const discoveryResult = await runRegistryRead(
      'oras',
      [
        'discover',
        ...orasRegistryArgs,
        '--distribution-spec',
        distributionSpec,
        '--format',
        'json',
        '--depth',
        '1',
        subject,
      ],
      { env: commandEnv },
    );
    const descriptors = discoveryDescriptors(
      parseJsonOutput(discoveryResult.stdout, 'OCI referrer discovery'),
    );
    const catalogs = descriptors.filter(
      (descriptor) => descriptor.artifactType === catalogArtifactType,
    );
    if (catalogs.length !== 1) {
      throw new Error(
        'OCI subject must have exactly one EnterpriseGlue catalog referrer',
      );
    }

    const indexedEvidence = packageIndex.files.filter((file) =>
      Object.hasOwn(evidenceArtifactTypeByRole, file.role),
    );
    for (const role of Object.keys(
      evidenceArtifactTypeByRole,
    ) as EvidenceRole[]) {
      if (!indexedEvidence.some((file) => file.role === role)) {
        throw new Error(`OCI package index is missing required ${role} evidence`);
      }
      const expectedCount = indexedEvidence.filter(
        (file) => file.role === role,
      ).length;
      const actualCount = descriptors.filter(
        (descriptor) =>
          descriptor.artifactType === evidenceArtifactTypeByRole[role],
      ).length;
      if (actualCount !== expectedCount) {
        throw new Error(
          `OCI subject has a missing or duplicate ${role} evidence referrer`,
        );
      }
    }

    const evidenceDescriptors = descriptors.filter((descriptor) =>
      Object.values(evidenceArtifactTypeByRole).includes(
        descriptor.artifactType as (typeof evidenceArtifactTypeByRole)[EvidenceRole],
      ),
    );
    const plannedReferrers = [
      { ...catalogs[0]!, root: catalogRoot },
      ...evidenceDescriptors.map((descriptor, index) => ({
        ...descriptor,
        root: resolve(work, `evidence-${index}`),
      })),
    ];
    for (const [index, referrer] of plannedReferrers.entries()) {
      await fetchManifest(
        `${repository}@${referrer.digest}`,
        referrer.artifactType,
        `Plugin referrer ${index}`,
      );
    }
    for (const referrer of plannedReferrers) {
      await mkdir(referrer.root, { recursive: true, mode: 0o700 });
      await runRegistryRead(
        'oras',
        [
          'pull',
          ...orasRegistryArgs,
          '--no-tty',
          '--keep-old-files',
          '--output',
          referrer.root,
          `${repository}@${referrer.digest}`,
        ],
        { env: commandEnv },
        () => resetDownloadRoot(referrer.root),
      );
    }

    exactInventory(
      await inventory(catalogRoot),
      new Set(['catalog.json', 'catalog.signature.json']),
      'OCI catalog referrer',
    );
    await Promise.all([
      copyFile(
        resolve(catalogRoot, 'catalog.json'),
        resolve(packageRoot, 'catalog.json'),
        constants.COPYFILE_EXCL,
      ),
      copyFile(
        resolve(catalogRoot, 'catalog.signature.json'),
        resolve(packageRoot, 'catalog.signature.json'),
        constants.COPYFILE_EXCL,
      ),
    ]);

    const evidenceByPath = new Map(
      indexedEvidence.map((file) => [file.path, file]),
    );
    const seenEvidencePaths = new Set<string>();
    for (const referrer of plannedReferrers.slice(1)) {
      const paths = await inventory(referrer.root);
      if (paths.length !== 1) {
        throw new Error(
          'Each OCI evidence referrer must contain exactly one indexed file',
        );
      }
      const path = paths[0]!;
      const indexed = evidenceByPath.get(path);
      if (
        !indexed ||
        evidenceArtifactTypeByRole[indexed.role as EvidenceRole] !==
          referrer.artifactType ||
        seenEvidencePaths.has(path)
      ) {
        throw new Error(
          'OCI evidence referrer is unindexed, mis-typed, or duplicated',
        );
      }
      const actual = await fileDigest(resolve(referrer.root, path));
      if (
        actual.sizeBytes !== indexed.sizeBytes ||
        actual.sha256 !== indexed.sha256
      ) {
        throw new Error(
          `OCI evidence referrer differs from its signed index: ${path}`,
        );
      }
      seenEvidencePaths.add(path);
    }
    if (seenEvidencePaths.size !== indexedEvidence.length) {
      throw new Error('OCI acquisition did not verify every indexed evidence file');
    }

    return {
      packageRoot,
      receipt: {
        subject,
        subjectDigest,
        catalogReferrerDigest: catalogs[0]!.digest,
        evidenceReferrerCount: seenEvidencePaths.size,
        cosignMode: policy.mode,
        maximumDownloadBytes,
        registryRetryCount,
        maximumRegistryReadAttempts,
      },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
