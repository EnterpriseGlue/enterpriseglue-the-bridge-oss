import {
  createHash,
  createPrivateKey,
  randomUUID,
  sign,
  type KeyObject,
} from 'node:crypto';
import { open, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import {
  namespacedIdentifierSchema,
  opaqueReferenceSchema,
  pluginDiagnosticBundleSignaturePayloadV1,
  pluginIdSchema,
  pluginSanitizedDiagnosticBundleReceiptV1Schema,
  pluginSanitizedDiagnosticBundleV1Schema,
  type PluginDiagnosticCollectionRequestV1,
  type PluginDiagnosticCollectionResponseV1,
  type PluginDiagnosticCollectorStatusResponseV1,
  type PluginId,
  type PluginInvocationClaimsV1,
  type PluginSanitizedDiagnosticBundleV1,
} from '@enterpriseglue/plugin-sdk';
import type { PluginDiagnosticCollectorV1 } from '@enterpriseglue/plugin-runtime/host-broker';
import { fetch, type Dispatcher, type RequestInit } from 'undici';
import { z } from 'zod';

import type { PluginDiagnosticMetricsRegistryV1 } from './pluginDiagnosticMetrics.js';

const MAX_POLICY_BYTES = 1024 * 1024;
const MAX_CREDENTIAL_BYTES = 32 * 1024;
const MAX_HANDOFF_RESPONSE_BYTES = 4 * 1024;
const MAX_SANITIZED_BYTES = 256 * 1024;
const MAX_FULL_SANITIZED_BYTES = 10 * 1024 * 1024;

type FetchV1 = (
  input: string,
  init?: RequestInit & { dispatcher?: Dispatcher },
) => ReturnType<typeof fetch>;

const absoluteFileSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine((value) => isAbsolute(value) && !value.includes('\0'));

const sourceKindSchema = z.enum([
  'file_tail',
  'docker_json_file_tail',
  'kubernetes_cri_file_tail',
]);

const sourceSchema = z
  .object({
    sourceId: namespacedIdentifierSchema,
    kind: sourceKindSchema,
    path: absoluteFileSchema,
    engineRefs: z.array(opaqueReferenceSchema).min(1).max(1_000),
    profiles: z
      .array(
        z.enum([
          'incident_minimal',
          'failed_job_minimal',
          'engine_health',
        ]),
      )
      .min(1)
      .max(3),
    maxBytes: z.number().int().min(1).max(MAX_SANITIZED_BYTES),
    maxLines: z.number().int().min(1).max(100_000),
    /**
     * Full-log collection is opt-in per approved source. The collector rejects
     * an over-limit file instead of silently sending a partial file as a full
     * log. Raw bytes still remain inside this customer deployment.
     */
    fullLogCollection: z
      .object({
        enabled: z.boolean(),
        maxBytes: z
          .number()
          .int()
          .min(1)
          .max(MAX_FULL_SANITIZED_BYTES),
        maxLines: z.number().int().min(1).max(1_000_000),
      })
      .strict()
      .default({
        enabled: false,
        maxBytes: MAX_FULL_SANITIZED_BYTES,
        maxLines: 1_000_000,
      }),
  })
  .strict();

const pluginPolicySchema = z
  .object({
    pluginId: pluginIdSchema,
    enabled: z.boolean(),
    policyRevision: opaqueReferenceSchema,
    signingKeyId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/),
    signingPrivateKeyFile: absoluteFileSchema,
    bearerTokenFile: absoluteFileSchema,
    handoffEndpoint: z.string().url().max(2_000),
    timeoutMs: z.number().int().min(100).max(120_000).default(10_000),
    bundleTtlSeconds: z.number().int().min(60).max(3_600).default(300),
    sources: z.array(sourceSchema).min(1).max(100),
  })
  .strict();

