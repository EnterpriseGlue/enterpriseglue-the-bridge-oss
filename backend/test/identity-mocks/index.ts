import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer as createHttpsServer, request as httpsRequest, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import jwt from 'jsonwebtoken';
import type { IdentityProviderAdapter, NormalizedExternalIdentity, ProviderIdentityInput } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderAdapter.js';
import { IdentityProviderFailure } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderFailure.js';
import { createEphemeralTestCertificate, createSamlSigningMaterial } from './samlSigningMaterial.js';

const require = createRequire(import.meta.url);
const { signXml } = require('@node-saml/node-saml/lib/xml.js') as {
  signXml: (xml: string, xpath: string, location: { reference: string; action: 'after' }, options: { privateKey: string; publicCert: string; signatureAlgorithm: 'sha256' }) => string;
};

export type OidcMockFailureMode = 'none' | 'unavailable' | 'malformed' | 'wrong_issuer' | 'invalid_token' | 'wrong_audience' | 'group_overage' | 'expired_token' | 'not_yet_valid_token' | 'missing_subject' | 'unknown_signing_key' | 'timeout';
export type MockEntraOidcScenario = 'standard' | 'guest_user' | 'group_overage' | 'tenant_mismatch' | 'consent_denied';

export interface MockOidcProviderOptions {
  issuer?: string;
  clientId?: string;
  callbackUrl?: string;
}

export interface MockEntraOidcProviderOptions extends MockOidcProviderOptions {
  tenantId?: string;
}

export interface MockSamlIdentityProviderOptions {
  issuer?: string;
  audience?: string;
  callbackUrl?: string;
}

