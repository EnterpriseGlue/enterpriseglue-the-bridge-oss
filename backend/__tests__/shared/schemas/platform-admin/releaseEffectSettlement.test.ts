import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import {
  ReleaseEffectCohortMutationRequestSchema,
  ReleaseEffectSettlementStatusSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/release-effect-settlement.js';

const status = {
  schemaVersion: 'release-effect-settlement.enterpriseglue.io/v1', releaseId: 'release-a', cohortEpoch: 7,
  state: 'closing', revision: 2, inventoryVersion: 'release-effect-inventory.enterpriseglue.io/v1',
  configuredInventoryVersion: 'release-effect-inventory.enterpriseglue.io/v1',
  inventorySha256: 'a'.repeat(64), configuredInventorySha256: 'a'.repeat(64), inventoryComplete: false,
  releaseAssignmentsOutstanding: 0, coveredSourcesSettled: true, settled: false, eligibleForShutdown: false,
  openedAt: 1, closedAt: 2, settledAt: null, updatedAt: 2,
  sources: [{
    sourceId: 'engine_api_mutation', owner: 'api', settlementRequired: true, coverage: 'uncovered',
    durableTables: [], admissionBoundary: 'request only', settlementBasis: 'not durable',
    outstanding: null, reasonCode: 'uncovered',
  }],
};

describe('release effect settlement contract', () => {
  it('requires strict revision mutation input and coherent status flags', () => {
    expect(ReleaseEffectCohortMutationRequestSchema.parse({ expectedRevision: 0 })).toEqual({ expectedRevision: 0 });
    expect(ReleaseEffectCohortMutationRequestSchema.safeParse({ expectedRevision: 1, retry: true }).success).toBe(false);
    expect(ReleaseEffectSettlementStatusSchema.parse(status)).toEqual(status);
    expect(ReleaseEffectSettlementStatusSchema.safeParse({ ...status, sources: [] }).success).toBe(false);
  });

  it('publishes all four controller-only paths in generated OpenAPI', () => {
    const paths = generateOpenApi().paths;
    const root = '/api/workloads/releases/{releaseId}/effect-cohorts/{cohortEpoch}';
    expect(paths?.[root]?.put).toBeDefined();
    expect(paths?.[root]?.get).toBeDefined();
    expect(paths?.[`${root}/close`]?.post).toBeDefined();
    expect(paths?.[`${root}/verify`]?.post).toBeDefined();
    for (const operation of [paths?.[root]?.put, paths?.[root]?.get, paths?.[`${root}/close`]?.post, paths?.[`${root}/verify`]?.post]) {
      const serialized = JSON.stringify(operation);
      expect(serialized).toContain('x-enterpriseglue-authz-exemption');
      expect(serialized).toContain('release-effect-settlement.enterpriseglue.io/v1');
    }
  });

  it('keeps the operator example aligned with the strict mutation schema', () => {
    const example = JSON.parse(readFileSync(new URL(
      '../../../../../docs/examples/release-effect-cohort.json', import.meta.url,
    ), 'utf8'));
    expect(example.open.path).toMatch(/\/effect-cohorts\/31$/);
    expect(ReleaseEffectCohortMutationRequestSchema.parse(example.open.body)).toEqual({ expectedRevision: 0 });
    expect(ReleaseEffectCohortMutationRequestSchema.parse(example.close.body)).toEqual({ expectedRevision: 1 });
    expect(ReleaseEffectCohortMutationRequestSchema.parse(example.verify.body)).toEqual({ expectedRevision: 2 });
    expect(example.responseExcerpt).toMatchObject({ inventoryComplete: false, settled: false, eligibleForShutdown: false });
  });
});