const policySchema = z
  .object({
    apiVersion: z.literal(
      'diagnostic-collector-policy.plugin.enterpriseglue.io/v1',
    ),
    plugins: z.array(pluginPolicySchema).min(1).max(100),
  })
  .strict()
  .superRefine((policy, context) => {
    const ids = new Set<string>();
    for (const [pluginIndex, plugin] of policy.plugins.entries()) {
      if (ids.has(plugin.pluginId)) {
        context.addIssue({
          code: 'custom',
          path: ['plugins', pluginIndex, 'pluginId'],
          message: 'Plugin collector policies must be unique',
        });
      }
      ids.add(plugin.pluginId);
      const sourceIds = new Set<string>();
      for (const [sourceIndex, source] of plugin.sources.entries()) {
        if (sourceIds.has(source.sourceId)) {
          context.addIssue({
            code: 'custom',
            path: ['plugins', pluginIndex, 'sources', sourceIndex, 'sourceId'],
            message: 'Collector source IDs must be unique per plugin',
          });
        }
        sourceIds.add(source.sourceId);
      }
    }
  });

type LocalDiagnosticCollectorPolicyV1 = z.infer<typeof policySchema>;
type PluginCollectorPolicyV1 = z.infer<typeof pluginPolicySchema>;
type PluginCollectorSourceV1 = z.infer<typeof sourceSchema>;

export interface LocalDiagnosticCollectorOptionsV1 {
  fetch?: FetchV1;
  allowLoopbackHttp?: boolean;
  now?: () => Date;
  metrics?: Pick<
    PluginDiagnosticMetricsRegistryV1,
    'recordCollection' | 'recordStatus'
  >;
}

/**
 * Customer-local collector controlled by a deployment-owned policy file.
 *
 * The broker request cannot select a filesystem path or network destination.
 * Raw bytes are read into memory only for local filtering and are never written
 * to host persistence or included in the handoff.
 */
