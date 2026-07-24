import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { getDataSource, encrypt, decrypt, generateId } = vi.hoisted(() => ({
  getDataSource: vi.fn(),
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  decrypt: vi.fn((value: string) => value.replace(/^encrypted:/, '')),
  generateId: vi.fn(() => 'import-run-1'),
}));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource }));
vi.mock('@enterpriseglue/shared/services/encryption.js', () => ({ encrypt, decrypt }));
vi.mock('@enterpriseglue/shared/utils/id.js', () => ({ generateId }));

import {
  CamundaNativeGrantImportRunService,
  DEFAULT_CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_MS,
} from '@enterpriseglue/shared/services/platform-admin/CamundaNativeGrantImportRunService.js';
import { CamundaNativeGrantImportRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/CamundaNativeGrantImportRun.js';

const baseClassification = {
  sourceAuthorizationId: 'native-auth-1',
  disposition: 'proposed' as const,
  reasonCodes: ['group_grant_process_definition'] as const,
  principal: { type: 'group' as const, groupId: 'native-operations' },
  resourceKind: 'process_definition' as const,
  resourceId: 'payments-order',
  runtimeTenantId: 'runtime-payments',
  mappedActionIds: ['engine.runtime.process-definitions.read'],
};
const hash = 'a'.repeat(64);

function setup() {
  const repository = { insert: vi.fn(), findOne: vi.fn(), update: vi.fn().mockResolvedValue({ affected: 1 }) };
  (getDataSource as unknown as Mock).mockResolvedValue({
    getRepository(entity: unknown) {
      if (entity === CamundaNativeGrantImportRun) return repository;
      throw new Error('Unexpected entity');
    },
  });
  return repository;
}

describe('CamundaNativeGrantImportRunService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores only opaque classifications in the ordinary run record and encrypts the detailed snapshot', async () => {
    const repository = setup();
    const now = Date.now();
    const service = new CamundaNativeGrantImportRunService();

    const result = await service.createPreview({
      engineId: 'engine-1',
      tenantId: ' tenant-a ',
      sourceKind: 'live_api',
      inputHash: hash,
      mappingCatalogVersion: 'camunda7-v1-read-only',
      inventoryTruncated: false,
      classifications: [baseClassification],
      detailedSnapshot: { authorizations: [{ groupId: 'native-operations', resourceId: 'payments-order' }] },
      actorId: ' operator-1 ',
      now,
    });

    expect(result).toMatchObject({
      id: 'import-run-1', engineId: 'engine-1', tenantId: 'tenant-a', sourceKind: 'live_api', status: 'previewed',
      detailedSnapshotAvailable: true, detailedSnapshotExpiresAt: now + DEFAULT_CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_MS,
      normalizedCounts: { total: 1, proposed: 1, approval_required: 0, manual_required: 0, blocked: 0 },
    });
    expect(result.classifications[0]).toMatchObject({
      sourceAuthorizationRef: expect.stringMatching(/^camunda-auth-/),
      groupReference: expect.stringMatching(/^camunda-group-/),
      resourceReference: expect.stringMatching(/^camunda-resource-/),
    });
    expect(JSON.stringify(result)).not.toContain('native-operations');
    expect(JSON.stringify(result)).not.toContain('payments-order');
    const stored = repository.insert.mock.calls[0][0];
    expect(stored.encryptedDetailedSnapshot).toContain('native-operations');
    expect(stored.classificationsJson).not.toContain('native-operations');
    expect(stored.classificationsJson).not.toContain('payments-order');
    expect(stored.createdById).toBe('operator-1');
  });

  it('returns a detailed snapshot only while it is retained and never in the summary', async () => {
    const repository = setup();
    const now = Date.now();
    repository.findOne.mockResolvedValue({
      id: 'run-1', engineId: 'engine-1', tenantId: null, sourceKind: 'customer_export', status: 'previewed', inputHash: hash,
      mappingCatalogVersion: 'camunda7-v1-read-only', inventoryTruncated: false,
      normalizedCountsJson: '{"total":1,"proposed":1,"approval_required":0,"manual_required":0,"blocked":0}',
      classificationsJson: '[{"sourceAuthorizationRef":"camunda-auth-aaaaaaaaaaaaaaaaaaaaaaaa","disposition":"proposed","reasonCodes":["group_grant_process_definition"],"principalType":"group","groupReference":"camunda-group-bbbbbbbbbbbbbbbbbbbbbbbb","resourceKind":"process_definition","resourceReference":"camunda-resource-cccccccccccccccccccccccc","mappedActionIds":["engine.runtime.process-definitions.read"]}]',
      encryptedDetailedSnapshot: 'encrypted:{"native":"secret"}', detailedSnapshotExpiresAt: now + 1_000,
      draftHash: null, createdAt: now, updatedAt: now,
    });
    const service = new CamundaNativeGrantImportRunService();

    const summary = await service.getSummary(' run-1 ');
    const detail = await service.getDetailedSnapshot('run-1', now);
    const expired = await service.getDetailedSnapshot('run-1', now + 1_000);

    expect(summary?.detailedSnapshotAvailable).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('secret');
    expect(detail).toEqual({ native: 'secret' });
    expect(expired).toBeNull();
  });

  it('binds an approved draft and config-bundle apply receipt to an existing run', async () => {
    const repository = setup();
    const now = Date.now();
    const run = {
      id: 'run-1', engineId: 'engine-1', tenantId: null, sourceKind: 'live_api', status: 'previewed', inputHash: hash,
      mappingCatalogVersion: 'camunda7-v1-read-only', inventoryTruncated: false,
      normalizedCountsJson: '{"total":0,"proposed":0,"approval_required":0,"manual_required":0,"blocked":0}', classificationsJson: '[]',
      encryptedDetailedSnapshot: null, detailedSnapshotExpiresAt: null, draftHash: null, createdAt: now, updatedAt: now,
    };
    repository.findOne.mockResolvedValue(run);
    const service = new CamundaNativeGrantImportRunService();

    const drafted = await service.setDraft({ id: ' run-1 ', draftHash: 'B'.repeat(64), approverId: ' approver-1 ', now });
    const applied = await service.markApplied({ id: 'run-1', configBundleApplyRunId: 'apply-run-1' });
    const rolledBack = await service.markRolledBack({ id: 'run-1', configBundleApplyRunId: 'rollback-run-1', now: now + 1 });

    expect(drafted).toMatchObject({ status: 'draft_generated', draftHash: 'b'.repeat(64) });
    expect(repository.update).toHaveBeenCalledWith({ id: 'run-1' }, expect.objectContaining({ approvedById: 'approver-1', approvedAt: now }));
    expect(applied).toMatchObject({ status: 'applied' });
    expect(repository.update).toHaveBeenCalledWith({ id: 'run-1' }, expect.objectContaining({ appliedConfigBundleRunId: 'apply-run-1' }));
    expect(rolledBack).toMatchObject({ status: 'rolled_back', rollbackConfigBundleRunId: 'rollback-run-1', rolledBackAt: now + 1 });
    expect(repository.update).toHaveBeenLastCalledWith({ id: 'run-1' }, expect.objectContaining({ rollbackConfigBundleRunId: 'rollback-run-1', rolledBackAt: now + 1 }));
  });

  it('retains a reviewed draft only in the encrypted detail snapshot and binds it to its engine', async () => {
    const repository = setup();
    const now = Date.now();
    const run = {
      id: 'run-1', engineId: 'engine-1', tenantId: null, sourceKind: 'live_api', status: 'previewed', inputHash: hash,
      mappingCatalogVersion: 'camunda7-v1-read-only', inventoryTruncated: false,
      normalizedCountsJson: '{"total":0,"proposed":0,"approval_required":0,"manual_required":0,"blocked":0}', classificationsJson: '[]',
      encryptedDetailedSnapshot: 'encrypted:{"authorizations":[{"groupId":"native-sensitive"}]}', detailedSnapshotExpiresAt: now + 1_000,
      draftHash: null, createdAt: now, updatedAt: now,
    };
    repository.findOne.mockResolvedValue(run);
    const service = new CamundaNativeGrantImportRunService();
    const draft = {
      bundle: { metadata: { key: 'migration' } }, files: {}, canonicalHash: hash,
      engineReference: { key: 'external.camunda-native-1234', engineId: 'engine-1', mode: 'existing_registered' as const },
      generated: { groupCount: 1, roleCount: 1, runtimeResourceSetCount: 1, assignmentCount: 1 },
      manualWorkAuthorizationIds: ['native-auth-1'],
    };

    await service.setDraft({ id: 'run-1', draftHash: hash, approverId: 'approver-1', draft, now });
    const stored = repository.update.mock.calls[0][1].encryptedDetailedSnapshot;
    expect(stored).toContain('native-sensitive');
    expect(stored).toContain('external.camunda-native-1234');

    repository.findOne.mockResolvedValue({ ...run, encryptedDetailedSnapshot: stored, draftHash: hash });
    expect(await service.getGeneratedDraft('run-1', now)).toEqual(draft);
  });

  it('retains every disposition as opaque counts without requiring a detailed snapshot', async () => {
    const repository = setup();
    const result = await new CamundaNativeGrantImportRunService().createPreview({
      engineId: 'engine-1', sourceKind: 'customer_export', inputHash: hash, mappingCatalogVersion: 'v1', inventoryTruncated: false,
      classifications: [
        baseClassification,
        { ...baseClassification, sourceAuthorizationId: 'approval', disposition: 'approval_required', reasonCodes: ['broad_resource_acknowledgement_required'], resourceId: '*', runtimeTenantId: null },
        { ...baseClassification, sourceAuthorizationId: 'manual', disposition: 'manual_required', reasonCodes: ['user_identity_mapping_required'], principal: { type: 'user' }, resourceKind: null, resourceId: 'unlinked-resource', mappedActionIds: [] },
        { ...baseClassification, sourceAuthorizationId: 'blocked', disposition: 'blocked', reasonCodes: ['runtime_resource_not_found'], principal: { type: 'global' }, resourceKind: null, resourceId: null, mappedActionIds: [] },
      ],
    });

    expect(result).toMatchObject({
      tenantId: null, detailedSnapshotAvailable: false, detailedSnapshotExpiresAt: null,
      normalizedCounts: { total: 4, proposed: 1, approval_required: 1, manual_required: 1, blocked: 1 },
    });
    expect(repository.insert).toHaveBeenCalledWith(expect.objectContaining({ encryptedDetailedSnapshot: null, createdById: null }));
  });

  it('fails closed for incomplete, invalid, or absent evidence and removes only expired encrypted detail', async () => {
    const repository = setup();
    repository.findOne.mockResolvedValue(null);
    const service = new CamundaNativeGrantImportRunService();

    await expect(service.createPreview({ engineId: '', sourceKind: 'live_api', inputHash: hash, mappingCatalogVersion: 'v1', inventoryTruncated: false, classifications: [] })).rejects.toThrow('Engine id is required');
    await expect(service.createPreview({ engineId: 'engine-1', sourceKind: 'live_api', inputHash: hash, mappingCatalogVersion: 'v1', inventoryTruncated: true, classifications: [] })).rejects.toThrow('truncated');
    await expect(service.createPreview({ engineId: 'engine-1', sourceKind: 'live_api', inputHash: 'invalid', mappingCatalogVersion: 'v1', inventoryTruncated: false, classifications: [] })).rejects.toThrow('Input hash');
    await expect(service.createPreview({ engineId: 'engine-1', sourceKind: 'live_api', inputHash: hash, mappingCatalogVersion: 'v1', inventoryTruncated: false, classifications: [], snapshotRetentionMs: 0 })).rejects.toThrow('Snapshot retention');
    await expect(service.createPreview({ engineId: 'engine-1', sourceKind: 'live_api', inputHash: hash, mappingCatalogVersion: 'x'.repeat(129), inventoryTruncated: false, classifications: [] })).rejects.toThrow('Mapping catalog');
    await expect(service.createPreview({ engineId: 'engine-1', sourceKind: 'live_api', inputHash: hash, mappingCatalogVersion: 'v1', inventoryTruncated: false, classifications: [], snapshotRetentionMs: DEFAULT_CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_MS + 1 })).rejects.toThrow('Snapshot retention');
    await expect(service.setDraft({ id: '', draftHash: hash, approverId: 'operator' })).rejects.toThrow('Import run id');
    await expect(service.setDraft({ id: 'run-1', draftHash: hash, approverId: '' })).rejects.toThrow('Import run id');
    await expect(service.markApplied({ id: '', configBundleApplyRunId: 'apply-1' })).rejects.toThrow('Import run id');
    await expect(service.markApplied({ id: 'run-1', configBundleApplyRunId: '' })).rejects.toThrow('Import run id');
    await expect(service.markRolledBack({ id: '', configBundleApplyRunId: 'apply-1' })).rejects.toThrow('Import run id');
    await expect(service.markRolledBack({ id: 'run-1', configBundleApplyRunId: '' })).rejects.toThrow('Import run id');
    expect(await service.setDraft({ id: 'missing', draftHash: hash, approverId: 'operator' })).toBeNull();
    expect(await service.markApplied({ id: 'missing', configBundleApplyRunId: 'apply-1' })).toBeNull();
    expect(await service.markRolledBack({ id: 'missing', configBundleApplyRunId: 'apply-1' })).toBeNull();
    expect(await service.getDetailedSnapshot('missing')).toBeNull();

    repository.update.mockResolvedValueOnce({ affected: 0 });
    expect(await service.purgeExpiredDetailedSnapshots(1234)).toBe(0);
    expect(repository.update).toHaveBeenLastCalledWith(expect.objectContaining({ detailedSnapshotExpiresAt: expect.anything(), encryptedDetailedSnapshot: expect.anything() }), {
      encryptedDetailedSnapshot: null, updatedAt: 1234,
    });
  });

  it('degrades malformed count JSON to an empty record while retaining opaque classifications', async () => {
    const repository = setup();
    const now = Date.now();
    repository.findOne.mockResolvedValue({
      id: 'run-1', engineId: 'engine-1', tenantId: null, sourceKind: 'live_api', status: 'previewed', inputHash: hash,
      mappingCatalogVersion: 'v1', inventoryTruncated: false, normalizedCountsJson: '{bad-json',
      classificationsJson: '[]', encryptedDetailedSnapshot: 'encrypted:{}', detailedSnapshotExpiresAt: null,
      draftHash: null, createdAt: now, updatedAt: now,
    });

    expect(await new CamundaNativeGrantImportRunService().getSummary('run-1')).toMatchObject({ normalizedCounts: {}, detailedSnapshotAvailable: true });
  });

  it('handles absent summaries and non-object count data without exposing a snapshot', async () => {
    const repository = setup();
    const now = Date.now();
    const stored = {
      id: 'run-1', engineId: 'engine-1', tenantId: null, sourceKind: 'live_api', status: 'previewed', inputHash: hash,
      mappingCatalogVersion: 'v1', inventoryTruncated: false, normalizedCountsJson: '[]', classificationsJson: '[]',
      encryptedDetailedSnapshot: null, detailedSnapshotExpiresAt: null, draftHash: null, createdAt: now, updatedAt: now,
    };
    repository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(stored).mockResolvedValueOnce({ ...stored, id: 'run-empty', normalizedCountsJson: null });
    const service = new CamundaNativeGrantImportRunService();

    expect(await service.getSummary('missing')).toBeNull();
    expect(await service.setDraft({ id: 'run-1', draftHash: hash, approverId: 'operator' })).toMatchObject({ normalizedCounts: {}, detailedSnapshotAvailable: false });
    expect(await service.getSummary('run-empty')).toMatchObject({ normalizedCounts: {} });
  });
});