export interface MockSamlResponseOptions {
  audience?: string;
  callbackUrl?: string;
  issueInstant?: Date;
  notBefore?: Date;
  notOnOrAfter?: Date;
}

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
  readonly issuer: string;
  readonly clientId: string;
  readonly callbackUrl: string;
  private signingMaterial = createSigningMaterial('identity-mock-key-1');
  private previousSigningMaterial: SigningMaterial | null = null;
  private tokenClaims: Record<string, unknown> = {
    sub: 'user-1', email: 'person@example.test', email_verified: true, groups: ['ops'], nonce: 'nonce-1',
  };
  private failureMode: OidcMockFailureMode = 'none';

  constructor(options: MockOidcProviderOptions = {}) {
    this.issuer = options.issuer || 'https://identity-mock.example.test';
    this.clientId = options.clientId || 'enterpriseglue-test-client';
    this.callbackUrl = options.callbackUrl || 'https://app.example.test/api/auth/identity/callback';
  }

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
    this.previousSigningMaterial = this.signingMaterial;
    this.signingMaterial = createSigningMaterial(kid);
  }

  reset(): void {
    this.failureMode = 'none';
    this.tokenClaims = { sub: 'user-1', email: 'person@example.test', email_verified: true, groups: ['ops'], nonce: 'nonce-1' };
    this.previousSigningMaterial = null;
    this.signingMaterial = createSigningMaterial(`identity-mock-key-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
    const url = new URL(String(input));
    if (this.failureMode === 'timeout') throw new Error('OIDC provider request timed out');
    if (this.failureMode === 'unavailable') return new Response('unavailable', { status: 503 });
    if (url.href === `${this.issuer}/.well-known/openid-configuration`) {
      if (this.failureMode === 'malformed') return Response.json({ issuer: this.issuer });
      return Response.json({
        issuer: this.failureMode === 'wrong_issuer' ? 'https://wrong-issuer.example.test' : this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`, token_endpoint: `${this.issuer}/token`, jwks_uri: `${this.issuer}/jwks`,
      });
    }
    if (url.href === `${this.issuer}/jwks`) return Response.json({ keys: [this.signingMaterial.publicJwk] });
    if (url.href === `${this.issuer}/token` && init?.method === 'POST') {
      if (this.failureMode === 'invalid_token') return Response.json({ id_token: 'invalid.token.value' });
      if (this.failureMode === 'wrong_audience') {
        return Response.json({ id_token: jwt.sign({ ...this.tokenClaims, iss: this.issuer, aud: 'wrong-audience' }, this.signingMaterial.privateKey, {
          algorithm: 'RS256', keyid: String(this.signingMaterial.publicJwk.kid), expiresIn: '5m',
        }) });
      }
      if (this.failureMode === 'unknown_signing_key' && this.previousSigningMaterial) {
        return Response.json({ id_token: jwt.sign({ ...this.tokenClaims, iss: this.issuer, aud: this.clientId }, this.previousSigningMaterial.privateKey, {
          algorithm: 'RS256', keyid: String(this.previousSigningMaterial.publicJwk.kid), expiresIn: '5m',
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
    if (url.href.startsWith(`${this.issuer}/authorize`)) {
      const state = url.searchParams.get('state') || '';
      const callbackUrl = url.searchParams.get('redirect_uri') || this.callbackUrl;
      const callback = new URL(callbackUrl);
      callback.searchParams.set('code', 'code-1');
      callback.searchParams.set('state', state);
      return new Response(null, { status: 302, headers: { location: callback.toString() } });
    }
    if (url.href === `${this.issuer}/userinfo`) {
      const { nonce: _nonce, ...claims } = this.tokenClaims;
      return Response.json(claims);
    }
    if (url.href === `${this.issuer}/groups`) {
      return Response.json({ groups: this.tokenClaims.groups || [], roles: this.tokenClaims.roles || [] });
    }
    return new Response('not found', { status: 404 });
  }
}

/**
 * Deterministic Microsoft Entra-compatible OIDC profile. It deliberately
 * models the documented token and entitlement shapes that matter to
 * EnterpriseGlue, without pretending to be a Microsoft service emulator.
 * Product code still receives ordinary discovery, token, and JWKS requests.
 */
export class MockEntraOidcProvider extends MockOidcProvider {
  readonly tenantId: string;
  readonly guestHomeTenantId = '66666666-7777-8888-9999-000000000000';
  private scenario: MockEntraOidcScenario = 'standard';
  private authorizationCodeSequence = 0;
  private readonly authorizationCodes = new Map<string, { codeChallenge: string; consumed: boolean }>();

  constructor(options: MockEntraOidcProviderOptions = {}) {
    const tenantId = options.tenantId || '11111111-2222-3333-4444-555555555555';
    super({
      ...options,
      issuer: options.issuer || `https://login.microsoftonline.com/${tenantId}/v2.0`,
    });
    this.tenantId = tenantId;
    this.reset();
  }

  override configuration() {
    return {
      ...super.configuration(),
      expectedAudience: this.clientId,
    };
  }

  override reset(): void {
    super.reset();
    this.scenario = 'standard';
    this.authorizationCodeSequence = 0;
    this.authorizationCodes.clear();
    this.setScenario('standard');
  }

  setScenario(scenario: MockEntraOidcScenario): void {
    this.scenario = scenario;
    this.setFailureMode('none');
    this.setTokenClaims({
      sub: 'entra-subject-1',
      oid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      tid: this.tenantId,
      email: 'entra-operator@example.test',
      email_verified: true,
      preferred_username: 'entra-operator@example.test',
      groups: ['group-id-operators'],
      roles: ['enterpriseglue.engine_operator'],
      nonce: 'nonce-1',
    });
    if (scenario === 'guest_user') {
      this.setTokenClaims({
        sub: 'entra-guest-subject-1',
        oid: 'ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb',
        tid: this.tenantId,
        email: 'guest.operator@example.test',
        email_verified: true,
        preferred_username: 'guest_operator_example.test#EXT#@enterpriseglue-local.onmicrosoft.com',
        idp: `https://login.microsoftonline.com/${this.guestHomeTenantId}/v2.0`,
        groups: ['group-id-guests'],
        roles: ['enterpriseglue.engine_operator'],
        nonce: 'nonce-1',
      });
    }
    if (scenario === 'tenant_mismatch') {
      this.setTokenClaims({
        sub: 'entra-subject-1',
        oid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        tid: '99999999-aaaa-bbbb-cccc-dddddddddddd',
        email: 'entra-operator@example.test',
        email_verified: true,
        preferred_username: 'entra-operator@example.test',
        groups: ['group-id-operators'],
        roles: ['enterpriseglue.engine_operator'],
        nonce: 'nonce-1',
      });
    }
  }

  /**
   * Simulates Entra's authorization endpoint without attempting to emulate its
   * login page. The returned callback is bound to PKCE and can be exchanged
   * exactly once through the ordinary token endpoint.
   */
  authorize(authorizationUrl: string): URL {
    const request = new URL(authorizationUrl);
    if (`${request.origin}${request.pathname}` !== `${this.issuer}/authorize`) throw new Error('Unexpected Entra authorization endpoint');
    if (request.searchParams.get('client_id') !== this.clientId) throw new Error('Unexpected Entra client ID');
    const callback = new URL(request.searchParams.get('redirect_uri') || this.callbackUrl);
    const state = request.searchParams.get('state');
    if (!state) throw new Error('Entra authorization request state is required');
    callback.searchParams.set('state', state);
    if (this.scenario === 'consent_denied') {
      callback.searchParams.set('error', 'access_denied');
      callback.searchParams.set('error_description', 'AADSTS65004: User declined consent.');
      return callback;
    }
    const codeChallenge = request.searchParams.get('code_challenge');
    if (!codeChallenge || request.searchParams.get('code_challenge_method') !== 'S256') throw new Error('Entra authorization request must use S256 PKCE');
    const code = `entra-code-${++this.authorizationCodeSequence}`;
    this.authorizationCodes.set(code, { codeChallenge, consumed: false });
    callback.searchParams.set('code', code);
    return callback;
  }

  override async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input));
    if (url.href === `${this.issuer}/authorize`) {
      return new Response(null, { status: 302, headers: { location: this.authorize(url.toString()).toString() } });
    }
    if (url.href === `${this.issuer}/token` && init?.method === 'POST') {
      const body = init.body instanceof URLSearchParams ? init.body : new URLSearchParams(typeof init.body === 'string' ? init.body : undefined);
      const code = body.get('code') || '';
      const authorization = this.authorizationCodes.get(code);
      if (authorization) {
        const suppliedChallenge = createHash('sha256').update(body.get('code_verifier') || '').digest('base64url');
        if (authorization.consumed || suppliedChallenge !== authorization.codeChallenge) {
          return Response.json({ error: 'invalid_grant', error_description: 'AADSTS54005: Authorization code was already redeemed or PKCE verification failed.' }, { status: 400 });
        }
        authorization.consumed = true;
      } else if (this.authorizationCodes.size > 0) {
        return Response.json({ error: 'invalid_grant', error_description: 'AADSTS70000: Authorization code is invalid.' }, { status: 400 });
      }
      if (this.scenario === 'group_overage') {
        return Response.json({ id_token: this.issueIdToken({
          sub: 'entra-subject-1', oid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', tid: this.tenantId,
          email: 'entra-operator@example.test', email_verified: true, preferred_username: 'entra-operator@example.test',
          roles: ['enterpriseglue.engine_operator'], nonce: 'nonce-1', hasgroups: true,
          _claim_names: { groups: 'src1' }, _claim_sources: { src1: { endpoint: 'https://graph.microsoft.com/v1.0/me/getMemberObjects' } },
        }) });
      }
    }
    return super.fetch(input, init);
  }
}

/**
 * HTTPS loopback provider for transport-level OIDC tests. Its controller is
 * only exposed to the test process, while product code receives real discovery,
 * authorization, token, JWKS, userinfo, and group endpoint responses.
 */
export class MockOidcHttpsServer {
  private server: Server | null = null;
  provider: MockOidcProvider | null = null;
  private issuerUrl: string | null = null;

  get issuer(): string {
    if (!this.issuerUrl) throw new Error('OIDC mock server is not running');
    return this.issuerUrl;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const tls = createEphemeralTestCertificate('127.0.0.1');
    this.server = createHttpsServer({ key: tls.privateKey, cert: tls.certificate }, (request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        this.server!.off('error', reject);
        resolve();
      });
    });
    const address = this.server.address() as AddressInfo;
    this.issuerUrl = `https://127.0.0.1:${address.port}`;
    this.provider = new MockOidcProvider({ issuer: this.issuerUrl });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.provider = null;
    this.issuerUrl = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  configuration() {
    if (!this.provider) throw new Error('OIDC mock server is not running');
    return this.provider.configuration();
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input));
    if (url.origin !== this.issuer) return globalThis.fetch(input, init);
    const headers = new Headers(init?.headers);
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : init?.body;
    return new Promise<Response>((resolve, reject) => {
      const request = httpsRequest(url, {
        method: init?.method || 'GET',
        headers: Object.fromEntries(headers.entries()),
        rejectUnauthorized: false,
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.once('error', reject);
        response.once('end', () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) value.forEach((entry) => responseHeaders.append(key, entry));
            else if (value !== undefined) responseHeaders.set(key, String(value));
          }
          resolve(new Response(Buffer.concat(chunks), { status: response.statusCode || 500, headers: responseHeaders }));
        });
      });
      request.once('error', reject);
      if (body === undefined || body === null) request.end();
      else request.end(body as string | Buffer);
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const provider = this.provider;
      if (!provider) throw new Error('OIDC mock server is not initialized');
      const result = await provider.fetch(new URL(request.url || '/', this.issuer), { method: request.method });
      response.statusCode = result.status;
      result.headers.forEach((value, key) => response.setHeader(key, value));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      response.statusCode = 500;
      response.end('OIDC test mock failed');
    }
  }
}

