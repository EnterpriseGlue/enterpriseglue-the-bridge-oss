import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
} from 'node:crypto';

import {
  opaqueReferenceSchema,
  pluginBackendCapabilitiesV1Schema,
  pluginInvocationClaimsV1Schema,
  safeRelativePathSchema,
  type EnterpriseGluePluginManifestV1,
  type PluginBackendCapabilitiesV1,
  type PluginBackendOperationV1,
  type PluginId,
  type PluginInvocationClaimsV1,
  type PluginPermissionV1,
} from '@enterpriseglue/plugin-sdk';

export type PluginGatewayErrorCode =
  | 'token_malformed'
  | 'token_algorithm_invalid'
  | 'token_signature_invalid'
  | 'token_claims_invalid'
  | 'token_audience_invalid'
  | 'token_operation_invalid'
  | 'token_expired'
  | 'token_not_yet_valid'
  | 'token_lifetime_exceeded'
  | 'token_replayed'
  | 'operation_unknown'
  | 'operation_method_invalid'
  | 'operation_path_invalid'
  | 'permission_denied'
  | 'request_too_large'
  | 'schema_digest_invalid'
  | 'schema_document_invalid'
  | 'request_schema_invalid'
  | 'response_schema_invalid'
  | 'rate_limited'
  | 'concurrency_limited'
  | 'admission_unavailable'
  | 'circuit_open'
  | 'capabilities_invalid'
  | 'capabilities_identity_invalid'
  | 'capabilities_operation_mismatch';

export class PluginGatewayError extends Error {
  constructor(
    public readonly code: PluginGatewayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PluginGatewayError';
  }
}

export interface PluginGatewayAdmissionPolicyV1 {
  windowMs: number;
  maxRequestsPerSubjectOperation: number;
  maxRequestsPerPlugin: number;
  maxConcurrentPerOperation: number;
  maxTrackedBuckets?: number;
}

export interface PluginGatewayAdmissionInputV1 {
  pluginId: PluginId;
  operationId: string;
  tenantRef?: string;
  subjectRef: string;
  nowMs?: number;
  /**
   * Maximum lifetime of a durable concurrency lease. Database-backed
   * implementations use this to recover capacity after a host crash.
   */
  leaseTtlMs?: number;
}

export interface PluginGatewayAdmissionLeaseV1 {
  release(): void | Promise<void>;
}

/**
 * Admission port accepted by the OSS gateway.
 *
 * The in-memory controller returns immediately and is suitable for tests or a
 * single replica. Production uses an asynchronous database-backed
 * implementation so every host replica shares one deployment-wide ceiling.
 */
export interface PluginGatewayAdmissionV1 {
  acquire(
    input: PluginGatewayAdmissionInputV1,
  ):
    | PluginGatewayAdmissionLeaseV1
    | Promise<PluginGatewayAdmissionLeaseV1>;
}

export interface PluginGatewayCircuitBreakerPolicyV1 {
  failureThreshold: number;
  openMs: number;
  maxTrackedOperations?: number;
}

export interface PluginGatewayCircuitLeaseV1 {
  succeed(): void;
  fail(): void;
}

interface GatewayCircuitState {
  consecutiveFailures: number;
  openedAt?: number;
  probeInFlight: boolean;
  touchedAt: number;
}

/**
 * Per-host-replica circuit breaker keyed by a hash of plugin and operation.
 *
 * One half-open probe is allowed after the cooldown. Success closes the
 * circuit; failure opens it again. Callers must complete each lease exactly
 * once, and completion methods are idempotent as a defensive backstop.
 */
export class PluginGatewayCircuitBreakerV1 {
  private readonly policy: Required<PluginGatewayCircuitBreakerPolicyV1>;
  private readonly states = new Map<string, GatewayCircuitState>();

  constructor(policy: PluginGatewayCircuitBreakerPolicyV1) {
    for (const [name, value] of Object.entries(policy)) {
      if (
        value !== undefined &&
        (!Number.isSafeInteger(value) || value <= 0)
      ) {
        throw new Error(`Plugin gateway circuit ${name} must be positive`);
      }
    }
    this.policy = {
      ...policy,
      maxTrackedOperations: policy.maxTrackedOperations ?? 10_000,
    };
  }

