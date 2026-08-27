import { describe, expect, it, vi } from 'vitest';
import {
  HttpTenantSecretBroker,
  TenantSecretBrokerError,
  assertTenantSecretReference,
  createTenantSecretReference,
  parseTenantSecretReference,
  type TenantSecretBrokerPort,
  type TenantSecretMetadata,
  type TenantSecretOperationContext,
} from '@enterpriseglue/shared/services/platform-admin/TenantSecretBroker.js';
import { SecretResolver } from '@enterpriseglue/shared/services/platform-admin/SecretResolver.js';

class FakeBroker implements TenantSecretBrokerPort {
  readonly values = new Map<string, string>();
  resolveCalls = 0;
  putCalls = 0;
  retireCalls = 0;

  async resolve(input: TenantSecretOperationContext & { reference: string }) {
    this.resolveCalls += 1;
    assertTenantSecretReference(input.reference, input);
    const value = this.values.get(input.reference);
    if (!value) throw new TenantSecretBrokerError('unavailable');
    return { value, version: '1' };
  }

  async put(input: TenantSecretOperationContext & { value: string; previousReference?: string }): Promise<TenantSecretMetadata> {
    this.putCalls += 1;
    const reference = createTenantSecretReference({
      tenantId: input.tenantId,
      purpose: input.purpose,
      opaqueId: `version-${this.putCalls}`,
    });
    this.values.set(reference, input.value);
    return { ...input, reference, version: String(this.putCalls), updatedAt: 1_700_000_000_000 };
  }

  async availability(input: TenantSecretOperationContext & { reference: string }) {
    assertTenantSecretReference(input.reference, input);
    return { available: this.values.has(input.reference), ...(this.values.has(input.reference) ? { version: '1' } : { reason: 'not_found' as const }) };
  }

  async retire(input: TenantSecretOperationContext & { reference: string }) {
    this.retireCalls += 1;
    assertTenantSecretReference(input.reference, input);
    return { retired: this.values.delete(input.reference), retiredAt: 1_700_000_000_001 };
  }
}

function resolver(broker: TenantSecretBrokerPort, cacheTtl = 30_000) {
  return new SecretResolver(() => ({
    provider: 'env',
    tenantSecretBrokerCacheTtlMs: cacheTtl,
    tenantSecretBrokerCacheMaxEntries: 2,
  }), broker);
}