export class MockSamlIdentityProvider {
  readonly issuer: string;
  readonly audience: string;
  readonly callbackUrl: string;
  private signingMaterial = createSamlSigningMaterial();
  private sequence = 0;
  private now: Date | null = null;
  private attributes: Record<string, unknown> = {
    nameID: 'person@example.test',
    'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups': ['payments', 'operations'],
    role: ['operator'],
  };

  constructor(options: MockSamlIdentityProviderOptions = {}) {
    this.issuer = options.issuer || 'https://saml-mock.example.test';
    this.audience = options.audience || 'enterpriseglue-ai';
    this.callbackUrl = options.callbackUrl || 'https://app.example.test/api/auth/providers/saml/callback';
  }

  setAttributes(attributes: Record<string, unknown>): void {
    this.attributes = { ...attributes };
  }

  assertion(): Record<string, unknown> {
    return { ...this.attributes };
  }

  certificate(): string {
    return this.signingMaterial.certificate;
  }

  rotateSigningMaterial(): void {
    this.signingMaterial = createSamlSigningMaterial();
  }

  setNow(now: Date | null): void {
    this.now = now ? new Date(now) : null;
  }

  reset(): void {
    this.signingMaterial = createSamlSigningMaterial();
    this.sequence = 0;
    this.now = null;
    this.attributes = {
      nameID: 'person@example.test',
      'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups': ['payments', 'operations'],
      role: ['operator'],
    };
  }