  acquire(
    pluginId: PluginId,
    operationId: string,
    nowMs?: number,
  ): PluginGatewayCircuitLeaseV1 {
    const explicitNow = nowMs !== undefined;
    const observedAt = nowMs ?? Date.now();
    const key = admissionHash(['circuit', pluginId, operationId]);
    let state = this.states.get(key);
    if (!state) {
      if (this.states.size >= this.policy.maxTrackedOperations) {
        this.evictClosedState();
      }
      if (this.states.size >= this.policy.maxTrackedOperations) {
        throw new PluginGatewayError(
          'circuit_open',
          'Plugin circuit state is at capacity',
        );
      }
      state = {
        consecutiveFailures: 0,
        probeInFlight: false,
        touchedAt: observedAt,
      };
      this.states.set(key, state);
    }
    state.touchedAt = observedAt;

    const isOpen = state.openedAt !== undefined;
    if (
      isOpen &&
      (observedAt < state.openedAt! + this.policy.openMs ||
        state.probeInFlight)
    ) {
      throw new PluginGatewayError(
        'circuit_open',
        'Plugin operation circuit is open',
      );
    }
    const isProbe = isOpen;
    if (isProbe) state.probeInFlight = true;

    let completed = false;
    const complete = (succeeded: boolean): void => {
      if (completed) return;
      completed = true;
      const current = this.states.get(key);
      if (!current) return;
      const completedAt = explicitNow ? observedAt : Date.now();
      current.probeInFlight = false;
      current.touchedAt = completedAt;
      if (succeeded) {
        this.states.delete(key);
        return;
      }
      current.consecutiveFailures += 1;
      if (
        isProbe ||
        current.consecutiveFailures >= this.policy.failureThreshold
      ) {
        current.openedAt = completedAt;
      }
    };
    return Object.freeze({
      succeed: (): void => complete(true),
      fail: (): void => complete(false),
    });
  }

  private evictClosedState(): void {
    let oldest: { key: string; touchedAt: number } | undefined;
    for (const [key, state] of this.states) {
      if (state.openedAt !== undefined || state.probeInFlight) continue;
      if (!oldest || state.touchedAt < oldest.touchedAt) {
        oldest = { key, touchedAt: state.touchedAt };
      }
    }
    if (oldest) this.states.delete(oldest.key);
  }
}

interface GatewayRateBucket {
  windowStartedAt: number;
  count: number;
}

/**
 * Per-host-replica admission control for plugin sidecars.
 *
 * This is an immediate blast-radius ceiling, not billing metering. Raw subject
 * and tenant references are hashed before becoming ephemeral in-memory keys.
 * A deployment-wide load balancer may impose an additional aggregate ceiling.
 */
