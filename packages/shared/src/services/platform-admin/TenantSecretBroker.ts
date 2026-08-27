import {
  TENANT_IDENTITY_SECRET_PURPOSES,
  TenantIdentitySecretPurposeSchema,
  type TenantIdentitySecretPurpose,
} from '../../schemas/platform-admin/identity.js';

export const TENANT_SECRET_PURPOSES = TENANT_IDENTITY_SECRET_PURPOSES;

export type TenantSecretPurpose = TenantIdentitySecretPurpose;

export const TenantSecretPurposeSchema = TenantIdentitySecretPurposeSchema;

export type TenantSecretOperationContext = {
  tenantId: string;
  purpose: TenantSecretPurpose;
  correlationId: string;
};

export type TenantSecretMetadata = TenantSecretOperationContext & {
  reference: string;
  version: string | null;
  updatedAt: number;
};

export type TenantSecretAvailability = {
  available: boolean;
  reason?: 'not_found' | 'retired' | 'provider_unavailable';
  version?: string | null;
};

export interface TenantSecretBrokerPort {
  resolve(input: TenantSecretOperationContext & { reference: string }): Promise<{ value: string; version?: string | null }>;
  put(input: TenantSecretOperationContext & { value: string; previousReference?: string }): Promise<TenantSecretMetadata>;
  availability(input: TenantSecretOperationContext & { reference: string }): Promise<TenantSecretAvailability>;
  retire(input: TenantSecretOperationContext & { reference: string }): Promise<{ retired: boolean; retiredAt: number }>;
}

export type ParsedTenantSecretReference = {
  tenantId: string;
  purpose: TenantSecretPurpose;
  opaqueId: string;
};

const TENANT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SECRET_VALUE_LIMIT_BYTES = 256 * 1024;
const RESPONSE_LIMIT_BYTES = 384 * 1024;

export class TenantSecretBrokerError extends Error {
  constructor(
    readonly code:
      | 'invalid_context'
      | 'invalid_reference'
      | 'tenant_mismatch'
      | 'purpose_mismatch'
      | 'not_configured'
      | 'unavailable'
      | 'invalid_response',
  ) {
    super(code === 'not_configured'
      ? 'Tenant secret broker is not configured'
      : code === 'unavailable'
        ? 'Tenant secret broker is unavailable'
        : 'Tenant secret broker request was rejected');
    this.name = 'TenantSecretBrokerError';
  }
}

function requiredToken(value: string, kind: 'tenant' | 'correlation'): string {
  const normalized = value.trim();
  const valid = kind === 'tenant' ? TENANT_ID.test(normalized) : CORRELATION_ID.test(normalized);
  if (!valid) throw new TenantSecretBrokerError('invalid_context');
  return normalized;
}

export function createTenantSecretReference(input: {
  tenantId: string;
  purpose: TenantSecretPurpose;
  opaqueId: string;
}): string {
  const tenantId = requiredToken(input.tenantId, 'tenant');
  const purpose = TenantSecretPurposeSchema.parse(input.purpose);
  const opaqueId = input.opaqueId.trim();
  if (!OPAQUE_ID.test(opaqueId)) throw new TenantSecretBrokerError('invalid_reference');
  return `tenant-secret://v1/${tenantId}/${purpose}/${opaqueId}`;
}

export function parseTenantSecretReference(value: string): ParsedTenantSecretReference {
  const match = /^tenant-secret:\/\/v1\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(value.trim());
  if (!match || !TENANT_ID.test(match[1]) || !OPAQUE_ID.test(match[3])) {
    throw new TenantSecretBrokerError('invalid_reference');
  }
  const purpose = TenantSecretPurposeSchema.safeParse(match[2]);
  if (!purpose.success) throw new TenantSecretBrokerError('invalid_reference');
  return { tenantId: match[1], purpose: purpose.data, opaqueId: match[3] };
}

export function assertTenantSecretReference(
  reference: string,
  context: Pick<TenantSecretOperationContext, 'tenantId' | 'purpose'>,
): ParsedTenantSecretReference {
  const parsed = parseTenantSecretReference(reference);
  if (parsed.tenantId !== requiredToken(context.tenantId, 'tenant')) {
    throw new TenantSecretBrokerError('tenant_mismatch');
  }
  if (parsed.purpose !== context.purpose) throw new TenantSecretBrokerError('purpose_mismatch');
  return parsed;
}

