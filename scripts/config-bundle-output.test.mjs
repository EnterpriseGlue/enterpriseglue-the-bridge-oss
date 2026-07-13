import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeConfigBundleError, sanitizeConfigBundleOutput } from './lib/config-bundle-output.mjs';

test('sanitizes nested credential fields and known bearer tokens from CLI artifacts', () => {
  const result = sanitizeConfigBundleOutput({
    canonicalHash: 'hash',
    provider: { clientSecret: 'provider-secret', metadataXmlRef: 'file:///private/metadata.xml' },
    engine: { passwordEnc: 'engine-password', peerToken: 'customer-token' },
    authorization: 'Bearer deployment-token',
  }, ['deployment-token']);

  assert.deepEqual(result, {
    canonicalHash: 'hash',
    provider: { clientSecret: '[REDACTED]', metadataXmlRef: '[REDACTED]' },
    engine: { passwordEnc: '[REDACTED]', peerToken: '[REDACTED]' },
    authorization: '[REDACTED]',
  });
});

test('sanitizes known tokens and credential patterns in errors', () => {
  const error = sanitizeConfigBundleError(new Error('Authorization: Bearer deployment-token; password=engine-password'), ['deployment-token']);
  assert.equal(error, 'Authorization: Bearer [REDACTED]; password=[REDACTED]');
});