export class PluginGatewayAdmissionControllerV1
implements PluginGatewayAdmissionV1 {
  private readonly policy: Required<PluginGatewayAdmissionPolicyV1>;
  private readonly rateBuckets = new Map<string, GatewayRateBucket>();
  private readonly concurrent = new Map<string, number>();

  constructor(policy: PluginGatewayAdmissionPolicyV1) {
    for (const [name, value] of Object.entries(policy)) {
      if (
        value !== undefined &&
        (!Number.isSafeInteger(value) || value <= 0)
      ) {
        throw new Error(`Plugin gateway admission ${name} must be positive`);
      }
    }
    this.policy = {
      ...policy,
      maxTrackedBuckets: policy.maxTrackedBuckets ?? 100_000,
    };
  }

  acquire(input: PluginGatewayAdmissionInputV1): PluginGatewayAdmissionLeaseV1 {
    const now = input.nowMs ?? Date.now();
    const windowStartedAt =
      Math.floor(now / this.policy.windowMs) * this.policy.windowMs;
    this.removeExpiredBuckets(now);

    const subjectKey = admissionHash([
      'subject',
      input.pluginId,
      input.operationId,
      input.tenantRef ?? 'deployment',
      input.subjectRef,
    ]);
    const pluginKey = admissionHash(['plugin', input.pluginId]);
    const concurrentKey = admissionHash([
      'concurrent',
      input.pluginId,
      input.operationId,
    ]);
    const subjectCount = this.bucketCount(subjectKey, windowStartedAt);
    const pluginCount = this.bucketCount(pluginKey, windowStartedAt);
    if (
      subjectCount >= this.policy.maxRequestsPerSubjectOperation ||
      pluginCount >= this.policy.maxRequestsPerPlugin
    ) {
      throw new PluginGatewayError(
        'rate_limited',
        'Plugin operation rate limit exceeded',
      );
    }
    if (
      (this.concurrent.get(concurrentKey) ?? 0) >=
      this.policy.maxConcurrentPerOperation
    ) {
      throw new PluginGatewayError(
        'concurrency_limited',
        'Plugin operation concurrency limit exceeded',
      );
    }
    if (
      this.rateBuckets.size + 2 > this.policy.maxTrackedBuckets &&
      (!this.rateBuckets.has(subjectKey) || !this.rateBuckets.has(pluginKey))
    ) {
      throw new PluginGatewayError(
        'rate_limited',
        'Plugin operation rate state is at capacity',
      );
    }

    this.incrementBucket(subjectKey, windowStartedAt);
    this.incrementBucket(pluginKey, windowStartedAt);
    this.concurrent.set(
      concurrentKey,
      (this.concurrent.get(concurrentKey) ?? 0) + 1,
    );
    let released = false;
    return Object.freeze({
      release: (): void => {
        if (released) return;
        released = true;
        const count = this.concurrent.get(concurrentKey) ?? 0;
        if (count <= 1) {
          this.concurrent.delete(concurrentKey);
        } else {
          this.concurrent.set(concurrentKey, count - 1);
        }
      },
    });
  }

  private bucketCount(key: string, windowStartedAt: number): number {
    const bucket = this.rateBuckets.get(key);
    return bucket?.windowStartedAt === windowStartedAt ? bucket.count : 0;
  }

  private incrementBucket(key: string, windowStartedAt: number): void {
    const bucket = this.rateBuckets.get(key);
    if (bucket?.windowStartedAt === windowStartedAt) {
      bucket.count += 1;
      return;
    }
    this.rateBuckets.set(key, { windowStartedAt, count: 1 });
  }

  private removeExpiredBuckets(now: number): void {
    if (this.rateBuckets.size === 0) return;
    for (const [key, bucket] of this.rateBuckets) {
      if (bucket.windowStartedAt + this.policy.windowMs <= now) {
        this.rateBuckets.delete(key);
      }
    }
  }
}

function admissionHash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\0'), 'utf8').digest('hex');
}

export interface PluginInvocationReplayStoreV1 {
  /**
   * Atomically record an invocation ID until its expiry.
   *
   * Returns false when the ID already exists and the invocation is a replay.
   */
  consume(jti: string, expiresAtEpochSeconds: number): Promise<boolean>;
}

export interface PluginInvocationVerificationInputV1 {
  token: string;
  publicKey: KeyObject | string | Buffer;
  expectedAudience: PluginId;
  expectedOperationId: string;
  replayStore: PluginInvocationReplayStoreV1;
  nowEpochSeconds?: number;
  clockSkewSeconds?: number;
  maximumLifetimeSeconds?: number;
}

const tokenHeader = Object.freeze({
  alg: 'EdDSA',
  typ: 'EG-PLUGIN-INVOCATION-V1',
});

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson(segment: string): unknown {
  if (segment.length === 0 || segment.length > 32_768) {
    throw new PluginGatewayError(
      'token_malformed',
      'Invocation token segment has an invalid size',
    );
  }
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new PluginGatewayError(
      'token_malformed',
      'Invocation token contains invalid JSON',
    );
  }
}

function keyObject(
  key: KeyObject | string | Buffer,
  kind: 'public' | 'private',
): KeyObject {
  if (typeof key !== 'string' && !Buffer.isBuffer(key)) return key;
  return kind === 'public' ? createPublicKey(key) : createPrivateKey(key);
}