describe('tenant secret broker contract', () => {
  it('creates parseable references that bind tenant, purpose, and opaque id', () => {
    const reference = createTenantSecretReference({ tenantId: 'tenant-alpha', purpose: 'oidc.client_secret', opaqueId: 'secret-1' });
    expect(reference).toBe('tenant-secret://v1/tenant-alpha/oidc.client_secret/secret-1');
    expect(parseTenantSecretReference(reference)).toEqual({ tenantId: 'tenant-alpha', purpose: 'oidc.client_secret', opaqueId: 'secret-1' });
    expect(() => assertTenantSecretReference(reference, { tenantId: 'tenant-bravo', purpose: 'oidc.client_secret' })).toThrowError(TenantSecretBrokerError);
    expect(() => assertTenantSecretReference(reference, { tenantId: 'tenant-alpha', purpose: 'ldap.bind_password' })).toThrowError(TenantSecretBrokerError);
  });

  it('rejects Alpha resolving Bravo material before calling the broker', async () => {
    const broker = new FakeBroker();
    const secretResolver = resolver(broker);
    const bravoReference = createTenantSecretReference({ tenantId: 'tenant-bravo', purpose: 'oidc.client_secret', opaqueId: 'secret-1' });
    broker.values.set(bravoReference, 'bravo-secret-sentinel');

    await expect(secretResolver.resolveTenantStored(`ref:${bravoReference}`, {
      tenantId: 'tenant-alpha', purpose: 'oidc.client_secret', correlationId: 'cross-tenant-test',
    })).rejects.toMatchObject({ code: 'tenant_mismatch' });
    expect(broker.resolveCalls).toBe(0);
  });

  it('uses a bounded cache and invalidates references during rotation and retirement', async () => {
    const broker = new FakeBroker();
    const secretResolver = resolver(broker);
    const first = await secretResolver.putTenantSecret({ tenantId: 'tenant-alpha', purpose: 'ldap.bind_password', value: 'first-secret', correlationId: 'put-1' });

    await expect(secretResolver.resolveTenantStored(`ref:${first.reference}`, { tenantId: 'tenant-alpha', purpose: 'ldap.bind_password', correlationId: 'resolve-1' })).resolves.toBe('first-secret');
    await expect(secretResolver.resolveTenantStored(`ref:${first.reference}`, { tenantId: 'tenant-alpha', purpose: 'ldap.bind_password', correlationId: 'resolve-2' })).resolves.toBe('first-secret');
    expect(broker.resolveCalls).toBe(1);

    const second = await secretResolver.putTenantSecret({ tenantId: 'tenant-alpha', purpose: 'ldap.bind_password', value: 'second-secret', previousReference: first.reference, correlationId: 'put-2' });
    await expect(secretResolver.resolveTenantStored(`ref:${first.reference}`, { tenantId: 'tenant-alpha', purpose: 'ldap.bind_password', correlationId: 'resolve-3' })).resolves.toBe('first-secret');
    expect(broker.resolveCalls).toBe(2);
    await expect(secretResolver.resolveTenantStored(`ref:${second.reference}`, { tenantId: 'tenant-alpha', purpose: 'ldap.bind_password', correlationId: 'resolve-4' })).resolves.toBe('second-secret');

    await expect(secretResolver.retireTenantSecret(second.reference, { tenantId: 'tenant-alpha', purpose: 'ldap.bind_password', correlationId: 'retire-1' })).resolves.toEqual({ retired: true, retiredAt: 1_700_000_000_001 });
    await expect(secretResolver.resolveTenantStored(`ref:${second.reference}`, { tenantId: 'tenant-alpha', purpose: 'ldap.bind_password', correlationId: 'resolve-5' })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('keeps broker authentication out of the request body and validates response tenancy', async () => {
    const reference = createTenantSecretReference({ tenantId: 'tenant-alpha', purpose: 'oidc.client_secret', opaqueId: 'secret-1' });
    const fetchImpl = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => new Response(JSON.stringify({ value: 'resolved-secret', reference, version: '7' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const broker = new HttpTenantSecretBroker({ baseUrl: 'https://broker.internal.example/', authToken: () => 'broker-token-sentinel', timeoutMs: 1_000, fetchImpl });
    await expect(broker.resolve({ tenantId: 'tenant-alpha', purpose: 'oidc.client_secret', correlationId: 'http-test-1', reference })).resolves.toEqual({ value: 'resolved-secret', version: '7' });

    const init = fetchImpl.mock.calls[0][1]!;
    expect(init.headers).toMatchObject({
      authorization: 'Bearer broker-token-sentinel',
      'x-correlation-id': 'http-test-1',
      'x-enterpriseglue-tenant-id': 'tenant-alpha',
    });
    expect(String(init.body)).not.toContain('broker-token-sentinel');
  });

  it('fails safely on outage without including secret values in the error', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network failure with secret-value-sentinel'); });
    const broker = new HttpTenantSecretBroker({ baseUrl: 'https://broker.internal.example/', authToken: () => 'broker-token-sentinel', timeoutMs: 100, fetchImpl });
    const reference = createTenantSecretReference({ tenantId: 'tenant-alpha', purpose: 'saml.idp_signing_certificate', opaqueId: 'secret-1' });
    const error = await broker.resolve({ tenantId: 'tenant-alpha', purpose: 'saml.idp_signing_certificate', correlationId: 'outage-test', reference }).catch((candidate) => candidate as Error);
    expect(error).toMatchObject({ name: 'TenantSecretBrokerError', message: 'Tenant secret broker is unavailable' });
    expect(JSON.stringify(error)).not.toContain('secret-value-sentinel');
    expect(JSON.stringify(error)).not.toContain('broker-token-sentinel');
  });
});
