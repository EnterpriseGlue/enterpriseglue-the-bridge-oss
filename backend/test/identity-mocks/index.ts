import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import jwt from 'jsonwebtoken';
import type { IdentityProviderAdapter, NormalizedExternalIdentity, ProviderIdentityInput } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderAdapter.js';
import { samlSigningMaterials } from './samlSigningMaterial.js';

const require = createRequire(import.meta.url);
const { signXml } = require('@node-saml/node-saml/lib/xml.js') as {
  signXml: (xml: string, xpath: string, location: { reference: string; action: 'after' }, options: { privateKey: string; publicCert: string; signatureAlgorithm: 'sha256' }) => string;
};

export type OidcMockFailureMode = 'none' | 'unavailable' | 'malformed' | 'wrong_issuer' | 'invalid_token' | 'wrong_audience' | 'group_overage' | 'expired_token' | 'not_yet_valid_token' | 'missing_subject' | 'timeout';

interface SigningMaterial {
  privateKey: string;
  publicJwk: JsonWebKey & { kid: string };
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

  issueIdToken(
    claims: Record<string, unknown> = this.tokenClaims,
    expiresIn: Exclude<jwt.SignOptions['expiresIn'], undefined> = '5m',
  ): string {
    return jwt.sign({ ...claims, iss: this.issuer, aud: this.clientId }, this.signingMaterial.privateKey, {
      algorithm: 'RS256', keyid: String(this.signingMaterial.publicJwk.kid), expiresIn,
    });
  }

  issueIdTokenWithNotBefore(
    claims: Record<string, unknown>,
    notBefore: Exclude<jwt.SignOptions['notBefore'], undefined>,
  ): string {
    return jwt.sign({ ...claims, iss: this.issuer, aud: this.clientId }, this.signingMaterial.privateKey, {
      algorithm: 'RS256', keyid: String(this.signingMaterial.publicJwk.kid), expiresIn: '5m', notBefore,
    });
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const url = String(input);
    if (this.failureMode === 'timeout') throw new Error('OIDC provider request timed out');
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
      if (this.failureMode === 'wrong_audience') {
        return Response.json({ id_token: jwt.sign({ ...this.tokenClaims, iss: this.issuer, aud: 'wrong-audience' }, this.signingMaterial.privateKey, {
          algorithm: 'RS256', keyid: String(this.signingMaterial.publicJwk.kid), expiresIn: '5m',
        }) });
      }
      if (this.failureMode === 'expired_token') return Response.json({ id_token: this.issueIdToken(undefined, -1) });
      if (this.failureMode === 'not_yet_valid_token') return Response.json({ id_token: this.issueIdTokenWithNotBefore(this.tokenClaims, '5m') });
      if (this.failureMode === 'missing_subject') return Response.json({ id_token: this.issueIdToken({ email: 'person@example.test', email_verified: true, nonce: 'nonce-1', groups: ['ops'] }) });
      if (this.failureMode === 'group_overage') {
        return Response.json({ id_token: this.issueIdToken({
          sub: 'user-1', email: 'person@example.test', email_verified: true, nonce: 'nonce-1', hasgroups: true,
          _claim_names: { groups: 'src1' }, _claim_sources: { src1: { endpoint: 'https://graph.example.test/me/getMemberObjects' } },
        }) });
      }
      return Response.json({ id_token: this.issueIdToken() });
    }
    return new Response('not found', { status: 404 });
  }
}

export class MockSamlIdentityProvider {
  readonly issuer = 'https://saml-mock.example.test';
  readonly audience = 'enterpriseglue-ai';
  readonly callbackUrl = 'https://app.example.test/api/auth/providers/saml/callback';
  private signingMaterialIndex = 0;
  private sequence = 0;
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

  certificate(): string {
    return samlSigningMaterials[this.signingMaterialIndex].certificate;
  }

  rotateSigningMaterial(): void {
    this.signingMaterialIndex = (this.signingMaterialIndex + 1) % samlSigningMaterials.length;
  }

