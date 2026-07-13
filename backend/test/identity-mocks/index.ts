import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { IdentityProviderAdapter, NormalizedExternalIdentity, ProviderIdentityInput } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderAdapter.js';

export type OidcMockFailureMode = 'none' | 'unavailable' | 'malformed' | 'wrong_issuer' | 'invalid_token';

interface SigningMaterial {
  privateKey: string;
  publicJwk: JsonWebKey;
}

function createSigningMaterial(kid: string): SigningMaterial {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: keys.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    publicJwk: { ...keys.publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' },
  };
}

/**
 * In-process protocol boundary for deterministic OIDC tests. It is deliberately
 * test-only: product code only sees ordinary discovery, token, and JWKS HTTP calls.
 */
export class MockOidcProvider {
  readonly issuer = 'https://identity-mock.example.test';
  readonly clientId = 'enterpriseglue-test-client';
  readonly callbackUrl = 'https://app.example.test/api/auth/identity/callback';
  private signingMaterial = createSigningMaterial('identity-mock-key-1');
  private tokenClaims: Record<string, unknown> = {
    sub: 'user-1', email: 'person@example.test', email_verified: true, groups: ['ops'], nonce: 'nonce-1',
  };
  private failureMode: OidcMockFailureMode = 'none';

  configuration() {
    return { issuerUrl: this.issuer, clientId: this.clientId, callbackUrl: this.callbackUrl, scopes: ['openid', 'profile', 'email'] };
  }

  setTokenClaims(claims: Record<string, unknown>): void {
    this.tokenClaims = { ...claims };
  }

  setFailureMode(mode: OidcMockFailureMode): void {
    this.failureMode = mode;
  }

  rotateSigningMaterial(): void {
    const kid = `identity-mock-key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.signingMaterial = createSigningMaterial(kid);
  }

  reset(): void {
    this.failureMode = 'none';
    this.tokenClaims = { sub: 'user-1', email: 'person@example.test', email_verified: true, groups: ['ops'], nonce: 'nonce-1' };
  }

  issueIdToken(claims: Record<string, unknown> = this.tokenClaims, expiresIn: string | number = '5m'): string {
    return jwt.sign({ ...claims, iss: this.issuer, aud: this.clientId }, this.signingMaterial.privateKey, {
      algorithm: 'RS256', keyid: String(this.signingMaterial.publicJwk.kid), expiresIn,
    });
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const url = String(input);
    if (this.failureMode === 'unavailable') return new Response('unavailable', { status: 503 });
    if (url === `${this.issuer}/.well-known/openid-configuration`) {
      if (this.failureMode === 'malformed') return Response.json({ issuer: this.issuer });
      return Response.json({
        issuer: this.failureMode === 'wrong_issuer' ? 'https://wrong-issuer.example.test' : this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`, token_endpoint: `${this.issuer}/token`, jwks_uri: `${this.issuer}/jwks`,
      });
    }
    if (url === `${this.issuer}/jwks`) return Response.json({ keys: [this.signingMaterial.publicJwk] });
    if (url === `${this.issuer}/token` && init?.method === 'POST') {
      if (this.failureMode === 'invalid_token') return Response.json({ id_token: 'invalid.token.value' });
      return Response.json({ id_token: this.issueIdToken() });
    }
    return new Response('not found', { status: 404 });
  }
}

export class MockSamlIdentityProvider {
  private attributes: Record<string, unknown> = {
    nameID: 'person@example.test',
    'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups': ['payments', 'operations'],
    role: ['operator'],
  };

  setAttributes(attributes: Record<string, unknown>): void {
    this.attributes = { ...attributes };
  }

  assertion(): Record<string, unknown> {
    return { ...this.attributes };
  }
}

export class MockLdapDirectory {
  private readonly users = new Map<string, { password: string; subjectId: string; memberOf: string[] }>();

  constructor() {
    this.setUser('person@example.test', {
      password: 'directory-password', subjectId: 'uid=person,ou=users,dc=example,dc=test',
      memberOf: ['cn=operations,ou=groups,dc=example,dc=test'],
    });
  }

  setUser(username: string, value: { password: string; subjectId: string; memberOf: string[] }): void {
    this.users.set(username, { ...value, memberOf: [...value.memberOf] });
  }

  deleteUser(username: string): void {
    this.users.delete(username);
  }

  bind(username: string, password: string): { subjectId: string; memberOf: string[] } {
    const user = this.users.get(username);
    if (!user || user.password !== password) throw new Error('LDAP invalid credentials');
    return { subjectId: user.subjectId, memberOf: [...user.memberOf] };
  }
}

/** A protocol-independent adapter used to prove the shared contract is not protocol-coupled. */
export const inMemoryIdentityProviderAdapter: IdentityProviderAdapter = {
  type: 'oidc',
  normalizeIdentity(input: ProviderIdentityInput): NormalizedExternalIdentity {
    const subjectId = input.subjectId.trim();
    if (!input.providerKey.trim()) throw new Error('providerKey is required');
    if (!subjectId) throw new Error('subjectId is required');
    const values = (value: unknown): string[] => [...new Set((Array.isArray(value) ? value : value == null ? [] : [value])
      .map((entry) => String(entry).trim()).filter(Boolean))].sort();
    const scopes = values(input.claims.scp ?? input.claims.scope).flatMap((value) => value.split(/\s+/)).filter(Boolean).sort();
    const entitlements = [
      ...values(input.claims.groups ?? input.claims.group ?? input.claims.memberOf).map((externalId) => ({ type: 'group' as const, externalId })),
      ...values(input.claims.roles ?? input.claims.role ?? input.claims.appRoles).map((externalId) => ({ type: 'role' as const, externalId })),
      ...scopes.map((externalId) => ({ type: 'scope' as const, externalId })),
    ];
    return {
      providerKey: input.providerKey.trim(), providerType: 'oidc', subjectId,
      username: input.username?.trim() || undefined, email: input.email?.trim().toLowerCase() || undefined,
      directoryTenantId: input.directoryTenantId?.trim() || undefined, observedAt: input.observedAt ?? Date.now(),
      entitlements: entitlements.filter((entry, index) => entitlements.findIndex((candidate) => candidate.type === entry.type && candidate.externalId === entry.externalId) === index),
    };
  },
};
