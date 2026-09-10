import {
  RELEASE_EFFECT_INVENTORY_VERSION,
} from '@enterpriseglue/shared/contracts/release-effect-inventory.js';
import { closeDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  configuredReleaseEffectRuntimeBinding,
  assertSignedCandidateReceiptReleaseId,
  releaseEffectInventorySha256,
  releaseEffectSettlementService,
  type ReleaseEffectSettlementService,
  type ReleaseEffectSettlementStatusV1,
} from '@enterpriseglue/shared/services/platform-admin/ReleaseEffectSettlementService.js';

export interface OpenReleaseEffectCohortCommandV1 {
  readonly releaseId: string;
  readonly cohortEpoch: number;
  readonly inventoryVersion: typeof RELEASE_EFFECT_INVENTORY_VERSION;
  readonly inventorySha256: string;
}

type CohortOpener = Pick<ReleaseEffectSettlementService, 'open'>;

/**
 * Narrow deployment command for opening the cohort before any API or worker
 * process starts. It deliberately delegates the only write to the settlement
 * service and has no migration, synchronization, repair, or seeding path.
 */
export async function openReleaseEffectCohort(
  command: OpenReleaseEffectCohortCommandV1,
  service: CohortOpener = releaseEffectSettlementService,
): Promise<ReleaseEffectSettlementStatusV1> {
  const configuredInventorySha256 = releaseEffectInventorySha256();
  assertSignedCandidateReceiptReleaseId(command.releaseId);
  if (
    !command.releaseId
    || !Number.isSafeInteger(command.cohortEpoch)
    || command.cohortEpoch <= 0
    || command.inventoryVersion !== RELEASE_EFFECT_INVENTORY_VERSION
    || command.inventorySha256 !== configuredInventorySha256
  ) {
    throw new Error('Release effect cohort command does not match the configured runtime inventory');
  }

  const status = await service.open({
    releaseId: command.releaseId,
    cohortEpoch: command.cohortEpoch,
    expectedRevision: 0,
  });
  if (
    status.releaseId !== command.releaseId
    || status.cohortEpoch !== command.cohortEpoch
    || status.state !== 'open'
    || status.revision !== 1
    || status.inventoryVersion !== command.inventoryVersion
    || status.configuredInventoryVersion !== command.inventoryVersion
    || status.inventorySha256 !== command.inventorySha256
    || status.configuredInventorySha256 !== command.inventorySha256
    || status.closedAt !== null
    || status.settledAt !== null
    || status.settled
    || status.eligibleForShutdown
  ) {
    throw new Error('Release effect cohort is not the exact open deployment cohort');
  }
  return status;
}

/** Chart hook entrypoint. Runtime identity comes only from the release-specific
 * ConfigMap; inventory identity comes only from the bundled executable. */
export async function openConfiguredReleaseEffectCohort(): Promise<ReleaseEffectSettlementStatusV1> {
  return openConfiguredReleaseEffectCohortWith();
}

export interface ConfiguredCohortCommandDependencies {
  readonly runtime?: ReturnType<typeof configuredReleaseEffectRuntimeBinding>;
  readonly inventoryVersion?: string;
  readonly inventorySha256?: string;
  readonly service?: CohortOpener;
  readonly close?: () => Promise<void>;
  readonly write?: (value: string) => void;
}

/** Dependency seam is exported for a no-database CLI contract test only. */
export async function openConfiguredReleaseEffectCohortWith(
  dependencies: ConfiguredCohortCommandDependencies = {},
): Promise<ReleaseEffectSettlementStatusV1> {
  const runtime = dependencies.runtime ?? configuredReleaseEffectRuntimeBinding();
  const inventoryVersion = dependencies.inventoryVersion
    ?? process.env.EG_RELEASE_EFFECT_EXPECTED_INVENTORY_VERSION;
  const inventorySha256 = dependencies.inventorySha256
    ?? process.env.EG_RELEASE_EFFECT_EXPECTED_INVENTORY_SHA256;
  if (
    !runtime.releaseId
    || !runtime.cohortEpoch
    || runtime.managedPooledCloud !== true
    || !inventoryVersion
    || !inventorySha256
  ) {
    throw new Error('Release effect cohort runtime identity is not configured');
  }
  try {
    const status = await openReleaseEffectCohort({
      releaseId: runtime.releaseId,
      cohortEpoch: runtime.cohortEpoch,
      inventoryVersion: inventoryVersion as typeof RELEASE_EFFECT_INVENTORY_VERSION,
      inventorySha256,
    }, dependencies.service);
    (dependencies.write ?? process.stdout.write.bind(process.stdout))(`${JSON.stringify({
      schemaVersion: status.schemaVersion,
      releaseId: status.releaseId,
      cohortEpoch: status.cohortEpoch,
      state: status.state,
      revision: status.revision,
      inventoryVersion: status.inventoryVersion,
      inventorySha256: status.inventorySha256,
    })}\n`);
    return status;
  } finally {
    await (dependencies.close ?? closeDataSource)();
  }
}