  signedResponse(options: MockSamlResponseOptions = {}): string {
    const material = this.signingMaterial;
    const now = options.issueInstant || this.now || new Date();
    const notBefore = (options.notBefore || new Date(now.getTime() - 60_000)).toISOString();
    const notOnOrAfter = (options.notOnOrAfter || new Date(now.getTime() + 300_000)).toISOString();
    const issueInstant = now.toISOString();
    const sequence = ++this.sequence;
    const nameId = xmlEscape(String(this.attributes.nameID ?? 'person@example.test'));
    const callbackUrl = options.callbackUrl || this.callbackUrl;
    const audience = options.audience || this.audience;
    const attributeXml = Object.entries(this.attributes)
      .filter(([name]) => name !== 'nameID')
      .map(([name, value]) => `<saml:Attribute Name="${xmlEscape(name)}">${(Array.isArray(value) ? value : [value]).map((entry) => `<saml:AttributeValue>${xmlEscape(String(entry))}</saml:AttributeValue>`).join('')}</saml:Attribute>`)
      .join('');
    const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assertion-${sequence}" Version="2.0" IssueInstant="${issueInstant}"><saml:Issuer>${this.issuer}</saml:Issuer><saml:Subject><saml:NameID>${nameId}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData Recipient="${callbackUrl}" NotOnOrAfter="${notOnOrAfter}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${issueInstant}" SessionIndex="session-${sequence}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement>${attributeXml}</saml:AttributeStatement></saml:Assertion>`;
    const signedAssertion = signXml(assertion, "/*[local-name(.)='Assertion']", { reference: "/*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' }, { ...material, publicCert: material.certificate, signatureAlgorithm: 'sha256' });
    const response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_response-${sequence}" Version="2.0" IssueInstant="${issueInstant}" Destination="${callbackUrl}"><saml:Issuer>${this.issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${signedAssertion}</samlp:Response>`;
    const signedResponse = signXml(response, "/*[local-name(.)='Response']", { reference: "/*[local-name(.)='Response']/*[local-name(.)='Issuer']", action: 'after' }, { ...material, publicCert: material.certificate, signatureAlgorithm: 'sha256' });
    return Buffer.from(signedResponse).toString('base64');
  }
}

/**
 * A test-only SAML IdP transport surface. The server binds to loopback with an
 * ephemeral port and has no HTTP mutation endpoint; tests mutate only the
 * in-process provider controller before requesting metadata or the SSO form.
 */
export class MockSamlHttpsServer {
  private server: Server | null = null;
  provider: MockSamlIdentityProvider | null = null;
  private issuerUrl: string | null = null;