export class LocalSanitizedDiagnosticCollectorV1
implements PluginDiagnosticCollectorV1 {
  private readonly fetch: FetchV1;
  private readonly now: () => Date;
  private policyPromise?: Promise<LocalDiagnosticCollectorPolicyV1>;

  constructor(
    private readonly policyFile: string,
    private readonly options: LocalDiagnosticCollectorOptionsV1 = {},
  ) {
    if (!isAbsolute(policyFile) || policyFile.includes('\0')) {
      throw new Error('collector_policy_path_invalid');
    }
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async collect(input: {
    pluginId: PluginId;
    claims: PluginInvocationClaimsV1;
    request: PluginDiagnosticCollectionRequestV1;
  }): Promise<
    Pick<
      PluginDiagnosticCollectionResponseV1,
      | 'intentRef'
      | 'status'
      | 'filteringBoundary'
      | 'reasonCode'
      | 'consumerContextRef'
      | 'artifactRef'
      | 'sanitizedBytes'
    >
  > {
    const intentRef = bundleRef(input);
    try {
      assertProfileTrigger(input.request);
      const policy = await this.policy();
      const plugin = policy.plugins.find(
        (candidate) =>
          candidate.pluginId === input.pluginId && candidate.enabled,
      );
      if (!plugin) throw new Error('collector_policy_unavailable');
      const source = plugin.sources.find(
        (candidate) =>
          candidate.engineRefs.includes(input.request.engineRef) &&
          candidate.profiles.includes(input.request.profile),
      );
      if (!source) throw new Error('collector_source_not_approved');
      if (
        input.request.evidenceLevel === 'full_sanitized_logs' &&
        !source.fullLogCollection.enabled
      ) {
        throw new Error('full_log_collection_not_approved');
      }
      let sanitized: Awaited<ReturnType<typeof collectAndRedact>>;
      try {
        sanitized = await collectAndRedact(
          source,
          input.request.evidenceLevel,
          input.request.timeRange,
        );
      } catch (error) {
        throw classified(error, 'collector_source_processing_failed');
      }
      let bundle: PluginSanitizedDiagnosticBundleV1;
      try {
        bundle = await createBundle({
          ...input,
          intentRef,
          plugin,
          source,
          sanitized,
          now: this.now(),
        });
      } catch (error) {
        throw classified(error, 'collector_bundle_signing_failed');
      }
      try {
        const receipt = await this.handoff(plugin, bundle);
        const result = {
          intentRef,
          status: 'sanitized_bundle_ready' as const,
          filteringBoundary: 'customer_adapter' as const,
          reasonCode: 'locally_filtered_and_handed_off',
          sanitizedBytes: sanitized.bytes,
          ...(receipt.consumerContextRef
            ? { consumerContextRef: receipt.consumerContextRef }
            : {}),
          ...(receipt.artifactRef
            ? { artifactRef: receipt.artifactRef }
            : {}),
        };
        this.recordCollection(
          input.pluginId,
          result.status,
          result.reasonCode,
          sanitized.bytes,
        );
        return result;
      } catch (error) {
        throw classified(error, 'collector_handoff_unavailable');
      }
    } catch (error) {
      const result = {
        intentRef,
        status: 'rejected' as const,
        filteringBoundary: 'customer_adapter' as const,
        reasonCode: safeFailureCode(error),
      };
      this.recordCollection(
        input.pluginId,
        result.status,
        result.reasonCode,
      );
      return result;
    }
  }

  async status(input: {
    pluginId: PluginId;
    claims: PluginInvocationClaimsV1;
  }): Promise<
    Pick<
      PluginDiagnosticCollectorStatusResponseV1,
      | 'state'
      | 'reasonCode'
      | 'sourceClass'
      | 'filteringBoundary'
      | 'checkedAt'
    >
  > {
    const checkedAt = this.now().toISOString();
    let policy: LocalDiagnosticCollectorPolicyV1;
    try {
      policy = await this.policy();
    } catch (error) {
      return this.statusResult(input.pluginId, {
        state: 'unavailable',
        reasonCode: safeFailureCode(error),
        sourceClass: 'none',
        filteringBoundary: 'customer_adapter',
        checkedAt,
      });
    }
    const plugin = policy.plugins.find(
      (candidate) => candidate.pluginId === input.pluginId,
    );
    if (!plugin || !plugin.enabled) {
      return this.statusResult(input.pluginId, {
        state: 'disabled',
        reasonCode: 'collector_policy_disabled',
        sourceClass: 'none',
        filteringBoundary: 'customer_adapter',
        checkedAt,
      });
    }
    const sourceClass = sourceCountClass(plugin.sources.length);
    try {
      try {
        await signingKey(plugin.signingPrivateKeyFile);
      } catch (error) {
        throw classified(error, 'collector_signing_key_invalid');
      }
      await handoffToken(plugin.bearerTokenFile);
      validateHandoffEndpoint(
        plugin.handoffEndpoint,
        this.options.allowLoopbackHttp,
      );
      await Promise.all(plugin.sources.map(validateSourceAvailable));
      return this.statusResult(input.pluginId, {
        state: 'ready',
        reasonCode: 'collector_ready',
        sourceClass,
        filteringBoundary: 'customer_adapter',
        checkedAt,
      });
    } catch (error) {
      return this.statusResult(input.pluginId, {
        state: 'degraded',
        reasonCode: safeFailureCode(error),
        sourceClass,
        filteringBoundary: 'customer_adapter',
        checkedAt,
      });
    }
  }

  private recordCollection(
    pluginId: PluginId,
    status: 'sanitized_bundle_ready' | 'rejected',
    reasonCode: string,
    sanitizedBytes?: number,
  ): void {
    try {
      this.options.metrics?.recordCollection({
        pluginId,
        status,
        reasonCode,
        ...(sanitizedBytes === undefined ? {} : { sanitizedBytes }),
      });
    } catch {
      // Observability must never weaken or block the collection boundary.
    }
  }

  private statusResult(
    pluginId: PluginId,
    result: Pick<
      PluginDiagnosticCollectorStatusResponseV1,
      | 'state'
      | 'reasonCode'
      | 'sourceClass'
      | 'filteringBoundary'
      | 'checkedAt'
    >,
  ): typeof result {
    try {
      this.options.metrics?.recordStatus({
        pluginId,
        state: result.state,
        reasonCode: result.reasonCode,
        sourceClass: result.sourceClass,
      });
    } catch {
      // Observability must never turn a safe health projection into a failure.
    }
    return result;
  }

  private async policy(): Promise<LocalDiagnosticCollectorPolicyV1> {
    this.policyPromise ??= loadPolicy(this.policyFile);
    return this.policyPromise;
  }

  private async handoff(
    policy: PluginCollectorPolicyV1,
    bundle: PluginSanitizedDiagnosticBundleV1,
  ) {
    const endpoint = validateHandoffEndpoint(
      policy.handoffEndpoint,
      this.options.allowLoopbackHttp,
    );
    const token = await handoffToken(policy.bearerTokenFile);
    const response = await this.fetch(endpoint.toString(), {
      method: 'POST',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bundle),
      signal: AbortSignal.timeout(policy.timeoutMs),
    });
    const bytes = await boundedResponse(response);
    if (!response.ok) throw new Error('collector_handoff_rejected');
    if (
      !/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(
        response.headers.get('content-type') ?? '',
      )
    ) {
      throw new Error('collector_handoff_response_invalid');
    }
    const receipt = pluginSanitizedDiagnosticBundleReceiptV1Schema.parse(
      JSON.parse(bytes.toString('utf8')),
    );
    if (receipt.bundleRef !== bundle.bundleRef) {
      throw new Error('collector_handoff_response_invalid');
    }
    if (
      receipt.consumerContextRef !== undefined &&
      receipt.consumerContextRef !== bundle.consumerContextRef
    ) {
      throw new Error('collector_handoff_response_invalid');
    }
    return receipt;
  }
}

