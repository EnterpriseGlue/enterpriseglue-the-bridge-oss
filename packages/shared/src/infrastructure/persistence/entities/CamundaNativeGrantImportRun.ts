import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/**
 * Opaque migration evidence for an imported Camunda 7 authorization inventory.
 * The optional detailed snapshot is encrypted and is removed at expiry; the
 * remaining row intentionally contains only hashes, counts, and opaque refs.
 */
@Entity({ name: 'camunda_native_grant_import_runs', schema: 'main' })
@Index('idx_camunda_native_grant_import_engine_created', ['engineId', 'createdAt'])
@Index('idx_camunda_native_grant_import_snapshot_expiry', ['detailedSnapshotExpiresAt'])
@Index('idx_camunda_native_grant_import_status_updated', ['status', 'updatedAt'])
export class CamundaNativeGrantImportRun extends AppBaseEntity {
  @Column({ name: 'engine_id', type: 'text' }) engineId!: string;
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'source_kind', type: 'text' }) sourceKind!: 'live_api' | 'customer_export';
  @Column({ type: 'text' }) status!: 'previewed' | 'draft_generated' | 'applied' | 'rolled_back' | 'failed';
  @Column({ name: 'input_hash', type: 'text' }) inputHash!: string;
  @Column({ name: 'mapping_catalog_version', type: 'text' }) mappingCatalogVersion!: string;
  @Column({ name: 'inventory_truncated', type: 'boolean', default: false }) inventoryTruncated!: boolean;
  @Column({ name: 'normalized_counts_json', type: 'text' }) normalizedCountsJson!: string;
  // Adapters map these two named evidence fields to their safe unbounded text
  // type. Values are separately capped before persistence.
  @Column({ name: 'classifications_json', type: 'text' }) classificationsJson!: string;
  @Column({ name: 'encrypted_detailed_snapshot', type: 'text', nullable: true }) encryptedDetailedSnapshot!: string | null;
  @Column({ name: 'detailed_snapshot_expires_at', type: 'bigint', nullable: true }) detailedSnapshotExpiresAt!: number | null;
  @Column({ name: 'draft_hash', type: 'text', nullable: true }) draftHash!: string | null;
  @Column({ name: 'created_by_id', type: 'text', nullable: true }) createdById!: string | null;
  @Column({ name: 'approved_by_id', type: 'text', nullable: true }) approvedById!: string | null;
  @Column({ name: 'approved_at', type: 'bigint', nullable: true }) approvedAt!: number | null;
  @Column({ name: 'applied_config_bundle_run_id', type: 'text', nullable: true }) appliedConfigBundleRunId!: string | null;
  @Column({ name: 'rollback_config_bundle_run_id', type: 'text', nullable: true }) rollbackConfigBundleRunId!: string | null;
  @Column({ name: 'rolled_back_at', type: 'bigint', nullable: true }) rolledBackAt!: number | null;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
}