function brokerEndpoint(baseUrl: string, operation: 'resolve' | 'put' | 'availability' | 'retire'): URL {
  let base: URL;
  try { base = new URL(baseUrl); } catch { throw new TenantSecretBrokerError('not_configured'); }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(base.hostname);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) {
    throw new TenantSecretBrokerError('not_configured');
  }
  return new URL(`v1/tenant-secrets:${operation}`, `${base.toString().replace(/\/?$/, '/')}`);
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > RESPONSE_LIMIT_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new TenantSecretBrokerError('invalid_response');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > RESPONSE_LIMIT_BYTES) throw new TenantSecretBrokerError('invalid_response');
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new TenantSecretBrokerError('invalid_response');
  }
}

function safeMetadata(
  response: Record<string, unknown>,
  context: TenantSecretOperationContext,
): TenantSecretMetadata {
  if (typeof response.reference !== 'string') throw new TenantSecretBrokerError('invalid_response');
  assertTenantSecretReference(response.reference, context);
  const updatedAt = Number(response.updatedAt);
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) throw new TenantSecretBrokerError('invalid_response');
  const version = response.version == null ? null : typeof response.version === 'string' ? response.version : null;
  if (response.version != null && version === null) throw new TenantSecretBrokerError('invalid_response');
  return { ...context, reference: response.reference, version, updatedAt };
}

export class HttpTenantSecretBroker implements TenantSecretBrokerPort {
  constructor(private readonly settings: {
    baseUrl: string;
    authToken: () => string;
    timeoutMs: number;
    fetchImpl?: typeof fetch;
  }) {}

  private async call(
    operation: 'resolve' | 'put' | 'availability' | 'retire',
    input: TenantSecretOperationContext & Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    requiredToken(input.tenantId, 'tenant');
    requiredToken(input.correlationId, 'correlation');
    TenantSecretPurposeSchema.parse(input.purpose);
    const authToken = this.settings.authToken().trim();
    if (!authToken) throw new TenantSecretBrokerError('not_configured');
    let response: Response;
    try {
      response = await (this.settings.fetchImpl || fetch)(brokerEndpoint(this.settings.baseUrl, operation), {
        method: 'POST',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${authToken}`,
          'content-type': 'application/json',
          'x-correlation-id': input.correlationId,
          'x-enterpriseglue-tenant-id': input.tenantId,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(this.settings.timeoutMs),
      });
    } catch {
      throw new TenantSecretBrokerError('unavailable');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new TenantSecretBrokerError('unavailable');
    }
    return boundedJson(response);
  }

  async resolve(input: TenantSecretOperationContext & { reference: string }): Promise<{ value: string; version?: string | null }> {
    assertTenantSecretReference(input.reference, input);
    const response = await this.call('resolve', input);
    if (typeof response.value !== 'string' || !response.value) throw new TenantSecretBrokerError('invalid_response');
    if (response.reference !== undefined && response.reference !== input.reference) throw new TenantSecretBrokerError('invalid_response');
    return { value: response.value, ...(typeof response.version === 'string' || response.version === null ? { version: response.version } : {}) };
  }

  async put(input: TenantSecretOperationContext & { value: string; previousReference?: string }): Promise<TenantSecretMetadata> {
    if (!input.value || Buffer.byteLength(input.value, 'utf8') > SECRET_VALUE_LIMIT_BYTES) {
      throw new TenantSecretBrokerError('invalid_context');
    }
    if (input.previousReference) assertTenantSecretReference(input.previousReference, input);
    return safeMetadata(await this.call('put', input), input);
  }

  async availability(input: TenantSecretOperationContext & { reference: string }): Promise<TenantSecretAvailability> {
    assertTenantSecretReference(input.reference, input);
    const response = await this.call('availability', input);
    if (typeof response.available !== 'boolean') throw new TenantSecretBrokerError('invalid_response');
    const reason = response.reason;
    if (reason !== undefined && !['not_found', 'retired', 'provider_unavailable'].includes(String(reason))) {
      throw new TenantSecretBrokerError('invalid_response');
    }
    return {
      available: response.available,
      ...(reason ? { reason: String(reason) as TenantSecretAvailability['reason'] } : {}),
      ...(typeof response.version === 'string' || response.version === null ? { version: response.version } : {}),
    };
  }

  async retire(input: TenantSecretOperationContext & { reference: string }): Promise<{ retired: boolean; retiredAt: number }> {
    assertTenantSecretReference(input.reference, input);
    const response = await this.call('retire', input);
    const retiredAt = Number(response.retiredAt);
    if (typeof response.retired !== 'boolean' || !Number.isSafeInteger(retiredAt) || retiredAt < 0) {
      throw new TenantSecretBrokerError('invalid_response');
    }
    return { retired: response.retired, retiredAt };
  }
}