async function loadPolicy(
  path: string,
): Promise<LocalDiagnosticCollectorPolicyV1> {
  const details = await stat(path);
  if (!details.isFile() || details.size > MAX_POLICY_BYTES) {
    throw new Error('collector_policy_invalid');
  }
  return parseLocalDiagnosticCollectorPolicyV1(
    JSON.parse(await readFile(path, 'utf8')),
  );
}

export function parseLocalDiagnosticCollectorPolicyV1(
  input: unknown,
): LocalDiagnosticCollectorPolicyV1 {
  return policySchema.parse(input);
}

function sourceCountClass(
  count: number,
): PluginDiagnosticCollectorStatusResponseV1['sourceClass'] {
  if (count === 0) return 'none';
  return count === 1 ? 'single' : 'multiple';
}

function validateHandoffEndpoint(
  value: string,
  allowLoopbackHttp: boolean | undefined,
): URL {
  const endpoint = new URL(value);
  const loopback =
    endpoint.protocol === 'http:' &&
    (endpoint.hostname === '127.0.0.1' ||
      endpoint.hostname === '::1' ||
      endpoint.hostname === 'localhost');
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.protocol !== 'https:' &&
      !(loopback && allowLoopbackHttp))
  ) {
    throw new Error('collector_handoff_endpoint_invalid');
  }
  return endpoint;
}

async function handoffToken(path: string): Promise<string> {
  let value: Buffer;
  try {
    value = await readProtectedFile(
      path,
      'collector_handoff_credential_invalid',
    );
  } catch (error) {
    throw classified(error, 'collector_handoff_credential_invalid');
  }
  const token = value.toString('utf8').trim();
  if (!token || /[\r\n]/.test(token)) {
    throw new Error('collector_handoff_credential_invalid');
  }
  return token;
}

async function validateSourceAvailable(
  source: PluginCollectorSourceV1,
): Promise<void> {
  try {
    const target = await realpath(source.path);
    const details = await stat(target);
    if (!details.isFile()) throw new Error('collector_source_invalid');
  } catch (error) {
    throw classified(error, 'collector_source_invalid');
  }
}