  signedResponse(): string {
    const material = samlSigningMaterials[this.signingMaterialIndex];
    const now = new Date();
    const notBefore = new Date(now.getTime() - 60_000).toISOString();
    const notOnOrAfter = new Date(now.getTime() + 300_000).toISOString();
    const issueInstant = now.toISOString();
    const sequence = ++this.sequence;
    const nameId = xmlEscape(String(this.attributes.nameID || 'person@example.test'));
    const attributeXml = Object.entries(this.attributes)
      .filter(([name]) => name !== 'nameID')
      .map(([name, value]) => `<saml:Attribute Name="${xmlEscape(name)}">${(Array.isArray(value) ? value : [value]).map((entry) => `<saml:AttributeValue>${xmlEscape(String(entry))}</saml:AttributeValue>`).join('')}</saml:Attribute>`)
      .join('');
    const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assertion-${sequence}" Version="2.0" IssueInstant="${issueInstant}"><saml:Issuer>${this.issuer}</saml:Issuer><saml:Subject><saml:NameID>${nameId}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData Recipient="${this.callbackUrl}" NotOnOrAfter="${notOnOrAfter}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}"><saml:AudienceRestriction><saml:Audience>${this.audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${issueInstant}" SessionIndex="session-${sequence}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement>${attributeXml}</saml:AttributeStatement></saml:Assertion>`;
    const signedAssertion = signXml(assertion, "/*[local-name(.)='Assertion']", { reference: "/*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' }, { ...material, publicCert: material.certificate, signatureAlgorithm: 'sha256' });
    const response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_response-${sequence}" Version="2.0" IssueInstant="${issueInstant}" Destination="${this.callbackUrl}"><saml:Issuer>${this.issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${signedAssertion}</samlp:Response>`;
    const signedResponse = signXml(response, "/*[local-name(.)='Response']", { reference: "/*[local-name(.)='Response']/*[local-name(.)='Issuer']", action: 'after' }, { ...material, publicCert: material.certificate, signatureAlgorithm: 'sha256' });
    return Buffer.from(signedResponse).toString('base64');
  }
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export class MockLdapDirectory {
  readonly url = 'ldaps://directory-mock.example.test:636';
  readonly bindDn = 'cn=service,dc=example,dc=test';
  readonly bindPassword = 'service-password';
  private readonly users = new Map<string, { password: string; subjectId: string; memberOf: string[] }>();
  private failureMode: 'none' | 'tls_failure' | 'timeout' | 'search_failure' | 'malformed' = 'none';

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

  setFailureMode(mode: typeof this.failureMode): void {
    this.failureMode = mode;
  }

  bind(username: string, password: string): { subjectId: string; memberOf: string[] } {
    const user = this.users.get(username);
    if (!user || user.password !== password) throw new Error('LDAP invalid credentials');
    return { subjectId: user.subjectId, memberOf: [...user.memberOf] };
  }

  client(url: string) {
    if (!url.startsWith('ldaps://')) throw new Error('LDAP mock requires TLS');
    if (this.failureMode === 'tls_failure') throw new Error('LDAP TLS certificate verification failed');
    let selectedUser: { username: string; password: string; subjectId: string; memberOf: string[] } | null = null;
    return {
      bind: async (dn: string, password: string) => {
        if (this.failureMode === 'timeout') throw new Error('LDAP bind timed out');
        if (dn === this.bindDn && password === this.bindPassword) return;
        selectedUser = [...this.users.entries()]
          .map(([username, user]) => ({ username, ...user }))
          .find((user) => user.subjectId === dn) || null;
        if (!selectedUser || selectedUser.password !== password) throw new Error('LDAP invalid credentials');
      },
      search: async (_baseDn: string, options: { filter: string }) => {
        if (this.failureMode === 'timeout') throw new Error('LDAP search timed out');
        if (this.failureMode === 'search_failure') throw new Error('LDAP search failed');
        const username = options.filter.match(/^\(mail=(.*)\)$/)?.[1] || '';
        const user = this.users.get(username);
        if (!user) return { searchEntries: [] };
        if (this.failureMode === 'malformed') return { searchEntries: [{ mail: username }] };
        return { searchEntries: [{ dn: user.subjectId, entryUUID: `uuid-${username}`, mail: username, cn: username, memberOf: [...user.memberOf] }] };
      },
      unbind: async () => undefined,
    };
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
    const email = input.email?.trim().toLowerCase() || undefined;
    const atIndex = email?.lastIndexOf('@') ?? -1;
    const emailDomain = atIndex > 0 && atIndex < (email?.length ?? 0) - 1 ? email!.slice(atIndex + 1) : null;
    const entitlements = [
      { type: 'authenticated' as const, externalId: 'authenticated' },
      ...values(input.claims.groups ?? input.claims.group ?? input.claims.memberOf).map((externalId) => ({ type: 'group' as const, externalId })),
      ...values(input.claims.roles ?? input.claims.role ?? input.claims.appRoles).map((externalId) => ({ type: 'role' as const, externalId })),
      ...scopes.map((externalId) => ({ type: 'scope' as const, externalId })),
      ...(emailDomain ? [{ type: 'attribute' as const, externalId: `email_domain:${emailDomain}` }] : []),
    ];
    return {
      providerKey: input.providerKey.trim(), providerType: 'oidc', subjectId,
      username: input.username?.trim() || undefined, email,
      directoryTenantId: input.directoryTenantId?.trim() || undefined, observedAt: input.observedAt ?? Date.now(),
      entitlements: entitlements.filter((entry, index) => entitlements.findIndex((candidate) => candidate.type === entry.type && candidate.externalId === entry.externalId) === index),
    };
  },
};
