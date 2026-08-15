import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const concept = read('docs/concepts/authentication-and-authoritative-provisioning.md');
const setup = read('docs/how-to/configure-scim-provisioning.md');
const operations = read('docs/how-to/operate-identity-lifecycle.md');
const api = read('docs/reference/scim-and-user-lifecycle-api.md');
const developer = read('docs/development/extending-scim-provisioning.md');
const upgrade = read('docs/how-to/upgrade-identity-provisioning.md');
const index = read('docs/index.md');
const example = JSON.parse(read('docs/examples/identity-provisioning-directories.json'));

test('documents the independent authentication, provisioning, and authorization authorities', () => {
  assert.match(concept, /SCIM is not a login method/);
  assert.match(concept, /Email alone is never sufficient/);
  assert.match(concept, /one active authoritative\s+SCIM directory per tenant/);
  assert.match(concept, /recovery administrator/i);
  assert.match(concept, /exact identity mapping/i);
  assert.match(concept, /RFC 7643/);
  assert.match(concept, /Microsoft Entra/);
  assert.match(concept, /cannot target the Platform Administrators/i);
});

test('documents complete SCIM, administrative, and source-aware user interfaces', () => {
  for (const route of [
    '/ServiceProviderConfig', '/Schemas', '/ResourceTypes', '/Users', '/Groups', '/Bulk', '/oauth/token',
    '/api/identity/provisioning-directories', '/api/users/directory',
    '/identity-context', '/effective-access', '/sessions', '/audit',
    '/deactivate', '/reactivate', '/revoke-sessions',
  ]) assert.match(api, new RegExp(route.replaceAll('/', '\\/')));
  assert.match(api, /application\/scim\+json/);
  assert.match(api, /If-Match/);
  assert.match(api, /OAuth 2\.0 client credentials/);
  assert.match(api, /sort by/);
  assert.match(api, /writeOnly/);
  assert.match(api, /client secret\/static bearer,\s+and token endpoint exactly once/);
  assert.match(api, /no administrative “run” API/i);
  assert.match(api, /no force-link conflict API/i);
});

test('documents setup, lifecycle, credential, audit, troubleshooting, and rollback operations', () => {
  assert.match(setup, /Microsoft Entra-compatible configuration/);
  assert.match(setup, /credentialSecretRef/);
  assert.match(setup, /409/);
  assert.match(operations, /Rotate credentials/);
  assert.match(operations, /Audit events/);
  assert.match(operations, /Troubleshooting/);
  assert.match(upgrade, /1700000000111-add-identity-provisioning-foundation/);
  assert.match(upgrade, /1700000000112-add-federated-session-lineage/);
  assert.match(upgrade, /Rollback/);
});

test('keeps the headless example secret-reference-only and discoverable', () => {
  assert.equal(example.identityProvisioningDirectories.length, 1);
  const directory = example.identityProvisioningDirectories[0];
  assert.equal(directory.enabled, false);
  assert.match(directory.credentialSecretRef, /^(?:env|file):\/\//);
  assert.equal(Object.hasOwn(directory, 'token'), false);
  assert.equal(Object.hasOwn(directory, 'tokenHash'), false);
  assert.match(setup, /docs\/examples|identity-provisioning-directories\.json|identityProvisioningDirectories/);
  assert.match(index, /SCIM and User-Lifecycle API/);
  assert.match(index, /Extending SCIM Provisioning/);
});

test('developer guide requires contract, persistence, security, and end-to-end parity', () => {
  for (const requirement of ['canonical Zod schema', 'OpenAPI', 'PostgreSQL', 'Oracle', 'HTTP-to-database', 'screenshot']) {
    assert.match(developer, new RegExp(requirement, 'i'));
  }
});