async function collectAndRedact(
  source: PluginCollectorSourceV1,
  evidenceLevel: PluginDiagnosticCollectionRequestV1['evidenceLevel'],
  timeRange: PluginDiagnosticCollectionRequestV1['timeRange'],
): Promise<{
  content: string;
  bytes: number;
  lineCount: number;
  summary: PluginSanitizedDiagnosticBundleV1['redactionSummary'];
}> {
  const target = await realpath(source.path);
  const handle = await open(target, 'r');
  try {
    const details = await handle.stat();
    if (!details.isFile()) throw new Error('collector_source_invalid');
    const fullLog = evidenceLevel === 'full_sanitized_logs';
    const byteLimit = fullLog
      ? source.fullLogCollection.maxBytes
      : source.maxBytes;
    const lineLimit = fullLog
      ? source.fullLogCollection.maxLines
      : source.maxLines;
    if (fullLog && details.size > byteLimit) {
      throw new Error('full_log_source_exceeds_policy');
    }
    const bytesToRead = fullLog
      ? details.size
      : Math.min(details.size, byteLimit);
    const raw = Buffer.alloc(bytesToRead);
    if (bytesToRead > 0) {
      await handle.read(
        raw,
        0,
        bytesToRead,
        fullLog ? 0 : Math.max(0, details.size - bytesToRead),
      );
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      throw new Error('collector_source_encoding_invalid');
    }
    const bounded = normalizeSourceText(
      source.kind,
      text,
      fullLog || details.size === bytesToRead,
      lineLimit,
      fullLog,
    );
    const windowed = timeRange
      ? filterNormalizedLogByTimeRange(bounded, timeRange)
      : bounded;
    const redacted = redact(windowed);
    if (containsSensitive(redacted.content)) {
      throw new Error('collector_post_redaction_verification_failed');
    }
    const bytes = Buffer.byteLength(redacted.content, 'utf8');
    if (
      bytes > byteLimit ||
      bytes > (fullLog ? MAX_FULL_SANITIZED_BYTES : MAX_SANITIZED_BYTES)
    ) {
      throw new Error('collector_sanitized_output_too_large');
    }
    return {
      content: redacted.content,
      bytes,
      lineCount: redacted.content ? redacted.content.split('\n').length : 0,
      summary: redacted.summary,
    };
  } finally {
    await handle.close();
  }
}

function filterNormalizedLogByTimeRange(
  input: string,
  timeRange: NonNullable<PluginDiagnosticCollectionRequestV1['timeRange']>,
): string {
  const start = Date.parse(timeRange.startAt);
  const end = Date.parse(timeRange.endAt);
  let timestampedEvents = 0;
  let includeContinuation = false;
  const selected: string[] = [];
  for (const line of input.split('\n')) {
    const match = /(?:^|\s)(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))(?:\s|$)/.exec(
      line,
    );
    if (match) {
      timestampedEvents += 1;
      const observed = Date.parse(match[1]!);
      includeContinuation = observed >= start && observed <= end;
    }
    if (includeContinuation) selected.push(line);
  }
  if (timestampedEvents === 0) {
    throw new Error('collector_time_range_unavailable');
  }
  if (selected.length === 0) {
    throw new Error('collector_time_range_empty');
  }
  return selected.join('\n');
}

function normalizeSourceText(
  kind: PluginCollectorSourceV1['kind'],
  input: string,
  startsAtFileStart: boolean,
  maxLines: number,
  preserveAll: boolean,
): string {
  if (kind === 'file_tail') {
    const lines = input.split(/\r?\n/);
    if (preserveAll) {
      if (lines.length > maxLines) throw new Error('full_log_line_limit_exceeded');
      return input;
    }
    return lines.slice(-maxLines).join('\n');
  }

  const lines = input.split(/\r?\n/);
  if (!startsAtFileStart) lines.shift();
  if (lines[lines.length - 1] === '') lines.pop();
  if (preserveAll && lines.length > maxLines) {
    throw new Error('full_log_line_limit_exceeded');
  }
  const selected = preserveAll ? lines : lines.slice(-maxLines);
  if (selected.length === 0) return '';

  if (kind === 'docker_json_file_tail') {
    return selected
      .map((line) => {
        let entry: unknown;
        try {
          entry = JSON.parse(line);
        } catch {
          throw new Error('collector_source_format_invalid');
        }
        const parsed = z
          .object({
            log: z.string().max(MAX_SANITIZED_BYTES),
            stream: z.enum(['stdout', 'stderr']),
            time: z.string().min(20).max(40),
            attrs: z.record(z.string(), z.string()).optional(),
          })
          .strict()
          .safeParse(entry);
        if (
          !parsed.success ||
          !isRfc3339Timestamp(parsed.data.time)
        ) {
          throw new Error('collector_source_format_invalid');
        }
        const content = parsed.data.log.replace(/\r?\n$/, '');
        return `${parsed.data.time} ${parsed.data.stream} ${content}`;
      })
      .join('\n')
      .split('\n')
      .slice(-maxLines)
      .join('\n');
  }

  return selected
    .map((line) => {
      const parsed = /^(\S{20,40}) (stdout|stderr) ([FP]) (.*)$/.exec(
        line,
      );
      if (!parsed || !isRfc3339Timestamp(parsed[1]!)) {
        throw new Error('collector_source_format_invalid');
      }
      return `${parsed[1]} ${parsed[2]} ${parsed[3]} ${parsed[4]}`;
    })
    .join('\n');
}