export function signPluginInvocationV1(
  claimsInput: PluginInvocationClaimsV1,
  privateKey: KeyObject | string | Buffer,
): string {
  const claims = pluginInvocationClaimsV1Schema.parse(claimsInput);
  const header = encodeJson(tokenHeader);
  const payload = encodeJson(claims);
  const signingInput = `${header}.${payload}`;
  const signature = sign(
    null,
    Buffer.from(signingInput, 'utf8'),
    keyObject(privateKey, 'private'),
  ).toString('base64url');
  return `${signingInput}.${signature}`;
}

export async function verifyPluginInvocationV1(
  input: PluginInvocationVerificationInputV1,
): Promise<PluginInvocationClaimsV1> {
  if (input.token.length === 0 || input.token.length > 64_000) {
    throw new PluginGatewayError(
      'token_malformed',
      'Invocation token has an invalid size',
    );
  }
  const segments = input.token.split('.');
  if (segments.length !== 3) {
    throw new PluginGatewayError(
      'token_malformed',
      'Invocation token must contain three segments',
    );
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  const header = decodeJson(headerSegment);
  if (
    !header ||
    typeof header !== 'object' ||
    (header as Record<string, unknown>).alg !== tokenHeader.alg ||
    (header as Record<string, unknown>).typ !== tokenHeader.typ ||
    Object.keys(header as Record<string, unknown>).length !== 2
  ) {
    throw new PluginGatewayError(
      'token_algorithm_invalid',
      'Invocation token header is unsupported',
    );
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(signatureSegment, 'base64url');
  } catch {
    throw new PluginGatewayError(
      'token_malformed',
      'Invocation token signature is malformed',
    );
  }
  const signingInput = `${headerSegment}.${payloadSegment}`;
  if (
    !verify(
      null,
      Buffer.from(signingInput, 'utf8'),
      keyObject(input.publicKey, 'public'),
      signature,
    )
  ) {
    throw new PluginGatewayError(
      'token_signature_invalid',
      'Invocation token signature is invalid',
    );
  }

  const parsed = pluginInvocationClaimsV1Schema.safeParse(
    decodeJson(payloadSegment),
  );
  if (!parsed.success) {
    throw new PluginGatewayError(
      'token_claims_invalid',
      'Invocation token claims are invalid',
    );
  }
  const claims = parsed.data;
  if (claims.aud !== input.expectedAudience) {
    throw new PluginGatewayError(
      'token_audience_invalid',
      'Invocation token audience does not match this plugin',
    );
  }
  if (claims.operationId !== input.expectedOperationId) {
    throw new PluginGatewayError(
      'token_operation_invalid',
      'Invocation token operation does not match the requested operation',
    );
  }

  const now = input.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const skew = input.clockSkewSeconds ?? 5;
  const maximumLifetime = input.maximumLifetimeSeconds ?? 60;
  if (claims.exp < now - skew) {
    throw new PluginGatewayError(
      'token_expired',
      'Invocation token has expired',
    );
  }
  if (claims.iat > now + skew) {
    throw new PluginGatewayError(
      'token_not_yet_valid',
      'Invocation token was issued in the future',
    );
  }
  if (claims.exp - claims.iat > maximumLifetime) {
    throw new PluginGatewayError(
      'token_lifetime_exceeded',
      'Invocation token lifetime exceeds policy',
    );
  }
  if (!(await input.replayStore.consume(claims.jti, claims.exp))) {
    throw new PluginGatewayError(
      'token_replayed',
      'Invocation token has already been consumed',
    );
  }
  return claims;
}

export interface PluginGatewayAuthorizationInputV1 {
  manifest: EnterpriseGluePluginManifestV1;
  pluginId: PluginId;
  operationId: string;
  method: string;
  relativePath: string;
  requestBytes: number;
  grantedPermissions: readonly PluginPermissionV1[];
}

export function matchPluginOperationPathV1(
  declaredPath: string,
  requestedPath: string,
): Readonly<Record<string, string>> | null {
  if (!safeRelativePathSchema.safeParse(requestedPath).success) return null;
  const declaredSegments = declaredPath.split('/');
  const requestedSegments = requestedPath.split('/');
  if (declaredSegments.length !== requestedSegments.length) return null;

  const parameters: Record<string, string> = {};
  for (let index = 0; index < declaredSegments.length; index += 1) {
    const declared = declaredSegments[index]!;
    const requested = requestedSegments[index]!;
    if (!declared.startsWith(':')) {
      if (declared !== requested) return null;
      continue;
    }
    const name = declared.slice(1);
    if (
      !name ||
      requested.startsWith(':') ||
      !opaqueReferenceSchema.safeParse(requested).success
    ) {
      return null;
    }
    parameters[name] = requested;
  }
  return Object.freeze(parameters);
}

export function authorizePluginGatewayInvocationV1(
  input: PluginGatewayAuthorizationInputV1,
): PluginBackendOperationV1 {
  if (
    input.manifest.metadata.id !== input.pluginId ||
    !input.operationId.startsWith(`${input.pluginId}.`)
  ) {
    throw new PluginGatewayError(
      'operation_unknown',
      'Plugin operation is not owned by the requested plugin',
    );
  }
  const operation = input.manifest.deployment.backend?.operations.find(
    (candidate) => candidate.operationId === input.operationId,
  );
  if (!operation) {
    throw new PluginGatewayError(
      'operation_unknown',
      'Plugin operation is not declared in the signed manifest',
    );
  }
  if (operation.method !== input.method) {
    throw new PluginGatewayError(
      'operation_method_invalid',
      'Plugin operation method does not match the manifest',
    );
  }
  if (matchPluginOperationPathV1(operation.path, input.relativePath) === null) {
    throw new PluginGatewayError(
      'operation_path_invalid',
      'Plugin operation path does not match the manifest',
    );
  }
  if (input.requestBytes < 0 || input.requestBytes > operation.maxRequestBytes) {
    throw new PluginGatewayError(
      'request_too_large',
      'Plugin request exceeds its declared maximum',
    );
  }
  const granted = new Set(input.grantedPermissions);
  if (
    operation.requiredPermissions.some(
      (permission) => !granted.has(permission),
    )
  ) {
    throw new PluginGatewayError(
      'permission_denied',
      'Plugin operation is missing a required permission grant',
    );
  }
  return operation;
}

export function validatePluginBackendCapabilitiesV1(
  manifest: EnterpriseGluePluginManifestV1,
  input: unknown,
): PluginBackendCapabilitiesV1 {
  const parsed = pluginBackendCapabilitiesV1Schema.safeParse(input);
  if (!parsed.success) {
    throw new PluginGatewayError(
      'capabilities_invalid',
      'Plugin backend returned an invalid capability document',
    );
  }
  const capabilities = parsed.data;
  if (
    capabilities.pluginId !== manifest.metadata.id ||
    capabilities.pluginVersion !== manifest.metadata.version
  ) {
    throw new PluginGatewayError(
      'capabilities_identity_invalid',
      'Plugin backend identity does not match the signed manifest',
    );
  }

  const manifestOperations = manifest.deployment.backend?.operations ?? [];
  if (manifestOperations.length !== capabilities.operations.length) {
    throw new PluginGatewayError(
      'capabilities_operation_mismatch',
      'Plugin backend operations do not exactly match the signed manifest',
    );
  }
  const capabilitiesById = new Map(
    capabilities.operations.map((operation) => [
      operation.operationId,
      operation,
    ]),
  );
  for (const declared of manifestOperations) {
    const actual = capabilitiesById.get(declared.operationId);
    const requestHash = declared.requestSchema.sha256;
    const responseHash = declared.responseSchema.sha256;
    if (
      !actual ||
      !timingSafeEqual(
        Buffer.from(actual.requestSchemaSha256),
        Buffer.from(requestHash),
      ) ||
      !timingSafeEqual(
        Buffer.from(actual.responseSchemaSha256),
        Buffer.from(responseHash),
      )
    ) {
      throw new PluginGatewayError(
        'capabilities_operation_mismatch',
        `Plugin backend capability ${declared.operationId} differs from the signed manifest`,
      );
    }
  }
  return capabilities;
}
