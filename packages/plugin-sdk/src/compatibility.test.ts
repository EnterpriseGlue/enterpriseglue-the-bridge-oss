import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { parseEnterpriseGluePluginManifestV1 } from './manifest.js';

const frozenFixtureUrl = new URL(
  '../fixtures/sdk-0.1.0/current-plugin-fixture.ts',
  import.meta.url,
);

describe('frozen plugin SDK compatibility fixtures', () => {
  it('keeps the 0.1.x consumer fixture explicit and parseable', async () => {
    const fixture = await readFile(frozenFixtureUrl, 'utf8');
    expect(fixture).toContain(
      "sdk: '^0.1.0'",
    );
    expect(fixture).toContain(
      "id: 'io.enterpriseglue.compatibility-fixture'",
    );

    const manifestLiteral = {
      apiVersion: 'plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePlugin',
      metadata: {
        id: 'io.enterpriseglue.compatibility-fixture',
        version: '1.0.0',
        displayName: 'Compatibility fixture',
        publisher: 'io.enterpriseglue',
      },
      compatibility: {
        host: '>=0.4.6 <0.5.0',
        sdk: '^0.1.0',
        frontendProtocol: 1,
        backendProtocol: 1,
        requiredSlots: ['mission-control.incident.actions.v1'],
      },
      deployment: {},
      scope: {
        installation: 'deployment',
        enablement: 'tenant',
      },
      permissions: {
        required: [],
        optional: [],
      },
      network: {
        egressPolicy: 'none',
      },
      dependencies: [],
      conflicts: [],
      events: { subscriptions: [] },
      jobs: { fixedSchedules: [] },
      contributions: [],
    };
    expect(
      parseEnterpriseGluePluginManifestV1(manifestLiteral).metadata.id,
    ).toBe('io.enterpriseglue.compatibility-fixture');
  });
});