function isRfc3339Timestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
    value,
  );
}

function redact(input: string): {
  content: string;
  summary: PluginSanitizedDiagnosticBundleV1['redactionSummary'];
} {
  const summary = {
    secrets: 0,
    emails: 0,
    networkAddresses: 0,
    identifiers: 0,
  };
  let content = replace(
    input,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '<SECRET>',
    () => summary.secrets++,
  );
  content = replace(
    content,
    /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    'Bearer <SECRET>',
    () => summary.secrets++,
  );
  content = replace(
    content,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    '<SECRET>',
    () => summary.secrets++,
  );
  content = content.replace(
    /\b(password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret)\s*([:=])\s*([^\s,;&]+)/gi,
    (_match, key: string, separator: string, value: string) => {
      if (value === '<SECRET>') return `${key}${separator}<SECRET>`;
      summary.secrets++;
      return `${key}${separator}<SECRET>`;
    },
  );
  content = replace(
    content,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|gh[pousr]_[A-Za-z0-9]{20,}/g,
    '<SECRET>',
    () => summary.secrets++,
  );
  content = replace(
    content,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    '<EMAIL>',
    () => summary.emails++,
  );
  content = replace(
    content,
    /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    '<IP>',
    () => summary.networkAddresses++,
  );
  content = replace(
    content,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    '<IDENTIFIER>',
    () => summary.identifiers++,
  );
  return { content, summary };
}

function containsSensitive(content: string): boolean {
  return [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b(?:Bearer|Basic)\s+(?!<SECRET>)[A-Za-z0-9._~+/=-]{8,}/i,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    /\b(?:password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*(?!<SECRET>)[^\s,;&]+/i,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|gh[pousr]_[A-Za-z0-9]{20,}/,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  ].some((pattern) => pattern.test(content));
}

async function createBundle(input: {
  pluginId: PluginId;
  claims: PluginInvocationClaimsV1;
  request: PluginDiagnosticCollectionRequestV1;
  intentRef: string;
  plugin: PluginCollectorPolicyV1;
  source: PluginCollectorSourceV1;
  sanitized: Awaited<ReturnType<typeof collectAndRedact>>;
  now: Date;
}): Promise<PluginSanitizedDiagnosticBundleV1> {
  const privateKey = await signingKey(input.plugin.signingPrivateKeyFile);
  const collectedAt = input.now.toISOString();
  const expiresAt = new Date(
    input.now.getTime() + input.plugin.bundleTtlSeconds * 1_000,
  ).toISOString();
  const unsigned = {
    apiVersion:
      'sanitized-diagnostic-bundle.plugin.enterpriseglue.io/v1' as const,
    bundleRef: input.intentRef,
    pluginId: input.pluginId,
    deploymentRef: input.claims.deploymentRef,
    tenantRef: input.claims.tenantRef!,
    engineRef: input.request.engineRef,
    ...(input.request.consumerContextRef
      ? { consumerContextRef: input.request.consumerContextRef }
      : {}),
    trigger: input.request.trigger,
    profile: input.request.profile,
    sourceId: input.source.sourceId,
    policyRevision: input.plugin.policyRevision,
    collectedAt,
    expiresAt,
    nonce: randomUUID(),
    contentType: 'text/plain; charset=utf-8' as const,
    contentSha256: hash(input.sanitized.content),
    contentBytes: input.sanitized.bytes,
    lineCount: input.sanitized.lineCount,
    redactionSummary: input.sanitized.summary,
    filteringBoundary: 'customer_adapter' as const,
    sanitizedContent: input.sanitized.content,
    signingKeyId: input.plugin.signingKeyId,
    signatureAlgorithm: 'Ed25519' as const,
  };
  return pluginSanitizedDiagnosticBundleV1Schema.parse({
    ...unsigned,
    signature: sign(
      null,
      Buffer.from(pluginDiagnosticBundleSignaturePayloadV1(unsigned), 'utf8'),
      privateKey,
    ).toString('base64'),
  });
}

async function signingKey(path: string): Promise<KeyObject> {
  const value = await readProtectedFile(path, 'collector_signing_key_invalid');
  const key = createPrivateKey(value);
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
    throw new Error('collector_signing_key_invalid');
  }
  return key;
}

