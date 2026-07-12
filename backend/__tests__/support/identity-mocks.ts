import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';

export class MockOidcProvider {
  readonly issuer = 'https://identity-mock.example.test';
  readonly clientId = 'enterpriseglue-test-client';
  readonly callbackUrl = 'https://app.example.test/api/auth/identity/callback';
  private readonly privateKey: string;
  private readonly publicJwk: JsonWebKey;

  constructor() {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = keys.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    this.publicJwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'identity-mock-key', use: 'sig', alg: 'RS256' };
  }

  configuration() {
    return { issuerUrl: this.issuer, clientId: this.clientId, callbackUrl: this.callbackUrl, scopes: ['openid', 'profile', 'email'] };
  }

  issueIdToken(claims: Record<string, unknown>) {
    return jwt.sign({ ...claims, iss: this.issuer, aud: this.clientId }, this.privateKey, { algorithm: 'RS256', keyid: 'identity-mock-key', expiresIn: '5m' });
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const url = String(input);
    if (url === `${this.issuer}/.well-known/openid-configuration`) {
      return Response.json({ issuer: this.issuer, authorization_endpoint: `${this.issuer}/authorize`, token_endpoint: `${this.issuer}/token`, jwks_uri: `${this.issuer}/jwks` });
    }
    if (url === `${this.issuer}/jwks`) return Response.json({ keys: [this.publicJwk] });
    if (url === `${this.issuer}/token` && init?.method === 'POST') return Response.json({ id_token: this.issueIdToken({ sub: 'user-1', email: 'person@example.test', email_verified: true, groups: ['ops'], nonce: 'nonce-1' }) });
    return new Response('not found', { status: 404 });
  }
}

export class MockSamlIdentityProvider {
  assertion() {
    return { nameID: 'person@example.test', 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups': ['payments', 'operations'], role: ['operator'] };
  }
}

export class MockLdapDirectory {
  private readonly users = new Map([['person@example.test', { password: 'directory-password', subjectId: 'uid=person,ou=users,dc=example,dc=test', memberOf: ['cn=operations,ou=groups,dc=example,dc=test'] }]]);

  bind(username: string, password: string): { subjectId: string; memberOf: string[] } {
    const user = this.users.get(username);
    if (!user || user.password !== password) throw new Error('LDAP invalid credentials');
    return { subjectId: user.subjectId, memberOf: user.memberOf };
  }
}
