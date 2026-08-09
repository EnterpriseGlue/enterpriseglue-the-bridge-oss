import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const registry = JSON.parse(readFileSync(
  new URL('../test/authz/engine-tenancy-provisioning-journeys.json', import.meta.url),
  'utf8',
));

test('defines the canonical fourteen-journey provisioning denominator', () => {
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.coverageStandard, 'real-service-provisioning-channel-journeys');
  assert.deepEqual(
    registry.channels,
    ['manual-ui', 'external-api', 'configuration-bundle'],
  );
  assert.equal(registry.journeys.length, 14);
  assert.deepEqual(
    registry.journeys.map(({ id }) => id),
    Array.from({ length: 14 }, (_, index) => index + 1),
  );
  assert.equal(new Set(registry.journeys.map(({ key }) => key)).size, 14);
});

test('accounts for every channel and names every required assertion', () => {
  const knownChannels = new Set(registry.channels);
  for (const journey of registry.journeys) {
    assert.match(journey.key, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(journey.description.length > 20);
    assert.ok(journey.requiredChannels.length > 0);
    assert.ok(journey.requiredAssertions.length > 0);
    assert.equal(new Set(journey.requiredChannels).size, journey.requiredChannels.length);
    assert.equal(
      new Set(journey.requiredAssertions).size,
      journey.requiredAssertions.length,
    );

    const required = new Set(journey.requiredChannels);
    const excluded = new Set(Object.keys(journey.excludedChannels));
    for (const channel of [...required, ...excluded]) {
      assert.ok(knownChannels.has(channel), `journey ${journey.id} has unknown channel ${channel}`);
    }
    for (const channel of required) {
      assert.ok(!excluded.has(channel), `journey ${journey.id} both requires and excludes ${channel}`);
    }
    assert.deepEqual(
      [...new Set([...required, ...excluded])].sort(),
      [...knownChannels].sort(),
      `journey ${journey.id} must account for every channel`,
    );
    for (const [channel, reason] of Object.entries(journey.excludedChannels)) {
      assert.ok(
        typeof reason === 'string' && reason.length > 20,
        `journey ${journey.id} exclusion ${channel} needs a reviewable reason`,
      );
    }
  }
});

test('repeats cross-cutting journeys through all three provisioning channels', () => {
  for (const journey of registry.journeys.filter(({ id }) => id >= 7)) {
    assert.deepEqual(
      [...journey.requiredChannels].sort(),
      [...registry.channels].sort(),
      `cross-cutting journey ${journey.id} must execute every channel`,
    );
    assert.deepEqual(journey.excludedChannels, {});
  }
});