async function readProtectedFile(
  path: string,
  code: string,
): Promise<Buffer> {
  const details = await stat(path);
  if (
    !details.isFile() ||
    details.size > MAX_CREDENTIAL_BYTES ||
    (details.mode & 0o077) !== 0
  ) {
    throw new Error(code);
  }
  return readFile(path);
}

async function boundedResponse(
  response: Awaited<ReturnType<FetchV1>>,
): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_HANDOFF_RESPONSE_BYTES) {
    throw new Error('collector_handoff_response_too_large');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_HANDOFF_RESPONSE_BYTES) {
    throw new Error('collector_handoff_response_too_large');
  }
  return bytes;
}

function assertProfileTrigger(
  request: PluginDiagnosticCollectionRequestV1,
): void {
  if (
    (request.profile === 'incident_minimal' &&
      request.trigger.kind !== 'incident') ||
    (request.profile === 'failed_job_minimal' &&
      request.trigger.kind !== 'failed_job') ||
    (request.profile === 'engine_health' &&
      request.trigger.kind !== 'engine')
  ) {
    throw new Error('collector_profile_trigger_mismatch');
  }
}

function bundleRef(input: {
  pluginId: PluginId;
  claims: PluginInvocationClaimsV1;
  request: PluginDiagnosticCollectionRequestV1;
}): string {
  return `diagnostic-${hash(
    [
      input.pluginId,
      input.claims.deploymentRef,
      input.claims.tenantRef,
      input.request.engineRef,
      input.request.idempotencyKey,
      input.request.consumerContextRef ?? '',
    ].join('\0'),
  )}`;
}

function safeFailureCode(error: unknown): string {
  if (error instanceof z.ZodError) {
    return 'collector_contract_invalid';
  }
  if (error instanceof SyntaxError) {
    return 'collector_policy_invalid';
  }
  const code = error instanceof Error ? error.message : '';
  const allowed = new Set([
    'collector_policy_path_invalid',
    'collector_policy_invalid',
    'collector_contract_invalid',
    'collector_policy_unavailable',
    'collector_source_not_approved',
    'collector_source_invalid',
    'collector_source_encoding_invalid',
    'collector_source_format_invalid',
    'collector_source_processing_failed',
    'collector_post_redaction_verification_failed',
    'collector_sanitized_output_too_large',
    'collector_profile_trigger_mismatch',
    'collector_signing_key_invalid',
    'collector_bundle_signing_failed',
    'collector_handoff_credential_invalid',
    'collector_handoff_endpoint_invalid',
    'collector_handoff_rejected',
    'collector_handoff_response_invalid',
    'collector_handoff_response_too_large',
    'collector_handoff_unavailable',
  ]);
  return allowed.has(code) ? code : 'collector_unavailable';
}

function classified(error: unknown, fallback: string): Error {
  if (
    error instanceof Error &&
    /^collector_[a-z0-9_]+$/.test(error.message)
  ) {
    return error;
  }
  return new Error(fallback);
}

function replace(
  input: string,
  pattern: RegExp,
  replacement: string,
  found: () => void,
): string {
  return input.replace(pattern, () => {
    found();
    return replacement;
  });
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