  get issuer(): string {
    if (!this.issuerUrl) throw new Error('SAML mock server is not running');
    return this.issuerUrl;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const tls = createEphemeralTestCertificate('127.0.0.1');
    this.server = createHttpsServer({ key: tls.privateKey, cert: tls.certificate }, (request, response) => {
      this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        this.server!.off('error', reject);
        resolve();
      });
    });
    const address = this.server.address() as AddressInfo;
    this.issuerUrl = `https://127.0.0.1:${address.port}`;
    this.provider = new MockSamlIdentityProvider({ issuer: this.issuerUrl });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.provider = null;
    this.issuerUrl = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input));
    if (url.origin !== this.issuer) return globalThis.fetch(input, init);
    const headers = new Headers(init?.headers);
    return new Promise<Response>((resolve, reject) => {
      const request = httpsRequest(url, {
        method: init?.method || 'GET',
        headers: Object.fromEntries(headers.entries()),
        rejectUnauthorized: false,
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.once('error', reject);
        response.once('end', () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) value.forEach((entry) => responseHeaders.append(key, entry));
            else if (value !== undefined) responseHeaders.set(key, String(value));
          }
          resolve(new Response(Buffer.concat(chunks), { status: response.statusCode || 500, headers: responseHeaders }));
        });
      });
      request.once('error', reject);
      request.end();
    });
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const provider = this.provider;
    if (!provider) {
      response.statusCode = 503;
      response.end();
      return;
    }
    const url = new URL(request.url || '/', this.issuer);
    if (url.pathname === '/metadata') {
      const certificate = provider.certificate().replace(/-----[^-]+-----|\s+/g, '');
      response.setHeader('content-type', 'application/samlmetadata+xml');
      response.end(`<?xml version="1.0"?><EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${xmlEscape(provider.issuer)}"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${certificate}</X509Certificate></X509Data></KeyInfo></KeyDescriptor><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${xmlEscape(`${provider.issuer}/sso`)}"/></IDPSSODescriptor></EntityDescriptor>`);
      return;
    }
    if (url.pathname === '/sso') {
      const relayState = url.searchParams.get('RelayState') || '';
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><form method="post" action="${xmlEscape(provider.callbackUrl)}"><input type="hidden" name="SAMLResponse" value="${provider.signedResponse()}"/><input type="hidden" name="RelayState" value="${xmlEscape(relayState)}"/></form>`);
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  }
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export class MockLdapDirectory {
  readonly url = 'ldaps://directory-mock.example.test:636';
  readonly bindDn = 'cn=service,dc=example,dc=test';
  /** Per-directory fixture credentials; never reusable outside this test instance. */
  bindPassword = '';
  defaultUserPassword = '';
  private readonly users = new Map<string, { password: string; subjectId: string; memberOf: string[] }>();
  private failureMode: 'none' | 'tls_failure' | 'timeout' | 'search_failure' | 'malformed' = 'none';

  constructor() {
    this.reset();
  }

  reset(): void {
    this.bindPassword = randomBytes(24).toString('base64url');
    this.defaultUserPassword = randomBytes(24).toString('base64url');
    this.failureMode = 'none';
    this.users.clear();
    this.setUser('person@example.test', {
      password: this.defaultUserPassword, subjectId: 'uid=person,ou=users,dc=example,dc=test',
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

/**
 * Test-only counterpart to the product SAML replay ledger. It retains only a
 * provider-scoped hash, expires entries, and can be reset with the rest of a
 * protocol fixture; raw assertions never leave the test that supplied them.
 */
export class MockSamlAssertionReplayCache {
  private readonly entries = new Map<string, number>();

  consume(providerId: string, samlResponse: string, now = Date.now(), ttlMs = 10 * 60 * 1000): void {
    const hash = createHash('sha256').update(samlResponse, 'utf8').digest('hex');
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
    const key = `${providerId}:${hash}`;
    if (this.entries.has(key)) throw new Error('SAML assertion has already been used');
    this.entries.set(key, now + ttlMs);
  }

  reset(): void {
    this.entries.clear();
  }
}

/**
 * Coordinates the mutable protocol fixtures used by an identity test. Product
 * runtime never imports this stack: tests retain direct access to each protocol
 * controller while `reset()` restores every fixture to an isolated baseline.
 */
export class MockIdentityTestStack {
  readonly oidc = new MockOidcProvider();
  readonly saml = new MockSamlIdentityProvider();
  readonly ldap = new MockLdapDirectory();
  readonly samlReplayCache = new MockSamlAssertionReplayCache();

  reset(): void {
    this.oidc.reset();
    this.saml.reset();
    this.ldap.reset();
    this.samlReplayCache.reset();
  }
}

/** A protocol-independent adapter used to prove the shared contract is not protocol-coupled. */
export const inMemoryIdentityProviderAdapter: IdentityProviderAdapter = {
  type: 'oidc',
  normalizeIdentity(input: ProviderIdentityInput): NormalizedExternalIdentity {
    const subjectId = input.subjectId.trim();
    if (!input.providerKey.trim()) throw new Error('providerKey is required');
    if (!subjectId) throw new IdentityProviderFailure('missing_subject', 'subjectId is required');
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
